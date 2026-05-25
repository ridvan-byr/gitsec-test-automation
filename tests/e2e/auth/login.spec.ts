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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';
const workspaceId = process.env.WORKSPACE_ID ?? '753';

test.describe('Login — UI Giriş Formu E2E Akışı', () => {
  // Temiz bir oturum durumu ile başla (Önceki oturum çerezlerini temizle)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Giriş ekranında mail/şifre yazılmalı, manuel captcha sonrası başarıyla giriş yapılmalı', async ({ page }) => {
    // Captcha çözmeniz için geniş bekleme süresi (180 saniye / 3 dakika)
    test.setTimeout(180000); 

    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    const signInUrl = `${dashboardBaseUrl}/sign-in`;
    console.log(`🚀 [E2E] Giriş sayfasına gidiliyor: ${signInUrl}`);
    await page.goto(signInUrl, { waitUntil: 'load' });
    
    console.log('⏳ [E2E] Sayfanın ilk otomatik yenilenmesi (refresh/reload) bekleniyor...');
    await page.waitForTimeout(5000);

    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[type="password"]').first();
    const signInButton = page.getByRole('button', { name: /^Sign in$/i });

    // ─── ADIM 1: E-posta alanına yavaşça yaz ───
    console.log(`✉️ [E2E] E-posta yazılıyor: ${email}`);
    await emailInput.click();
    await emailInput.fill('');
    await emailInput.pressSequentially(email, { delay: 75 });
    await page.waitForTimeout(500);

    // ─── ADIM 2: Şifre alanına yavaşça yaz ───
    console.log(`🔑 [E2E] Şifre yazılıyor...`);
    await passwordInput.click();
    await passwordInput.fill('');
    await passwordInput.pressSequentially(password, { delay: 75 });
    await page.waitForTimeout(1000);

    // ─── ADIM 3: Captcha çıkmış mı kontrol et (SADECE iframe varlığına bak) ───
    // Sayfayı sessizce en alta (buton ve captcha bölgesine) odakla ve orada sabitle
    console.log('🔄 [E2E] Sayfa görünümü form sonuna kaydırılıyor...');
    await signInButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const isCaptchaVisible = await page.locator('iframe[src*="challenges.cloudflare.com"]').isVisible().catch(() => false);

    if (isCaptchaVisible) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log('💡 Form doldurulurken Captcha devreye girdi!');
      console.log('💡 Sayfa görünümü sabitlendi. Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test otomatik olarak kaldığı yerden devam edecektir.');
      console.log('=========================================\n');

      // SIFIR-SCROLL SESSİZ BEKLEME: JS tabanlı elementHandle sorgusu ile sayfa odağını bozmadan butonun aktifleşmesini bekle
      console.log('⏳ [E2E] Captcha çözümü bekleniyor... (Ekran sabitlendi - 90 saniye tolerans)');
      const buttonHandle = await signInButton.elementHandle();
      if (buttonHandle) {
        await page.waitForFunction(
          (btn) => btn instanceof HTMLButtonElement && !btn.disabled,
          buttonHandle,
          { timeout: 90000 }
        ).catch(() => {});
      } else {
        // Fallback
        await expect(signInButton).toBeEnabled({ timeout: 90000 });
      }
      
      console.log('✅ [E2E] Captcha başarıyla çözüldü!');
      await page.waitForTimeout(1000);
    }

    // ─── ADIM 4: E-posta ve şifre alanlarını kontrol et, eksikse düzelt ───
    const currentEmailValue = await emailInput.inputValue();
    if (currentEmailValue !== email) {
      console.log(`🔄 [E2E] E-posta eksik kalmış! Mevcut: "${currentEmailValue}" → Düzeltiliyor...`);
      await emailInput.click();
      await emailInput.fill('');
      await emailInput.pressSequentially(email, { delay: 50 });
      await page.waitForTimeout(300);
      console.log('✅ [E2E] E-posta tamamlandı.');
    }

    const currentPasswordValue = await passwordInput.inputValue();
    if (currentPasswordValue !== password) {
      console.log(`🔄 [E2E] Şifre eksik kalmış! Düzeltiliyor...`);
      await passwordInput.click();
      await passwordInput.fill('');
      await passwordInput.pressSequentially(password, { delay: 50 });
      await page.waitForTimeout(300);
      console.log('✅ [E2E] Şifre tamamlandı.');
    }

    // ─── ADIM 5: Sign in butonuna tıkla ───
    // Buton hâlâ disabled ise (şifre sonrası captcha tetiklenmiş olabilir) bekle
    if (await signInButton.isDisabled().catch(() => false)) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ - SON AŞAMA] ⚠️⚠️');
      console.log('💡 Lütfen Captcha\'yı MANUEL olarak çözün.');
      console.log('=========================================\n');
      
      const buttonHandle = await signInButton.elementHandle();
      if (buttonHandle) {
        await page.waitForFunction(
          (btn) => btn instanceof HTMLButtonElement && !btn.disabled,
          buttonHandle,
          { timeout: 90000 }
        ).catch(() => {});
      } else {
        await expect(signInButton).toBeEnabled({ timeout: 90000 });
      }
      
      console.log('✅ [E2E] Captcha çözüldü, buton aktif!');
    }
    
    await page.waitForTimeout(1500);
    console.log('👆 [E2E] "Sign in" butonuna tıklanıyor...');
    await signInButton.click({ force: true });

    // ─── ADIM 6: Dashboard yönlendirmesini doğrula ───
    console.log('⏳ [E2E] Dashboard sayfasına yönlendirme bekleniyor...');
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 25000 });

    console.log('🎉 [E2E] Dashboard başarıyla yüklendi! UI Giriş E2E testi başarıyla tamamlandı.');
    await page.waitForTimeout(4000);
  });
});
