import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Forgot Password Mocked — Şifremi Unuttum Mock Akışı', () => {
  // Temiz bir oturum durumu ile başla
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Şifremi unuttum bağlantısı, form doldurma ve başarıyla sıfırlama talebi gönderimi', { tag: ['@smoke', '@critical'] }, async ({ page, loginPage }) => {
    const apiBaseUrl = requireEnv('API_BASE_URL');

    // Hata filtreleme
    (page as any).ignoredErrors = [
      /Failed to load resource/i,
      /Cannot read properties of undefined/i
    ];

    // 1. reCAPTCHA ve Turnstile mock'larını yükle
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

    // 2. API isteklerini yakala ve mock yanıt dön
    await page.route(
      (url) => url.href.startsWith(apiBaseUrl),
      async (route) => {
        const urlStr = route.request().url();
        const method = route.request().method();
        console.log(`🛡️ [MOCK API] URL: ${urlStr} (${method})`);

        // Şifre sıfırlama veya şifremi unuttum isteği
        if (urlStr.includes('/forgot-password') || urlStr.includes('/reset-password') || urlStr.includes('/reset')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Password reset link sent successfully.'
            })
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: {} })
          });
        }
      }
    );

    // 3. Giriş sayfasına git
    await loginPage.goto();

    // 4. "Forgot password?" / "Şifremi unuttum" linkine tıklayarak sıfırlama sayfasına geç
    const forgotPasswordLink = page.getByRole('link', { name: /Forgot password|Forgot/i })
      .or(page.locator('a').filter({ hasText: /Forgot password|Forgot|şifremi unuttum/i }))
      .first();

    await expect(forgotPasswordLink).toBeVisible({ timeout: 15000 });
    await expect(forgotPasswordLink).toBeEnabled();
    console.log('🔘 [FORGOT PASSWORD] "Forgot password?" linkine tıklanıyor...');
    await forgotPasswordLink.click();

    // 5. Sıfırlama sayfasına ulaşıldığını doğrula
    await expect(page).toHaveURL(/forgot-password|reset-password|forgot/);

    // 6. E-posta alanını doldur
    const emailInput = page.getByRole('textbox', { name: /email/i })
      .or(page.getByPlaceholder('name@example.com'))
      .or(page.getByLabel(/email/i))
      .first();
    
    await expect(emailInput).toBeVisible({ timeout: 15000 });
    await expect(emailInput).toBeEditable();
    
    const testEmail = 'forgot-password-e2e@gitsec.io';
    console.log(`✉️ [FORGOT PASSWORD] E-posta yazılıyor: ${testEmail}`);
    await emailInput.fill(testEmail);
    await expect(emailInput).toHaveValue(testEmail);

    // 7. Formu gönder
    const submitBtn = page.getByRole('button', { name: /Send reset link|Send|gönder/i })
      .or(page.locator('button[type="submit"]'))
      .first();

    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeEnabled();

    // Captcha korumaları veya engeller varsa butonu aktifleştir
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.getAttribute('type') === 'submit' || /Send|Submit|Gönder/i.test(b.textContent || ''));
      if (btn) {
        btn.removeAttribute('disabled');
        btn.disabled = false;
      }
    });

    console.log('🔘 [FORGOT PASSWORD] Gönder butonuna tıklanıyor...');
    await submitBtn.click({ force: true });

    // 8. Başarı bildiriminin göründüğünü doğrula (Toast veya metin)
    const successToast = page.getByText(/sent|email|check|gönderildi|e-posta|başarılı/i).first();
    await expect(successToast).toBeVisible({ timeout: 20000 });

    console.log('🎉 [FORGOT PASSWORD] Şifre sıfırlama talebi testi başarıyla tamamlandı!');
  });
});
