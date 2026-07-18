import { test, expect, GitSecPage } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';

let dashboardBaseUrl: string;

async function mockNextRegistrationPost(
  page: Page,
  status: 429 | 500,
  message: string
): Promise<void> {
  await page.route('**/*', async route => {
      const request = route.request();
      const requestUrl = request.url();
      const isCaptchaProvider = /google\.com\/recaptcha|gstatic\.com\/recaptcha|challenges\.cloudflare\.com/i.test(requestUrl);

      if (request.method() !== 'POST' || isCaptchaProvider) {
        await route.continue();
        return;
      }

      const gitSecPage = page as GitSecPage;
      gitSecPage.ignoredErrors = [...(gitSecPage.ignoredErrors || []), requestUrl];

      console.log(`🛡️ [MOCK REGISTER ${status}] Kayıt POST isteği yakalandı: ${requestUrl}`);
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message })
      });
    });
}

async function ensureConsentsChecked(termsCheckbox: Locator, privacyCheckbox: Locator): Promise<void> {
  await expect(async () => {
    if (await termsCheckbox.getAttribute('data-state') !== 'checked') {
      await termsCheckbox.click();
    }
    if (await privacyCheckbox.getAttribute('data-state') !== 'checked') {
      await privacyCheckbox.click();
    }
    if (await termsCheckbox.getAttribute('data-state') !== 'checked') {
      await termsCheckbox.click();
    }

    expect(await termsCheckbox.getAttribute('data-state')).toBe('checked');
    expect(await privacyCheckbox.getAttribute('data-state')).toBe('checked');
  }).toPass({ timeout: 10000, intervals: [250, 500] });

  await expect(termsCheckbox).toHaveAttribute('data-state', 'checked');
  await expect(privacyCheckbox).toHaveAttribute('data-state', 'checked');
}

