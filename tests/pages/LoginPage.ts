import { Page, Locator, expect } from '@playwright/test';
import { requireEnv } from '../support/require-env';

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  get dashboardBaseUrl() {
    return requireEnv('DASHBOARD_BASE_URL');
  }

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
    const signInUrl = `${this.dashboardBaseUrl}/sign-in`;
    console.log(`🚀 [POM] Giriş sayfasına gidiliyor: ${signInUrl}`);
    await this.page.goto(signInUrl, { waitUntil: 'domcontentloaded' });
    await expect(this.emailInput).toBeVisible({ timeout: 15000 });
    // Next.js hydration tamamlanmasını bekle (Form doldurma kararlılığı için)
    await this.page.waitForFunction(() => typeof (window as any).next !== 'undefined', { timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(2000);
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

  async handleCaptchaIfVisible(
    timeoutMs = 600000,
    checkTimeoutMs = 3000,
    failOnTimeout = true
  ): Promise<void> {
    console.log('⏳ [POM] Captcha varlığı kontrol ediliyor...');
    
    const captchaSelector = [
      'iframe[src*="challenges.cloudflare.com"]',
      '.cf-turnstile',
      'iframe[src*="google.com/recaptcha"]',
      '#g-recaptcha',
      '.g-recaptcha'
    ].join(', ');

    const hasCaptcha = await this.page.locator(captchaSelector).first()
      .waitFor({ state: 'attached', timeout: checkTimeoutMs })
      .then(() => true)
      .catch(() => false);

    if (hasCaptcha) {
      const isTurnstile = await this.page.locator('iframe[src*="challenges.cloudflare.com"], .cf-turnstile').first().isVisible().catch(() => false) ||
                          await this.page.locator('.cf-turnstile').count().then(c => c > 0);
      const captchaType = isTurnstile ? 'Cloudflare Turnstile' : 'Google reCAPTCHA';

      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfada Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan tarayıcıdan Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test otomatik olarak devam edecektir.');
      console.log('=========================================\n');

      try {
        await this.page.waitForFunction(() => {
          const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
          const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
          const tVal = turnstile ? turnstile.value.trim() : '';
          const rVal = recaptcha ? recaptcha.value.trim() : '';
          return tVal.length > 0 || rVal.length > 0;
        }, undefined, { timeout: timeoutMs, polling: 1000 });
      } catch (error) {
        if (failOnTimeout) {
          throw new Error(`Captcha ${timeoutMs} ms içinde manuel olarak çözülmedi.`, { cause: error });
        }

        console.log('ℹ️ [POM] Mock/hata senaryosunda Captcha beklenmeden devam ediliyor.');
        return;
      }

      console.log('✅ [POM] Captcha başarıyla çözüldü (Token algılandı)!');
      await expect(this.signInButton).toBeEnabled({ timeout: 5000 });
    } else {
      console.log('ℹ️ [POM] Captcha bulunamadı veya pasif. Devam ediliyor.');
    }
  }
}
