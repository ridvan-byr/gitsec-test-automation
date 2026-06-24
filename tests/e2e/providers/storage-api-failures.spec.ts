/**
 * Test: AWS S3 Storage Provider API & Network Failures (Faz 3 - Failure Scenarios)
 * 
 * Risk:
 * Backend servisinin yavaşlaması (high latency), geçici olarak çökmesi (HTTP 500) veya 
 * kullanıcının oturumunun zaman aşımına uğraması (HTTP 401) durumunda arayüzün (UI) 
 * kilitlenmesi, çökmesi veya kullanıcıyı bilgilendirmeden başarısız işlemi gizlemesi.
 * 
 * Beklenen:
 * - API 500 hatası döndüğünde, arayüz çökmemeli ve kullanıcıya anlamlı bir hata toast'u göstermelidir.
 * - API yanıtı geciktiğinde, "Double-submit" veya mükerrer isteği önlemek için kaydetme butonu anında `disabled` (spinner) konumuna geçmelidir.
 * - API 401 Unauthorized döndüğünde, oturumun sonlandığına dair uyarı toast mesajı çıkmalıdır.
 * 
 * Doğrulama (Assert):
 * - Mock 500 hatasında, ekranda `failed to add`, `error` vb. hata toast'unun görünür olması.
 * - Gecikmeli API yanıtı simülasyonunda, Save butonuna tıklandığı an butonun `disabled` olması.
 * - Mock 401 hatasında, `session expired`, `unauthorized` veya hata toast'unun görünmesi.
 * 
 * Yanlış Pozitif Riski:
 * Arayüz hata uyarısını toast olarak gösteriyor gibi yapabilir ama buton hala aktif kalarak 
 * kullanıcının tekrar tıklamasına ve spam yapmasına izin veriyor olabilir. Veya hata 
 * mesajı arka planda konsola basılıp kullanıcıya hiç hissettirilmeyebilir.
 * 
 * Ek Doğrulama (Mitigation):
 * - Playwright'ın `page.route` mekanizması ile API istekleri ağ seviyesinde kesilerek 
 *   kesin durum kodları (500, 401, delay) enjekte edilir ve UI'ın bu ağ durumlarına tepkisi doğrulanır.
 */

import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { requireEnv } from '../../support/require-env';

const workspaceId = requireEnv('WORKSPACE_ID');

