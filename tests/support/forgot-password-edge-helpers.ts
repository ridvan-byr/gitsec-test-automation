import { expect, type Locator, type Page, type Response } from '@playwright/test';
import type { GitSecPage } from '../fixtures/test';
import type { ForgotPasswordPage } from '../pages/ForgotPasswordPage';
import {
  isResetPasswordSubmitPost,
  mockResetPasswordSubmitPost
} from './forgot-password-reset-helpers';
import { requireEnv } from './require-env';

export type MockResetApiStatus = 401 | 422 | 429 | 500;

export function isForgotPasswordSubmitPost(url: string, method: string): boolean {
  if (method !== 'POST') return false;

  const apiBaseUrl = requireEnv('API_BASE_URL');
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const ownedOrigins = new Set([
    new URL(apiBaseUrl).origin,
    new URL(dashboardBaseUrl).origin
  ]);
  const { origin, pathname } = new URL(url);
  return ownedOrigins.has(origin) && /\/forgot-password/i.test(pathname);
}

export async function expectForgotPasswordRequestBlocked(
  page: Page,
  options: { forgotPostSent?: boolean; response?: Response | null } = {}
): Promise<void> {
  if (options.response?.ok()) {
    throw new Error('Forgot-password talebi beklenmedik şekilde başarılı oldu.');
  }

  await expect(page).toHaveURL(/forgot-password/i);

  await expect(async () => {
    if (options.forgotPostSent !== undefined) {
      expect(options.forgotPostSent).toBeFalsy();
    }

    if (options.response) {
      expect(options.response.status()).toBeGreaterThanOrEqual(400);
    }

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const hasEmailError = await page.getByText(
      /please enter your email|enter your email|valid email|geçerli.*e-posta|e-posta.*gir|email.*required|invalid email/i
    ).first().isVisible().catch(() => false);
    const emailInvalid = await emailInput.evaluate((el: HTMLInputElement) => {
      return el.validity.valueMissing || el.validity.typeMismatch || el.getAttribute('aria-invalid') === 'true';
    }).catch(() => false);
    const blockedWithoutNetwork = options.forgotPostSent === false;

    expect(hasEmailError || emailInvalid || blockedWithoutNetwork).toBeTruthy();
  }).toPass({ timeout: 10_000, intervals: [250, 500, 1_000] });
}

export async function expectResetSubmitBlocked(
  page: Page,
  options: { resetPostSent?: boolean; response?: Response | null } = {}
): Promise<void> {
  expect(/reset-password/i.test(page.url())).toBeTruthy();

  if (options.resetPostSent !== undefined) {
    expect(options.resetPostSent).toBeFalsy();
  }

  if (options.response) {
    expect(options.response.ok()).toBeFalsy();
    expect(options.response.status()).toBeGreaterThanOrEqual(400);
  }
}

export async function expectVisibleValidationFeedback(
  page: Page,
  patterns: RegExp[]
): Promise<void> {
  await expect(async () => {
    for (const pattern of patterns) {
      const textMatch = page.getByText(pattern).first();
      if (await textMatch.isVisible().catch(() => false)) {
        return;
      }

      const alertMatch = page.locator('[role="alert"], [data-sonner-toast]').filter({ hasText: pattern }).first();
      if (await alertMatch.isVisible().catch(() => false)) {
        return;
      }
    }

    const invalidField = page.locator('input[aria-invalid="true"], input:invalid').first();
    await expect(invalidField).toBeVisible();
  }).toPass({ timeout: 10_000, intervals: [250, 500, 1_000] });
}

export async function expectPasswordPolicyFeedback(page: Page): Promise<void> {
  await expectVisibleValidationFeedback(page, [
    /requirement|not met|at least|minimum|12|character|uppercase|lowercase|special|number|weak|too short|kısa|karakter|büyük|küçük/i
  ]);
}

export async function expectPasswordMismatchFeedback(page: Page): Promise<void> {
  await expectVisibleValidationFeedback(page, [
    /match|eşleş|confirm|confirmation|do not match|passwords must|şifre.*eşleş/i
  ]);
}

