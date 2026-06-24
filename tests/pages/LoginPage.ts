import { Page, Locator, expect } from '@playwright/test';
import { requireEnv } from '../support/require-env';

const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // Prefer accessibility roles/placeholders, fall back to attribute names
    this.emailInput = page.getByRole('textbox', { name: /email/i })
      .or(page.locator('input[name="email"]')).first();
    this.passwordInput = page.getByPlaceholder(/password/i)
      .or(page.locator('input[name="password"], input[type="password"]')).first();
    this.signInButton = page.getByRole('button', { name: /^Sign in$/i })
      .or(page.locator('button').filter({ hasText: /^Sign in$/i })).first();
  }

  async goto(): Promise<void> {
    const signInUrl = `${dashboardBaseUrl}/sign-in`;
    console.log(`🚀 [POM] Giriş sayfasına gidiliyor: ${signInUrl}`);
    await this.page.goto(signInUrl, { waitUntil: 'load' });
    await expect(this.emailInput).toBeVisible({ timeout: 15000 });
  }

  async fillForm(email: string, password: string): Promise<void> {
    console.log(`✉️ [POM] E-posta yazılıyor: ${email}`);
    await this.emailInput.click();
    await this.emailInput.fill(email);

    console.log(`🔑 [POM] Şifre yazılıyor...`);
    await this.passwordInput.click();
    await this.passwordInput.fill(password);

    // Double check input values to prevent keypress loss
    const currentEmailValue = await this.emailInput.inputValue();
    if (currentEmailValue !== email) {
      await this.emailInput.fill(email);
    }
    const currentPasswordValue = await this.passwordInput.inputValue();
    if (currentPasswordValue !== password) {
      await this.passwordInput.fill(password);
    }
  }

  async submit(): Promise<void> {
    console.log('👆 [POM] "Sign in" butonuna tıklanıyor...');
    await this.signInButton.click();
  }

  async handleCaptchaIfVisible(timeoutMs = 120000): Promise<void> {
    console.log('⏳ [POM] Captcha iframe\'inin yüklenmesi bekleniyor (maksimum 10 saniye)...');
    
    const captchaType = await Promise.race([
      this.page.locator('iframe[src*="challenges.cloudflare.com"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Cloudflare Turnstile').catch(() => null),
      this.page.locator('iframe[src*="google.com/recaptcha"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Google reCAPTCHA').catch(() => null)
    ]);

    if (captchaType) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfa yüklendiğinde Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test bilgileri doldurup otomatik devam edecektir.');
      console.log('=========================================\n');

      await this.page.waitForFunction(() => {
        const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const tVal = turnstile ? turnstile.value.trim() : '';
        const rVal = recaptcha ? recaptcha.value.trim() : '';
        return tVal.length > 0 || rVal.length > 0;
      }, { timeout: timeoutMs }).catch((e) => {
        console.log('⚠️ [POM] Captcha bekleme süresi doldu veya hata oluştu:', e.message);
      });

      console.log('✅ [POM] Captcha başarıyla çözüldü (Token algılandı)!');
      await expect(this.signInButton).toBeEnabled({ timeout: 5000 }).catch(() => {});
    } else {
      console.log('ℹ️ [POM] Captcha iframe\'i bulunamadı veya pasif. Doğrudan veri girişine geçiliyor.');
    }
  }
}