test.describe('AWS S3 Depolama Sağlayıcısı API & Ağ Hata (Network Failure) Testleri', () => {
  let storagePage: StoragePage;

  test.beforeEach(async ({ page }) => {
    // Connection check API'sini mock'la (Testlerin ışık hızında ve kararlı çalışması için)
    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log(`🛡️ [MOCK] Connection Test API isteği yakalandı ve 200 OK dönülüyor.`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Connection test successful',
            errors: [],
            data: {
              isSuccessful: true,
              provider: 1,
              durationMs: 150,
              checks: []
            }
          })
        });
      }
    );

    storagePage = new StoragePage(page);
    await storagePage.navigateToStoragePage();
    await storagePage.clickAddStorageProvider();
    await storagePage.selectS3Provider();
  });


  // ─────────────────────────────────────────────────────────────────
  // 💥 SENARYO 1: HTTP 500 INTERNAL SERVER ERROR
  // ─────────────────────────────────────────────────────────────────
  test('Save esnasında API 500 Internal Server Error dönerse UI kararlılığını doğrula', async ({ page }) => {
    const connName = `API 500 Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // Formu doldur
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    // Bağlantıyı test et (Save butonunun aktifleşmesi için)
    await storagePage.testS3Connection();

    // Save isteğini kesip 500 dönelim
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Save API isteği kesildi ve 500 döndürülüyor: ${route.request().url()}`);
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Internal Server Error', message: 'Failed to add storage provider due to an internal server error' })
          });
        } else {
          await route.continue();
        }
      }
    );

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();

    // UI'ın çökmediğini ve hata mesajını gösterdiğini doğrula
    const errorToast = page.getByText(/failed to add|error|failed/i).first();
    await expect(errorToast).toBeVisible({ timeout: 12000 });
    
    console.log('✅ API 500 hatası durumunda arayüzün hata bildirimini başarıyla gösterdiği doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // ⏳ SENARYO 2: AŞIRI GECİKME (LATENCY) & SPINNER / DOUBLE-SUBMIT KORUMASI
  // ─────────────────────────────────────────────────────────────────
  test('API yanıtı yavaşladığında (gecikme) kaydetme butonunun disabled olduğunu doğrula', async ({ page }) => {
    const connName = `Latency Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    // Bağlantıyı test et (Save butonunun aktifleşmesi için)
    await storagePage.testS3Connection();

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();

    // Save isteğini kesip 5 saniye geciktirelim
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Save API isteği yakalandı, 2 saniye geciktiriliyor...`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Mocked successful save after latency',
              data: { id: 'mock-latency-id' }
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    // Save butonuna tıkla, Playwright'ın sayfanın yüklenmesini beklemesini engellemek için noWaitAfter: true kullanıyoruz.
    await saveBtn.click({ noWaitAfter: true });

    // İstek havada iken butonun disabled olduğunu doğrula (Double-submit koruması)
    await expect(saveBtn).toBeDisabled();
    console.log('✅ API yanıtı geciktiğinde kaydetme butonunun disabled olduğu başarıyla doğrulandı (Double-submit koruması).');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🔐 SENARYO 3: HTTP 401 UNAUTHORIZED / SESSION TIMEOUT
  // ─────────────────────────────────────────────────────────────────
  test('Oturum sonlandığında (API 401 Unauthorized) kullanıcının hata toast bildirimini doğrula', async ({ page }) => {
    const connName = `API 401 Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    // Bağlantıyı test et (Save butonunun aktifleşmesi için)
    await storagePage.testS3Connection();

    // Save isteğini kesip 401 dönelim
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Save API isteği kesildi ve 401 dönülüyor...`);
          await route.fulfill({
            status: 401,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Unauthorized', message: 'Session expired' })
          });
        } else {
          await route.continue();
        }
      }
    );

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();

    // Yetkisiz işlem nedeniyle ekranda session expired veya unauthorized toast mesajının belirdiğini doğrula
    const errorToast = page.getByText(/session expired|unauthorized|failed to add|error/i).first();
    await expect(errorToast).toBeVisible({ timeout: 12000 });
    
    console.log('✅ Yetkisiz işlem (401) durumunda arayüzün hata toast bildirimini başarıyla gösterdiği doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🔄 SENARYO 4: HATA SONRASI YENİDEN DENEME & KURTARMA (RETRY & RECOVERY)
  // ─────────────────────────────────────────────────────────────────
  test('Save esnasında ilk istek 500 dönüp başarısız olduğunda, ikinci tıklamada (Retry) 200 dönerek kurtarma yapılabildiğini doğrula', async ({ page }) => {
    const connName = `Retry Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();

    let attempt = 0;

    // Save isteğini keserek ilkini 500, ikincisini 200 dönecek şekilde ayarlayalım
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          attempt++;
          if (attempt === 1) {
            console.log(`🛡️ [MOCK] 1. Kaydetme denemesi kesildi, 500 Hata dönülüyor...`);
            await route.fulfill({
              status: 500,
              contentType: 'application/json',
              body: JSON.stringify({ error: 'Temporary Failure', message: 'First attempt failed due to database locks' })
            });
          } else {
            console.log(`🛡️ [MOCK] 2. Kaydetme denemesi kesildi, 200 Başarılı dönülüyor!`);
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                success: true,
                errors: [],
                message: 'Recovery success',
                data: { id: 'mock-recovery-id' }
              })
            });
          }
        } else {
          await route.continue();
        }
      }
    );

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();

    // 1. İlk tıklama - 500 hatası alır ve UI çökmeden hata gösterir
    await saveBtn.click();
    
    const errorToast = page.getByText(/failed to add|error|failed/i).first();
    await expect(errorToast).toBeVisible({ timeout: 8000 });
    console.log('🧡 [RECOVERY] İlk denemede beklendiği gibi hata toast uyarısı görüldü.');

    // 2. Sayfayı yenilemeden tekrar Save butonuna tıkla (Retry)
    await saveBtn.click();

    // İkinci istek başarılı olduğu için sayfaya yönlendirmeyi bekleriz
    await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 15_000 });
    console.log('✅ [RECOVERY] Hata sonrası ikinci denemede entegrasyonun başarıyla kurulduğu doğrulandı (Retry-Recovery).');
  });
});
