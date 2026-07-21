import { ImapFlow } from 'imapflow';
import type { MessageStructureObject } from 'imapflow';

type PollPasswordResetLinkOptions = {
  email: string;
  password: string;
  host?: string;
  port?: number;
  minReceivedAt: Date;
  maxWaitMs?: number;
  pollMs?: number;
};

export type PasswordResetEmailReceipt = {
  subject: string;
  from: string;
  receivedAt: Date;
};

type PollPasswordResetEmailOptions = PollPasswordResetLinkOptions & {
  recipientEmail?: string;
};

async function fetchLatestPasswordResetEmail(
  options: PollPasswordResetEmailOptions
): Promise<PasswordResetEmailReceipt | null> {
  const hostCandidate = options.host?.trim();
  const host = (!hostCandidate || /^[•*\s]+$/.test(hostCandidate)) ? 'imap.gmail.com' : hostCandidate;

  const client = new ImapFlow({
    host,
    port: options.port ?? 993,
    secure: true,
    auth: { user: options.email, pass: options.password.replace(/\s/g, '') },
    logger: false
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(options.minReceivedAt.getTime() - 10_000);
      const uidsRaw = await client.search({ since }, { uid: true });
      const uids = Array.isArray(uidsRaw) ? uidsRaw : [];

      for (const uid of [...uids].reverse()) {
        const message = await client.fetchOne(
          String(uid),
          { envelope: true, internalDate: true },
          { uid: true }
        );
        if (!message || !message.envelope) continue;

        const rawReceivedAt = message.internalDate ?? message.envelope.date;
        if (!rawReceivedAt) continue;
        const receivedAt = rawReceivedAt instanceof Date ? rawReceivedAt : new Date(rawReceivedAt);
        if (receivedAt.getTime() < options.minReceivedAt.getTime() - 10_000) continue;

        const subject = message.envelope.subject ?? '';
        if (!/reset password|password reset|şifre sıfırlama/i.test(subject)) continue;

        const recipients = message.envelope.to
          ?.map(address => address.address?.toLowerCase() ?? '')
          .filter(Boolean) ?? [];
        if (
          options.recipientEmail &&
          recipients.length > 0 &&
          !recipients.includes(options.recipientEmail.toLowerCase())
        ) continue;

        const fromAddress = message.envelope.from?.[0]?.address ?? 'unknown';
        return { subject, from: fromAddress, receivedAt };
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return null;
}

export async function pollPasswordResetEmail(
  options: PollPasswordResetEmailOptions
): Promise<PasswordResetEmailReceipt> {
  const maxWaitMs = options.maxWaitMs ?? 120_000;
  const pollMs = options.pollMs ?? 5_000;
  const deadline = Date.now() + maxWaitMs;
  let lastConnectionError: unknown;

  while (Date.now() < deadline) {
    try {
      const email = await fetchLatestPasswordResetEmail(options);
      if (email) return email;
      lastConnectionError = undefined;
    } catch (error) {
      lastConnectionError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⚠️ [FORGOT PASSWORD] Geçici IMAP okuma hatası, yeniden denenecek: ${message || 'Bağlantı hatası'}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Reset Password e-postası ${maxWaitMs / 1000} saniye içinde Gmail kutusunda bulunamadı.`,
    lastConnectionError ? { cause: lastConnectionError } : undefined
  );
}

export function decodeEmailContent(raw: string): string {
  const withDecodedBase64Parts = raw.replace(
    /Content-Transfer-Encoding:\s*base64[^\r\n]*\r?\n\r?\n([A-Za-z0-9+/=\r\n]+?)(?=\r?\n--)/gi,
    (_, encodedBody: string) => Buffer.from(encodedBody.replace(/\s/g, ''), 'base64').toString('utf8')
  );

  return withDecodedBase64Parts
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    )
    .replace(/&amp;/gi, '&');
}

export function extractPasswordResetLink(raw: string): string | null {
  const decoded = decodeEmailContent(raw);
  const urls = decoded.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const parsedUrls = urls.flatMap(value => {
    try {
      return [{ value, url: new URL(value) }];
    } catch {
      return [];
    }
  });
  const validDashboardResetLink = parsedUrls.find(({ url }) =>
    /(?:^|\.)dashboard\.gitsec\.io$/i.test(url.hostname) &&
    /forgot-password|reset-password|password-reset|reset|change-password/i.test(url.pathname)
  );
  if (validDashboardResetLink) return validDashboardResetLink.value;

  const malformedDashboardLink = parsedUrls.some(({ url }) =>
    /dashboard\.gitsec\.io(?:forgot|reset|password|change)/i.test(url.hostname)
  );
  if (malformedDashboardLink) {
    throw new InvalidPasswordResetLinkError(
      'E-postadaki şifre sıfırlama linki hatalı: dashboard domaininden sonra "/" eksik.'
    );
  }

  return parsedUrls.find(({ url }) =>
    /forgot-password|reset-password|password-reset|reset|change-password/i.test(url.pathname)
  )?.value ?? null;
}

class InvalidPasswordResetLinkError extends Error {}

function collectTextPartIds(node?: MessageStructureObject, isRoot = true): string[] {
  if (!node) return [];
  if (node.childNodes?.length) return node.childNodes.flatMap(child => collectTextPartIds(child, false));
  if (!/^text\/(?:plain|html)$/i.test(node.type)) return [];
  return [node.part || (isRoot ? '1' : '')].filter(Boolean);
}

async function fetchLatestPasswordResetLink(
  options: PollPasswordResetLinkOptions
): Promise<string | null> {
  const hostCandidate = options.host?.trim();
  const host = (!hostCandidate || /^[•*\s]+$/.test(hostCandidate)) ? 'imap.gmail.com' : hostCandidate;

  const client = new ImapFlow({
    host,
    port: options.port ?? 993,
    secure: true,
    auth: { user: options.email, pass: options.password.replace(/\s/g, '') },
    logger: false
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(options.minReceivedAt.getTime() - 60_000);
      const uidsRaw = await client.search({ since }, { uid: true });
      const uids = Array.isArray(uidsRaw) ? uidsRaw : [];

      for (const uid of [...uids].reverse()) {
        const message = await client.fetchOne(
          String(uid),
          { source: true, internalDate: true, bodyStructure: true, envelope: true },
          { uid: true }
        );
        if (!message || !message.source) continue;

        const receivedAt = message.internalDate
          ? message.internalDate instanceof Date
            ? message.internalDate
            : new Date(message.internalDate)
          : undefined;
        if (receivedAt && receivedAt.getTime() < options.minReceivedAt.getTime() - 60_000) {
          continue;
        }

        const textPartIds = collectTextPartIds(message.bodyStructure);
        let decodedBody = '';
        if (textPartIds.length > 0) {
          const parts = await client.downloadMany(String(uid), textPartIds, { uid: true });
          decodedBody = Object.values(parts)
            .map(part => part.content?.toString('utf8') ?? '')
            .join('\n');
        }

        if (/reset password/i.test(message.envelope?.subject ?? '')) {
          const urlCount = (decodedBody.match(/https?:\/\//gi) ?? []).length;
          console.log(
            `🔎 [FORGOT PASSWORD] Reset e-postası incelendi: textParts=${textPartIds.length}, ` +
            `bodyType=${message.bodyStructure?.type ?? 'unknown'}, bodyPart=${message.bodyStructure?.part ?? 'root'}, ` +
            `decodedLength=${decodedBody.length}, rawLength=${message.source.length}, urls=${urlCount}`
          );
        }

        const link = extractPasswordResetLink(decodedBody || message.source.toString());
        if (link) return link;
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }

  return null;
}

export async function pollPasswordResetLink(
  options: PollPasswordResetLinkOptions
): Promise<string> {
  const maxWaitMs = options.maxWaitMs ?? 120_000;
  const pollMs = options.pollMs ?? 5_000;
  const deadline = Date.now() + maxWaitMs;
  let lastConnectionError: unknown;

  while (Date.now() < deadline) {
    try {
      const link = await fetchLatestPasswordResetLink(options);
      if (link) return link;
      lastConnectionError = undefined;
    } catch (error) {
      if (error instanceof InvalidPasswordResetLinkError) throw error;
      lastConnectionError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`⚠️ [FORGOT PASSWORD] Geçici IMAP okuma hatası, yeniden denenecek: ${message || 'Bağlantı hatası'}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  throw new Error(
    `Şifre sıfırlama e-postası ${maxWaitMs / 1000} saniye içinde ulaşmadı.`,
    lastConnectionError ? { cause: lastConnectionError } : undefined
  );
}