test.describe('Register Failures — Kayıt Hata Durumları E2E Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const signUpUrl = `${dashboardBaseUrl}/sign-up`;
    console.log(`🚀 [Register Edge Cases] Kayıt sayfasına gidiliyor: ${signUpUrl}`);
    await page.goto(signUpUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15000 });
  });

  test('Zaten kayıtlı bir e-posta ile kayıt olmaya çalışıldığında uygun hata mesajı gösterilmeli', { tag: ['@manual-interactive'] }, async ({ page, registerPage }) => {
    // 400 Bad Request / 409 Conflict durumunu audit kontrolünden muaf tut
    (page as GitSecPage).ignoredErrors = [/auth\/signup/, /status of 400/, /status of 409/, /already exists/i];

    const email = requireEnv('E2E_USER_EMAIL');
    const password = 'Password123!';
    const firstName = 'Duplicate';
    const lastName = 'TestUser';

    // Captcha varsa çözülmesini bekle (Giriş alanları odağını bozmamak için)
    await registerPage.handleCaptchaIfVisible(30000).catch(() => {});

    // ─── ADIM 2: Formu doldur ───
    await registerPage.fillForm(firstName, lastName, email, password);

    // ─── ADIM 3: Koşulları onay kutularını işaretle ───
    const termsCheckbox = page.getByRole('checkbox', { name: /terms of service/i });
    const privacyCheckbox = page.getByRole('checkbox', { name: /privacy policy/i });

    await termsCheckbox.click();
    await expect(termsCheckbox).toHaveAttribute('data-state', 'checked', { timeout: 5000 });

    await privacyCheckbox.click();
    await expect(privacyCheckbox).toHaveAttribute('data-state', 'checked', { timeout: 5000 });

    // ─── ADIM 4: Captcha kontrolü yap ───
    await registerPage.handleCaptchaIfVisible(30000).catch(() => {});

    // ─── ADIM 5: Formu gönder ───
    console.log('🔘 [E2E] Kayıt formu gönderiliyor...');
    await registerPage.submit();

    // ─── ADIM 6: Hata mesajının arayüzde görünür olduğunu doğrula ───
    const errorToast = page.getByText(/exists|already|kullanımda|kayıtlı|verified|credentials/i).first();

    await expect(errorToast).toBeVisible({ timeout: 15000 });
    console.log('✅ [E2E] Zaten kayıtlı e-posta hatası başarıyla doğrulandı.');
  });

  test('Boş alanlarla kayıt olmaya çalışıldığında form hata vermeli', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();
    await submitButton.click({ force: true });
    
    const nameInput = page.locator('input[name="name"]');
    const isNameInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    
    const validationMessage = page.locator(':invalid, [class*="error"], p:has-text("required"), span:has-text("required"), span:has-text("boş")').first();
    const hasCustomError = await validationMessage.isVisible().catch(() => false);
    
    expect(isNameInvalid || hasCustomError).toBeTruthy();
    console.log('✅ Boş form ile kayıt engellendi.');
  });

  test('Geçersiz e-posta formatı girildiğinde form hata vermeli', async ({ page }) => {
    const emailInput = page.locator('input[name="email"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();
    
    await emailInput.fill('invalidemail');
    await submitButton.click({ force: true });
    
    const isEmailInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const errorAlert = page.locator(':invalid, [class*="error"], span:has-text("format"), p:has-text("email"), p:has-text("posta")').first();
    const hasCustomError = await errorAlert.isVisible().catch(() => false);
    
    expect(isEmailInvalid || hasCustomError).toBeTruthy();
    console.log('✅ Geçersiz e-posta formatıyla kayıt engellendi.');
  });

  test('Koşullar ve gizlilik onaylanmadan kayıt butonu devre dışı kalmalı veya form gönderilmemeli', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]');
    const surnameInput = page.locator('input[name="surname"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('Edge');
    await surnameInput.fill('Tester');
    await emailInput.fill('edge-test-auth@gitsec.io');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('ValidPassword123!');
      await passwordInputs.nth(1).fill('ValidPassword123!');
    } else {
      await passwordInputs.first().fill('ValidPassword123!');
    }

    const isEnabled = await submitButton.isEnabled();
    const registrationRequestPromise = page.waitForRequest(
      request => request.method() === 'POST' && (request.postData() || '').includes('edge-test-auth@gitsec.io'),
      { timeout: 2000 }
    ).then(() => true).catch(() => false);
    
    if (isEnabled) {
      await submitButton.click({ force: true });
      const errorMsg = page.locator('[class*="error"], p:has-text("terms"), p:has-text("privacy"), span:has-text("koşul"), span:has-text("kabul")').first();
      const isErrorVisible = await errorMsg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      expect(isErrorVisible || (await page.url().includes('sign-up'))).toBeTruthy();
    } else {
      expect(isEnabled).toBeFalsy();
    }
    expect(await registrationRequestPromise, 'Terms/privacy kabul edilmeden kayıt POST isteği gönderilmemeli.').toBe(false);
    console.log('✅ Koşullar kabul edilmeden kayıt yapılması engellendi.');
  });

  test('Sınır değerler (çok uzun isim, geçersiz şifre limitleri) girildiğinde form doğrulama yapmalı', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('a'.repeat(250));
    await emailInput.fill('a'.repeat(200) + '@example.com');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('123');
      await passwordInputs.nth(1).fill('123');
    } else {
      await passwordInputs.first().fill('123');
    }

    await submitButton.click({ force: true });
    
    const isPasswordInvalid = await passwordInputs.first().evaluate((el: HTMLInputElement) => !el.validity.valid);
    const hasError = await page.locator(':invalid, [class*="error"], span:has-text("karakter"), p:has-text("karakter"), span:has-text("şifre"), p:has-text("password")').first().isVisible().catch(() => false);
    
    expect(isPasswordInvalid || hasError).toBeTruthy();
    console.log('✅ Sınır değer doğrulamasının çalıştığı doğrulandı.');
  });

  test('Kayıt esnasında API 429 Rate Limit dönerse UI hata göstermeli', { tag: ['@manual-interactive'] }, async ({ page, registerPage }) => {
    test.setTimeout(900000);
    // 429 durumunu audit kontrolünden muaf tut
    (page as GitSecPage).ignoredErrors = [/auth\/(signup|register)/, /status of 429/, /too many requests/i];

    await registerPage.fillForm('Edge', 'Tester', 'edge-rate-limit@gitsec.io', 'ValidPassword123!');

    const termsCheckbox = page.getByRole('checkbox', { name: /terms of service/i });
    const privacyCheckbox = page.getByRole('checkbox', { name: /privacy policy/i });

    // Captcha çözümü formu yeniden render edip consent state'lerini sıfırlayabildiği için önce Captcha tamamlanır.
    await registerPage.handleCaptchaIfVisible(600000, 10000);
    // Terms/privacy Captcha'dan sonra ve submit'ten hemen önce birlikte doğrulanır.
    await ensureConsentsChecked(termsCheckbox, privacyCheckbox);

    await mockNextRegistrationPost(
      page,
      429,
      'Too many requests. Please try again later.'
    );
    const responsePromise = page.waitForResponse(response =>
      response.status() === 429 &&
      response.request().method() === 'POST'
    );
    await registerPage.submit();
    const response = await responsePromise;
    expect(response.status()).toBe(429);
    
    const errorAlert = page.getByText(/too many|çok fazla|attempts|limit|hata|error/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 });
    console.log('✅ API 429 durumunda UI hata gösterimi doğrulandı.');
  });

  test('Kayıt esnasında API 500 Server Error dönerse UI hata göstermeli', { tag: ['@manual-interactive'] }, async ({ page, registerPage }) => {
    test.setTimeout(900000);
    // 500 durumunu audit kontrolünden muaf tut
    (page as GitSecPage).ignoredErrors = [/auth\/(signup|register)/, /status of 500/, /internal server error/i];

    await registerPage.fillForm('Edge', 'Tester', 'edge-500-error@gitsec.io', 'ValidPassword123!');

    const termsCheckbox = page.getByRole('checkbox', { name: /terms of service/i });
    const privacyCheckbox = page.getByRole('checkbox', { name: /privacy policy/i });

    // Captcha çözümü formu yeniden render edip consent state'lerini sıfırlayabildiği için önce Captcha tamamlanır.
    await registerPage.handleCaptchaIfVisible(600000, 10000);
    // Terms/privacy Captcha'dan sonra ve submit'ten hemen önce birlikte doğrulanır.
    await ensureConsentsChecked(termsCheckbox, privacyCheckbox);

    await mockNextRegistrationPost(page, 500, 'Internal Server Error');
    const responsePromise = page.waitForResponse(response =>
      response.status() === 500 &&
      response.request().method() === 'POST'
    );
    await registerPage.submit();
    const response = await responsePromise;
    expect(response.status()).toBe(500);
    
    const errorAlert = page.getByText(/internal|server|500|hata|error/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 });
    console.log('✅ API 500 durumunda UI hata gösterimi doğrulandı.');
  });
});
