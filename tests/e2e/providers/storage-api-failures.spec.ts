/**
 * Test: Bulut Depolama Sağlayıcısı API & Ağ Hata (Network Failure) Testleri
 * 
 * Bu test dosyası AWS S3, Azure Blob, Huawei OBS, Google Drive ve OneDrive sağlayıcıları için
 * API kesintileri, yüksek gecikmeler (latency), yetkisiz oturum (401) ve hata sonrası
 * kurtarma (Retry/Recovery) davranışlarını test eder.
 */

import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import { StoragePage } from '../../pages/StoragePage';
import { requireEnv } from '../../support/require-env';

const DUMMY_HUAWEI_SECRET = 'huawei_secret_not_real_dummy_' + 'x'.repeat(16);

const provider = process.env.E2E_STORAGE_PROVIDER || 'aws';
const isOAuthProvider = ['gdrive', 'onedrive'].includes(provider);

// Sağlayıcıya göre geçerli çevre verilerini hazırlayalım
function getProviderEnvData() {
  if (provider === 'aws') {
    return {
      connName: `API Failures AWS Test - ${Date.now()}`,
      bucket: requireEnv('AWS_S3_BUCKET'),
      accessKey: requireEnv('AWS_ACCESS_KEY_ID'),
      secretKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      region: requireEnv('AWS_REGION')
    };
  } else if (provider === 'azure') {
    return {
      connName: `API Failures Azure Test - ${Date.now()}`,
      folderPath: '/backups',
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=gitsectest;AccountKey=abcxyz123==;EndpointSuffix=core.windows.net'
    };
  } else if (provider === 'huawei') {
    return {
      connName: `API Failures Huawei Test - ${Date.now()}`,
      bucket: 'gitsec-huawei-bucket',
      accessKey: 'HUAWEIAK1234567890AA',
      secretKey: DUMMY_HUAWEI_SECRET,
      region: 'tr-west-1'
    };
  } else {
    // OAuth (GDrive, OneDrive)
    return {
      connName: `API Failures OAuth Test - ${Date.now()}`
    };
  }
}

async function fillFormForSelectedProvider(storagePage: StoragePage, connName: string, data: any) {
  if (provider === 'aws') {
    await storagePage.fillAWSForm(connName, data.bucket, data.accessKey, data.secretKey, data.region);
  } else if (provider === 'azure') {
    await storagePage.fillAzureForm(connName, data.folderPath, data.connectionString);
  } else if (provider === 'huawei') {
    await storagePage.fillHuaweiForm(connName, data.bucket, data.accessKey, data.secretKey, data.region);
  } else {
    // OAuth (GDrive, OneDrive) sadece Connection Name doldurulur
    const connectionNameInput = storagePage.page.getByPlaceholder('e.g., Compliance GD')
      .or(storagePage.page.locator('input[placeholder*="Compliance"]'))
      .or(storagePage.page.locator('input[name="name"]'))
      .first();
    await connectionNameInput.waitFor({ state: 'visible', timeout: 15000 });
    await connectionNameInput.fill(connName);
  }
}

async function prepareConnectionForSave(storagePage: StoragePage, page: Page) {
  if (!isOAuthProvider) {
    await storagePage.testS3Connection();
  } else {
    // OAuth sağlayıcılarda yetkilendirme akışını mock'la ve "Permission Required" butonuna tıkla
    await page.route(/\/api\/storage-providers\/oauth\/status/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
    });
    const popupPromise = page.waitForEvent('popup');
    const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
    await permissionBtn.click();
    const popup = await popupPromise;
    await popup.close();
    const baseUrl = page.url().split('?')[0];
    const providerParam = provider === 'gdrive' ? 'Google+Drive' : 'OneDrive+Personal';
    await page.goto(`${baseUrl}?provider=${providerParam}&oauth-success=true&correlation_id=mock-correlation-id`);
  }
}

test.describe(`${provider.toUpperCase()} Depolama Sağlayıcısı API & Ağ Hata (Network Failure) Testleri`, () => {
  test.describe.configure({ retries: 1 });
  let storagePage: StoragePage;
  let workspaceId: string;

  test.beforeEach(async ({ page }) => {
    workspaceId = requireEnv('WORKSPACE_ID');
    (page as any).ignoredErrors = [
      /api\/storage-providers/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /Cross-Origin-Opener-Policy/,
      /HTTP Status 502/
    ];

    // Sınama API'sini mock'la (Başarılı bağlantı durumları için)
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
            data: { isSuccessful: true, provider: 1, durationMs: 150, checks: [] }
          })
        });
      }
    );

    storagePage = new StoragePage(page);
    await storagePage.navigateToStoragePage();
    await storagePage.cleanupExistingTestProviders(provider);
    await storagePage.clickAddStorageProvider();

    // Arayüzden ilgili sağlayıcı kartını seçelim
    if (provider === 'aws') {
      await storagePage.selectS3Provider();
    } else if (provider === 'azure') {
      await storagePage.selectAzureProvider();
    } else if (provider === 'huawei') {
      await storagePage.selectHuaweiProvider();
    } else if (provider === 'gdrive') {
      await storagePage.selectOAuthProvider('Google Drive', 'Google Drive Service');
    } else if (provider === 'onedrive') {
      await storagePage.selectOAuthProvider('OneDrive Personal', 'OneDrive Personal');
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 💥 SENARYO 1: HTTP 500 INTERNAL SERVER ERROR
  // ─────────────────────────────────────────────────────────────────
  test('Save esnasında API 500 Internal Server Error dönerse UI kararlılığını doğrula', async ({ page }) => {
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    // Save isteğini kesip 500 dönelim
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Save API isteği kesildi ve 500 döndürülüyor.`);
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
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();

    // Save isteğini kesip 2 saniye geciktirelim
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

    // Save butonuna tıkla
    await saveBtn.click({ noWaitAfter: true });

    // İstek havada iken butonun disabled olduğunu doğrula (Double-submit koruması)
    await expect(saveBtn).toBeDisabled();
    console.log('✅ API yanıtı geciktiğinde kaydetme butonunun disabled olduğu başarıyla doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🔐 SENARYO 3: HTTP 401 UNAUTHORIZED / SESSION TIMEOUT
  // ─────────────────────────────────────────────────────────────────
  test('Oturum sonlandığında (API 401 Unauthorized) kullanıcının hata toast bildirimini doğrula', async ({ page }) => {
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

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
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

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
              body: JSON.stringify({ error: 'Temporary Failure', message: 'First attempt failed' })
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
    console.log('✅ [RECOVERY] Hata sonrası ikinci denemede entegrasyonun başarıyla kurulduğu doğrulandı.');
  });
});
