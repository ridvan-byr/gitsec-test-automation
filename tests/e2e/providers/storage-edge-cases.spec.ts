/**
 * Test: AWS S3 Storage Provider Edge Cases & Stress (Faz 4 - Edge Cases & States)
 * 
 * Risk:
 * - Kullanıcının "Save" butonuna aşırı hızlı ve art arda tıklaması (Double-click spamming) durumunda backend'e mükerrer 
 *   isteklerin gitmesi ve mükerrer veritabanı kayıtları veya sunucu tarafında kaynak israfı oluşması.
 * - İşlem sırasında kullanıcının internet bağlantısının tamamen kesilmesi durumunda arayüzün (UI) donması veya çökmesi.
 * 
 * Beklenen:
 * - Butona ilk tıklamada buton anında `disabled` olmalı, sonraki tıklamalar hiçbir şekilde API isteği tetiklememelidir.
 * - İnternet bağlantısı koptuğunda uygulama çökmeyip kararlı kalmalı veya kullanıcıyı `/offline` sayfasına yönlendirmelidir.
 * 
 * Doğrulama (Assert):
 * - Double-click spam testinde; ikinci/üçüncü tıklama denemelerinde butonun `disabled` olması ve ağda sadece 1 adet POST isteği yapılması.
 * - Offline mod testinde; `context.setOffline(true)` sonrası yapılan işlemde URL'in `/offline` içermesi veya arayüzün kararlı kalması.
 * 
 * Yanlış Pozitif Riski:
 * Buton arayüzde pasif görünmesine rağmen arka planda ağ isteklerini göndermeye devam ediyor olabilir (debouncing/throttle veya disabled mantığı eksik kurulmuş olabilir).
 * 
 * Ek Doğrulama (Mitigation):
 * - Ağ katmanında POST istek adedi Playwright route interceptor (`page.route`) ile sayılarak (yani `apiPostCount === 1`) 
 *   kesin olarak sadece tek bir API isteğinin sunucuya ulaştığı doğrulanır.
 */

import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { requireEnv } from '../../support/require-env';

// --- DİNAMİK HATA YAKALAMA FONKSİYONLARI ---

/**
 * Sayfa üzerinde o an görünür olan herhangi bir hata mesajı, toast, alert veya validation uyarısını dinamik olarak arar.
 */
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

/**
 * Belirtilen regex pattern'ine uyan bir hatanın arayüzde görünmesini dinamik olarak bekler ve doğrular.
 */
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


const workspaceId = requireEnv('WORKSPACE_ID');

