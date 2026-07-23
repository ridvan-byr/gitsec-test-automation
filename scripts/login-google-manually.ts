import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleLoginPage } from '../tests/pages/GoogleLoginPage';

dotenv.config();

async function loginGoogle() {
  const authDir = path.join(process.cwd(), 'playwright/.auth');
  fs.mkdirSync(authDir, { recursive: true });
  const googleSessionPath = path.join(authDir, 'google-session.json');

  console.log('🚀 Real Google Chrome başlatılıyor...');
  console.log('ℹ️ Bu tarayıcıda Google hesabınızla otomatik/manuel giriş yapılacaktır.\n');

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
    try {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      (window as any).chrome = { runtime: {} };
    } catch {}
  });

  const page = await context.newPage();
  
  console.log('🔗 Google Oturum Açma sayfasına (Google Drive yönlendirmeli) gidiliyor...');
  await page.goto('https://accounts.google.com/ServiceLogin?continue=https://drive.google.com', { waitUntil: 'domcontentloaded' }).catch(() => {});

  console.log('\n👉 Lütfen açılan Chrome penceresinde:');
  console.log('   1. Google test hesabınızla (gitsectest@gmail.com) giriş yapın.');
  console.log('   2. 2FA (SMS / Authenticator) doğrulamasını tamamlayın.');
  console.log('   3. Google Drive / Hesabım ekranı yüklendiğinde oturumunuz otomatik kaydedilecektir.');
  console.log('\n⏳ Oturumun açılması bekleniyor (Pencereyi kapatabilirsiniz ya da giriş yapılınca otomatik kaydedilecektir)...');

  // ----------------------------------------------------
  // Oturumun tamamlanmasını veya tarayıcının kapatılmasını bekleyen akış
  // ----------------------------------------------------
  let isDone = false;

  const waitForLoginRedirect = new Promise<void>((resolve) => {
    const pollInterval = setInterval(async () => {
      if (isDone || page.isClosed()) {
        clearInterval(pollInterval);
        return;
      }
      try {
        const cookies = await context.cookies();
        const criticalCookieNames = ['SID', 'HSID', 'SSID', 'SAPISID', 'APISID'];
        const hasAuth = cookies.some((c: any) => criticalCookieNames.includes(c.name) && c.domain?.includes('google.com'));

        const currentUrl = page.url();
        const isLoggedUrl = /drive\.google\.com|docs\.google\.com|myaccount\.google\.com|google\.com\/(u|b|drive|docs)\//i.test(currentUrl);

        if (hasAuth && isLoggedUrl) {
          console.log('\n🎉 Google hesabı girişi (çerezler ve yönlendirme) başarıyla tespit edildi! Oturum kaydediliyor...');
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
    const cookies = googleSession.cookies || [];
    const criticalCookieNames = ['SID', 'HSID', 'SSID', 'SAPISID', 'APISID'];
    const hasValidGoogleLogin = cookies.some((c: any) => criticalCookieNames.includes(c.name) && c.domain?.includes('google.com'));

    if (!hasValidGoogleLogin) {
      console.log('\n⚠️ [GİRİŞ YAPILMADI] Google oturum açma çerezleri (SID/HSID) bulunamadı!');
      console.log('💡 Lütfen kart üzerindeki "Oturumu Yenile" butonuna tıklayıp açılan Chrome penceresinde hesabınıza giriş yapın.');
      console.log('💡 Giriş yapılmadan pencere kapatıldığı için mevcut oturum dosyalarınız güncellenmedi.\n');
      
      // Geçersiz çerez dosyasını sil ki hatalı durum oluşmasın
      try { fs.unlinkSync(googleSessionPath); } catch {}
      process.exit(1);
    }

    // Çerez Expiry Date Bilgilerini Logla
    console.log('\n📋 [ÇEREZ DURUMU] Kaydedilen Google Çerezlerinin Son Kullanma Tarihleri:');
    const sidCookie = cookies.find((c: any) => ['SID', 'HSID', 'SSID'].includes(c.name) && c.domain?.includes('google.com'));
    if (sidCookie && sidCookie.expires) {
      const sidDate = new Date(sidCookie.expires * 1000);
      console.log(`   • Ana Oturum Çerezi (${sidCookie.name}): ${sidDate.toLocaleDateString('tr-TR')} ${sidDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`);
    }

    const rtsCookie = cookies.find((c: any) => ['__Secure-1PSIDRTS', '__Secure-3PSIDRTS', 'SIDTS'].includes(c.name));
    if (rtsCookie && rtsCookie.expires) {
      const rtsDate = new Date(rtsCookie.expires * 1000);
      const diffMins = Math.floor((rtsCookie.expires - Date.now() / 1000) / 60);
      console.log(`   • Güvenlik Çerezi (${rtsCookie.name}): ${rtsDate.toLocaleDateString('tr-TR')} ${rtsDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} (Kalan Süre: ~${Math.floor(diffMins / 60)}s ${diffMins % 60}dk)`);
    }
    console.log('');

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
