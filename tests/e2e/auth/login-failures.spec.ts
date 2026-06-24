/**
 * Login Failure E2E Test (Ağ Hata ve Uç Durum Senaryoları)
 * 
 * Bu test, giriş sayfasında ağ kopması veya sunucu hatası durumunda 
 * arayüzün (UI) kilitlenmeden doğru hata mesajlarını gösterdiğini doğrular.
 */
import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Login — UI Ağ Hata (Network & Server Failure) Senaryoları', () => {
  // Temiz bir oturum durumu ile başla
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, loginPage }) => {
    test.setTimeout(180000); // 3 dakika bekleme süresi tanıyarak manuel captcha çözümüne izin veriyoruz
    await loginPage.goto();
    await loginPage.handleCaptchaIfVisible();
  });

  test('Giriş isteği ağ seviyesinde başarısız olursa (Network Request Failed) UI hata bildirmeli', async ({ page, loginPage }) => {
    // 1. Ağ seviyesinde signin POST isteğini kesip ağ hatası (abort) fırlatıyoruz
    await page.route('**/auth/signin', async (route) => {
      if (route.request().method() === 'POST') {
        console.log(`🛡️ [MOCK] Signin POST isteği engellendi (Network Failed).`);
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // 2. Form alanlarını doldur ve tıkla
    await loginPage.fillForm('e2e-failure-test@gitsec.io', 'WrongPassword123!');
    await loginPage.submit();
    console.log('👆 [Failure Test] "Sign in" butonuna tıklandı, ağ hatasına tepki bekleniyor...');

    // 3. Arayüzün çökmediğini ve hata uyarısı gösterdiğini doğrula
    const errorAlert = page.getByText(/failed|error|hata|fetch/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 });
    console.log('✅ Giriş esnasında ağ bağlantısı koptuğunda UI\'ın hata mesajı gösterdiği başarıyla doğrulandı.');
  });

  test('Giriş esnasında API 500 Internal Server Error dönerse UI hata göstermeli', async ({ page, loginPage }) => {
    // 1. Ağ seviyesinde signin POST isteğini kesip 500 hatası dönüyoruz
    await page.route('**/auth/signin', async (route) => {
      if (route.request().method() === 'POST') {
        console.log(`🛡️ [MOCK] Signin POST isteği kesildi, 500 Internal Server Error dönülüyor.`);
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Internal Database Error during login authentication'
          })
        });
      } else {
        await route.continue();
      }
    });

    // 2. Form alanlarını doldur ve tıkla
    await loginPage.fillForm('e2e-server-error@gitsec.io', 'SomePassword123!');
    await loginPage.submit();
    console.log('👆 [Failure Test] "Sign in" butonuna tıklandı, 500 hatasına tepki bekleniyor...');

    // 3. Hata mesajını doğrula
    const errorAlert = page.getByText(/internal|failed|error|hata/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 });
    console.log('✅ Giriş esnasında sunucu çöktüğünde (500) UI\'ın hata mesajı gösterdiği başarıyla doğrulandı.');
  });

  test('Boş e-posta ve şifre alanları gönderildiğinde ön yüz doğrulama uyarısı görünmeli', async ({ page, loginPage }) => {
    // Butona doğrudan tıkla (alanlar boş)
    await loginPage.submit();
    console.log('Form boşken Sign in butonuna tıklandı.');

    // HTML5 validation ya da custom validation doğrula
    const isHtml5Invalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const validationMessage = page.locator(':invalid, [class*="error"], p:has-text("required"), span:has-text("required"), span:has-text("boş")').first();
    const hasCustomError = await validationMessage.isVisible().catch(() => false);
    
    expect(isHtml5Invalid || hasCustomError).toBeTruthy();
    console.log('✅ Boş form gönderildiğinde doğrulama mekanizmasının çalıştığı başarıyla doğrulandı.');
  });

  test('Geçersiz e-posta formatı girildiğinde form hata vermeli ve gönderilmemeli', async ({ page, loginPage }) => {
    await loginPage.fillForm('invalid-email-format', 'ValidPassword123!');
    await loginPage.submit();

    // HTML5 e-posta format denetimi ya da custom error kontrolü
    const isHtml5Invalid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const errorAlert = page.locator(':invalid, [class*="error"], span:has-text("format"), p:has-text("email"), p:has-text("posta")').first();
    const hasCustomError = await errorAlert.isVisible().catch(() => false);

    expect(isHtml5Invalid || hasCustomError).toBeTruthy();
    console.log('✅ Geçersiz e-posta formatı girildiğinde formun gönderilmediği başarıyla doğrulandı.');
  });

  test('API 429 Too Many Requests (Rate Limit) döndüğünde UI kullanıcıya engel uyarısı göstermeli', async ({ page, loginPage }) => {
    // 1. Ağ seviyesinde signin POST isteğini kesip 429 dönüyoruz
    await page.route('**/auth/signin', async (route) => {
      if (route.request().method() === 'POST') {
        console.log(`🛡️ [MOCK] Signin POST isteği kesildi, 429 Too Many Requests dönülüyor.`);
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Too many login attempts. Please try again after 60 seconds.'
          })
        });
      } else {
        await route.continue();
      }
    });

    // 2. Form alanlarını doldur ve tıkla
    await loginPage.fillForm('rate-limit-test@gitsec.io', 'SomePassword123!');
    await loginPage.submit();

    // 3. Hata mesajını doğrula
    const errorAlert = page.getByText(/too many|çok fazla|attempts|deneme|limit/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 });
    console.log('✅ API 429 (Rate Limit) döndüğünde kullanıcıya engel uyarısı gösterildiği başarıyla doğrulandı.');
  });

  test('Giriş formunda sınır değerler (aşırı uzun e-posta, çok kısa şifre) girildiğinde form hata vermeli', async ({ page, loginPage }) => {
    // Sınır Değeri 1: 256 karakterden uzun e-posta ve çok kısa şifre
    const longEmail = 'a'.repeat(250) + '@example.com';
    await loginPage.fillForm(longEmail, '123');
    await loginPage.submit();

    // HTML5 invalid durumu ya da arayüzdeki hata mesajının tetiklenmesini kontrol edelim
    const isEmailValid = await loginPage.emailInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    const isPasswordValid = await loginPage.passwordInput.evaluate((el: HTMLInputElement) => el.validity.valid);
    
    const errorAlert = page.locator(':invalid, [class*="error"], span:has-text("karakter"), p:has-text("karakter"), span:has-text("şifre"), p:has-text("password")').first();
    const hasCustomError = await errorAlert.isVisible().catch(() => false);

    expect(!isEmailValid || !isPasswordValid || hasCustomError).toBeTruthy();
    console.log('✅ Giriş formunda e-posta ve şifre sınır değer doğrulamasının çalıştığı başarıyla doğrulandı.');
  });
});

