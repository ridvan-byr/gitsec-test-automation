import { ImapFlow } from 'imapflow';
import { extractEmailBodiesFromMimeSource } from './github-email-otp';

export type PollMicrosoftOtpOptions = {
  maxWaitMs?: number;
  pollMs?: number;
  lookbackMinutes?: number;
  minReceivedAt?: Date;
  excludeCodes?: string[];
};

function isPlausibleOtp6(digits: string): boolean {
  if (!/^\d{6}$/.test(digits)) return false;
  return true;
}

export function extractMicrosoftOtp6(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;

  const contextual = [
    /security code[^0-9]{0,80}(\d{6})/i,
    /güvenlik kodu[^0-9]{0,80}(\d{6})/i,
    /tek kullanımlık kod[^0-9]{0,80}(\d{6})/i,
    /verification code[^0-9]{0,80}(\d{6})/i,
    /doğrulama kodu[^0-9]{0,80}(\d{6})/i,
    /use[^0-9]{0,40}(\d{6})[^0-9]{0,40}as/i,
    /code[:\s]+(\d{6})/i,
    /kod[:\s]+(\d{6})/i,
  ];

  for (const p of contextual) {
    const hit = text.match(p);
    if (hit?.[1] && isPlausibleOtp6(hit[1])) {
      return hit[1];
    }
  }

  // Fallback: Find any 6-digit number
  for (const hit of body.matchAll(/\b(\d{6})\b/g)) {
    if (isPlausibleOtp6(hit[1])) {
      return hit[1];
    }
  }

  return null;
}

function getEnvOrThrow(): { user: string; pass: string; host: string; port: number } {
  const user = process.env.GITHUB_MAIL_USER?.trim();
  const passRaw = process.env.GITHUB_MAIL_PASSWORD;
  const pass = passRaw?.replace(/\s/g, '') ?? '';
  if (!user || !pass) {
    throw new Error(
      '.env içine GITHUB_MAIL_USER ve GITHUB_MAIL_PASSWORD ekleyin.'
    );
  }
  const host = process.env.GITHUB_MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  const port = Number(process.env.GITHUB_MAIL_IMAP_PORT || '993');
  return { user, pass, host, port };
}

export async function tryFetchMicrosoftOtpFromImapOnce(
  lookbackMinutes = 15,
  minReceivedAt?: Date,
  excludeCodes: string[] = []
): Promise<string | null> {
  const { user, pass, host, port } = getEnvOrThrow();
  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const uidsRaw = await client.search({ since }, { uid: true });
      const uids = Array.isArray(uidsRaw) ? uidsRaw : [];
      if (uids.length === 0) {
        return null;
      }

      type Hit = { code: string; at: number; subject: string; from: string };
      const hits: Hit[] = [];

      for (const uid of [...uids].reverse()) {
        const msg = await client.fetchOne(
          String(uid),
          { envelope: true, source: true, internalDate: true },
          { uid: true }
        );
        if (!msg) {
          continue;
        }

        const env = msg.envelope;
        const msgDate =
          msg.internalDate instanceof Date
            ? msg.internalDate
            : env?.date
              ? new Date(env.date)
              : null;
        if (minReceivedAt && msgDate && msgDate.getTime() < minReceivedAt.getTime() - 180000) {
          continue;
        }

        const fromAddr = env?.from?.[0]?.address?.toLowerCase() ?? '';
        const fromName = env?.from?.[0]?.name?.toLowerCase() ?? '';
        
        // Microsoft / Outlook / Live mail checks
        const isMicrosoft = 
          fromAddr.includes('microsoft') || 
          fromName.includes('microsoft') ||
          fromAddr.includes('live.com') ||
          fromAddr.includes('outlook.com');

        if (!isMicrosoft) {
          continue;
        }

        const subject = env?.subject ?? '';
        let raw = '';
        if (Buffer.isBuffer(msg.source)) {
          raw = msg.source.toString('utf8');
        } else if (typeof msg.source === 'string') {
          raw = msg.source;
        }

        const body = extractEmailBodiesFromMimeSource(raw);
        const code = extractMicrosoftOtp6(subject, body);
        if (!code || excludeCodes.includes(code)) {
          continue;
        }
        hits.push({
          code,
          at: msgDate?.getTime() ?? 0,
          subject,
          from: fromAddr || fromName,
        });
      }

      if (!hits.length) {
        return null;
      }
      // Sort newest first
      hits.sort((a, b) => b.at - a.at);
      
      console.log(`[imap-microsoft] KOD BULUNDU: "${hits[0].code}"`);
      console.log(`[imap-microsoft] Konu: "${hits[0].subject}"`);
      console.log(`[imap-microsoft] Gönderen: ${hits[0].from}`);
      
      return hits[0].code;
    } finally {
      lock.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

export async function pollMicrosoftEmailOtp(options?: PollMicrosoftOtpOptions): Promise<string> {
  const maxWait = options?.maxWaitMs ?? 120_000;
  const pollMs = options?.pollMs ?? 3000;
  const lookback = options?.lookbackMinutes ?? 15;
  const minReceivedAt = options?.minReceivedAt;
  const excludeCodes = options?.excludeCodes ?? [];
  const deadline = Date.now() + maxWait;

  console.log(
    `[imap-microsoft] Microsoft OTP için mail taraması başladı (max ${maxWait}ms, lookback ${lookback} dk)`
  );

  let attempt = 1;
  while (Date.now() < deadline) {
    console.log(`📬 [imap-microsoft] Gelen kutusu taranıyor, yeni e-posta bekleniyor... (Deneme #${attempt}, Kalan Süre: ${Math.round((deadline - Date.now())/1000)}sn)`);
    try {
      const code = await tryFetchMicrosoftOtpFromImapOnce(lookback, minReceivedAt, excludeCodes);
      if (code) {
        console.log(`[imap-microsoft] Microsoft OTP başarıyla alındı: "${code}"`);
        return code;
      }
    } catch (e) {
      console.log('[imap-microsoft] Hata (tarama devam edecek):', e);
    }
    attempt++;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`Microsoft e-posta kodu ${maxWait} ms içinde bulunamadı.`);
}
