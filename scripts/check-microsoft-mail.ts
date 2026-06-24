import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { extractEmailBodiesFromMimeSource } from '../tests/support/github-email-otp';
import { extractMicrosoftOtp6 } from '../tests/support/microsoft-email-otp';

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

async function main() {
  console.log('=== Microsoft/Outlook mail / IMAP kontrolü ===\n');

  const user = process.env.GITHUB_MAIL_USER?.trim();
  const pass = process.env.GITHUB_MAIL_PASSWORD?.replace(/\s/g, '');
  console.log('[1] .env');
  console.log(`    GITHUB_MAIL_USER: ${user ? maskEmail(user) : '(YOK)'}`);
  console.log(`    GITHUB_MAIL_PASSWORD: ${pass ? `ayarlı (${pass.length} karakter)` : '(YOK)'}`);
  if (!user || !pass) {
    console.log('\nSONUÇ: FAIL — .env dosyasına mail bilgilerini ekleyin.');
    process.exit(1);
  }

  const host = process.env.GITHUB_MAIL_IMAP_HOST?.trim() || 'imap.gmail.com';
  const port = Number(process.env.GITHUB_MAIL_IMAP_PORT || '993');

  console.log('\n[2] IMAP bağlantısı + INBOX taraması (son 30 dk)...');
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
      const since = new Date(Date.now() - 30 * 60 * 1000);
      const uidsRaw = await client.search({ since }, { uid: true });
      const uids = Array.isArray(uidsRaw) ? uidsRaw : [];
      console.log(`    Bağlantı: OK`);
      console.log(`    Penceredeki toplam posta (son 30 dk): ${uids.length}`);

      let microsoftCount = 0;
      let matchedCode: string | null = null;

      console.log('\n[3] Son postalar (en yeni üstte, en fazla 25):');
      if (uids.length === 0) {
        console.log('    (son 30 dakikada posta yok)');
      } else {
        for (const uid of [...uids].reverse().slice(0, 25)) {
          const msg = await client.fetchOne(
            String(uid),
            { envelope: true, source: true, internalDate: true },
            { uid: true }
          );
          if (!msg) continue;

          const env = msg.envelope;
          const fromAddr = env?.from?.[0]?.address?.toLowerCase() ?? '';
          const fromName = env?.from?.[0]?.name?.toLowerCase() ?? '';
          
          const isMicrosoft = 
            fromAddr.includes('microsoft') || 
            fromName.includes('microsoft') ||
            fromAddr.includes('live.com') ||
            fromAddr.includes('outlook.com');

          let raw = '';
          if (Buffer.isBuffer(msg.source)) {
            raw = msg.source.toString('utf8');
          } else if (typeof msg.source === 'string') {
            raw = msg.source;
          }

          const subject = env?.subject ?? '(konu yok)';
          const body = extractEmailBodiesFromMimeSource(raw);
          const code = extractMicrosoftOtp6(subject, body);

          const tag = isMicrosoft ? 'MICROSOFT' : 'diğer';
          console.log(`    [${tag}] ${env?.date ? new Date(env.date).toISOString() : '?'}`);
          console.log(`           Konu: ${subject}`);
          console.log(`           Kimden: ${fromName} <${fromAddr}>`);
          
          // Print all found 6-digit numbers in body as diagnostic
          const all6Digits: string[] = [];
          for (const hit of body.matchAll(/\b(\d{6})\b/g)) {
            all6Digits.push(hit[1]);
          }
          if (all6Digits.length > 0) {
            console.log(`           Gövdedeki tüm 6 haneli sayılar: ${all6Digits.join(', ')}`);
          }

          if (isMicrosoft) {
            microsoftCount++;
            console.log(`           Gövde önizleme: ${body.replace(/\s+/g, ' ').slice(0, 200)}...`);
            if (code) {
              console.log(`           --> EŞLEŞEN KOD: "${code}"`);
              if (!matchedCode) matchedCode = code;
            } else {
              console.log(`           --> EŞLEŞEN KOD BULUNAMADI`);
            }
          }
        }
      }

      console.log('\n[4] Sonuç');
      if (matchedCode) {
        console.log(`    SONUÇ: OK — Çekilen kod: ${matchedCode}`);
      } else if (microsoftCount > 0) {
        console.log(`    SONUÇ: FAIL — Microsoft maili var ama içinden 6 haneli OTP kodu süzülemedi.`);
      } else {
        console.log(`    SONUÇ: FAIL — Son 30 dk içinde Microsoft/Outlook ile ilgili bir mail bulunamadı.`);
      }
    } finally {
      lock.release();
    }
  } catch (e: any) {
    console.log(`\nSONUÇ: FAIL — IMAP hatası: ${e.message}`);
  } finally {
    try {
      await client.logout();
    } catch {}
  }
}

main();
