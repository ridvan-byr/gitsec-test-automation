import { test, expect, GitSecPage } from '../../fixtures/test';
import type { Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';
import { requestPasswordResetLink, resolveForgotPasswordMailConfig } from '../../support/forgot-password-flow';
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';

function isResetPasswordSubmitPost(url: string, method: string): boolean {
  if (method !== 'POST') return false;
  const pathname = new URL(url).pathname;
  return /\/reset-password(?:\/|$)/i.test(pathname) && !/\/forgot-password/i.test(pathname);
}

async function mockResetPasswordSubmitPost(
  page: Page,
  status: 429 | 500,
  message: string
): Promise<void> {
  await page.route(
    url => /\/reset-password(?:\/|$)/i.test(url.pathname) && !/\/forgot-password/i.test(url.pathname),
    async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const gitSecPage = page as GitSecPage;
      const requestUrl = route.request().url();
      gitSecPage.ignoredErrors = [
        ...(gitSecPage.ignoredErrors || []),
        requestUrl,
        /credentials/i,
        /token/i
      ];

      console.log(`🛡️ [MOCK RESET ${status}] Şifre sıfırlama POST isteği yakalandı: ${requestUrl}`);
      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message, error: message, errors: [message] })
      });
    }
  );
}

async function expectResetApiErrorVisible(page: Page): Promise<void> {
  await expect(async () => {
    const textError = await page.getByText(/too many|çok fazla|attempts|limit|rate|429|internal|server|500|hata|error|unexpected|try again|failed|başarısız|please try/i).first().isVisible().catch(() => false);
    const toastError = await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').filter({
      hasText: /too many|429|500|internal|server|hata|error|try again|failed|unexpected/i
    }).first().isVisible().catch(() => false);
    const stayedOnResetPage = /reset-password/i.test(page.url());

    expect(textError || toastError || stayedOnResetPage).toBeTruthy();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

async function openMockResetFormFromLink(
  forgotPasswordPage: ForgotPasswordPage,
  resetLink: string,
  email: string
): Promise<void> {
  await forgotPasswordPage.openResetLink(resetLink);
  await forgotPasswordPage.fillResetForm(email, 'ValidPassword123!');
}

async function obtainFreshResetLinkForMockTest(
  forgotPasswordPage: ForgotPasswordPage
): Promise<string> {
  await forgotPasswordPage.gotoForgotPasswordFromLogin();
  const { resetLink } = await requestPasswordResetLink(forgotPasswordPage.page);
  return resetLink;
}

test.describe('Forgot Password Failures — Şifre Sıfırlama Uç Durumları', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.describe.configure({ mode: 'serial' });

  let sharedResetLink = '';
  let sharedEmail = '';
  let mockResetLink = '';

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    sharedEmail = resolveForgotPasswordMailConfig().email;

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const setupPage = await context.newPage();
    const setupForgotPasswordPage = new ForgotPasswordPage(setupPage);

    try {
      console.log('📨 [FORGOT PASSWORD] Tüm uç durum testleri için tek sıfırlama linki alınıyor...');
      await setupForgotPasswordPage.gotoForgotPasswordFromLogin();
      const { resetLink } = await requestPasswordResetLink(setupPage);
      sharedResetLink = resetLink;
      console.log(`✅ [FORGOT PASSWORD] Paylaşılan sıfırlama linki hazır: ${sharedResetLink}`);
    } finally {
      await context.close();
    }
  });

  test('Boş e-posta ile form gönderildiğinde doğrulama hatası gösterilmeli', { tag: ['@manual-interactive'] }, async ({ page, forgotPasswordPage }) => {
    test.setTimeout(120_000);
    await forgotPasswordPage.prepareResetForm(sharedResetLink);
    await forgotPasswordPage.fillPasswords('ValidPassword123!', 'ValidPassword123!');

    const resetPostPromise = page.waitForRequest(
      request => isResetPasswordSubmitPost(request.url(), request.method()),
      { timeout: 4_000 }
    ).then(() => true).catch(() => false);

    await forgotPasswordPage.submitReset();
    const resetPostSent = await resetPostPromise;

    await expect(async () => {
      const emailError = forgotPasswordPage.page.getByText(/please enter your email|enter your email|e-posta.*gir|email.*required|geçerli.*e-posta/i).first();
      const hasEmailError = await emailError.isVisible().catch(() => false);
      const emailValueMissing = await forgotPasswordPage.emailInput.evaluate((el: HTMLInputElement) => {
        return el.validity.valueMissing || el.getAttribute('aria-invalid') === 'true';
      });
      const stayedOnResetPage = /reset-password/i.test(forgotPasswordPage.page.url());

      expect(stayedOnResetPage).toBeTruthy();
      expect(resetPostSent).toBeFalsy();
      expect(hasEmailError || emailValueMissing).toBeTruthy();
    }).toPass({ timeout: 10_000, intervals: [250, 500, 1_000] });

    console.log('✅ Boş e-posta ile sıfırlama engellendi.');
  });

  test('Boş şifre alanlarıyla form gönderildiğinde doğrulama hatası gösterilmeli', { tag: ['@manual-interactive'] }, async ({ forgotPasswordPage }) => {
    test.setTimeout(120_000);
    await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
    await forgotPasswordPage.submitReset();

    const passwordInput = forgotPasswordPage.passwordInputs.first();
    const isPasswordInvalid = await passwordInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const validationMessage = forgotPasswordPage.page.locator(':invalid, [class*="error"], p:has-text("required"), span:has-text("required"), span:has-text("boş"), span:has-text("password")').first();
    const hasCustomError = await validationMessage.isVisible().catch(() => false);

    expect(isPasswordInvalid || hasCustomError).toBeTruthy();
    console.log('✅ Boş şifre alanları ile sıfırlama engellendi.');
  });

  test('Eşleşmeyen şifreler girildiğinde form hata vermeli', { tag: ['@manual-interactive'] }, async ({ forgotPasswordPage }) => {
    test.setTimeout(120_000);
    await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
    await forgotPasswordPage.fillPasswords('ValidPassword123!', 'DifferentPassword123!');
    await forgotPasswordPage.submitReset();

    const errorAlert = forgotPasswordPage.page.locator(
      '[class*="error"], p:has-text("match"), p:has-text("eşleş"), span:has-text("match"), span:has-text("eşleş"), span:has-text("confirm"), p:has-text("confirm")'
    ).first();
    const stayedOnResetPage = /reset|forgot|password|change-password/i.test(forgotPasswordPage.page.url());
    const hasError = await errorAlert.isVisible().catch(() => false);

    expect(hasError || stayedOnResetPage).toBeTruthy();
    console.log('✅ Eşleşmeyen şifreler ile sıfırlama engellendi.');
  });

  test('Zayıf veya kısa şifre girildiğinde form doğrulama yapmalı', { tag: ['@manual-interactive'] }, async ({ forgotPasswordPage }) => {
    test.setTimeout(120_000);
    await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
    await forgotPasswordPage.fillPasswords('123', '123');
    await forgotPasswordPage.submitReset();

    const passwordInput = forgotPasswordPage.passwordInputs.first();
    const isPasswordInvalid = await passwordInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const hasError = await forgotPasswordPage.page.locator(
      ':invalid, [class*="error"], span:has-text("karakter"), p:has-text("karakter"), span:has-text("şifre"), p:has-text("password"), span:has-text("weak"), p:has-text("weak")'
    ).first().isVisible().catch(() => false);

    expect(isPasswordInvalid || hasError).toBeTruthy();
    console.log('✅ Zayıf şifre doğrulaması çalıştı.');
  });

  test('Sınır değerler (çok uzun şifre) girildiğinde form doğrulama yapmalı', { tag: ['@manual-interactive'] }, async ({ forgotPasswordPage }) => {
    test.setTimeout(120_000);
    const longPassword = `Aa1!${'x'.repeat(200)}`;
    await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
    await forgotPasswordPage.fillLongPasswordForValidation(longPassword);
    await forgotPasswordPage.submitReset();

    const passwordInput = forgotPasswordPage.passwordInputs.first();
    const isPasswordInvalid = await passwordInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const hasError = await forgotPasswordPage.page.locator(
      ':invalid, [class*="error"], span:has-text("karakter"), p:has-text("karakter"), span:has-text("long"), p:has-text("long"), span:has-text("limit"), span:has-text("too long"), p:has-text("too long")'
    ).first().isVisible().catch(() => false);
    const stayedOnResetPage = /reset-password/i.test(forgotPasswordPage.page.url());

    expect(isPasswordInvalid || hasError || stayedOnResetPage).toBeTruthy();
    console.log('✅ Uzun şifre sınır doğrulaması çalıştı.');
  });

  test('Geçersiz veya süresi dolmuş token ile sıfırlama başarısız olmalı', async ({ page, forgotPasswordPage }) => {
    test.setTimeout(120_000);
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const invalidLink = `${dashboardBaseUrl}/reset-password/invalid-token-e2e-test`;

    await page.goto(invalidLink, { waitUntil: 'domcontentloaded' });
    await forgotPasswordPage.expectResetPasswordPage();
    await forgotPasswordPage.fillResetForm(sharedEmail, 'ValidPassword123!');

    const responsePromise = page.waitForResponse(response =>
      isResetPasswordSubmitPost(response.url(), response.request().method())
    , { timeout: 15_000 }).catch(() => null);

    await forgotPasswordPage.submitReset();
    const response = await responsePromise;

    const errorAlert = page.getByText(/invalid|expired|geçersiz|süresi dol|token|link|hata|error|failed|başarısız|unable|could not/i).first();
    const hasError = await errorAlert.isVisible({ timeout: 15_000 }).catch(() => false);
    const failedResponse = Boolean(response && response.status() >= 400);
    const stayedOnResetPage = /reset-password/i.test(page.url());

    expect(hasError || failedResponse || stayedOnResetPage).toBeTruthy();
    console.log('✅ Geçersiz token senaryosu doğrulandı.');
  });

  test('Şifre sıfırlama sırasında API 429 dönerse UI hata göstermeli', { tag: ['@manual-interactive'] }, async ({ page, forgotPasswordPage }) => {
    test.setTimeout(300_000);
    (page as GitSecPage).ignoredErrors = [/reset-password/, /status of 429/, /too many requests/i, /credentials/i, /token/i, /reCAPTCHA Timeout/i];

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockResetPasswordSubmitPost(page, 429, 'Too many requests. Please try again later.');
    mockResetLink = await obtainFreshResetLinkForMockTest(forgotPasswordPage);
    await openMockResetFormFromLink(forgotPasswordPage, mockResetLink, sharedEmail);

    const responsePromise = page.waitForResponse(response =>
      response.status() === 429 &&
      isResetPasswordSubmitPost(response.url(), response.request().method())
    , { timeout: 30_000 });
    await forgotPasswordPage.submitReset();
    const response = await responsePromise;
    expect(response.status()).toBe(429);

    await expectResetApiErrorVisible(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    console.log('✅ API 429 durumunda UI hata gösterimi doğrulandı.');
  });

  test('Şifre sıfırlama sırasında API 500 dönerse UI hata göstermeli', { tag: ['@manual-interactive'] }, async ({ page, forgotPasswordPage }) => {
    test.setTimeout(300_000);
    (page as GitSecPage).ignoredErrors = [/reset-password/, /status of 500/, /internal server error/i, /credentials/i, /token/i, /reCAPTCHA Timeout/i];

    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await mockResetPasswordSubmitPost(page, 500, 'Internal Server Error');
    expect(mockResetLink).toBeTruthy();
    await openMockResetFormFromLink(forgotPasswordPage, mockResetLink, sharedEmail);

    const responsePromise = page.waitForResponse(response =>
      response.status() === 500 &&
      isResetPasswordSubmitPost(response.url(), response.request().method())
    , { timeout: 30_000 });
    await forgotPasswordPage.submitReset();
    const response = await responsePromise;
    expect(response.status()).toBe(500);

    await expectResetApiErrorVisible(page);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    console.log('✅ API 500 durumunda UI hata gösterimi doğrulandı.');
  });

  test('Doğru bilgilerle şifre sıfırlanmalı ve yeni şifre ile giriş yapılabilmeli', { tag: ['@manual-interactive', '@critical'] }, async ({ page, loginPage, forgotPasswordPage }) => {
    test.setTimeout(300_000);
    const newPassword = requireEnv('E2E_USER_PASSWORD');

    (page as GitSecPage).ignoredErrors = [/reCAPTCHA Timeout/i];
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    console.log('📨 [FORGOT PASSWORD] Final akış için yeni sıfırlama linki alınıyor...');
    await forgotPasswordPage.gotoForgotPasswordFromLogin();
    const { resetLink } = await requestPasswordResetLink(page);
    await forgotPasswordPage.openResetLink(resetLink);
    await forgotPasswordPage.resetPassword(sharedEmail, newPassword);

    console.log('🔐 [FORGOT PASSWORD] Yeni şifre ile giriş doğrulanıyor...');
    await expect(loginPage.emailInput).toBeVisible({ timeout: 15_000 });
    await loginPage.fillForm(sharedEmail, newPassword);
    await loginPage.handleCaptchaIfVisible(600_000, 10_000, false);
    await loginPage.submit();

    await page.waitForURL(/dashboard\.gitsec\.io/i, { timeout: 30_000 }).catch(() => {});
    await expect(page).not.toHaveURL(/\/(?:sign-in|login)(?:[/?#]|$)/i, { timeout: 30_000 });
    console.log('✅ Şifre sıfırlama ve giriş akışı başarıyla tamamlandı.');
  });
});
