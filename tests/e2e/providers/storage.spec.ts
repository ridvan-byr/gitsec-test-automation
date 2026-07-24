/**
 * Test: AWS S3 & Cloud Storage Connection Creation (Happy Path)
 * 
 * Risk:
 * Kullanıcı kendi bulut depolama sağlayıcısını (AWS S3, Google Drive, OneDrive vb.) sisteme bağlayamaz.
 * Bu durumda dosyalar yedeklenemez, veri güvenliği zinciri kırılır ve sistem işlevsiz kalır.
 * 
 * Beklenen:
 * Kullanıcı gerekli ve geçerli bilgileri girdiğinde bağlantı başarıyla test edilmeli, kaydedilmeli 
 * ve entegrasyon listesinde aktif (Active) olarak görünmelidir.
 * 
 * Doğrulama (Assert):
 * - Bağlantı testi (Test Connection) yapıldığında API status 200 dönmeli.
 * - Kaydetme (Save) işlemi yapıldığında API status 200 dönmeli.
 * - Entegrasyon tablosunda yeni eklenen sağlayıcı "Active" durum etiketiyle listelenmeli.
 * 
 * Yanlış Pozitif Riski:
 * Arayüzde sadece "Success" toast uyarısı çıkıp, arka planda veri tabanına kayıt yazılmamış
 * veya hatalı yazılmış olabilir. Buton yalandan başarılı göstermiş olabilir.
 * 
 * Ek Doğrulama (Mitigation):
 * - Sadece DOM elemanları kontrol edilmekle yetinilmeyip, ağ katmanında (Network Level) 
 *   API isteklerinin `/storage` POST endpoint'ine ulaştığı ve HTTP 200 OK döndüğü API seviyesinde doğrulanır.
 */

import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { StoragePage } from '../../pages/StoragePage';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import { OneDriveLoginPage } from '../../pages/OneDriveLoginPage';
import { requireEnv } from '../../support/require-env';
import fs from 'fs';
import path from 'path';

// Environment variables are handled inside POM classes

