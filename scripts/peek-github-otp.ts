/**
 * IMAP + GitHub postası testi:
 * - `tryFetchGithubOtpFromImapOnce`: SON 15 DAKİKADA gelen GitHub kodlu postada 8 veya 6 hane arar (hemen döner).
 * - Bulunamazsa `pollGithubEmailOtp` ile en fazla ~90 sn bekler (Verify via email sonrası posta gecikirse).
 *
 * Çalıştır: npm run mail:github-otp
 *
 * Önkoşul: `.env` içinde GITHUB_MAIL_USER, GITHUB_MAIL_PASSWORD (Gmail uygulama şifresi).
 */
import 'dotenv/config';
import { pollGithubEmailOtp, tryFetchGithubOtpFromImapOnce } from '../tests/support/github-email-otp';

async function main(): Promise<void> {
  const hasMail =
    Boolean(process.env.GITHUB_MAIL_USER?.trim()) && Boolean(process.env.GITHUB_MAIL_PASSWORD?.trim());
  if (!hasMail) {
    console.error('Eksik: GITHUB_MAIL_USER ve GITHUB_MAIL_PASSWORD .env içinde tanımlı olmalı.');
    process.exit(1);
  }

  console.log('[imap] Bağlantı + INBOX taraması (son 15 dk, GitHub gönderen + 8/6 hane kod)...');
  try {
    const quick = await tryFetchGithubOtpFromImapOnce(15);
    if (quick) {
      console.log('OK — IMAP çalışıyor, kutuda bulunan kod:', quick);
      process.exit(0);
    }
    console.log(
      '[imap] Son 15 dakikada uygun GitHub kodlu posta yok. Verify via email ile yeni mail tetikleyebilirsin; 90 sn polling başlıyor...'
    );
    const code = await pollGithubEmailOtp({ maxWaitMs: 90_000, pollMs: 2500 });
    console.log('OK — polling ile bulunan kod:', code);
    process.exit(0);
  } catch (e) {
    console.error('[imap] Hata (şifre, IMAP kapalı, veya ağ):');
    console.error(e);
    process.exit(1);
  }
}

void main();