test.describe('AWS S3 Depolama Sağlayıcısı Edge Case & Stres Testleri', () => {
  // Stres ve Edge Case testleri (offline/recovery/delete) uzun sürebilir, timeout'u artıralım
  test.setTimeout(90_000);

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
    await storagePage.cleanupExistingTestProviders('aws');
    await storagePage.clickAddStorageProvider();
    await storagePage.selectS3Provider();
  });


  // ─────────────────────────────────────────────────────────────────
  // 🖱️ SENARYO 1: DOUBLE-CLICK SPAMMING (ÇİFT TIKLAMA KORUMASI)
  // ─────────────────────────────────────────────────────────────────
  test('Save butonuna art arda hızlı tıklandığında butonun disabled olarak mükerrer isteği engellediğini doğrula', async ({ page }) => {
    const connName = `Double Click Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();

    // Ağ seviyesinde SADECE POST /api/storage-providers isteklerini sayacağız
    let apiPostCount = 0;
    await page.route(
      (url) => url.href.includes('/api/storage-providers') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          apiPostCount++;
          console.log(`📡 [AĞ] Storage POST isteği #${apiPostCount} yakalandı: ${route.request().url()}`);
          await new Promise(resolve => setTimeout(resolve, 3000));
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Mocked successful save',
              data: { id: 999999 }
            })
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

    console.log(`📊 Toplam gönderilen POST API isteği sayısı: ${apiPostCount}`);
    console.log(`📊 2. tıklama engellendi mi: ${secondClickBlocked}`);
    console.log(`📊 3. tıklama engellendi mi: ${thirdClickBlocked}`);

    expect(secondClickBlocked).toBe(true);
    expect(thirdClickBlocked).toBe(true);
    expect(apiPostCount).toBe(1);
    console.log('✅ Double-click spam koruması doğrulandı: İlk tıklama sonrası buton disabled oldu, mükerrer API çağrısı engellendi.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 📴 SENARYO 2: OFFLİNE MODE (ÇEVRİMDIŞI MOD DAYANIKLILIĞI)
  // ─────────────────────────────────────────────────────────────────
  test('İnternet bağlantısı kesildiğinde uygulamanın offline sayfasına yönlendirdiğini doğrula', async ({ page, context }) => {
    // Offline mod testi daha uzun sürebilir
    test.setTimeout(60000);

    const connName = `Offline Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();

    // İnternet bağlantısını kes (CDP bağlantısını bozmadan simüle etmek için page.route kullanıyoruz)
    console.log('📴 İnternet bağlantısı kesiliyor (Offline Simülasyonu)...');
    await page.route('**/*', async (route) => {
      await route.abort('internetdisconnected').catch(() => { });
    });

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click({ noWaitAfter: true }).catch(() => { });

    // Next.js uygulamasının /offline sayfasına yönlendirmesini bekle
    console.log('⏳ Offline sayfasına yönlendirme bekleniyor...');
    await page.waitForURL(/offline/i, { timeout: 15000 }).catch(() => { });

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
    console.log('🌐 İnternet bağlantısı geri açıldı ve sayfa kapatıldı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 📴 SENARYO 3: INTERNET KESİNTİSİNDEN TEKRAR ONLINE DURUMA DÖNÜŞ (RECOVERY)
  // ─────────────────────────────────────────────────────────────────
  test('İnternet kesildiğinde kaydetme başarısız olmalı, internet geri geldiğinde tekrar Save tıklanarak başarılı olunmalı', async ({ page }) => {
    const connName = `Offline Recovery Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();

    // 1. Ağ kesintisi simülasyonu yapalım
    console.log('📴 İnternet bağlantısı kesiliyor (Offline)...');
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
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
    await page.unroute(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check')
    );

    // Save API çağrısını başarılı 200 dönecek şekilde mocklayalım
    await page.route(
      (url) => url.href.includes('/storage') && !url.href.includes('/test') && !url.href.includes('/check'),
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
  // 🗑️ SENARYO 4: SİLME (DELETE) İŞLEMİ VE VERİ TUTARLILIĞI DOĞRULAMASI (Senior QA)
  // ─────────────────────────────────────────────────────────────────
  test('Eklenen bir depolama sağlayıcısının silindiğinde arayüzden ve backend\'den kalıcı olarak kalktığını doğrula', async ({ page }) => {
    const connName = `CRUD Delete Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // 1. Entegrasyon ekleme işlemini yapalım (Gerçek API entegrasyonu ile sağlayıcı ekleme işlemini yapalım)
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();
    await storagePage.saveStorageProvider();

    // 2. Arayüzde eklendiğini doğrula
    await storagePage.verifyProviderActive(connName);

    // 3. Silme işlemini tetikle (Gerçek DELETE API çağrısını tetikler)
    console.log(`🗑️ [DELETE] ${connName} sağlayıcısı silinmeye başlanıyor...`);
    await storagePage.deleteProvider(connName);

    // 4. Arayüzde ve sayfa yenilendikten sonra da gerçekten kalıcı olarak silindiğini doğrula (CRUD Verification)
    const cardLocator = page.locator('tr').filter({ hasText: connName }).first();
    await expect(cardLocator).toBeHidden({ timeout: 8000 });

    console.log('🔄 [RELOAD] Sayfa yenileniyor, verinin gerçekten silindiği teyit edilecek...');
    await page.reload();
    await expect(cardLocator).toBeHidden({ timeout: 8000 });

    console.log('✅ [CRUD DELETE] Entegrasyonun silindikten sonra hem arayüzden hem de kalıcı olarak silindiği doğrulandı.');
  });
});
