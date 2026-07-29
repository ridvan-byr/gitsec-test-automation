import { expect, type Browser, type Page } from '@playwright/test';
import type { GitSecPage } from '../fixtures/test';
import type { LoginPage } from '../pages/LoginPage';
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import { requireEnv } from './require-env';
import {
  pollPasswordResetEmail,
  type PasswordResetEmailReceipt
} from './password-reset-email';
import {
  requestPasswordResetLink,
  resolveForgotPasswordMailConfig
} from './forgot-password-flow';

export function isResetPasswordSubmitPost(url: string, method: string): boolean {
  if (method !== 'POST') return false;
  const pathname = new URL(url).pathname;
  return /\/reset-password(?:\/|$)/i.test(pathname) && !/\/forgot-password/i.test(pathname);
}

export async function mockResetPasswordSubmitPost(
  page: Page,
  status: 401 | 422 | 429 | 500,
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


export async function obtainSharedPasswordResetLink(
  browser: Browser
): Promise<{ resetLink: string; email: string }> {
  const email = resolveForgotPasswordMailConfig().email;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const setupPage = await context.newPage();
  const setupForgotPasswordPage = new ForgotPasswordPage(setupPage);

  try {
    console.log('📨 [FORGOT PASSWORD] Form doğrulama testleri için paylaşılan sıfırlama linki alınıyor...');
    await setupForgotPasswordPage.gotoForgotPasswordFromLogin();
    const { resetLink } = await requestPasswordResetLink(setupPage);
    console.log(`✅ [FORGOT PASSWORD] Paylaşılan sıfırlama linki hazır: ${resetLink}`);
    return { resetLink, email };
  } finally {
    await context.close();
  }
}

export async function pollPasswordResetEmailReceipt(
  requestedAt: Date,
  maxWaitMs = 180_000
): Promise<PasswordResetEmailReceipt> {
  const mailConfig = resolveForgotPasswordMailConfig();

  console.log('📨 [FORGOT PASSWORD] Gmail kutusunda Reset Password e-postası bekleniyor...');
  const receivedEmail = await pollPasswordResetEmail({
    email: mailConfig.mailUser,
    password: mailConfig.mailPassword,
    host: mailConfig.host,
    port: mailConfig.port,
    minReceivedAt: requestedAt,
    recipientEmail: mailConfig.email,
    maxWaitMs
  });

  expect(receivedEmail.subject).toMatch(/reset password|password reset|şifre sıfırlama/i);
  expect(receivedEmail.receivedAt.getTime()).toBeGreaterThanOrEqual(requestedAt.getTime() - 10_000);

  return receivedEmail;
}

export async function verifyLoginAfterPasswordReset(
  page: Page,
  loginPage: LoginPage,
  email: string,
  password: string
): Promise<void> {
  console.log('🔐 [FORGOT PASSWORD] Yeni şifre ile giriş doğrulanıyor...');
  await expect(loginPage.emailInput).toBeVisible({ timeout: 15_000 });
  await loginPage.fillForm(email, password);
  await loginPage.handleCaptchaIfVisible(600_000, 10_000, false);
  await loginPage.submit();

  await page.waitForURL(/dashboard\.gitsec\.io/i, { timeout: 30_000 }).catch(() => {});
  await expect(page).not.toHaveURL(/\/(?:sign-in|login)(?:[/?#]|$)/i, { timeout: 30_000 });
}

export async function completePasswordResetHappyPath(
  page: Page,
  loginPage: LoginPage,
  forgotPasswordPage: ForgotPasswordPage,
  newPassword: string
): Promise<PasswordResetEmailReceipt> {
  const mailConfig = resolveForgotPasswordMailConfig();

  await loginPage.goto();
  await forgotPasswordPage.openFromLoginLink();

  const { resetLink, requestedAt } = await requestPasswordResetLink(page);
  const receivedEmail = await pollPasswordResetEmailReceipt(requestedAt);

  await forgotPasswordPage.openResetLink(resetLink);
  await forgotPasswordPage.resetPassword(mailConfig.email, newPassword);
  await verifyLoginAfterPasswordReset(page, loginPage, mailConfig.email, newPassword);

  return receivedEmail;
}

export function buildInvalidResetPasswordLink(): string {
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  return `${dashboardBaseUrl}/reset-password/invalid-token-e2e-test`;
}
