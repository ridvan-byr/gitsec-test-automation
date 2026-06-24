/**
 * Login E2E Form Testi (UI Tabanlı & Manuel Captcha Onaylı)
 * 
 * Bu test gerçek kullanıcı arayüzü (UI) üzerinden:
 * 1. /sign-in sayfasına gider.
 * 2. E-posta ve şifreyi karakter karakter görsel olarak yavaşça yazar.
 * 3. Cloudflare Turnstile (Captcha) onayını bekler (90 saniye manuel tolerans).
 * 4. Siz captcha'yı doğruladığınız an Playwright otomatik olarak devam eder, "Sign in" butonuna tıklar ve Dashboard'a yönlenmeyi doğrular.
 *
 * Çalıştırma: npx playwright test tests/e2e/auth/login.spec.ts
 */
import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

const workspaceId = requireEnv('WORKSPACE_ID');

test.describe('Login — UI Giriş Formu E2E Akışı', () => {
  // Temiz bir oturum durumu ile başla (Önceki oturum çerezlerini temizle)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Giriş ekranında mail/şifre yazılmalı, manuel captcha sonrası başarıyla giriş yapılmalı', { tag: ['@smoke', '@critical'] }, async ({ page, loginPage }) => {
    // Captcha çözmeniz için geniş bekleme süresi (180 saniye / 3 dakika)
    test.setTimeout(180000); 

    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    // ─── ADIM 1: Giriş sayfasına git ───
    await loginPage.goto();

    // ─── ADIM 2: Captcha kontrolü yap (YAZMADAN ÖNCE) ───
    await loginPage.handleCaptchaIfVisible();

    // ─── ADIM 3: Form alanlarını doldur ve yazım doğruluğunu teyit et ───
    await loginPage.fillForm(email, password);

    // ─── ADIM 4: Sign in butonuna tıkla ───
    await loginPage.submit();

    // ─── ADIM 5: Dashboard yönlendirmesini doğrula ───
    console.log('⏳ [E2E] Dashboard sayfasına yönlendirme bekleniyor...');
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 25000 });

    console.log('🎉 [E2E] Dashboard başarıyla yüklendi! UI Giriş E2E testi başarıyla tamamlandı.');
  });
});
