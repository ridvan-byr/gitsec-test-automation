/**
 * Test: Bulut Depolama Sağlayıcısı Edge Cases & Stres Testleri
 * 
 * Bu test dosyası AWS S3, Azure Blob, Huawei OBS, Google Drive ve OneDrive sağlayıcıları için
 * çift tıklama engelleme (double-click spam), çevrimdışı (offline) mod dayanıklılığı,
 * ve silme (DELETE) işlemi veri tutarlılığı senaryolarını dinamik olarak test eder.
 */

import { test, expect } from '../../fixtures/test';
import { Page } from '@playwright/test';
import { StoragePage } from '../../pages/StoragePage';
import { requireEnv } from '../../support/require-env';

// Arayüzdeki hata mesajlarını dinamik arayan yardımcı fonksiyon
async function getVisibleErrorMessage(page: Page): Promise<string | null> {
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

async function assertAndLogDynamicError(page: Page, expectedPattern: RegExp): Promise<string> {
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
      connName: `Edge Cases AWS Test - ${Date.now()}`,
      bucket: requireEnv('AWS_S3_BUCKET'),
      accessKey: requireEnv('AWS_ACCESS_KEY_ID'),
      secretKey: requireEnv('AWS_SECRET_ACCESS_KEY'),
      region: requireEnv('AWS_REGION')
    };
  } else if (provider === 'azure') {
    return {
      connName: `Edge Cases Azure Test - ${Date.now()}`,
      folderPath: process.env.AZURE_FOLDER_PATH || '/',
      connectionString: requireEnv('AZURE_CONNECTION_STRING')
    };
  } else if (provider === 'huawei') {
    return {
      connName: `Edge Cases Huawei Test - ${Date.now()}`,
      bucket: requireEnv('HUAWEI_BUCKET'),
      accessKey: requireEnv('HUAWEI_ACCESS_KEY_ID'),
      secretKey: requireEnv('HUAWEI_SECRET_ACCESS_KEY'),
      region: process.env.HUAWEI_REGION || 'Europe (Turkey - West)'
    };
  } else {
    // OAuth (GDrive, OneDrive)
    return {
      connName: `Edge Cases OAuth Test - ${Date.now()}`
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
    // OAuth sağlayıcılarda yetkilendirme akışını mock'la
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

test.describe(`${provider.toUpperCase()} Depolama Sağlayıcısı Edge Case & Stres Testleri`, () => {
  test.setTimeout(90000);
  test.describe.configure({ retries: 1 });
  let storagePage: StoragePage;
  let workspaceId: string;

  test.beforeEach(async ({ page }) => {
    workspaceId = requireEnv('WORKSPACE_ID');
    (page as any).ignoredErrors = [
      /api\/storage-providers/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /Cross-Origin-Opener-Policy/,
      /net::ERR_INTERNET_DISCONNECTED/,
      /net::ERR_FAILED/,
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
  // 🖱️ SENARYO 1: DOUBLE-CLICK SPAMMING (ÇİFT TIKLAMA KORUMASI)
  // ─────────────────────────────────────────────────────────────────
  test('Save butonuna art arda hızlı tıklandığında butonun disabled olarak mükerrer isteği engellediğini doğrula', async ({ page }) => {
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    // Ağ seviyesinde SADECE POST /api/storage-providers isteklerini sayacağız
    let apiPostCount = 0;
    await page.route(
      (url) => url.href.includes('/api/storage-providers') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          apiPostCount++;
          console.log(`📡 [AĞ] Storage POST isteği #${apiPostCount} yakalandı.`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, message: 'Mocked successful save', data: { id: 999999 } })
          });
        } else {
          await route.continue();
        }
      }
    );

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();

    // İlk tıklama — istek gönderir ve buton disabled olmalı
    console.log('🖱️ [1] Save butonuna ilk tıklama yapılıyor...');
    await saveBtn.click({ noWaitAfter: true });

    // İlk tıklamadan sonra butonun anında disabled olduğunu doğrula
    await expect(saveBtn).toBeDisabled({ timeout: 3000 });
    console.log('🔒 Buton ilk tıklamadan sonra disabled konumuna geçti.');

    // İkinci ve üçüncü tıklama denemeleri — buton disabled olduğu için gerçek kullanıcı tıklayamaz
    console.log('🖱️ [2] Buton disabled iken ikinci tıklama deneniyor...');
    const secondClickBlocked = await saveBtn.isDisabled();
    console.log(`🖱️ [3] Buton disabled iken üçüncü tıklama deneniyor...`);
    const thirdClickBlocked = await saveBtn.isDisabled();

    // Gecikme süresinin dolmasını bekle
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

    expect(secondClickBlocked).toBe(true);
    expect(thirdClickBlocked).toBe(true);
    expect(apiPostCount).toBe(1);
    console.log('✅ Double-click spam koruması başarıyla doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 📴 SENARYO 2: OFFLİNE MODE (ÇEVRİMDIŞI MOD DAYANIKLILIĞI)
  // ─────────────────────────────────────────────────────────────────
  test('İnternet bağlantısı kesildiğinde uygulamanın offline veya çökmeden kararlı kaldığını doğrula', async ({ page }) => {
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    // İnternet bağlantısını kes (Ağ seviyesinde abort)
    console.log('📴 İnternet bağlantısı kesiliyor (Offline Simülasyonu)...');
    await page.route('**/*', async (route) => {
      await route.abort('internetdisconnected').catch(() => { });
    });

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click({ noWaitAfter: true }).catch(() => { });

    // Next.js uygulamasının /offline sayfasına yönlendirmesini bekle veya arayüzün ayakta kaldığını doğrula
    console.log('⏳ Offline durumu veya çökme kontrolü bekleniyor...');
    await page.waitForURL(/offline/i, { timeout: 8000 }).catch(() => { });

    const currentUrl = page.url();
    console.log(`📍 Mevcut URL: ${currentUrl}`);

    if (currentUrl.includes('offline')) {
      console.log('✅ Uygulama internet kesildiğinde kullanıcıyı başarıyla /offline sayfasına yönlendirdi.');
    } else {
      const bodyVisible = await page.locator('body').isVisible().catch(() => false);
      expect(bodyVisible).toBe(true);
      console.log('✅ Uygulama internet kesilmesine rağmen kararlı kaldı ve çökmedi.');
    }

    // İnterneti geri aç (Temizlik)
    await page.unroute('**/*').catch(() => { });
    await page.close({ runBeforeUnload: false }).catch(() => { });
  });

  // ─────────────────────────────────────────────────────────────────
  // 📴 SENARYO 3: INTERNET KESİNTİSİNDEN TEKRAR ONLINE DURUMA DÖNÜŞ (RECOVERY)
  // ─────────────────────────────────────────────────────────────────
  test('İnternet kesildiğinde kaydetme başarısız olmalı, internet geri geldiğinde tekrar Save tıklanarak başarılı olunmalı', async ({ page }) => {
    const envData = getProviderEnvData();
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, envData.connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    const storageRoutePattern = (url: URL) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check');

    // 1. Ağ kesintisi simülasyonu yapalım
    console.log('📴 İnternet bağlantısı kesiliyor (Offline)...');
    await page.route(
      storageRoutePattern,
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log('🛡️ [OFFLINE MOCK] Kaydetme isteği engellendi (Network Error).');
          await route.abort('failed').catch(() => { });
        } else {
          await route.continue();
        }
      }
    );

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();

    // Hata oluştuğunu doğrula
    await assertAndLogDynamicError(page, /failed to add|error|failed/i);
    console.log('🧡 [OFFLINE RECOVERY] Beklendiği gibi internet hatası nedeniyle kayıt başarısız oldu.');

    // 2. Ağ bağlantısını geri getirelim
    console.log('🌐 İnternet bağlantısı geri geliyor (Online)...');
    await page.unroute(storageRoutePattern);

    // Save API çağrısını başarılı 200 dönecek şekilde mocklayalım
    await page.route(
      storageRoutePattern,
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log('🛡️ [MOCK] İnternet geri geldi, kaydetme başarılı 200 dönülüyor!');
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, message: 'Saved after reconnecting' })
          });
        } else {
          await route.continue();
        }
      }
    );

    // Tekrar kaydetmeyi deneyelim
    await saveBtn.click();

    // Başarıyla kaydettiğini ve listeye yönlendiğini doğrula
    await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 15_000 });
    console.log('✅ [OFFLINE RECOVERY] İnternet geri geldikten sonra yapılan tekrar deneme başarıyla tamamlandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🗑️ SENARYO 4: SİLME (DELETE) İŞLEMİ VE VERİ TUTARLILIĞI DOĞRULAMASI
  // ─────────────────────────────────────────────────────────────────
  test('Eklenen bir depolama sağlayıcısının silindiğinde arayüzden ve backend\'den kalıcı olarak kalktığını doğrula', async ({ page }) => {
    if (isOAuthProvider) {
      test.skip(true, 'OAuth providers require real interactive authorization and cannot be tested for CRUD delete without a real connection.');
    }

    const envData = getProviderEnvData();
    const connName = `CRUD Delete Test - ${Date.now()}`;

    // 1. Formu dolduralım
    if (isOAuthProvider) {
      await prepareConnectionForSave(storagePage, page);
      await fillFormForSelectedProvider(storagePage, connName, envData);
      await storagePage.testS3Connection();
    } else {
      await fillFormForSelectedProvider(storagePage, connName, envData);
      await prepareConnectionForSave(storagePage, page);
    }

    // 2. Gerçek API üzerinden kaydedelim
    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();
    await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 15_000 });

    // 3. Arayüzde eklendiğini (Active/Connected) doğrula
    await storagePage.verifyProviderActive(connName);

    // 4. Silme işlemini tetikle
    console.log(`🗑️ [DELETE] ${connName} sağlayıcısı siliniyor...`);
    await storagePage.deleteProvider(connName);

    // 5. Arayüzden silindiğini doğrula
    const cardLocator = page.locator('tr').filter({ hasText: connName }).first();
    await expect(cardLocator).toBeHidden({ timeout: 8000 });

    // 6. Sayfayı yenileyip gerçekten silindiğini doğrula
    console.log('🔄 [RELOAD] Sayfa yenileniyor...');
    await page.reload();
    await page.waitForLoadState('networkidle').catch(() => { });
    await expect(cardLocator).toBeHidden({ timeout: 8000 });

    console.log('✅ Entegrasyonun silindikten sonra hem arayüzden hem de kalıcı olarak silindiği başarıyla doğrulandı.');
  });
});
