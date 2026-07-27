import { ImapFlow } from 'imapflow';

export type PollAtlassianOtpOptions = {
  maxWaitMs?: number;
  pollMs?: number;
  lookbackMinutes?: number;
  minReceivedAt?: Date;
  excludeCodes?: string[];
};

function decodeQuotedPrintableChunk(chunk: string): string {
  return chunk
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

export function extractEmailBodiesFromMimeSource(raw: string): string {
  const bodies: string[] = [];
  const partRe =
    /Content-Type:\s*text\/(?:plain|html)[^\r\n]*(?:[\r\n]+Content-Transfer-Encoding:[^\r\n]*)?[\r\n]+([\s\S]*?)(?=\r\n--[^\r\n]+|\r\nContent-Type:|$)/gi;

  let m: RegExpExecArray | null;
  while ((m = partRe.exec(raw)) !== null) {
    let chunk = decodeQuotedPrintableChunk(m[1]);
    if (/text\/html/i.test(m[0])) {
      chunk = chunk.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
    }
    bodies.push(chunk);
  }

  if (bodies.length === 0) {
    const headerEnd = raw.search(/\r\n\r\n/);
    if (headerEnd >= 0) {
      bodies.push(raw.slice(headerEnd + 4, headerEnd + 12000));
    }
  }

  return bodies.join('\n').replace(/\s+/g, ' ').trim();
}

/**
 * Atlassian e-postasından 6 haneli harf/sayı (Alphanumeric) OTP kodunu çıkarır (örneğin "0Q0R7P").
 */
export function extractAtlassianOtp(subject: string, rawSource: string): string | null {
  const body = extractEmailBodiesFromMimeSource(rawSource);
  const text = `${subject}\n${body}`;

  // 1. Contextual regexes (Atlassian özel kalıpları)
  const contextualPatterns = [
    /kodu girin:\s*([A-Z0-9]{6})/i,
    /enter the code:\s*([A-Z0-9]{6})/i,
    /verification code:\s*([A-Z0-9]{6})/i,
    /security code:\s*([A-Z0-9]{6})/i,
    /code:\s*([A-Z0-9]{6})/i,
    /([A-Z0-9]{6})\s*is your Atlassian/i,
  ];

  for (const pattern of contextualPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].toUpperCase();
      if (candidate.length === 6 && !/^(CANCEL|SUBMIT|LOGIN|VERIFY|STATUS)$/i.test(candidate)) {
        return candidate;
      }
    }
  }

  // 2. Standalone 6-character alphanumeric uppercase token match
  const matches = text.matchAll(/\b([A-Z0-9]{6})\b/g);
  for (const m of matches) {
    const candidate = m[1].toUpperCase();
    if (candidate.length === 6 && /[0-9]/.test(candidate) && /[A-Z]/.test(candidate) && !/^(CANCEL|SUBMIT|LOGIN|VERIFY|STATUS)$/i.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function tryFetchAtlassianOtpFromImapOnce(
  lookbackMinutes: number,
  minReceivedAt?: Date,
  excludeCodes: string[] = []
): Promise<string | null> {
  const user = process.env.FORGOT_PASSWORD_MAIL_USER?.trim() || process.env.GITHUB_MAIL_USER?.trim();
  const pass = process.env.FORGOT_PASSWORD_MAIL_PASSWORD?.trim() || process.env.GITHUB_MAIL_PASSWORD?.trim();
  const host = process.env.FORGOT_PASSWORD_MAIL_IMAP_HOST?.trim() || process.env.GITHUB_MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  const port = Number(process.env.FORGOT_PASSWORD_MAIL_IMAP_PORT || process.env.GITHUB_MAIL_IMAP_PORT || '993');

  if (!user || !pass) {
    console.error('❌ [imap-atlassian] GMAIL IMAP e-posta kullanıcı adı veya şifresi .env dosyasında bulunamadı.');
    return null;
  }

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const sinceDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const messages: Array<{ date: Date; subject: string; from: string; body: string }> = [];

      for await (const message of client.fetch({ since: sinceDate }, { envelope: true, source: true })) {
        const fromAddr = message.envelope?.from?.[0]?.address || '';
        const subject = message.envelope?.subject || '';
        const date = message.envelope?.date ? new Date(message.envelope.date) : new Date();

        // Sadece Atlassian e-postalarına bak
        const isAtlassian = /atlassian/i.test(fromAddr) || /atlassian/i.test(subject) || /tamamlamak/i.test(subject) || /doğrulama/i.test(subject) || /verify/i.test(subject);

        if (isAtlassian) {
          const rawSource = message.source ? message.source.toString('utf8') : '';
          messages.push({ date, subject, from: fromAddr, body: rawSource });
        }
      }

      messages.sort((a, b) => b.date.getTime() - a.date.getTime());

      for (const msg of messages) {
        if (minReceivedAt && msg.date.getTime() < minReceivedAt.getTime() - 10000) {
          continue;
        }

        const otp = extractAtlassianOtp(msg.subject, msg.body);
        if (otp && !excludeCodes.includes(otp)) {
          console.log(`🎯 [ATLASSIAN IMAP] Kod Bulundu! Kimden: "${msg.from}" Konu: "${msg.subject}" Kod: "${otp}"`);
          return otp;
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return null;
}

export async function pollAtlassianEmailOtp(options?: PollAtlassianOtpOptions): Promise<string> {
  const maxWait = options?.maxWaitMs ?? 60_000;
  const pollMs = options?.pollMs ?? 3000;
  const lookback = options?.lookbackMinutes ?? 15;
  const minReceivedAt = options?.minReceivedAt;
  const excludeCodes = options?.excludeCodes ?? [];
  const deadline = Date.now() + maxWait;

  console.log(`📬 [ATLASSIAN IMAP] Gelen kutusunda Atlassian MFA e-postası taranıyor...`);

  let attempt = 1;
  while (Date.now() < deadline) {
    console.log(`📬 [ATLASSIAN IMAP] E-posta bekleniyor... (Deneme #${attempt}, Kalan Süre: ${Math.round((deadline - Date.now())/1000)}sn)`);
    const code = await tryFetchAtlassianOtpFromImapOnce(lookback, minReceivedAt, excludeCodes);
    if (code) {
      console.log(`🎉 [ATLASSIAN IMAP] 6 Haneli Alfasayısal Kod Başarıyla Çekildi: "${code}"`);
      return code;
    }
    attempt++;
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`❌ Atlassian e-posta MFA kodu ${maxWait}ms içinde bulunamadı.`);
}
