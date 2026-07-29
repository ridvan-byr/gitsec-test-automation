import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import { completePasswordResetHappyPath } from '../../support/forgot-password-reset-helpers';

test.describe('Forgot Password — Gerçek Backend, Gmail ve Şifre Sıfırlama Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'Sıfırlama e-postası gelmeli, link açılmalı, şifre güncellenmeli ve giriş yapılabilmeli',
    { tag: ['@manual-interactive'] },
    async ({ page, loginPage, forgotPasswordPage }) => {
      test.setTimeout(300_000);

      const newPassword = requireEnv('E2E_USER_PASSWORD');
      (page as GitSecPage).ignoredErrors = [/reCAPTCHA Timeout/i];

      const receivedEmail = await completePasswordResetHappyPath(
        page,
        loginPage,
        forgotPasswordPage,
        newPassword
      );

      const formattedDate = receivedEmail.receivedAt.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
      console.log(
        `✅ [FORGOT PASSWORD] Tam akış başarılı ` +
        `(E-posta: ${formattedDate}, Konu: ${receivedEmail.subject}, Gönderen: ${receivedEmail.from}).`
      );
    }
  );
});
