/**
 * Mailden kod çekimi kontrolü (adım adım rapor).
 *
 *   npm run mail:check
 *
 * 1) .env değişkenleri var mı
 * 2) IMAP bağlantısı açılıyor mu
 * 3) Son 30 dk postalar listeleniyor (GitHub olanlar işaretli)
 * 4) GitHub postasında 8 veya 6 haneli kod bulundu mu
 *
 * Kod yoksa: GitHub’da "Verify via email"e bas → mail gelsin → tekrar çalıştır.
 * Kod beklemek için: npm run mail:github-otp
 */
import 'dotenv/config';
import { diagnoseGithubMailInbox } from '../tests/support/github-email-otp';

function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

async function main(): Promise<void> {
  console.log('=== GitHub mail / IMAP kontrolü ===\n');

  const user = process.env.GITHUB_MAIL_USER?.trim();
  const pass = process.env.GITHUB_MAIL_PASSWORD?.replace(/\s/g, '');
  console.log('[1] .env');
  console.log(`    GITHUB_MAIL_USER: ${user ? maskEmail(user) : '(YOK)'}`);
  console.log(`    GITHUB_MAIL_PASSWORD: ${pass ? `ayarlı (${pass.length} karakter)` : '(YOK)'}`);
  if (!user || !pass) {
    console.log('\nSONUÇ: FAIL — .env dosyasına mail bilgilerini ekleyin.');
    process.exit(1);
  }

  console.log('\n[2] IMAP bağlantısı + INBOX taraması (son 30 dk)...');
  const report = await diagnoseGithubMailInbox(30);

  console.log(`    Sunucu: ${report.imapHost}:${report.imapPort}`);
  console.log(`    Hesap: ${maskEmail(report.mailUser)}`);

  if (report.error) {
    console.log(`\nSONUÇ: FAIL — IMAP hatası: ${report.error}`);
    console.log('    Gmail: IMAP açık mı, uygulama şifresi doğru mu kontrol edin.');
    process.exit(1);
  }

  console.log(`    Bağlantı: OK`);
  console.log(`    Penceredeki toplam posta: ${report.totalMessagesInWindow}`);
  console.log(`    GitHub gönderenli posta: ${report.githubMessages}`);

  console.log('\n[3] Son postalar (en yeni üstte, en fazla 25):');
  if (report.rows.length === 0) {
    console.log('    (son 30 dakikada posta yok)');
  } else {
    for (const r of report.rows) {
      const tag = r.isGithub ? 'GITHUB' : 'diğer';
      const codeInfo = r.code ? `kod=${r.code}` : 'kod yok';
      console.log(`    [${tag}] ${r.date}`);
      console.log(`           Konu: ${r.subject}`);
      console.log(`           Kimden: ${r.from}`);
      console.log(`           ${codeInfo}`);
    }
  }

  console.log('\n[4] Kod çıkarımı');
  if (report.extractedCode) {
    console.log(`    SONUÇ: OK — Kutudan okunan kod: ${report.extractedCode}`);
    console.log('    Playwright testi de aynı IMAP mantığını kullanır.');
    process.exit(0);
  }

  if (report.githubMessages > 0) {
    console.log('    GitHub postası var ama gövde/konuda 6 veya 8 haneli kod bulunamadı.');
    console.log('    Mail şablonu farklı olabilir; ham mail gövdesini kontrol edin.');
  } else {
    console.log('    Son 30 dk içinde GitHub postası yok.');
    console.log('    GitHub’da "Verify via email" → mail gelsin → npm run mail:check tekrar.');
  }

  console.log('\n    İsteğe bağlı: yeni mail için 90 sn bekle → npm run mail:github-otp');
  console.log('\nSONUÇ: FAIL — henüz çekilebilir kod yok.');
  process.exit(1);
}

void main();
