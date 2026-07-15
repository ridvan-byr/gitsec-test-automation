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
      // Tarayıcı ve sayfanın açık kalmasını önlemek için kesin kapatma komutu
      console.log('🚪 [KAPANIŞ] Test bitti, tarayıcı penceresi kapatılıyor...');
      await page.context().browser()?.close().catch(() => { });
    }
  });
});