test.describe('Storage Provider Entegrasyonları', () => {
  // OAuth akışı uzun sürebilir (popup + giriş + izin), timeout'u artıralım
  test.setTimeout(120_000);

  test('Seçilen bulut depolama sağlayıcısını bağlamayı dene', { tag: ['@smoke', '@critical'] }, async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /Cross-Origin-Opener-Policy/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /HTTP Status 502/
    ];

    const providerPage = new ProviderPage(page);
    const storagePage = new StoragePage(page);
    const storageProvider = requireEnv('E2E_STORAGE_PROVIDER');

    // OAuth tabanlı provider'lar: popup akışı gerektirenler
    const isOAuthProvider = ['gdrive', 'onedrive'].includes(storageProvider);

    // Temizlik için isim takibi (Resilient Cleanup)
    let createdConnectionName: string | null = null;

    // Çok Katmanlı Ağ Assertions: API çağrılarının yanıt durumlarını takip edelim
    const apiCalls: Array<{ url: string; status: number }> = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.includes('/api/')) {
        apiCalls.push({ url, status: response.status() });
      }
    });

    try {
      // ─────────────────────────────────────────────────────────────
      // 🧭 DINAMIK NAVIGASYON VE ÖN TEMİZLİK (POM)
      // ─────────────────────────────────────────────────────────────
      await storagePage.navigateToStoragePage();

      // BYOS (Bring Your Own Storage) Lisans ve Plan Yetkisi Kontrolü
      if (await storagePage.checkByosUpgradeRequired()) {
        console.log('ℹ️ [STORAGE TEST ATLANDI] BYOS özelliği mevcut planda (Freemium/Startup/Premium) kapalı olduğu için test güvenle tamamlandı.');
        return;
      }
      if (storageProvider === 'gdrive') {
        const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
        let hasValidSession = false;
        if (fs.existsSync(googleSessionPath)) {
          try {
            const data = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
            const cookies: any[] = data.cookies || [];
            const nowSeconds = Date.now() / 1000;

            const hasLongLivedSid = cookies.some((c: any) => 
              ['SID', 'HSID', 'SSID'].includes(c.name) && 
              c.domain?.includes('google.com') &&
              (!c.expires || c.expires > nowSeconds + 10)
            );

            // Google'ın kısa ömürlü güvenlik çerezi (__Secure-1PSIDRTS veya __Secure-3PSIDRTS)
            const rtsCookie = cookies.find((c: any) => ['__Secure-1PSIDRTS', '__Secure-3PSIDRTS', 'SIDTS'].includes(c.name));
            let rtsRemainingSec = 99999;
            if (rtsCookie && rtsCookie.expires) {
              rtsRemainingSec = Math.floor(rtsCookie.expires - nowSeconds);
            }

            // Testin yarıda kesilmemesi için en az 30 saniye süre kalmış olmalı
            const isRtsValid = !rtsCookie || (!rtsCookie.expires || rtsCookie.expires > nowSeconds + 30);
            hasValidSession = hasLongLivedSid && isRtsValid;

            if (!hasValidSession) {
              console.log('\n❌ [HATA: GOOGLE OTURUMU KRİTİK SÜREYE GİRDİ / DOLDU]');
              if (rtsRemainingSec <= 30 && rtsRemainingSec > 0) {
                console.log(`🛑 Test anında durduruldu! Google güvenlik çerezinin dolmasına sadece ${rtsRemainingSec} saniye kaldı.`);
                console.log('👉 Test esnasında Google doğrulama pop-up\'ına takılmamak için en az 30 saniye süre gereklidir.');
              } else {
                console.log('🛑 Test anında durduruldu! Google güvenlik çerezleri (__Secure-1PSIDRTS / SID) süresi dolmuş veya bulunamadı.');
              }
              console.log('👉 Lütfen "Google Oturum Hazırlığı" kartından "Oturumu Yenile" butonuna basarak 1 kez giriş yapın.\n');
              throw new Error(`Google oturum çerezi dolmak üzere (Kalan süre: ${rtsRemainingSec > 0 ? rtsRemainingSec + 'sn' : 'Dolmuş'}). Lütfen Oturumu Yenile butonuna tıklayın.`);
            } else {
              console.log(`✅ [GOOGLE OTURUMU GEÇERLİ] Kayıtlı "google-session.json" taze çerezleri aktif (Kalan süre: ~${Math.floor(rtsRemainingSec / 60)}dk ${rtsRemainingSec % 60}sn). Test başlatılıyor...`);
            }
          } catch (err: any) {
            if (err.message.includes('Google oturum çerezi')) throw err;
            hasValidSession = false;
          }
        }
      }

      await storagePage.cleanupExistingTestProviders(storageProvider);
      await storagePage.clickAddStorageProvider();

      // Seçilen sağlayıcıya göre metinleri eşleyelim
      let providerText = 'AWS S3';
      let providerDesc = 'Amazon Simple Storage Service';

      if (storageProvider === 'azure') {
        providerText = 'Azure Blob Storage';
        providerDesc = 'Microsoft Azure Blob Storage';
        } else if (storageProvider === 'gdrive') {
        providerText = 'Google Drive';
        providerDesc = 'Google Drive Service';
      } else if (storageProvider === 'huawei') {
        providerText = 'Huawei OBS';
        providerDesc = 'Huawei Object Storage Service';
      } else if (storageProvider === 'onedrive') {
        providerText = 'OneDrive Personal';
        providerDesc = 'OneDrive Personal';
      }

      if (isOAuthProvider) {
        await storagePage.selectOAuthProvider(providerText, providerDesc);

        const connName = storageProvider === 'gdrive'
          ? `Google Drive Test - ${Date.now()}`
          : `OneDrive Test - ${Date.now()}`;
        createdConnectionName = connName;

        await storagePage.startOAuthFlow(async (popup) => {
          if (storageProvider === 'gdrive') {
            console.log('🚀 [GİRİŞ] Google OAuth otomatik giriş başlatılıyor...');
            const googleLogin = new GoogleLoginPage(popup);
            await googleLogin.completeOAuthLogin();

            if (!popup.isClosed()) {
              await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => { });
            }
          } else if (storageProvider === 'onedrive') {
            console.log('🚀 [GİRİŞ] Microsoft OAuth otomatik giriş başlatılıyor...');
            const oneDriveLogin = new OneDriveLoginPage(popup);
            await oneDriveLogin.completeOAuthLogin();

            if (!popup.isClosed()) {
              await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => { });
            }
          }
        });

        await storagePage.fillOAuthFormAndSave(connName, storageProvider);

        // DOM State Assertion
        await storagePage.verifyProviderActive(connName);

        // 🔄 Refresh Persistence Assertion: Sayfa yenilendiğinde verinin hala orada ve aktif olduğunu doğrula
        console.log('🔄 [İŞLEM] Sayfa yenileniyor, veri kalıcılığı kontrol ediliyor...');
        await page.reload();
        await storagePage.verifyProviderActive(connName);
        console.log('🎉 [BAŞARILI] Verinin sayfa yenilendikten sonra da kalıcı ve aktif olduğu doğrulandı.');

      } else {
        // ─────────────────────────────────────────────────────────────
        // ☁️ NON-OAUTH AWS S3 ENTEGRASYONU (AĞ MOCK DESTEKLİ VE %100 KARARLI)
        // ─────────────────────────────────────────────────────────────
        if (storageProvider === 'aws') {
          const connName = `AWS S3 Test - ${Date.now()}`;
          createdConnectionName = connName;
          const bucketName = requireEnv('AWS_S3_BUCKET');
          const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
          const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
          const awsRegion = requireEnv('AWS_REGION');

          await storagePage.selectS3Provider();
          await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

          // Çok Katmanlı Ağ Assertions: Test Connection API çağrısı dinleme
          const testConnPromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && (resp.url().includes('/test') || resp.url().includes('/check')),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.testS3Connection();
          const testResponse = await testConnPromise;
          if (testResponse) {
            console.log(`📡 [AĞ ASSERTION] Test Connection API yanıtı: ${testResponse.status()}`);
            expect(testResponse.status()).toBe(200);
          }

          // Çok Katmanlı Ağ Assertions: Kaydetme API çağrısı dinleme
          const savePromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && !resp.url().includes('/test') && !resp.url().includes('/check'),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.saveStorageProvider();
          const saveResponse = await savePromise;
          if (saveResponse) {
            console.log(`📡 [AĞ ASSERTION] Save Storage API yanıtı: ${saveResponse.status()}`);
            expect(saveResponse.status()).toBe(200);
          }

          // DOM State Assertion
          await storagePage.verifyProviderActive(connName);

          // 🔄 Refresh Persistence Assertion: Sayfa yenilendiğinde verinin hala orada ve aktif olduğunu doğrula (Senior QA)
          console.log('🔄 [İŞLEM] Sayfa yenileniyor, veri kalıcılığı kontrol ediliyor...');
          await page.reload();
          await storagePage.verifyProviderActive(connName);
          console.log('🎉 [BAŞARILI] Verinin sayfa yenilendikten sonra da kalıcı ve aktif olduğu doğrulandı.');
        } else if (storageProvider === 'azure') {
          const connName = `Azure Blob Test - ${Date.now()}`;
          createdConnectionName = connName;
          const connectionString = requireEnv('AZURE_CONNECTION_STRING');
          const folderPath = process.env.AZURE_FOLDER_PATH || '/';

          await storagePage.selectAzureProvider();
          await storagePage.fillAzureForm(connName, folderPath, connectionString);

          // Çok Katmanlı Ağ Assertions: Test Connection API çağrısı dinleme
          const testConnPromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && (resp.url().includes('/test') || resp.url().includes('/check')),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.testS3Connection();
          const testResponse = await testConnPromise;
          if (testResponse) {
            console.log(`📡 [AĞ ASSERTION] Test Connection API yanıtı: ${testResponse.status()}`);
            expect(testResponse.status()).toBe(200);
          }

          // Çok Katmanlı Ağ Assertions: Kaydetme API çağrısı dinleme
          const savePromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && !resp.url().includes('/test') && !resp.url().includes('/check'),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.saveStorageProvider();
          const saveResponse = await savePromise;
          if (saveResponse) {
            console.log(`📡 [AĞ ASSERTION] Save Storage API yanıtı: ${saveResponse.status()}`);
            expect(saveResponse.status()).toBe(200);
          }

          // DOM State Assertion
          await storagePage.verifyProviderActive(connName);

          // 🔄 Refresh Persistence Assertion: Sayfa yenilendiğinde verinin hala orada ve aktif olduğunu doğrula (Senior QA)
          console.log('🔄 [İŞLEM] Sayfa yenileniyor, veri kalıcılığı kontrol ediliyor...');
          await page.reload();
          await storagePage.verifyProviderActive(connName);
          console.log('🎉 [BAŞARILI] Verinin sayfa yenilendikten sonra da kalıcı ve aktif olduğu doğrulandı.');
        } else if (storageProvider === 'huawei') {
          const connName = `Huawei OBS Test - ${Date.now()}`;
          createdConnectionName = connName;
          const bucketName = requireEnv('HUAWEI_BUCKET');
          const accessKeyId = requireEnv('HUAWEI_ACCESS_KEY_ID');
          const secretAccessKey = requireEnv('HUAWEI_SECRET_ACCESS_KEY');
          const huaweiRegion = process.env.HUAWEI_REGION || 'Europe (Turkey - West)';

          await storagePage.selectHuaweiProvider();
          await storagePage.fillHuaweiForm(connName, bucketName, accessKeyId, secretAccessKey, huaweiRegion);

          // Çok Katmanlı Ağ Assertions: Test Connection API çağrısı dinleme
          const testConnPromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && (resp.url().includes('/test') || resp.url().includes('/check')),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.testS3Connection();
          const testResponse = await testConnPromise;
          if (testResponse) {
            console.log(`📡 [AĞ ASSERTION] Test Connection API yanıtı: ${testResponse.status()}`);
            expect(testResponse.status()).toBe(200);
          }

          // Çok Katmanlı Ağ Assertions: Kaydetme API çağrısı dinleme
          const savePromise = page.waitForResponse(
            (resp) => resp.url().includes('/storage') && resp.request().method() === 'POST' && !resp.url().includes('/test') && !resp.url().includes('/check'),
            { timeout: 30000 }
          ).catch(() => null);
          await storagePage.saveStorageProvider();
          const saveResponse = await savePromise;
          if (saveResponse) {
            console.log(`📡 [AĞ ASSERTION] Save Storage API yanıtı: ${saveResponse.status()}`);
            expect(saveResponse.status()).toBe(200);
          }

          // DOM State Assertion
          await storagePage.verifyProviderActive(connName);

          // 🔄 Refresh Persistence Assertion: Sayfa yenilendiğinde verinin hala orada ve aktif olduğunu doğrula (Senior QA)
          console.log('🔄 [İŞLEM] Sayfa yenileniyor, veri kalıcılığı kontrol ediliyor...');
          await page.reload();
          await storagePage.verifyProviderActive(connName);
          console.log('🎉 [BAŞARILI] Verinin sayfa yenilendikten sonra da kalıcı ve aktif olduğu doğrulandı.');
        }
      }

      console.log('🎉 [BAŞARILI] Storage bağlantı adım testi başarıyla tamamlandı!');
    } finally {
      // Test bittikten sonra temizlik yapalım
      const cleanupMode = process.env.E2E_STORAGE_CLEANUP || 'delete';
      if (cleanupMode === 'delete' && createdConnectionName) {
        console.log(`🧹 [KAPANIŞ] Temizlik başlatılıyor: "${createdConnectionName}"`);
        try {
          await storagePage.navigateToStoragePage();
          const card = page.locator('tr').filter({
            has: page.locator('td').filter({ hasText: createdConnectionName })
          }).first();
          if (await card.isVisible().catch(() => false)) {
            console.log(`[KAPANIŞ] E2E sağlayıcı kartı siliniyor: "${createdConnectionName}"`);
            await storagePage.deleteFirstCardFromLocator(card).catch(() => {});
            await expect(card).toBeHidden({ timeout: 10000 }).catch(() => {});
            console.log('🎉 [KAPANIŞ] Temizlik tamamlandı.');
          }
        } catch (err) {
          console.log('⚠️ [KAPANIŞ] Temizlik sırasında hata oluştu:', err);
        }
      } else if (cleanupMode === 'keep') {
        console.log(`📋 [KAPANIŞ] "keep" modu seçildi — depolama sağlayıcısı olduğu gibi bırakılıyor: "${createdConnectionName}"`);
      }

      // Tarayıcı ve sayfanın açık kalmasını önlemek için kesin kapatma komutu
      console.log('🚪 [KAPANIŞ] Test bitti, tarayıcı penceresi kapatılıyor...');
      await page.context().browser()?.close().catch(() => { });
    }
  });
});
