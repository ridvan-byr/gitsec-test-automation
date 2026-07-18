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

test.describe('Login — UI Giriş Formu E2E Akışı', () => {
  // Temiz bir oturum durumu ile başla (Önceki oturum çerezlerini temizle)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Giriş ekranında mail/şifre yazılmalı, manuel captcha sonrası başarıyla giriş yapılmalı', { tag: ['@manual-interactive'] }, async ({ page, loginPage }) => {
    // Captcha çözmeniz için geniş bekleme süresi (600 saniye / 10 dakika)
    test.setTimeout(600000); 

    const workspaceId = requireEnv('WORKSPACE_ID');
    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    // ─── ADIM 1: Giriş sayfasına git ───
    await loginPage.goto();

    // ─── ADIM 2: İlk Captcha kontrolü (YAZMADAN ÖNCE) ───
    await loginPage.handleCaptchaIfVisible(600000, 3000);

    // ─── ADIM 3: Form alanlarını doldur ───
    await loginPage.fillForm(email, password);

    // ─── ADIM 4: İkinci Captcha kontrolü (YAZDIKTAN SONRA) ───
    await loginPage.handleCaptchaIfVisible(600000, 3000);

    // ─── ADIM 5: Sign in butonuna tıkla ───
    await loginPage.submit();

    // ─── ADIM 6: Yönlendirme ve Sonrası Olası Captcha Akışı ───
    console.log('⏳ [E2E] Yönlendirme durumu kontrol ediliyor...');
    const isRedirected = await page.waitForURL(new RegExp(`/${workspaceId}/`), { timeout: 7000 }).then(() => true).catch(() => false);
    
    if (!isRedirected) {
      console.log('ℹ️ [E2E] Hemen yönlendirme gerçekleşmedi. Ek Captcha veya doğrulama çıkmış olabilir. Kontrol ediliyor...');
      await loginPage.handleCaptchaIfVisible(600000, 5000);
      
      if (page.url().includes('sign-in')) {
        console.log('👆 [E2E] Captcha çözümü sonrası form tekrar submit ediliyor...');
        await loginPage.submit();
      }
    }

    // ─── ADIM 7: Dashboard yönlendirmesini doğrula ───
    console.log('⏳ [E2E] Son yönlendirme bekleniyor...');
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 25000 });

    console.log('🎉 [E2E] Dashboard başarıyla yüklendi! UI Giriş E2E testi başarıyla tamamlandı.');
  });
});
