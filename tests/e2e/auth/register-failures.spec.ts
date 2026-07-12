import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Register Failures — Kayıt Hata Durumları E2E Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Zaten kayıtlı bir e-posta ile kayıt olmaya çalışıldığında uygun hata mesajı gösterilmeli', { tag: ['@manual-interactive'] }, async ({ page, registerPage }) => {
    // 400 Bad Request / 409 Conflict durumunu audit kontrolünden muaf tut
    (page as any).ignoredErrors = [/auth\/signup/, /status of 400/, /status of 409/, /already exists/i];

    const email = requireEnv('E2E_USER_EMAIL');
    const password = 'Password123!';
    const firstName = 'Duplicate';
    const lastName = 'TestUser';

    // ─── ADIM 1: Kayıt sayfasına git ───
    await registerPage.goto();

    // Captcha varsa çözülmesini bekle (Giriş alanları odağını bozmamak için)
    await registerPage.handleCaptchaIfVisible(30000).catch(() => {});

    // ─── ADIM 2: Formu doldur ───
    await registerPage.fillForm(firstName, lastName, email, password);

    // ─── ADIM 3: Koşulları onay kutularını işaretle ───
    const termsCheckbox = page.locator('#terms');
    const privacyCheckbox = page.locator('#privacy');

    await expect(async () => {
      await termsCheckbox.click({ force: true }).catch(() => {});
      const ariaChecked = await termsCheckbox.getAttribute('aria-checked');
      if (ariaChecked !== 'true' && !(await termsCheckbox.isChecked().catch(() => false))) {
        throw new Error('Terms onay kutusu işaretlenemedi');
      }
    }).toPass({ timeout: 6000, intervals: [500] });

    await expect(async () => {
      await privacyCheckbox.click({ force: true }).catch(() => {});
      const ariaChecked = await privacyCheckbox.getAttribute('aria-checked');
      if (ariaChecked !== 'true' && !(await privacyCheckbox.isChecked().catch(() => false))) {
        throw new Error('Privacy onay kutusu işaretlenemedi');
      }
    }).toPass({ timeout: 6000, intervals: [500] });

    // ─── ADIM 4: Captcha kontrolü yap ───
    await registerPage.handleCaptchaIfVisible(30000).catch(() => {});

    // ─── ADIM 5: Formu gönder ───
    console.log('🔘 [E2E] Kayıt formu gönderiliyor...');
    await registerPage.submit();

    // ─── ADIM 6: Hata mesajının arayüzde görünür olduğunu doğrula ───
    // Sistem "Email already exists" toast/alert vermeli
    const errorToast = page.getByText(/exists|already|kullanımda|kayıtlı|verified|credentials/i).first();

    await expect(errorToast).toBeVisible({ timeout: 15000 });
    console.log('✅ [E2E] Zaten kayıtlı e-posta hatası başarıyla doğrulandı.');
  });
});
