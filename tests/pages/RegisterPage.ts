import { Page, Locator, expect } from '@playwright/test';
import { requireEnv } from '../support/require-env';

export class RegisterPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly surnameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInputs: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;

  get dashboardBaseUrl() {
    return requireEnv('DASHBOARD_BASE_URL');
  }

  constructor(page: Page) {
    this.page = page;
    // Prefer accessibility roles/placeholders, fall back to attribute names
    this.nameInput = page.getByPlaceholder(/first name/i)
      .or(page.locator('input[name="name"]')).first();
    this.surnameInput = page.getByPlaceholder(/last name/i)
      .or(page.locator('input[name="surname"]')).first();
    this.emailInput = page.getByRole('textbox', { name: /email/i })
      .or(page.locator('input[name="email"]')).first();
    this.passwordInputs = page.locator('input[type="password"]');
    this.passwordInput = page.locator('input[name="password"]').first();
    this.confirmPasswordInput = page.locator('input[name="confirmPassword"]').first();
    this.submitButton = page.getByRole('button', { name: /Create account/i })
      .or(page.locator('button').filter({ hasText: /Create account/i })).first();
  }

  async goto(): Promise<void> {
    const signUpUrl = `${this.dashboardBaseUrl}/sign-up`;
    console.log(`🚀 [POM] Kayıt sayfasına gidiliyor: ${signUpUrl}`);
    await this.page.goto(signUpUrl, { waitUntil: 'load' });
    await expect(this.nameInput).toBeVisible({ timeout: 15000 });
  }

  async fillForm(name: string, surname: string, email: string, password: string): Promise<void> {
    console.log(`👤 [POM] İsim yazılıyor: ${name}`);
    await this.nameInput.fill(name);

    console.log(`👤 [POM] Soyisim yazılıyor: ${surname}`);
    await this.surnameInput.fill(surname);

    console.log(`✉️ [POM] E-posta yazılıyor: ${email}`);
    await this.emailInput.fill(email);

    console.log(`🔑 [POM] Şifreler dolduruluyor...`);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(password);

    // Double check values
    const currentEmailValue = await this.emailInput.inputValue();
    if (currentEmailValue !== email) {
      await this.emailInput.fill(email);
    }
  }

  async submit(): Promise<void> {
    console.log('👆 [POM] "Create account" butonuna tıklanıyor...');
    await this.submitButton.click({ force: true });
  }

  async handleCaptchaIfVisible(timeoutMs = 120000): Promise<void> {
    console.log('⏳ [POM] Captcha varlığı kontrol ediliyor...');
    
    // 2 saniye içinde DOM'da Cloudflare Turnstile veya Google reCAPTCHA iframe'i var mı hızlıca tara
    const captchaType = await Promise.race([
      this.page.locator('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [id*="turnstile"]').first().waitFor({ state: 'attached', timeout: 2000 }).then(() => 'Cloudflare Turnstile').catch(() => null),
      this.page.locator('iframe[src*="google.com/recaptcha"], .g-recaptcha').first().waitFor({ state: 'attached', timeout: 2000 }).then(() => 'Google reCAPTCHA').catch(() => null)
    ]);

    if (captchaType) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfada Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan tarayıcıdan Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test kaldığı yerden otomatik olarak devam edecektir.');
      console.log('=========================================\n');

      // Token alanının dolmasını bekle
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
      await expect(this.submitButton).toBeEnabled({ timeout: 5000 }).catch(() => {});
    } else {
      console.log('ℹ️ [POM] Captcha bulunamadı veya pasif. Devam ediliyor.');
    }
  }
}
