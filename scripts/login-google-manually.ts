import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function loginGoogle() {
  const authDir = path.join(process.cwd(), 'playwright/.auth');
  fs.mkdirSync(authDir, { recursive: true });
  const googleSessionPath = path.join(authDir, 'google-session.json');

  console.log('🚀 Real Google Chrome başlatılıyor...');
  console.log('ℹ️ Bu tarayıcıda Google hesabınızla giriş yapacaksınız.\n');

  // Gerçek Chrome profil dizinini oluştur (Persistent Context için)
  const profileDir = path.join(authDir, 'google-profile');

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ]
  });

  // navigator.webdriver'ı gizleyen init script'i ekle (Güvenlik için)
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();
  
  console.log('🔗 Google Drive sayfasına gidiliyor...');
  await page.goto('https://drive.google.com');

  console.log('\n👉 Lütfen açılan tarayıcı penceresinde:');
  console.log('   1. gitsectest@gmail.com (veya kendi test hesabınızla) giriş yapın.');
  console.log('   2. 2FA / Telefon onayını tamamlayın.');
  console.log('   3. Google Drive arayüzünün başarıyla açıldığından emin olun.');
  console.log('\n⏳ Giriş tamamlandığında veya tarayıcıyı kapattığınızda oturum otomatik kaydedilecektir...');

  // ----------------------------------------------------
  // Oturumun tamamlanmasını veya tarayıcının kapatılmasını bekleyen akış
  // ----------------------------------------------------
  let isDone = false;

  const waitForLoginRedirect = page.waitForURL('**/drive/**', { timeout: 300_000 })
    .then(() => {
      if (!isDone) {
        console.log('\n🎉 Google Drive ana sayfası yüklendi! Giriş başarılı kabul ediliyor.');
      }
    })
    .catch(() => {});

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

  // Google'ın otomasyon tespiti engeline ("Couldn't sign you in / may not be secure") 
  // takılıp takılmadığını periyodik olarak kontrol eden arka plan denetimi (Senior QA)
  const checkStuckInterval = setInterval(async () => {
    try {
      if (page.isClosed()) {
        clearInterval(checkStuckInterval);
        return;
      }
      const currentUrl = page.url();
      const bodyText = await page.locator('body').innerText().catch(() => '');
      const isStuck = currentUrl.includes('signin/rejected') || 
                      bodyText.includes("Couldn't sign you in") || 
                      bodyText.includes("may not be secure") || 
                      bodyText.includes("Try using a different browser");
      
      if (isStuck) {
        console.log('\n🚨🚨🚨 [GOOGLE OTURUMU YENİLEYİN - GÜVENLİK ENGELLENDİ] 🚨🚨🚨');
        console.log('⚠️  Google, bu manuel giriş penceresini güvensiz tarayıcı (otomasyon) olarak algıladı ve girişi engelledi!');
        console.log('💡 Google oturum hazırlığı ekranından (arayüzdeki "Google Session" kartı) oturumu yenilemeniz gerekmektedir.');
        console.log('💡 Çözüm için tarayıcı penceresindeki "Try again" butonuna basarak tekrar giriş yapmayı deneyebilir,');
        console.log('   veya Google Hesap ayarlarınızdan "Daha az güvenli uygulama erişimi" seçeneğini kontrol edebilirsiniz.\n');
        clearInterval(checkStuckInterval);
      }
    } catch (e) {
      clearInterval(checkStuckInterval);
    }
  }, 3000);

  // İki durumdan biri gerçekleşene kadar bekle (Giriş başarılı oldu veya tarayıcı kapatıldı)
  await Promise.race([waitForLoginRedirect, waitForWindowClose]);
  isDone = true;
  clearInterval(checkStuckInterval);

  console.log('💾 Oturum bilgileri ve cookie\'ler kaydediliyor...');
  
  // Storage state'i kaydet (tüm cookie'ler ve localStorage)
  await context.storageState({ path: googleSessionPath });
  console.log(`✅ Google session başarıyla şuraya kaydedildi: ${googleSessionPath}`);

  // Context'i kapat (eğer hala açıksa)
  await context.close().catch(() => {});
  console.log('Tarayıcı kapatıldı.');

  // ----------------------------------------------------
  // Kaydedilen Google cookie'lerini mevcut Gitsec auth dosyalarıyla birleştir
  // ----------------------------------------------------
  const userJsonPath = path.join(authDir, 'user.json');
  const userWithProviderJsonPath = path.join(authDir, 'user-with-provider.json');

  if (fs.existsSync(googleSessionPath)) {
    const googleSession = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));

    const mergeAuthFile = (targetPath: string) => {
      if (fs.existsSync(targetPath)) {
        const targetData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        
        // Cookie'leri birleştir (aynı isim/domain olanları ez, yenileri ekle)
        const cookieMap = new Map<string, any>();
        
        // Önce hedef dosyayı ekle
        (targetData.cookies || []).forEach((c: any) => {
          cookieMap.set(`${c.domain}:${c.name}`, c);
        });
        
        // Sonra Google cookie'lerini ekle (veya ez)
        (googleSession.cookies || []).forEach((c: any) => {
          cookieMap.set(`${c.domain}:${c.name}`, c);
        });

        // Origins birleştir
        const originsMap = new Map<string, any>();
        (targetData.origins || []).forEach((o: any) => {
          originsMap.set(o.origin, o);
        });
        (googleSession.origins || []).forEach((o: any) => {
          originsMap.set(o.origin, o);
        });

        targetData.cookies = Array.from(cookieMap.values());
        targetData.origins = Array.from(originsMap.values());

        fs.writeFileSync(targetPath, JSON.stringify(targetData, null, 2), 'utf8');
        console.log(`🔄 Google session cookie'leri şununla birleştirildi: ${path.basename(targetPath)}`);
      }
    };

    mergeAuthFile(userJsonPath);
    mergeAuthFile(userWithProviderJsonPath);
    console.log('\n👍 Tüm entegrasyon dosyaları başarıyla güncellendi. Artık testlerinizi çalıştırabilirsiniz!');
  }
}

loginGoogle().catch((err) => {
  console.error('Hata oluştu:', err);
});
