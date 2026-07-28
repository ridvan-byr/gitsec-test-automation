import { expect, type Locator, type Page } from '@playwright/test';
import { requireEnv } from './require-env';
import { pollPasswordResetLink } from './password-reset-email';

type PageWithIgnoredErrors = Page & {
  ignoredErrors?: (string | RegExp)[];
};

export type ForgotPasswordMailConfig = {
  email: string;
  mailUser: string;
  mailPassword: string;
  host?: string;
  port?: number;
};

export function resolveForgotPasswordMailConfig(): ForgotPasswordMailConfig {
  const email = process.env.FORGOT_PASSWORD_EMAIL?.trim() || requireEnv('E2E_USER_EMAIL');
  const configuredMailUser = process.env.FORGOT_PASSWORD_MAIL_USER?.trim();
  const sharedMailUser = process.env.GITHUB_MAIL_USER?.trim();
  const useSharedMailAccount = !configuredMailUser || configuredMailUser === email;
  const mailUser = useSharedMailAccount
    ? sharedMailUser || configuredMailUser || email
    : configuredMailUser;

  let rawMailPassword = process.env.FORGOT_PASSWORD_MAIL_PASSWORD?.trim();
  if (!rawMailPassword || /^[•*\s]+$/.test(rawMailPassword)) {
    rawMailPassword = requireEnv('GITHUB_MAIL_PASSWORD');
  }

  return {
    email,
    mailUser,
    mailPassword: rawMailPassword,
    host: process.env.FORGOT_PASSWORD_MAIL_IMAP_HOST,
    port: Number(process.env.FORGOT_PASSWORD_MAIL_IMAP_PORT || '993')
  };
}

export async function prepareStableForgotPasswordForm(
  page: PageWithIgnoredErrors,
  emailInput: Locator,
  submitButton: Locator,
  email: string
): Promise<void> {
  await expect(async () => {
    await expect(page).toHaveURL(/forgot-password|reset-password|forgot/i);
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeEditable();
    await emailInput.fill(email);
    await expect(emailInput).toHaveValue(email);
    await expect(submitButton).toBeEnabled();

    await page.waitForFunction(
      ({ expectedEmail, stableForMs }) => new Promise<boolean>(resolve => {
        const startedAt = performance.now();
        const verify = () => {
          const input = document.querySelector('input[type="email"], input[name="email"]') as HTMLInputElement | null;
          const button = Array.from(document.querySelectorAll('button')).find(candidate =>
            candidate.getAttribute('type') === 'submit' || /send|gönder/i.test(candidate.textContent ?? '')
          ) as HTMLButtonElement | undefined;

          if (input?.value !== expectedEmail || !button || button.disabled) {
            resolve(false);
            return;
          }
          if (performance.now() - startedAt >= stableForMs) {
            resolve(true);
            return;
          }
          requestAnimationFrame(verify);
        };
        requestAnimationFrame(verify);
      }),
      { expectedEmail: email, stableForMs: 750 }
    );
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
}

export async function submitForgotPasswordRequest(
  page: PageWithIgnoredErrors,
  emailInput: Locator,
  submitButton: Locator,
  email: string
): Promise<{ requestedAt: Date; status: number }> {
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const ownedOrigins = new Set([
    new URL(apiBaseUrl).origin,
    new URL(dashboardBaseUrl).origin
  ]);

  await prepareStableForgotPasswordForm(page, emailInput, submitButton, email);

  const requestedAt = new Date();
  let resetRequestSent = false;
  const isForgotPasswordPost = (url: string, method: string) => {
    if (method !== 'POST') return false;
    const { origin, pathname } = new URL(url);
    return ownedOrigins.has(origin) && /\/forgot-password/i.test(pathname);
  };

  page.on('request', request => {
    if (isForgotPasswordPost(request.url(), request.method())) resetRequestSent = true;
  });

  const resetResponsePromise = page.waitForResponse(response => {
    const request = response.request();
    return isForgotPasswordPost(response.url(), request.method());
  }, { timeout: 30_000 });

  let submitAttempt = 0;
  await expect(async () => {
    if (resetRequestSent) return;
    if (submitAttempt > 0) {
      console.log('🔄 [FORGOT PASSWORD] Sayfa yenilendi veya istek oluşmadı; form yeniden hazırlanıyor...');
      await prepareStableForgotPasswordForm(page, emailInput, submitButton, email);
    }
    submitAttempt += 1;
    await submitButton.click();
    await expect.poll(() => resetRequestSent, { timeout: 3_000 }).toBe(true);
  }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });

  const resetResponse = await resetResponsePromise;
  console.log(`📡 [FORGOT PASSWORD] Sıfırlama API yanıtı: ${resetResponse.status()} ${resetResponse.url()}`);

  return { requestedAt, status: resetResponse.status() };
}

export async function requestPasswordResetLink(page: Page): Promise<{ resetLink: string; requestedAt: Date }> {
  const mailConfig = resolveForgotPasswordMailConfig();
  (page as PageWithIgnoredErrors).ignoredErrors = [/reCAPTCHA Timeout/i];

  const emailInput = page
    .getByRole('textbox', { name: /email|e-posta/i })
    .or(page.getByPlaceholder('name@example.com'))
    .first();
  const submitButton = page
    .getByRole('button', { name: /send reset link|send|gönder/i })
    .first();

  const { requestedAt, status } = await submitForgotPasswordRequest(
    page as PageWithIgnoredErrors,
    emailInput,
    submitButton,
    mailConfig.email
  );

  expect(status).toBe(200);

  const successMessage = page.getByText(/sent|check.*email|receive an email|instructions to reset|gönderildi|e-posta.*gönder|already sent|link has been/i).first();
  const successToast = page.locator('[data-sonner-toast], [role="status"], [role="alert"]').filter({
    hasText: /sent|check.*email|receive|reset|gönderildi|e-posta/i
  }).first();

  const hasSuccessUi = await successMessage.isVisible().catch(() => false)
    || await successToast.isVisible().catch(() => false);

  if (!hasSuccessUi) {
    console.log('ℹ️ [FORGOT PASSWORD] API 200 döndü ancak başarı mesajı görünmedi; e-posta kutusu yine de kontrol edilecek.');
  }

  console.log('📨 [FORGOT PASSWORD] Gmail kutusunda sıfırlama linki bekleniyor...');
  const resetLink = await pollPasswordResetLink({
    email: mailConfig.mailUser,
    password: mailConfig.mailPassword,
    host: mailConfig.host,
    port: mailConfig.port,
    minReceivedAt: requestedAt,
    maxWaitMs: 180_000
  });

  console.log(`🔗 [FORGOT PASSWORD] Sıfırlama linki alındı: ${resetLink}`);
  return { resetLink, requestedAt };
}
