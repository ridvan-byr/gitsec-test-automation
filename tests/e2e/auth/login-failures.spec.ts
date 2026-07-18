/**
 * Login Failure E2E Test (Ağ Hata ve Uç Durum Senaryoları)
 * 
 * Bu test, giriş sayfasında ağ kopması veya sunucu hatası durumunda 
 * arayüzün (UI) kilitlenmeden doğru hata mesajlarını gösterdiğini doğrular.
 */
import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import { LoginPage } from '../../pages/LoginPage';
import { Page } from '@playwright/test';

// Turnstile engellemelerini aşmak için butonu zorla aktif edip tıklar
async function forceSubmit(page: Page, loginPage: LoginPage) {
  // Next.js hydration'ın tamamlanmasını bekle
  await page.waitForFunction(() => typeof (window as any).next !== 'undefined', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);

  console.log('🔘 [E2E Failure Test] Sign in butonu zorla aktif ediliyor ve tıklanıyor...');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.getAttribute('type') === 'submit' || /Sign in/i.test(b.textContent || ''));
    if (btn) {
      btn.removeAttribute('disabled');
      btn.disabled = false;
    }
  });
  await loginPage.signInButton.click({ force: true });
}

test.describe('Login — UI Ağ Hata (Network & Server Failure) Senaryoları', { tag: ['@regression', '@mocked'] }, () => {
  // Temiz bir oturum durumu ile başla
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page, loginPage }) => {
    // Engellenen ağ veya sunucu isteklerinin testin sonunda sahte hata raporlamasını engellemek için yoksayılacak listeyi tanımla
    (page as GitSecPage).ignoredErrors = [
      /auth\/signin/i,
      /status of 500/i,
      /status of 429/i,
      /failed/i
    ];
    test.setTimeout(180000); // 3 dakika bekleme süresi tanıyarak manuel captcha çözümüne izin veriyoruz
    
    // Cloudflare Turnstile ve Google reCAPTCHA'yı mock'la (Arayüzün kilitlenmesini önlemek için)
    await page.addInitScript(() => {
      (window as any).grecaptcha = {
        ready: (cb: any) => cb(),
        execute: () => Promise.resolve('mock-recaptcha-token'),
        getResponse: () => 'mock-recaptcha-token'
      };
      (window as any).turnstile = {
        render: () => 'mock-turnstile-token',
        reset: () => {},
        getResponse: () => 'mock-turnstile-token'
      };
    });

    await loginPage.goto();
    // Bu dosya Captcha'yı değil, API hata yanıtlarına karşı UI davranışını test eder.
    await loginPage.handleCaptchaIfVisible(1000, 1000, false);
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
    await forceSubmit(page, loginPage);
    console.log('👆 [Failure Test] "Sign in" butonuna tıklandı, ağ hatasına tepki bekleniyor...');

    // 3. Arayüzün çökmediğini ve hata uyarısı gösterdiğini doğrula
    const toastOrAlert = page.locator('[class*="toast"], [id*="toast"], [role="alert"], div[role="status"]').first();
    const errorAlert = toastOrAlert.getByText(/failed|error|hata|fetch/i);
    await expect(errorAlert).toBeVisible({ timeout: 15000 });

    const submitBtn = page.getByRole('button', { name: /Sign in|Giriş Yap/i }).first();
    // HTML disabled'ı JS ile kaldırdığımız için, formun hata durumunda butonun tekrar normal akışına dönüp tıklanabilir (enabled) olduğunu doğrula
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    console.log('✅ Ağ hatası sonrasında giriş butonu tekrar aktifleşti (UI Kurtarma başarılı).');
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
    await forceSubmit(page, loginPage);
    console.log('👆 [Failure Test] "Sign in" butonuna tıklandı, 500 hatasına tepki bekleniyor...');

    // 3. Hata mesajını doğrula
    const toastOrAlert = page.locator('[class*="toast"], [id*="toast"], [role="alert"], div[role="status"]').first();
    const errorAlert = toastOrAlert.getByText(/internal|failed|error|hata/i);
    await expect(errorAlert).toBeVisible({ timeout: 15000 });

    const submitBtn = page.getByRole('button', { name: /Sign in|Giriş Yap/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    console.log('✅ API 500 hatası sonrasında giriş butonu tekrar aktifleşti (UI Kurtarma başarılı).');
    console.log('✅ Giriş esnasında sunucu çöktüğünde (500) UI\'ın hata mesajı gösterdiği başarıyla doğrulandı.');
  });

  test('Boş e-posta ve şifre alanları gönderildiğinde ön yüz doğrulama uyarısı görünmeli', async ({ page, loginPage }) => {
    // Arayüz boş e-posta ve şifre durumunda butonu disabled tutarak gönderimi engeller (Frontend Validation)
    await expect(loginPage.signInButton).toBeDisabled({ timeout: 5000 });
    console.log('✅ Boş form durumunda giriş butonunun pasif (disabled) olduğu başarıyla doğrulandı.');
  });

  test('Geçersiz e-posta formatı girildiğinde form hata vermeli ve gönderilmemeli', async ({ page, loginPage }) => {
    await loginPage.fillForm('invalid-email-format', 'ValidPassword123!');
    
    // Geçersiz e-posta girdisinde giriş butonunun pasif (disabled) kalması gerekir
    await expect(loginPage.signInButton).toBeDisabled({ timeout: 5000 });
    console.log('✅ Geçersiz e-posta formatı girildiğinde butonun pasif (disabled) kaldığı başarıyla doğrulandı.');
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
    await forceSubmit(page, loginPage);

    // 3. Hata mesajını doğrula
    const toastOrAlert = page.locator('[class*="toast"], [id*="toast"], [role="alert"], div[role="status"]').first();
    const errorAlert = toastOrAlert.getByText(/too many|çok fazla|attempts|deneme|limit/i);
    await expect(errorAlert).toBeVisible({ timeout: 15000 });

    const submitBtn = page.getByRole('button', { name: /Sign in|Giriş Yap/i }).first();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
    console.log('✅ API 429 Rate Limit sonrasında giriş butonu tekrar aktifleşti (UI Kurtarma başarılı).');
    console.log('✅ API 429 (Rate Limit) döndüğünde kullanıcıya engel uyarısı gösterildiği başarıyla doğrulandı.');
  });

  test('Giriş formunda sınır değerler (aşırı uzun e-posta, çok kısa şifre) girildiğinde form hata vermeli', async ({ page, loginPage }) => {
    // Sınır Değeri 1: 256 karakterden uzun e-posta ve çok kısa şifre
    const longEmail = 'a'.repeat(250) + '@example.com';
    await loginPage.fillForm(longEmail, '123');
    
    // Geçersiz şifre/email uzunluğunda giriş butonunun pasif kalması beklenir
    await expect(loginPage.signInButton).toBeDisabled({ timeout: 5000 });
    console.log('✅ Giriş formunda e-posta ve şifre sınır değer ihlalinde butonun pasif kaldığı başarıyla doğrulandı.');
  });
});
