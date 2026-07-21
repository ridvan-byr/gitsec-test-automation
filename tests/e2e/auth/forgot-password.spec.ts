import { test, expect, GitSecPage } from '../../fixtures/test';
import type { Locator } from '@playwright/test';
import { requireEnv } from '../../support/require-env';
import { pollPasswordResetEmail } from '../../support/password-reset-email';

async function prepareStableForgotPasswordForm(
  page: GitSecPage,
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

    // Refresh/hydration olursa execution context kesilir ve yalnız form hazırlığı yeniden yapılır.
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

test.describe('Forgot Password — Gerçek Backend ve Gmail Teslimat Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'Gerçek backend talebi kabul etmeli ve reset e-postası Gmail kutusuna ulaşmalı',
    { tag: ['@critical'] },
    async ({ page, loginPage }) => {
      test.setTimeout(180_000);

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
      const mailPassword = rawMailPassword;
      const apiBaseUrl = requireEnv('API_BASE_URL');
      const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
      const ownedOrigins = new Set([
        new URL(apiBaseUrl).origin,
        new URL(dashboardBaseUrl).origin
      ]);

      // Sayfada manuel CAPTCHA yok; arka plandaki Google reCAPTCHA scriptinin zaman aşımı
      // sıfırlama isteğini engellemediği sürece üçüncü taraf gürültüsüdür.
      (page as GitSecPage).ignoredErrors = [/reCAPTCHA Timeout/i];

      await loginPage.goto();

      const forgotPasswordLink = page
        .getByRole('link', { name: /forgot password|şifremi unuttum/i })
        .first();
      await expect(forgotPasswordLink).toBeVisible();
      await forgotPasswordLink.click();
      await expect(page).toHaveURL(/forgot-password|reset-password|forgot/i);

      const emailInput = page
        .getByRole('textbox', { name: /email|e-posta/i })
        .or(page.getByPlaceholder('name@example.com'))
        .first();
      const submitButton = page
        .getByRole('button', { name: /send reset link|send|gönder/i })
        .first();
      await prepareStableForgotPasswordForm(page as GitSecPage, emailInput, submitButton, email);

      const requestedAt = new Date();
      let resetRequestSent = false;
      const isResetPost = (url: string, method: string) =>
        ownedOrigins.has(new URL(url).origin) && method === 'POST';
      page.on('request', request => {
        if (isResetPost(request.url(), request.method())) resetRequestSent = true;
      });
      const resetResponsePromise = page.waitForResponse(response => {
        const request = response.request();
        return isResetPost(response.url(), request.method());
      }, { timeout: 30_000 });

      let submitAttempt = 0;
      await expect(async () => {
        if (resetRequestSent) return;
        if (submitAttempt > 0) {
          console.log('🔄 [FORGOT PASSWORD] Sayfa yenilendi veya istek oluşmadı; form yeniden hazırlanıyor...');
          await prepareStableForgotPasswordForm(page as GitSecPage, emailInput, submitButton, email);
        }
        submitAttempt += 1;
        await submitButton.click();
        await expect.poll(() => resetRequestSent, { timeout: 3_000 }).toBe(true);
      }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });

      const resetResponse = await resetResponsePromise;
      console.log(`📡 [FORGOT PASSWORD] Sıfırlama API yanıtı: ${resetResponse.status()} ${resetResponse.url()}`);
      expect(resetResponse.status()).toBe(200);
      await expect(page.getByText(/sent|check.*email|receive an email|instructions to reset|gönderildi|e-posta.*gönder/i).first())
        .toBeVisible();

      console.log('📨 [FORGOT PASSWORD] Gmail kutusunda Reset Password e-postası bekleniyor...');
      const receivedEmail = await pollPasswordResetEmail({
        email: mailUser,
        password: mailPassword,
        host: process.env.FORGOT_PASSWORD_MAIL_IMAP_HOST,
        port: Number(process.env.FORGOT_PASSWORD_MAIL_IMAP_PORT || '993'),
        minReceivedAt: requestedAt,
        recipientEmail: email
      });

      expect(receivedEmail.subject).toMatch(/reset password|password reset|şifre sıfırlama/i);
      expect(receivedEmail.receivedAt.getTime()).toBeGreaterThanOrEqual(requestedAt.getTime() - 10_000);
      const formattedDate = receivedEmail.receivedAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      console.log(
        `✅ [FORGOT PASSWORD] Gmail bağlantısı başarılı; reset e-postası görüldü ` +
        `(Tarih/Saat: ${formattedDate}, Konu: ${receivedEmail.subject}, Gönderen: ${receivedEmail.from}).`
      );
    }
  );
});
