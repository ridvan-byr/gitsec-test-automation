import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import {
  pollPasswordResetEmail,
  pollPasswordResetLink
} from '../../support/password-reset-email';
import {
  resolveForgotPasswordMailConfig,
  submitForgotPasswordRequest
} from '../../support/forgot-password-flow';

test.describe('Forgot Password — Gerçek Backend, Gmail ve Şifre Sıfırlama Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'Sıfırlama e-postası gelmeli, link açılmalı, şifre güncellenmeli ve giriş yapılabilmeli',
    { tag: ['@manual-interactive'] },
    async ({ page, loginPage, forgotPasswordPage }) => {
      test.setTimeout(300_000);

      const mailConfig = resolveForgotPasswordMailConfig();
      const newPassword = requireEnv('E2E_USER_PASSWORD');

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

      const { requestedAt, status } = await submitForgotPasswordRequest(
        page as GitSecPage,
        emailInput,
        submitButton,
        mailConfig.email
      );

      expect(status).toBe(200);
      await expect(page.getByText(/sent|check.*email|receive an email|instructions to reset|gönderildi|e-posta.*gönder/i).first())
        .toBeVisible();

      console.log('📨 [FORGOT PASSWORD] Gmail kutusunda Reset Password e-postası bekleniyor...');
      const receivedEmail = await pollPasswordResetEmail({
        email: mailConfig.mailUser,
        password: mailConfig.mailPassword,
        host: mailConfig.host,
        port: mailConfig.port,
        minReceivedAt: requestedAt,
        recipientEmail: mailConfig.email,
        maxWaitMs: 180_000
      });

      expect(receivedEmail.subject).toMatch(/reset password|password reset|şifre sıfırlama/i);
      expect(receivedEmail.receivedAt.getTime()).toBeGreaterThanOrEqual(requestedAt.getTime() - 10_000);

      const resetLink = await pollPasswordResetLink({
        email: mailConfig.mailUser,
        password: mailConfig.mailPassword,
        host: mailConfig.host,
        port: mailConfig.port,
        minReceivedAt: requestedAt,
        maxWaitMs: 180_000
      });

      await forgotPasswordPage.openResetLink(resetLink);
      await forgotPasswordPage.resetPassword(mailConfig.email, newPassword);

      console.log('🔐 [FORGOT PASSWORD] Yeni şifre ile giriş doğrulanıyor...');
      await expect(loginPage.emailInput).toBeVisible({ timeout: 15_000 });
      await loginPage.fillForm(mailConfig.email, newPassword);
      await loginPage.handleCaptchaIfVisible(600_000, 10_000, false);
      await loginPage.submit();

      await page.waitForURL(/dashboard\.gitsec\.io/i, { timeout: 30_000 }).catch(() => {});
      await expect(page).not.toHaveURL(/\/(?:sign-in|login)(?:[/?#]|$)/i, { timeout: 30_000 });

      const formattedDate = receivedEmail.receivedAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      console.log(
        `✅ [FORGOT PASSWORD] Tam akış başarılı ` +
        `(E-posta: ${formattedDate}, Konu: ${receivedEmail.subject}, Gönderen: ${receivedEmail.from}).`
      );
    }
  );
});