export async function expectResetApiErrorVisible(
  page: Page,
  status?: MockResetApiStatus,
  options: { allowFormStayFallback?: boolean } = {}
): Promise<void> {
  const statusPattern = status === 401
    ? /unauthorized|401|invalid|geçersiz|token|credentials/i
    : status === 422
      ? /invalid|validation|422|unprocessable|geçersiz|required/i
      : status === 429
        ? /too many|429|rate|limit|çok fazla|try again/i
        : status === 500
          ? /internal|500|server|unexpected|try again|hata|error|failed|başarısız/i
          : /too many|429|500|401|422|internal|server|hata|error|invalid|expired|token|try again|failed|başarısız/i;

  await expect(async () => {
    const textError = await page.getByText(statusPattern).first().isVisible().catch(() => false);
    const toastError = await page.locator('[data-sonner-toast], [role="status"], [role="alert"]').filter({
      hasText: statusPattern
    }).first().isVisible().catch(() => false);
    const stayedOnForm = /reset-password|forgot-password/i.test(page.url());
    const successMessage = await page.getByText(/sent|check.*email|receive|reset.*success|gönderildi|başarılı/i).first().isVisible().catch(() => false);

    expect(successMessage).toBeFalsy();
    expect(Boolean(textError || toastError || (options.allowFormStayFallback && stayedOnForm))).toBeTruthy();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

export async function expectInvalidResetAttemptBlocked(
  page: Page,
  response: Response | null
): Promise<void> {
  await expect(page).not.toHaveURL(/\/dashboard(?:[/?#]|$)/i);

  await expect(async () => {
    const errorVisible = await page.getByText(
      /invalid|expired|geçersiz|süresi dol|token|not registered|try with another|hata|error|failed|başarısız|unable|could not/i
    ).first().isVisible().catch(() => false);
    const toastError = await page.locator('[data-sonner-toast], [role="alert"], [role="status"]').filter({
      hasText: /invalid|expired|not registered|token|error|failed|başarısız|unable/i
    }).first().isVisible().catch(() => false);
    const failedHttp = Boolean(response && !response.ok());
    const stayedOnResetPage = /reset-password/i.test(page.url());
    const redirectedToSignIn = /sign-in|login/i.test(page.url());

    expect(errorVisible || toastError || failedHttp).toBeTruthy();
    expect(stayedOnResetPage || redirectedToSignIn).toBeTruthy();
    expect(redirectedToSignIn && !(errorVisible || toastError || failedHttp)).toBeFalsy();
  }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
}

export async function trackPostSent(
  page: Page,
  matcher: (url: string, method: string) => boolean
): Promise<{ wasSent: () => boolean }> {
  let sent = false;
  const listener = (request: { url: () => string; method: () => string }) => {
    if (matcher(request.url(), request.method())) {
      sent = true;
    }
  };

  page.on('request', listener);
  return {
    wasSent: () => sent
  };
}

export async function mockForgotPasswordSubmitPost(
  page: Page,
  status: 429 | 500,
  message: string
): Promise<void> {
  await page.route(
    url => /\/forgot-password/i.test(url.pathname),
    async route => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }

      const gitSecPage = page as GitSecPage;
      gitSecPage.ignoredErrors = [
        ...(gitSecPage.ignoredErrors || []),
        route.request().url(),
        /too many requests/i,
        /429/i
      ];

      await route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message, error: message, errors: [message] })
      });
    }
  );
}

export async function runMockForgotPasswordRequestFailure(
  page: Page,
  forgotPasswordPage: ForgotPasswordPage,
  email: string,
  status: 429 | 500,
  message: string
): Promise<void> {
  const gitSecPage = page as GitSecPage;
  gitSecPage.ignoredErrors = [
    /forgot-password/,
    status === 429 ? /status of 429|too many requests/i : /status of 500|internal server error/i,
    /reCAPTCHA Timeout/i
  ];

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockForgotPasswordSubmitPost(page, status, message);
  await forgotPasswordPage.gotoForgotPasswordRequestPage();
  await forgotPasswordPage.fillEmail(email);

  const responsePromise = page.waitForResponse(response =>
    response.status() === status && isForgotPasswordSubmitPost(response.url(), response.request().method())
  , { timeout: 30_000 });

  await forgotPasswordPage.submitForgotPasswordRequestForm();
  const response = await responsePromise;
  expect(response.status()).toBe(status);
  await expectResetApiErrorVisible(page, status, { allowFormStayFallback: true });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

export async function runMockResetPasswordApiFailureScenario(
  page: Page,
  forgotPasswordPage: ForgotPasswordPage,
  email: string,
  resetLink: string,
  status: MockResetApiStatus,
  message: string
): Promise<void> {
  const gitSecPage = page as GitSecPage;
  gitSecPage.ignoredErrors = [
    /reset-password/,
    new RegExp(`status of ${status}`, 'i'),
    /credentials/i,
    /token/i,
    /reCAPTCHA Timeout/i,
    /too many requests/i,
    /internal server error/i,
    /unauthorized/i,
    /unprocessable/i
  ];

  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockResetPasswordSubmitPost(page, status, message);
  await forgotPasswordPage.openResetLink(resetLink);
  await forgotPasswordPage.fillResetForm(email, 'ValidPassword123!');

  const responsePromise = page.waitForResponse(response =>
    response.status() === status &&
    isResetPasswordSubmitPost(response.url(), response.request().method())
  , { timeout: 30_000 });

  await forgotPasswordPage.submitReset();
  const response = await responsePromise;
  expect(response.status()).toBe(status);
  await expectResetApiErrorVisible(page, status, { allowFormStayFallback: true });
  await page.unrouteAll({ behavior: 'ignoreErrors' });
}

export async function waitForResetSubmitResponse(
  page: Page,
  timeout = 15_000
): Promise<Response | null> {
  return page.waitForResponse(response =>
    isResetPasswordSubmitPost(response.url(), response.request().method())
  , { timeout }).catch(() => null);
}

export function forgotPasswordRequestLocators(page: Page): { emailInput: Locator; submitButton: Locator } {
  return {
    emailInput: page.locator('input[name="email"]')
      .or(page.getByPlaceholder('name@example.com'))
      .or(page.getByRole('textbox', { name: /email/i }))
      .or(page.locator('input[type="email"]'))
      .first(),
    submitButton: page.getByRole('button', { name: /send reset link|send|gönder/i })
      .or(page.locator('button[type="submit"]'))
      .first()
  };
}
