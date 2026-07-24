import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function loginBitbucket() {
  const authDir = path.join(process.cwd(), 'playwright/.auth');
  fs.mkdirSync(authDir, { recursive: true });
  const bitbucketSessionPath = path.join(authDir, 'bitbucket-session.json');

  console.log('🚀 Real Bitbucket/Atlassian Chrome başlatılıyor...');
  console.log('ℹ️ Bu tarayıcıda Bitbucket / Atlassian hesabınızla manuel veya otomatik giriş yapabilirsiniz.\n');

  const profileDir = path.join(authDir, 'bitbucket-profile');

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ]
  });

  await context.addInitScript(() => {
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {} };
    } catch {}
  });

  const page = await context.newPage();
  
  console.log('🔗 Bitbucket / Atlassian Oturum Açma sayfasına gidiliyor...');
  await page.goto('https://id.atlassian.com/login', { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n👉 Lütfen açılan Chrome penceresinde:');
  console.log('   1. Bitbucket / Atlassian test hesabınızla giriş yapın (Google SSO veya E-posta).');
  console.log('   2. 2FA / Güvenlik doğrulamasını tamamlayın.');
  console.log('   3. Bitbucket / Atlassian paneli yüklendiğinde oturumunuz otomatik kaydedilecektir.');
  console.log('\n⏳ Oturumun açılması bekleniyor (Pencereyi kapatabilirsiniz ya da giriş yapılınca otomatik kaydedilecektir)...');

  let isDone = false;

  const waitForLoginRedirect = new Promise<void>((resolve) => {
    const pollInterval = setInterval(async () => {
      if (isDone || page.isClosed()) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const cookies = await context.cookies();
        const hasAuth = cookies.some((c: any) => 
          (c.domain?.includes('atlassian.com') || c.domain?.includes('bitbucket.org')) &&
          ['cloud.session.token', 'atlassian.account.id', 'bitbucket.session', 'ATL_TOKEN', 'ajs_user_id', 'bb_user'].includes(c.name)
        );

        const currentUrl = page.url();
        const isLoggedUrl = /bitbucket\.org\/|start\.atlassian\.com|id\.atlassian\.com\/manage-profile/i.test(currentUrl);

        if (hasAuth || isLoggedUrl) {
          console.log('\n🎉 Bitbucket / Atlassian hesabı girişi başarıyla tespit edildi! Oturum kaydediliyor...');
          clearInterval(pollInterval);
          resolve();
        }
      } catch {}
    }, 1500);
  });

  const waitForWindowClose = new Promise<void>((resolve) => {
    page.on('close', () => {
      if (!isDone) {
        console.log('\nℹ️ Tarayıcı penceresi kapatıldı.');
        resolve();
      }
    });
    context.on('close', () => {
      if (!isDone) {
        console.log('\nℹ️ Tarayıcı oturumu kapatıldı.');
        resolve();
      }
    });
  });

  await Promise.race([waitForLoginRedirect, waitForWindowClose]);
  isDone = true;

  console.log('💾 Bitbucket oturum bilgileri ve cookie\'ler kaydediliyor...');
  await context.storageState({ path: bitbucketSessionPath });
  console.log(`✅ Bitbucket session başarıyla şuraya kaydedildi: ${bitbucketSessionPath}`);

  await context.close().catch(() => {});
  console.log('Tarayıcı kapatıldı.');

  const userJsonPath = path.join(authDir, 'user.json');
  const userWithProviderJsonPath = path.join(authDir, 'user-with-provider.json');

  if (fs.existsSync(bitbucketSessionPath)) {
    const bitbucketSession = JSON.parse(fs.readFileSync(bitbucketSessionPath, 'utf8'));
    const cookies = bitbucketSession.cookies || [];

    console.log('\n📋 [ÇEREZ DURUMU] Kaydedilen Bitbucket Çerezleri:');
    cookies.slice(0, 5).forEach((c: any) => {
      if (c.expires) {
        const d = new Date(c.expires * 1000);
        console.log(`   • Çerez (${c.name}): ${d.toLocaleDateString('tr-TR')} ${d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`);
      }
    });

    const mergeAuthFile = (targetPath: string) => {
      if (fs.existsSync(targetPath)) {
        const targetData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        const cookieMap = new Map<string, any>();
        (targetData.cookies || []).forEach((c: any) => cookieMap.set(`${c.domain}:${c.name}`, c));
        (bitbucketSession.cookies || []).forEach((c: any) => cookieMap.set(`${c.domain}:${c.name}`, c));

        const originsMap = new Map<string, any>();
        (targetData.origins || []).forEach((o: any) => originsMap.set(o.origin, o));
        (bitbucketSession.origins || []).forEach((o: any) => originsMap.set(o.origin, o));

        targetData.cookies = Array.from(cookieMap.values());
        targetData.origins = Array.from(originsMap.values());

        fs.writeFileSync(targetPath, JSON.stringify(targetData, null, 2), 'utf8');
        console.log(`🔄 Bitbucket session cookie'leri şununla birleştirildi: ${path.basename(targetPath)}`);
      }
    };

    mergeAuthFile(userJsonPath);
    mergeAuthFile(userWithProviderJsonPath);
    console.log('\n👍 Bitbucket entegrasyon çerezleri başarıyla güncellendi.');
  }
}

loginBitbucket().catch((err) => {
  console.error('Hata oluştu:', err);
});
