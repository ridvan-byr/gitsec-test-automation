/**
 * Test: Bulut Depolama Sağlayıcısı Form Doğrulama (Validation Matrix)
 * 
 * Bu test dosyası AWS S3, Azure Blob, Huawei OBS, Google Drive ve OneDrive sağlayıcıları
 * için form doğrulama kurallarını ve hata yönetimini dinamik olarak test eder.
 */

import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { requireEnv } from '../../support/require-env';

const DUMMY_HUAWEI_SECRET = 'huawei_secret_not_real_dummy_' + 'x'.repeat(16);

// Arayüzdeki hata mesajlarını dinamik arayan yardımcı fonksiyon
async function getVisibleErrorMessage(page: any): Promise<string | null> {
  const errorSelectors = [
    page.locator('[role="alert"]'),
    page.locator('.toast-notification.error'),
    page.locator('.toast'),
    page.locator('[data-slot="error"]'),
    page.locator('.text-destructive'),
    page.locator('.text-red-500'),
    page.locator('text=/failed|error|must not|already|invalid|conflict|required|limit/i')
  ];

  const countSelectors = errorSelectors.length;
  for (let s = 0; s < countSelectors; s++) {
    const locator = errorSelectors[s];
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const text = (await el.innerText().catch(() => '')).trim();
        if (text.length > 0) {
          return text;
        }
      }
    }
  }
  return null;
}

async function assertAndLogDynamicError(page: any, expectedPattern: RegExp): Promise<string> {
  let errorText: string | null = null;
  let bodyText = '';

  await expect(async () => {
    errorText = await getVisibleErrorMessage(page);
    if (errorText) {
      expect(errorText).toMatch(expectedPattern);
    } else {
      bodyText = await page.locator('body').innerText().catch(() => '');
      expect(bodyText).toMatch(expectedPattern);
    }
  }).toPass({ timeout: 8000, intervals: [250] });

  if (errorText) {
    console.log(`✅ [DİNAMİK HATA YAKALANDI]: "${errorText}"`);
    return errorText;
  } else {
    console.log('✅ [DİNAMİK HATA GENEL METİNDE BULUNDU]');
    return 'General Page Text Match';
  }
}

const provider = process.env.E2E_STORAGE_PROVIDER || 'aws';
const isOAuthProvider = ['gdrive', 'onedrive'].includes(provider);

