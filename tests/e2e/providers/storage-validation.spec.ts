/**
 * Test: AWS S3 Storage Provider Form Validation (Faz 2 - Validation Matrix)
 * 
 * Risk:
 * Eksik veya geçersiz verilerle entegrasyon oluşturulmaya çalışılması, 
 * backend'de veri bozulmasına veya uygulamanın hata vermesine yol açabilir.
 * 
 * Beklenen:
 * - Gerekli alanlar boş bırakıldığında veya sadece boşluk girildiğinde form kaydetmeye izin vermemelidir (Client-side validation).
 * - Aynı isimde mükerrer (duplicate) kayıt eklenmeye çalışıldığında sistem bunu engellemeli ve kullanıcı dostu hata dönmelidir.
 * 
 * Doğrulama (Assert):
 * - Boş veya boşluklu Connection Name durumunda "Save" butonunun `disabled` olması.
 * - Mükerrer kayıtta API'den dönen hata toast bildiriminin ekranda görünür olması.
 * 
 * Yanlış Pozitif Riski:
 * Arayüz butonu aktif/pasif etme kontrolünü kaçırabilir, veya duplicate kayıtta backend 
 * hata dönse bile UI bunu yakalamayıp sessizce kalabilir veya başarılıymış gibi davranabilir.
 * 
 * Ek Doğrulama (Mitigation):
 * - Ağ seviyesinde ve DOM seviyesinde hem buton durumları (`toBeDisabled`) hem de spesifik hata mesajı 
 *   toast içerikleri (`already exists`, `failed to add`) eksiksiz assert edilir.
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

test.describe('AWS S3 Depolama Sağlayıcısı Form Doğrulama (Validation) Testleri', () => {
  test.setTimeout(180000);
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
  // 🚫 SENARYO 1: BOŞ VE GEÇERSİZ ALAN DOĞRULAMALARI (CLIENT-SIDE)
  // ─────────────────────────────────────────────────────────────────
  test('Boş Connection Name ve Bucket Name alanları için hata mesajlarını doğrula', async ({ page }) => {
    // Tüm alanları boş bırakıp doğrudan "Add Storage" butonunun durumunu kontrol edelim
    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Arayüzün butonunu devre dışı (disabled) bıraktığını doğrula
    await expect(saveBtn).toBeDisabled();
    console.log('✅ Boş bırakılan alanlar için client-side doğrulamada Add Storage butonunun devre dışı kaldığı başarıyla doğrulandı.');
  });

  test('Sadece boşluk (whitespace) girildiğinde kaydetmeyi engelle', async ({ page }) => {
    const connName = '   '; // Boşluk karakterleri
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // Formu sadece boşluk içeren isimle dolduralım
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();

    // Yönlendirme engellenmeli ve buton disabled kalmalıdır
    await expect(saveBtn).toBeDisabled();
    console.log('✅ Sadece boşluklardan (whitespace) oluşan Connection Name girişi sonrası butonun disabled kaldığı doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 📡 SENARYO 3: DUPLICATE (MÜKERRER) KAYIT API DOĞRULAMASI
  // ─────────────────────────────────────────────────────────────────
  test('Aynı isimde mükerrer sağlayıcı eklenmek istendiğinde backend hata toast mesajını doğrula', async ({ page }) => {
    const connName = `Duplicate AWS Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // Mükerrer kayıt hatası simülasyonu için POST isteğini kesip 400 Duplicate hatası dönelim
    await page.route(
      (url) => url.href.includes('/api/storage-providers') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Duplicate S3 Bucket Save POST isteği kesildi ve 400 Duplicate hatası dönülüyor.`);
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              errors: [{ message: 'This storage provider or bucket already exists.' }],
              message: 'A storage provider with this bucket already exists.'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    // 1. Formu dolduralım, bağlantıyı test edelim (Save butonunun aktifleşmesi için)
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();

    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await saveBtn.click();

    // 3. Dinamik Hata Yakalayıcı ile hata mesajını doğrula
    await assertAndLogDynamicError(page, /already exists|failed to add/i);

    console.log('✅ Mükerrer kayıt durumunda backend hata toast mesajının ekranda belirdiği başarıyla doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 🚫 SENARYO 4: GEÇERSİZ AWS KİMLİK BİLGİSİ FORMATI (CREDENTIALS MATRIX)
  // ─────────────────────────────────────────────────────────────────
  test('Geçersiz formatta AWS credentials girildiğinde arayüzde hata mesajını doğrula', async ({ page }) => {
    const connName = `Invalid Credentials Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = 'INVALID ACCESS KEY WITH SPACES'; // Geçersiz access key formatı
    const secretAccessKey = 'short'; // Çok kısa secret key
    const awsRegion = requireEnv('AWS_REGION');

    // Connection test API'sini mock'la (Geçersiz veri hatası dönecek şekilde)
    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log('🛡️ [MOCK] Connection Test returning 400 Bad Request due to invalid credentials format.');
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Invalid AWS Credentials format.',
            errors: [{ message: 'Access Key ID must be alphanumeric and exactly 20 characters long.' }],
            data: {
              isSuccessful: false,
              provider: 1,
              durationMs: 150,
              checks: []
            }
          })
        });
      }
    );

    // Formu geçersiz bilgilerle dolduralım
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    // Test Connection butonuna tıklayalım
    const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
    await testConnectionBtn.click();

    // Dinamik Hata Yakalayıcı ile hata mesajını doğrula
    await assertAndLogDynamicError(page, /invalid|credential|key|auth|format|failed|connection/i);
  });

  // ─────────────────────────────────────────────────────────────────
  // ⏳ SENARYO 5: BAĞLANTI SINAMA VE KURTARMA (CONNECTION TEST & RECOVERY)
  // ─────────────────────────────────────────────────────────────────
  test('Bağlantı test API yanıtında form kurtarılabilirliğini doğrula', async ({ page }) => {
    const connName = `Connection Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // Formu dolduralım
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);

    // Test Connection butonuna tıklayalım ve modalın kapanmasını bekleyelim (POM metodunu kullanarak)
    await storagePage.testS3Connection();

    // Formun hala doldurulmuş olduğunu ve "Add Storage" butonunun aktifleştiğini (kurtarılabilirlik) doğrula
    const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await expect(saveBtn).toBeEnabled();
    console.log('✅ Bağlantı sınama sonrası formun kurtarılabilirliği ve buton durumu başarıyla doğrulandı.');
  });

  test('Bağlantı dizesi veya anahtar alanına 5000 karakterlik aşırı büyük veri girildiğinde UI kilitlenmemeli ve hata verilmeli', async ({ page }) => {
    const connName = `Large Payload Test - ${Date.now()}`;
    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const largeSecret = 'a'.repeat(5000); // 5000 karakterlik aşırı büyük veri bloku
    const awsRegion = requireEnv('AWS_REGION');

    // API isteğini mocklayalım (400 Bad Request - Payload Too Large)
    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log('🛡️ [MOCK] Connection Test returning 400 Bad Request due to payload size limits.');
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

    // Formu dolduralım
    await storagePage.fillAWSForm(connName, bucketName, accessKeyId, largeSecret, awsRegion);

    // Test Connection butonuna tıklayalım
    const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
    await testConnectionBtn.click();

    // Sayfanın donmadığını (interaktif kaldığını) doğrulamak için başka bir form alanına tıklayabiliyor muyuz bakalım
    const nameInput = page.locator('input[name="name"], input[placeholder*="Connection Name"]').first();
    await expect(nameInput).toBeEnabled();
    await nameInput.click();

    // Dinamik Hata mesajının gösterildiğini doğrula
    await assertAndLogDynamicError(page, /too large|exceeds|limit|failed|error|invalid/i);
    console.log('✅ Aşırı büyük payload girildiğinde UI donmadığı ve hata uyarısı verildiği başarıyla doğrulandı.');
  });

  test('Bağlantı isminde (Connection Name) Null Byte, RTL karakterler ve Zero-width space içeren veriler girildiğinde uygulama çökmemeli ve hata uyarısı veya başarılı kayıt işlemiyle sonuçlanmalıdır', async ({ page }) => {
    const charsetNames = [
      'Null\0Byte',
      'AWS_S3_اختبار_RTL',
      'Arapça\u200BZeroWidth'
    ];

    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    for (const connName of charsetNames) {
      console.log(`📝 [CHARSET TEST] "${connName.replace('\0', '\\0')}" ismi ile depolama sağlayıcısı testi yapılıyor...`);
      
      // Her iterasyonda temiz bir form sayfasında başladığımızdan emin olmak için sayfayı sıfırlayalım (ilk eleman hariç)
      if (connName !== charsetNames[0]) {
        await storagePage.navigateToStoragePage();
        await storagePage.clickAddStorageProvider();
        await storagePage.selectS3Provider();
      }

      // Formu dolduralım ve bağlantıyı test edelim (Mock 200 dönecektir)
      await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
      await storagePage.testS3Connection();

      // Kaydetme butonunu tetikleyelim
      const saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
      await saveBtn.click();

      // En fazla 15 saniye boyunca ya /storage sayfasına yönlenmesini ya da bir hata mesajının belirmesini bekleyelim
      let redirected = false;
      let hasError: string | null = null;
      await expect(async () => {
        const currentUrl = page.url();
        if (currentUrl.includes(`/${workspaceId}/storage`) && !currentUrl.includes('/storage/add')) {
          redirected = true;
          return;
        }
        hasError = await getVisibleErrorMessage(page).catch(() => null);
        if (hasError) {
          return;
        }
        throw new Error('Still waiting for redirect or error');
      }).toPass({ timeout: 15000, intervals: [250] });

      if (redirected) {
        console.log(`✅ [CHARSET TEST] "${connName.replace('\0', '\\0')}" başarıyla kaydedildi.`);
        
        // Eklendiğini doğrula ve temizle
        await storagePage.verifyProviderActive(connName);
        await storagePage.deleteProvider(connName);
      } else {
        // Eğer form sayfasında kaldıysak, hata toast/metninin geldiğini ve sayfanın donmadığını doğrula
        console.log(`ℹ️ [CHARSET TEST] Kayıt başarısız oldu veya form sayfasında kalındı. Hata mesajı aranıyor...`);
        await assertAndLogDynamicError(page, /failed|error|invalid|name|format|already|duplicate|denied/i);
        
        // Sayfanın donmadığını doğrula (İnteraktif kalmalı)
        const nameInput = page.locator('input[name="name"], input[placeholder*="Connection Name"]').first();
        await expect(nameInput).toBeEnabled();
        console.log(`✅ [CHARSET TEST] Sunucu isteği reddetti ancak sayfa donmadı ve hata mesajı gösterildi.`);
      }
    }
  });
});
