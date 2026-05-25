import { ImapFlow } from 'imapflow';

export type PollGithubOtpOptions = {
  maxWaitMs?: number;
  pollMs?: number;
  /** Son N dakikadaki iletilere bak (varsayılan 15) */
  lookbackMinutes?: number;
  /** "Verify via email" tıklandıktan sonra gelen postalar (eski kodları elemek için). */
  minReceivedAt?: Date;
  /** Daha önce denenen kodlar (retry'da aynı kodu tekrar kullanma). */
  excludeCodes?: string[];
};

/** YYYYMMDD gibi takvim tarihlerini OTP sanma (ör. 20240605). */
function looksLikeCalendarDate8(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  const y = Number(digits.slice(0, 4));
  const m = Number(digits.slice(4, 6));
  const d = Number(digits.slice(6, 8));
  if (y < 1990 || y > 2035 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  return true;
}

function isPlausibleOtp8(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  if (looksLikeCalendarDate8(digits)) return false;
  return true;
}

function decodeQuotedPrintableChunk(chunk: string): string {
  return chunk
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/** Ham MIME source içinden yalnızca text/plain + text/html gövdesini çıkar (header/metadata hariç). */
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

/** GitHub sudo mailindeki gerçek 8 haneli kod (tarih/header sayıları elenir). */
export function extractSudoOtp8(subject: string, body: string): string | null {
  const text = `${subject}\n${body}`;

  const contextual = [
    /verification code[^0-9]{0,80}(\d{8})/i,
    /sudo[^0-9]{0,80}(\d{8})/i,
    /one-time code[^0-9]{0,80}(\d{8})/i,
    /security code[^0-9]{0,80}(\d{8})/i,
    /enter[^0-9]{0,40}8-digit[^0-9]{0,40}(\d{8})/i,
    /(\d{8})[^0-9]{0,40}is your GitHub/i,
    /code[:\s]+(\d{8})/i,
  ];
  for (const p of contextual) {
    const hit = text.match(p);
    if (hit?.[1] && isPlausibleOtp8(hit[1])) {
      return hit[1];
    }
  }

  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (/^\d{8}$/.test(t) && isPlausibleOtp8(t)) {
      return t;
    }
  }

  for (const hit of body.matchAll(/\b(\d{8})\b/g)) {
    if (isPlausibleOtp8(hit[1])) {
      return hit[1];
    }
  }

  return null;
}

function extractOtpFromGithubMessage(subject: string, rawSource: string, sudoOnly: boolean): string | null {
  const body = extractEmailBodiesFromMimeSource(rawSource);
  const eight = extractSudoOtp8(subject, body);
  if (eight) return eight;

  if (!sudoOnly) {
    // Look for 6 digit codes often used in device verification
    const six = body.match(/\b(\d{6})\b/);
    if (six) return six[1];

    // Fallback for alphanumeric codes if any
    const alphaNum = body.match(/\b([0-9a-fA-F]{5}-?[0-9a-fA-F]{5})\b/);
    if (alphaNum) return alphaNum[1];
  }

  return null;
}

function getEnvOrThrow(): { user: string; pass: string; host: string; port: number } {
  const user = process.env.GITHUB_MAIL_USER?.trim();
  const passRaw = process.env.GITHUB_MAIL_PASSWORD;
  const pass = passRaw?.replace(/\s/g, '') ?? '';
  if (!user || !pass) {
    throw new Error(
      '.env içine GITHUB_MAIL_USER (tam Gmail adresin) ve GITHUB_MAIL_PASSWORD (16 hanelik uygulama şifresi, boşluksuz da yazılabilir) ekleyin.'
    );
  }
  const host = process.env.GITHUB_MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  const port = Number(process.env.GITHUB_MAIL_IMAP_PORT || '993');
  return { user, pass, host, port };
}

/**
 * Tek seferlik INBOX taraması: son X dakikada GitHub’dan gelen ilk doğrulama kodunu döner.
 * Sudo e-postası 8 hane, klasik cihaz doğrulaması 6 hane olabilir — önce 8, sonra 6 aranır.
 */
export async function tryFetchGithubOtpFromImapOnce(
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
        if (minReceivedAt && msgDate && msgDate.getTime() < minReceivedAt.getTime() - 2000) {
          continue;
        }

        const fromAddr = env?.from?.[0]?.address?.toLowerCase() ?? '';
        const fromName = env?.from?.[0]?.name?.toLowerCase() ?? '';
        if (!fromAddr.includes('github') && !fromName.includes('github')) {
          continue;
        }

        const subject = env?.subject ?? '';
        let raw = '';
        if (Buffer.isBuffer(msg.source)) {
          raw = msg.source.toString('utf8');
        } else if (typeof msg.source === 'string') {
          raw = msg.source;
        }

        if (
          minReceivedAt &&
          !/verif|one-time|security|sudo|confirm|login|8-digit/i.test(subject) &&
          !/sudo|verification code/i.test(raw.slice(0, 2000))
        ) {
          continue;
        }

        const body = extractEmailBodiesFromMimeSource(raw);
        const code = extractOtpFromGithubMessage(subject, raw, false); // Device verification needs 6 digits too
        if (!code || excludeCodes.includes(code)) {
          continue;
        }
        hits.push({
          code,
          at: msgDate?.getTime() ?? 0,
          subject,
          from: fromAddr || fromName,
        });
        if (hits.length === 1 && process.env.GITHUB_MAIL_DEBUG !== '0') {
          const bodyPreview = body.replace(/\s+/g, ' ').slice(0, 120);
          console.log(`[imap-debug] gövde önizleme: "${bodyPreview}…"`);
        }
      }

      if (!hits.length) {
        console.log('[imap-debug] Bu taramada uygun GitHub kodu bulunamadı.');
        return null;
      }
      hits.sort((a, b) => b.at - a.at);
      console.log('[imap-debug] --- IMAP aday kodlar (en yeni üstte, en fazla 5) ---');
      for (const h of hits.slice(0, 5)) {
        const when = h.at ? new Date(h.at).toISOString() : '?';
        console.log(`[imap-debug]   kod="${h.code}"  tarih=${when}  kimden=${h.from}`);
        console.log(`[imap-debug]   konu: ${h.subject.slice(0, 100)}`);
      }
      console.log(`[imap-debug] SEÇİLEN (kutuya yazılacak): "${hits[0].code}"`);
      if (minReceivedAt) {
        console.log(`[imap-debug] minReceivedAt filtresi: ${minReceivedAt.toISOString()}`);
      }
      if (excludeCodes.length) {
        console.log(`[imap-debug] hariç tutulan kodlar: ${excludeCodes.join(', ')}`);
      }
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

/**
 * "Verify via email" sonrası postaya düşen kodu bekler (IMAP ile). 8 veya 6 haneli kod desteklenir.
 */
export async function pollGithubEmailOtp(options?: PollGithubOtpOptions): Promise<string> {
  const maxWait = options?.maxWaitMs ?? 120_000;
  const pollMs = options?.pollMs ?? 3000;
  const lookback = options?.lookbackMinutes ?? 15;
  const minReceivedAt = options?.minReceivedAt;
  const excludeCodes = options?.excludeCodes ?? [];
  const deadline = Date.now() + maxWait;

  console.log(
    `[imap-debug] poll başladı (max ${maxWait}ms, lookback ${lookback} dk` +
    (minReceivedAt ? `, Verify sonrası: ${minReceivedAt.toISOString()}` : '') +
    ')'
  );

  while (Date.now() < deadline) {
    const code = await tryFetchGithubOtpFromImapOnce(lookback, minReceivedAt, excludeCodes);
    if (code) {
      console.log(`[imap-debug] poll bitti, dönen kod: "${code}"`);
      return code;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }

  throw new Error(`GitHub e-posta kodu ${maxWait} ms içinde bulunamadı (IMAP / gönderen filtresi / süre).`);
}

export type GithubMailDiagnosticRow = {
  date: string;
  from: string;
  subject: string;
  isGithub: boolean;
  code: string | null;
};

export type GithubMailDiagnostic = {
  ok: boolean;
  imapHost: string;
  imapPort: number;
  mailUser: string;
  lookbackMinutes: number;
  totalMessagesInWindow: number;
  githubMessages: number;
  rows: GithubMailDiagnosticRow[];
  extractedCode: string | null;
  error?: string;
};


/**
 * IMAP bağlantısı + son N dakikadaki postaları listeler (kod çekimi testi için).
 */
export async function diagnoseGithubMailInbox(lookbackMinutes = 30): Promise<GithubMailDiagnostic> {
  const user = process.env.GITHUB_MAIL_USER?.trim() ?? '';
  const pass = process.env.GITHUB_MAIL_PASSWORD?.replace(/\s/g, '') ?? '';
  const host = process.env.GITHUB_MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  const port = Number(process.env.GITHUB_MAIL_IMAP_PORT || '993');

  const base: GithubMailDiagnostic = {
    ok: false,
    imapHost: host,
    imapPort: port,
    mailUser: user,
    lookbackMinutes,
    totalMessagesInWindow: 0,
    githubMessages: 0,
    rows: [],
    extractedCode: null,
  };

  if (!user || !pass) {
    return {
      ...base,
      error: 'GITHUB_MAIL_USER veya GITHUB_MAIL_PASSWORD .env içinde eksik.',
    };
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
      const since = new Date(Date.now() - lookbackMinutes * 60 * 1000);
      const uidsRaw = await client.search({ since }, { uid: true });
      const list = Array.isArray(uidsRaw) ? uidsRaw : [];
      base.totalMessagesInWindow = list.length;

      for (const uid of [...list].reverse().slice(0, 25)) {
        const msg = await client.fetchOne(String(uid), { envelope: true, source: true }, { uid: true });
        if (!msg) continue;

        const env = msg.envelope;
        const fromAddr = env?.from?.[0]?.address ?? '';
        const fromName = env?.from?.[0]?.name ?? '';
        const from = fromName ? `${fromName} <${fromAddr}>` : fromAddr;
        const isGithub =
          fromAddr.toLowerCase().includes('github') || fromName.toLowerCase().includes('github');

        let raw = '';
        if (Buffer.isBuffer(msg.source)) raw = msg.source.toString('utf8');
        else if (typeof msg.source === 'string') raw = msg.source;

        const subject = env?.subject ?? '(konu yok)';
        const code = isGithub ? extractOtpFromGithubMessage(subject, raw, true) : null;

        if (isGithub) base.githubMessages += 1;
        if (code && !base.extractedCode) base.extractedCode = code;

        base.rows.push({
          date: env?.date ? new Date(env.date).toISOString() : '?',
          from,
          subject: subject.slice(0, 120),
          isGithub,
          code,
        });
      }

      base.ok = true;
      return base;
    } finally {
      lock.release();
    }
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}