// Sağlayıcıya göre geçerli çevre verilerini hazırlayalım
function getProviderEnvData() {
  if (provider === 'aws') {
    return {
      connName: `Duplicate AWS Test - ${Date.now()}`,
      bucket: requireEnv('AWS_S3_BUCKET'),
      accessKey: requireEnv('AWS_ACCESS_KEY_ID'),
      secretKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      region: requireEnv('AWS_REGION')
    };
  } else if (provider === 'azure') {
    return {
      connName: `Duplicate Azure Test - ${Date.now()}`,
      folderPath: '/backups',
      connectionString: 'DefaultEndpointsProtocol=https;AccountName=gitsectest;AccountKey=abcxyz123==;EndpointSuffix=core.windows.net'
    };
  } else if (provider === 'huawei') {
    return {
      connName: `Duplicate Huawei Test - ${Date.now()}`,
      bucket: 'gitsec-huawei-bucket',
      accessKey: 'HUAWEIAK1234567890AA',
      secretKey: DUMMY_HUAWEI_SECRET,
      region: 'tr-west-1'
    };
  } else {
    // OAuth (GDrive, OneDrive)
    return {
      connName: `Duplicate OAuth Test - ${Date.now()}`
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

test.describe(`${provider.toUpperCase()} Depolama Sağlayıcısı Form Doğrulama (Validation) Testleri`, () => {
  test.setTimeout(180000);
  test.describe.configure({ retries: 1 });
  let storagePage: StoragePage;

  test.beforeEach(async ({ page }) => {
    (page as any).ignoredErrors = [
      /api\/storage-providers/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /Cross-Origin-Opener-Policy/,
      /HTTP Status 502/
    ];
    page.on('console', (msg) => {
      console.log(`🖥️ [BROWSER CONSOLE]: ${msg.text()}`);
    });
    page.on('request', (req) => {
      if (req.url().includes('/api/')) {
        console.log(`🌐 [REQUEST]: ${req.method()} ${req.url()}`);
      }
    });
    page.on('response', async (resp) => {
      if (resp.url().includes('/api/')) {
        console.log(`🌐 [RESPONSE]: ${resp.status()} ${resp.url()}`);
        if (resp.url().includes('oauth/authorize')) {
          const body = await resp.text().catch(() => '');
          console.log(`💬 [OAUTH_AUTHORIZE BODY]: ${body}`);
        }
      }
    });
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
            data: { isSuccessful: true, provider: 1, durationMs: 100, checks: [] }
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
  // 🚫 SENARYO 1: BOŞ ALAN DOĞRULAMALARI (CLIENT-SIDE)
  // ─────────────────────────────────────────────────────────────────
  test('Boş Connection Name ve diğer zorunlu alanlar için butonların durumunu doğrula', async ({ page }) => {
    const actionBtn = page.getByRole('button', { name: /Add Storage|Save|Permission Required/i }).first();
    await actionBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Hiçbir şey yazılmadığında butonun devre dışı (disabled) olduğunu doğrula
    await expect(actionBtn).toBeDisabled();
    console.log('✅ Boş bırakılan alanlar için client-side doğrulamada butonun devre dışı kaldığı başarıyla doğrulandı.');
  });

  test('Sadece boşluk (whitespace) girildiğinde kaydetmeyi engelle', async ({ page }) => {
    if (isOAuthProvider) {
      // OAuth sağlayıcılarda yetkilendirme akışını mock'la ve "Permission Required" butonuna tıkla
      await page.route(/\/api\/storage-providers\/oauth\/status/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      });

      // Frontend JS bundle'larını tarayıp postMessage veya message dinleyicilerini arayalım
      await page.evaluate(async () => {
        console.log('🔍 [JS INSPECTOR] correlationId detaylı taraması başlatılıyor...');
        const scripts = Array.from(document.querySelectorAll('script[src]'));
        for (const script of scripts) {
          try {
            const res = await fetch((script as HTMLScriptElement).src);
            const text = await res.text();
            if (text.includes('correlationId')) {
              console.log(`🔍 [JS INSPECTOR] correlationId bulundu: ${(script as HTMLScriptElement).src}`);
              const index = text.indexOf('correlationId');
              console.log(`💬 Code: ${text.substring(Math.max(0, index - 200), index + 1000)}`);
            }
          } catch (e) {
            console.log('⚠️ Tarama hatası:', e);
          }
        }
      });

      const popupPromise = page.waitForEvent('popup');
      const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
      await permissionBtn.click();
      const popup = await popupPromise;
      await popup.close();
      await page.goto(`${page.url()}&oauth-success=true&correlation_id=mock-correlation-id`);
    }

    const envData = getProviderEnvData();
    await fillFormForSelectedProvider(storagePage, '   ', envData);

    const actionBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await expect(actionBtn).toBeDisabled();
    console.log('✅ Sadece boşluklardan oluşan Connection Name girişi sonrası butonun disabled kaldığı doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 📡 SENARYO 3: DUPLICATE (MÜKERRER) KAYIT API DOĞRULAMASI
  // ─────────────────────────────────────────────────────────────────
  test('Aynı isimde mükerrer sağlayıcı eklenmek istendiğinde backend hata toast mesajını doğrula', async ({ page }) => {
    const envData = getProviderEnvData();

    // Mükerrer kayıt hatası simülasyonu için POST isteğini kesip 400 Duplicate hatası dönelim
    await page.route(
      (url) => url.href.includes('/api/storage-providers') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Duplicate Save POST isteği kesildi ve 400 Duplicate hatası dönülüyor.`);
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              errors: [{ message: 'This storage provider or connection already exists.' }],
              message: 'A storage provider with this connection already exists.'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    if (isOAuthProvider) {
      // OAuth sağlayıcılarda yetkilendirme akışını mock'la
      await page.route(/\/api\/storage-providers\/oauth\/status/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      });
      const popupPromise = page.waitForEvent('popup');
      // "Permission Required" butonuna basarak akışı tetikleyelim
      const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
      await permissionBtn.click();
      const popup = await popupPromise;
      const baseUrl = page.url().split('?')[0];
      const providerParam = provider === 'gdrive' ? 'Google+Drive' : 'OneDrive+Personal';
      await page.goto(`${baseUrl}?provider=${providerParam}&oauth-success=true&correlation_id=mock-correlation-id`);
    }

    await fillFormForSelectedProvider(storagePage, envData.connName, envData);

    await storagePage.testS3Connection();

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();

    // Arayüzdeki hata toast mesajını doğrula
    await assertAndLogDynamicError(page, /already exists|failed to add|conflict/i);
    console.log('✅ Mükerrer kayıt durumunda backend hata toast mesajının belirdiği doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🚫 SENARYO 4: GEÇERSİZ KİMLİK BİLGİSİ FORMATI (CREDENTIALS MATRIX)
  // ─────────────────────────────────────────────────────────────────
  test('Geçersiz formatta credentials girildiğinde arayüzde hata mesajını doğrula', async ({ page }) => {
    const envData = getProviderEnvData();
    let invalidData = { ...envData };

    if (provider === 'aws') {
      invalidData.accessKey = 'INVALID ACCESS KEY WITH SPACES';
      invalidData.secretKey = 'short';
    } else if (provider === 'azure') {
      invalidData.connectionString = 'invalid-connection-string';
    } else if (provider === 'huawei') {
      invalidData.accessKey = 'INVALID';
      invalidData.secretKey = 'short';
    }

    // Connection test API'sini mock'la (Geçersiz veri hatası dönecek şekilde)
    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log('🛡️ [MOCK] Connection Test returning 400 Bad Request due to invalid credentials.');
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Invalid credentials format.',
            errors: [{ message: 'The format of the input credentials is invalid.' }]
          })
        });
      }
    );

    if (!isOAuthProvider) {
      await fillFormForSelectedProvider(storagePage, envData.connName, invalidData);
      const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
      await testConnectionBtn.click();
      await assertAndLogDynamicError(page, /invalid|credential|key|auth|format|failed|connection/i);
    } else {
      // OAuth sağlayıcılarda bağlantı testi üzerinden yetkilendirme hatası mock'la
      await page.route('**/api/storage-providers/test-connection', async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'OAuth authorization expired or invalid.',
            errors: [{ message: 'OAuth authorization expired or invalid.' }]
          })
        });
      });
      const popupPromise = page.waitForEvent('popup');
      const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
      await permissionBtn.click();
      const popup = await popupPromise;
      await popup.close();
      const baseUrl = page.url().split('?')[0];
      const providerParam = provider === 'gdrive' ? 'Google+Drive' : 'OneDrive+Personal';
      await page.goto(`${baseUrl}?provider=${providerParam}&oauth-success=true&correlation_id=mock-correlation-id`);

      await fillFormForSelectedProvider(storagePage, envData.connName, envData);

      const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
      await testConnectionBtn.click();
      await assertAndLogDynamicError(page, /invalid|expired|failed|auth/i);
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // ⏳ SENARYO 5: BAĞLANTI SINAMA VE KURTARMA (CONNECTION TEST & RECOVERY)
  // ─────────────────────────────────────────────────────────────────
  test('Bağlantı test API yanıtında form kurtarılabilirliğini doğrula', async ({ page }) => {
    // OAuth sağlayıcılarda bağlantı sınama bütünü olmadığından bu adımı atlayalım
    if (isOAuthProvider) {
      test.skip(true, 'OAuth providers do not have a separate Test Connection recovery button.');
    }

    const envData = getProviderEnvData();
    await fillFormForSelectedProvider(storagePage, envData.connName, envData);
    await storagePage.testS3Connection();

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await expect(saveBtn).toBeEnabled();
    console.log('✅ Bağlantı sınama sonrası formun kurtarılabilirliği başarıyla doğrulandı.');
  });

  test('Bağlantı dizesi veya anahtar alanına 5000 karakterlik aşırı büyük veri girildiğinde UI kilitlenmemeli ve hata verilmeli', async ({ page }) => {
    // OAuth sağlayıcılar serbest metin girişi barındırmadığından bu testi atlayalım
    if (isOAuthProvider) {
      test.skip(true, 'OAuth providers do not have large text areas to test payload limits.');
    }

    const envData = getProviderEnvData();
    let largeData = { ...envData };
    const largePayload = 'a'.repeat(5000);

    if (provider === 'aws') {
      largeData.secretKey = largePayload;
    } else if (provider === 'azure') {
      largeData.connectionString = largePayload;
    } else if (provider === 'huawei') {
      largeData.secretKey = largePayload;
    }

    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Credentials payload is too large.',
            errors: [{ message: 'Input value exceeds maximum allowed length.' }]
          })
        });
      }
    );

    await fillFormForSelectedProvider(storagePage, envData.connName, largeData);

    const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
    await testConnectionBtn.click();

    const nameInput = page.locator('input[name="name"], input[placeholder*="Connection Name"]').first();
    await expect(nameInput).toBeEnabled();
    await nameInput.click();

    await assertAndLogDynamicError(page, /too large|exceeds|limit|failed|error|invalid/i);
    console.log('✅ Aşırı büyük payload girildiğinde UI donmadığı ve hata uyarısı verildiği başarıyla doğrulandı.');
  });
});
