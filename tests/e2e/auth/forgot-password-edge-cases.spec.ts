import { test, expect, GitSecPage } from '../../fixtures/test';
import {
  buildInvalidResetPasswordLink,
  isResetPasswordSubmitPost,
  obtainSharedPasswordResetLink
} from '../../support/forgot-password-reset-helpers';
import {
  expectForgotPasswordRequestBlocked,
  expectPasswordMismatchFeedback,
  expectPasswordPolicyFeedback,
  expectResetSubmitBlocked,
  expectInvalidResetAttemptBlocked,
  expectVisibleValidationFeedback,
  isForgotPasswordSubmitPost,
  runMockForgotPasswordRequestFailure,
  runMockResetPasswordApiFailureScenario,
  trackPostSent,
  waitForResetSubmitResponse
} from '../../support/forgot-password-edge-helpers';
import { pauseIfHeaded } from '../../support/dashboard-ui-helpers';

test.describe('Forgot Password Edge Cases — Talep Formu, Doğrulama, Token ve API Hataları', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let sharedResetLink = '';
  let sharedEmail = '';

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    const shared = await obtainSharedPasswordResetLink(browser);
    sharedResetLink = shared.resetLink;
    sharedEmail = shared.email;
  });

  test(
    'Şifre sıfırlama uç durumları — tek oturumda talep formu, reset doğrulama, token ve API hataları',
    { tag: ['@edge-cases', '@manual-interactive'] },
    async ({ page, forgotPasswordPage }) => {
      test.setTimeout(600_000);
      (page as GitSecPage).ignoredErrors = [/reCAPTCHA Timeout/i];

      await test.step('Kısım 1: Boş e-posta ile sıfırlama talebi engellenmeli', async () => {
        await forgotPasswordPage.gotoForgotPasswordRequestPage();
        await forgotPasswordPage.fillEmail('');

        const postTracker = await trackPostSent(page, isForgotPasswordSubmitPost);
        const responsePromise = page.waitForResponse(response =>
          isForgotPasswordSubmitPost(response.url(), response.request().method())
        , { timeout: 4_000 }).catch(() => null);

        await forgotPasswordPage.submitForgotPasswordRequestForm();
        const response = await responsePromise;

        await expectForgotPasswordRequestBlocked(page, {
          forgotPostSent: postTracker.wasSent(),
          response
        });
        console.log('✅ Boş e-posta ile sıfırlama talebi engellendi.');
      });

      await test.step('Kısım 2: Geçersiz e-posta formatı ile sıfırlama talebi engellenmeli', async () => {
        await forgotPasswordPage.gotoForgotPasswordRequestPage();
        await forgotPasswordPage.fillEmail('not-an-email');

        const postTracker = await trackPostSent(page, isForgotPasswordSubmitPost);
        const responsePromise = page.waitForResponse(response =>
          isForgotPasswordSubmitPost(response.url(), response.request().method())
        , { timeout: 4_000 }).catch(() => null);

        await forgotPasswordPage.submitForgotPasswordRequestForm();
        const response = await responsePromise;

        if (response && response.ok()) {
          throw new Error('Geçersiz e-posta formatı ile sıfırlama talebi API tarafından kabul edildi.');
        }

        await expectForgotPasswordRequestBlocked(page, {
          forgotPostSent: postTracker.wasSent(),
          response
        });
        console.log('✅ Geçersiz e-posta formatı ile sıfırlama talebi engellendi.');
      });

      await test.step('Kısım 3: Forgot-password API 429 dönerse UI hata göstermeli', async () => {
        await runMockForgotPasswordRequestFailure(
          page,
          forgotPasswordPage,
          sharedEmail,
          429,
          'Too many requests. Please try again later.'
        );
        console.log('✅ Forgot-password API 429 durumunda UI hata gösterimi doğrulandı.');
      });

      await test.step('Kısım 4: Boş e-posta ile reset formu gönderildiğinde doğrulama hatası gösterilmeli', async () => {
        await forgotPasswordPage.prepareResetForm(sharedResetLink);
        await forgotPasswordPage.fillPasswords('ValidPassword123!', 'ValidPassword123!');

        const postTracker = await trackPostSent(page, isResetPasswordSubmitPost);
        const responsePromise = waitForResetSubmitResponse(page, 4_000);

        await forgotPasswordPage.submitReset();
        const response = await responsePromise;

        await expectResetSubmitBlocked(page, {
          resetPostSent: postTracker.wasSent(),
          response
        });
        await expectVisibleValidationFeedback(page, [
          /please enter your email|enter your email|e-posta.*gir|email.*required|geçerli.*e-posta/i
        ]);
        console.log('✅ Boş e-posta ile sıfırlama engellendi.');
      });

      await test.step('Kısım 5: Boş şifre alanlarıyla reset formu gönderildiğinde doğrulama hatası gösterilmeli', async () => {
        await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
        await forgotPasswordPage.submitReset();

        const response = await waitForResetSubmitResponse(page, 4_000);
        await expectResetSubmitBlocked(page, { response });
        await expectVisibleValidationFeedback(page, [
          /required|password|şifre|boş|enter.*password/i
        ]);
        console.log('✅ Boş şifre alanları ile sıfırlama engellendi.');
      });

      await test.step('Kısım 6: Eşleşmeyen şifreler girildiğinde form hata vermeli', async () => {
        await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
        await forgotPasswordPage.fillPasswords('ValidPassword123!', 'DifferentPassword123!');

        const responsePromise = waitForResetSubmitResponse(page, 8_000);
        await forgotPasswordPage.submitReset();
        const response = await responsePromise;

        if (response?.ok()) {
          throw new Error('Eşleşmeyen şifreler ile sıfırlama API tarafından kabul edildi.');
        }

        await expectResetSubmitBlocked(page, { response });
        await expectPasswordMismatchFeedback(page);
        console.log('✅ Eşleşmeyen şifreler ile sıfırlama engellendi.');
      });

      await test.step('Kısım 7: Zayıf veya kısa şifre girildiğinde form doğrulama yapmalı', async () => {
        await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
        await forgotPasswordPage.fillPasswords('123', '123');

        const responsePromise = waitForResetSubmitResponse(page, 8_000);
        await forgotPasswordPage.submitReset();
        const response = await responsePromise;

        if (response?.ok()) {
          throw new Error('Zayıf şifre ile sıfırlama API tarafından kabul edildi.');
        }

        await expectResetSubmitBlocked(page, { response });
        await expectPasswordPolicyFeedback(page);
        console.log('✅ Zayıf şifre doğrulaması çalıştı.');
      });

      await test.step('Kısım 8: Çok uzun şifre girildiğinde form doğrulama yapmalı', async () => {
        const longPassword = `Aa1!${'x'.repeat(200)}`;
        await forgotPasswordPage.prepareResetForm(sharedResetLink, sharedEmail);
        await forgotPasswordPage.fillLongPasswordForValidation(longPassword);

        const responsePromise = waitForResetSubmitResponse(page, 8_000);
        await forgotPasswordPage.submitReset();
        const response = await responsePromise;

        if (response?.ok()) {
          throw new Error('Çok uzun şifre ile sıfırlama API tarafından kabul edildi.');
        }

        await expectResetSubmitBlocked(page, { response });
        await expectVisibleValidationFeedback(page, [
          /long|limit|too long|maximum|karakter|character|length|uzun/i
        ]);
        console.log('✅ Uzun şifre sınır doğrulaması çalıştı.');
      });

      await test.step('Kısım 9: Geçersiz veya süresi dolmuş token ile sıfırlama başarısız olmalı', async () => {
        const invalidLink = buildInvalidResetPasswordLink();

        await page.goto(invalidLink, { waitUntil: 'domcontentloaded' });
        await forgotPasswordPage.expectResetPasswordPage();
        await forgotPasswordPage.fillResetForm(sharedEmail, 'ValidPassword123!');

        const responsePromise = waitForResetSubmitResponse(page, 15_000);
        await forgotPasswordPage.submitReset();
        const response = await responsePromise;

        expect(response).not.toBeNull();
        await expectInvalidResetAttemptBlocked(page, response);
        console.log('✅ Geçersiz token senaryosu doğrulandı.');
      });

      await test.step('Kısım 10: Reset API 401 dönerse UI hata göstermeli', async () => {
        await runMockResetPasswordApiFailureScenario(
          page,
          forgotPasswordPage,
          sharedEmail,
          sharedResetLink,
          401,
          'Unauthorized. Invalid or expired token.'
        );
        console.log('✅ Reset API 401 durumunda UI hata gösterimi doğrulandı.');
      });

      await test.step('Kısım 11: Reset API 422 dönerse UI hata göstermeli', async () => {
        await runMockResetPasswordApiFailureScenario(
          page,
          forgotPasswordPage,
          sharedEmail,
          sharedResetLink,
          422,
          'Validation failed. Password does not meet requirements.'
        );
        console.log('✅ Reset API 422 durumunda UI hata gösterimi doğrulandı.');
      });

      await test.step('Kısım 12: Reset API 429 dönerse UI hata göstermeli', async () => {
        await runMockResetPasswordApiFailureScenario(
          page,
          forgotPasswordPage,
          sharedEmail,
          sharedResetLink,
          429,
          'Too many requests. Please try again later.'
        );
        console.log('✅ Reset API 429 durumunda UI hata gösterimi doğrulandı.');
      });

      await test.step('Kısım 13: Reset API 500 dönerse UI hata göstermeli', async () => {
        await runMockResetPasswordApiFailureScenario(
          page,
          forgotPasswordPage,
          sharedEmail,
          sharedResetLink,
          500,
          'Internal Server Error'
        );
        console.log('✅ Reset API 500 durumunda UI hata gösterimi doğrulandı.');
      });

      await pauseIfHeaded(page);
    }
  );
});
