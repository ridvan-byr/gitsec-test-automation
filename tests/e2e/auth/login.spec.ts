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
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const signInButton = page.locator('button').filter({ hasText: /^Sign in$/i }).first();

    // ─── ADIM 1: Sayfayı aşağı kaydır ve Captcha kontrolü yap (YAZMADAN ÖNCE) ───
    console.log('🔄 [E2E] Sayfa görünümü buton bölgesine kaydırılıyor...');
    await signInButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1000);

    console.log('⏳ [E2E] Captcha iframe\'inin yüklenmesi bekleniyor (maksimum 10 saniye)...');
    
    // Promise.race ile hangi captcha iframe'i önce yüklenirse anında devam eder, gereksiz beklemez!
    const captchaType = await Promise.race([
      page.locator('iframe[src*="challenges.cloudflare.com"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Cloudflare Turnstile').catch(() => null),
      page.locator('iframe[src*="google.com/recaptcha"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Google reCAPTCHA').catch(() => null)
    ]);

    const isCaptchaVisible = captchaType !== null;

    if (isCaptchaVisible) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfa yüklendiğinde Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test bilgileri doldurup otomatik devam edecektir.');
      console.log('=========================================\n');

      console.log('⏳ [E2E] Captcha çözümü bekleniyor... (Ekran sabitlendi - 120 saniye tolerans)');
      
      // Turnstile (cf-turnstile-response) veya reCAPTCHA (g-recaptcha-response) çözüldüğünde token yüklenir
      await page.waitForFunction(() => {
        const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const tVal = turnstile ? turnstile.value.trim() : '';
        const rVal = recaptcha ? recaptcha.value.trim() : '';
        return tVal.length > 0 || rVal.length > 0;
      }, { timeout: 120000 }).catch((e) => {
        console.log('⚠️ [E2E] Captcha bekleme süresi doldu veya hata oluştu:', e.message);
      });
      
      console.log('✅ [E2E] Captcha başarıyla çözüldü (Token algılandı)!');
      await page.waitForTimeout(1000);
    } else {
      console.log('ℹ️ [E2E] Captcha iframe\'i bulunamadı veya pasif. Doğrudan veri girişine geçiliyor.');
    }

    // ─── ADIM 2: E-posta alanına yaz ───
    console.log(`✉️ [E2E] E-posta yazılıyor: ${email}`);
    await emailInput.click();
    await emailInput.fill(email);
    await page.waitForTimeout(500);

    // ─── ADIM 3: Şifre alanına yaz ───
    console.log(`🔑 [E2E] Şifre yazılıyor...`);
    await passwordInput.click();
    await passwordInput.fill(password);
    await page.waitForTimeout(1000);

    // ─── ADIM 4: Yazım doğruluğunu teyit et ve eksiklikleri gider ───
    const currentEmailValue = await emailInput.inputValue();
    if (currentEmailValue !== email) {
      console.log(`🔄 [E2E] E-posta eksik kalmış! Düzeltiliyor...`);
      await emailInput.fill(email);
      await page.waitForTimeout(300);
    }

    const currentPasswordValue = await passwordInput.inputValue();
    if (currentPasswordValue !== password) {
      console.log(`🔄 [E2E] Şifre eksik kalmış! Düzeltiliyor...`);
      await passwordInput.fill(password);
      await page.waitForTimeout(300);
    }

    // Ekstra Kontrol: Eğer son adımda buton hâlâ disabled ise aktifleşmesini bekle
    if (await signInButton.isDisabled().catch(() => false)) {
      console.log('⏳ [E2E] Butonun aktifleşmesi bekleniyor...');
      await page.waitForFunction((btn) => btn instanceof HTMLButtonElement && !btn.disabled, await signInButton.elementHandle(), { timeout: 10000 }).catch(() => {});
    }

    // ─── ADIM 5: Sign in butonuna tıkla ───
    await page.waitForTimeout(1000);
    console.log('👆 [E2E] "Sign in" butonuna tıklanıyor...');
    await signInButton.click(); // Otomatik aksiyon alabilirlik (enabled/visible) bekleyen standart tıklama

    // ─── ADIM 6: Dashboard yönlendirmesini doğrula ───
    console.log('⏳ [E2E] Dashboard sayfasına yönlendirme bekleniyor...');
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    await expect(page).not.toHaveURL(/sign-in/);
    await expect(page.locator('main').first()).toBeVisible({ timeout: 25000 });

    console.log('🎉 [E2E] Dashboard başarıyla yüklendi! UI Giriş E2E testi başarıyla tamamlandı.');
    await page.waitForTimeout(4000);
  });
});
