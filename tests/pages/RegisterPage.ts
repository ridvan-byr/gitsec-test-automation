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
  private formData?: { name: string; surname: string; email: string; password: string };

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
    await this.page.goto(signUpUrl, { waitUntil: 'domcontentloaded' });
    await expect(this.nameInput).toBeVisible({ timeout: 15000 });
  }

  async fillForm(name: string, surname: string, email: string, password: string): Promise<void> {
    this.formData = { name, surname, email, password };
    console.log(`👤 [POM] İsim yazılıyor: ${name}`);
    await this.nameInput.fill(name);

    console.log(`👤 [POM] Soyisim yazılıyor: ${surname}`);
    await this.surnameInput.fill(surname);

    console.log(`✉️ [POM] E-posta yazılıyor: ${email}`);
    await this.emailInput.fill(email);

    console.log(`🔑 [POM] Şifreler dolduruluyor...`);
    // React controlled component: fill() ile password alanı doldurulduğunda,
    // confirmPassword'a geçildiğinde React state sıfırlayabiliyor.
    // pressSequentially ile karakter karakter yazarak React'ın onChange handler'ını
    // her keystroke'ta tetikliyoruz — bu sayede state tutarlı kalır.
    await this.fillPasswordField(this.passwordInput, password);
    await this.page.waitForTimeout(200);
    await this.fillPasswordField(this.confirmPasswordInput, password);

    await this.ensureFormIsFilled();
  }

  /**
   * Şifre alanını güvenilir şekilde doldurur.
   * React controlled component state sıfırlama sorununu önlemek için
   * click → clear → pressSequentially zinciri kullanır.
   */
  private async fillPasswordField(field: Locator, value: string): Promise<void> {
    await field.click();
    await field.fill(''); // Önce temizle
    await field.pressSequentially(value, { delay: 30 });
    // React state sync beklemesi
    await this.page.waitForTimeout(100);
  }

  async submitWithCaptchaHandling(timeoutMs = 0): Promise<void> {
    const hasDeadline = timeoutMs > 0;
    const deadline = hasDeadline ? Date.now() + timeoutMs : Number.POSITIVE_INFINITY;
    const remaining = () => hasDeadline ? Math.max(deadline - Date.now(), 1) : 0;

    while (!hasDeadline || Date.now() < deadline) {
      const remainingTime = remaining();

      if (await this.isUnsolvedCaptchaPresent()) {
        await this.handleCaptchaIfVisible(0, 1000);
        continue;
      }

      await this.ensureFormIsFilled();

      const nextState = await Promise.race([
        expect(this.submitButton).toBeEnabled({ timeout: remainingTime }).then(() => 'ready' as const),
        this.waitForUnsolvedCaptcha(remainingTime).then(() => 'captcha' as const)
      ]);

      if (nextState === 'captcha') {
        await this.handleCaptchaIfVisible(remainingTime, 0);
        continue;
      }

      console.log('👆 [POM] "Create account" butonuna tıklanıyor...');
      const registrationResponse = this.page.waitForResponse(
        response => /\/auth\/(signup|register)(?:[/?]|$)/i.test(response.url()) &&
          response.request().method() === 'POST',
        { timeout: remainingTime }
      ).then(response => ({ type: 'response' as const, response }));
      const redirected = this.page.waitForURL(/\/login|verify|confirm|success/i, {
        timeout: remainingTime
      }).then(() => ({ type: 'redirected' as const }));
      const captchaAppeared = this.waitForUnsolvedCaptcha(remainingTime)
        .then(() => ({ type: 'captcha' as const }));

      const submittedCaptchaToken = await this.getCaptchaToken();
      await this.submitButton.click();
      const result = await Promise.race([registrationResponse, redirected, captchaAppeared]);

      if (result.type === 'redirected') {
        return;
      }

      if (result.type === 'captcha') {
        await this.handleCaptchaIfVisible(0, 1000);
        continue;
      }

      if (result.response.ok()) {
        return;
      }

      const responseBody = await result.response.text().catch(() => '');
      const captchaRejected = /captcha|turnstile|recaptcha|challenge/i.test(responseBody);
      if (captchaRejected) {
        console.log('⚠️ [POM] Captcha henüz kabul edilmedi. Tarayıcı açık tutuluyor ve yeni challenge bekleniyor...');
        await this.waitForFreshCaptchaToken(submittedCaptchaToken, 0);
        continue;
      }

      throw new Error(
        `Kayıt isteği başarısız oldu (${result.response.status()}): ${responseBody.slice(0, 300)}`
      );
    }

    throw new Error(`Kayıt işlemi ${timeoutMs} ms içinde tamamlanamadı.`);
  }

  private async ensureFormIsFilled(): Promise<void> {
    if (!this.formData) {
      throw new Error('Kayıt formu doldurulmadan submit yapılamaz. Önce fillForm() çağrılmalıdır.');
    }

    // Şifre alanları hariç tüm text alanları
    const textFields: Array<[Locator, string]> = [
      [this.nameInput, this.formData.name],
      [this.surnameInput, this.formData.surname],
      [this.emailInput, this.formData.email],
    ];

    // Şifre alanları (React state sıfırlama riski nedeniyle ayrı ele alınır)
    const passwordFields: Array<[Locator, string]> = [
      [this.passwordInput, this.formData.password],
      [this.confirmPasswordInput, this.formData.password],
    ];

    // 1. Text alanlarını kontrol et ve gerekirse düzelt
    for (const [field, expectedValue] of textFields) {
      if (await field.inputValue() !== expectedValue) {
        await field.fill(expectedValue);
      }
      await expect(field).toHaveValue(expectedValue);
    }

    // 2. Şifre alanlarını kontrol et — boşsa pressSequentially ile tekrar doldur
    for (const [field, expectedValue] of passwordFields) {
      const currentValue = await field.inputValue();
      if (currentValue !== expectedValue) {
        console.log(`🔄 [POM] Şifre alanı boş/eksik — tekrar dolduruluyor (mevcut: "${currentValue.length > 0 ? '***' : ''}")`);
        await this.fillPasswordField(field, expectedValue);
      }
    }

    // 3. Son doğrulama: tüm şifre alanlarının tutarlı olduğunu onayla
    for (const [field, expectedValue] of passwordFields) {
      await expect(field).toHaveValue(expectedValue, { timeout: 5_000 });
    }
  }

  async submit(): Promise<void> {
    await this.ensureFormIsFilled();
    await expect(this.submitButton).toBeEnabled();
    await this.submitButton.click();
  }

  private async waitForUnsolvedCaptcha(timeoutMs: number): Promise<void> {
    await this.page.waitForFunction(() => {
      const captcha = document.querySelector([
        'iframe[src*="challenges.cloudflare.com"]',
        '.cf-turnstile',
        'iframe[src*="google.com/recaptcha"]',
        '#g-recaptcha',
        '.g-recaptcha'
      ].join(', '));
      const turnstileToken = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
      const recaptchaToken = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | null;
      const hasToken = Boolean(turnstileToken?.value.trim() || recaptchaToken?.value.trim());

      return Boolean(captcha) && !hasToken;
    }, undefined, { timeout: timeoutMs, polling: 1000 });
  }

  private async isUnsolvedCaptchaPresent(): Promise<boolean> {
    return this.page.evaluate(() => {
      const captcha = document.querySelector([
        'iframe[src*="challenges.cloudflare.com"]',
        '.cf-turnstile',
        'iframe[src*="google.com/recaptcha"]',
        '#g-recaptcha',
        '.g-recaptcha'
      ].join(', '));
      const turnstileToken = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
      const recaptchaToken = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | null;

      return Boolean(captcha) && !(turnstileToken?.value.trim() || recaptchaToken?.value.trim());
    });
  }

  private async getCaptchaToken(): Promise<string> {
    return this.page.evaluate(() => {
      const turnstileToken = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
      const recaptchaToken = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | null;
      return turnstileToken?.value.trim() || recaptchaToken?.value.trim() || '';
    });
  }

  private async waitForFreshCaptchaToken(previousToken: string, timeoutMs: number): Promise<void> {
    await this.page.waitForFunction((oldToken) => {
      const turnstileToken = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null;
      const recaptchaToken = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | null;
      const currentToken = turnstileToken?.value.trim() || recaptchaToken?.value.trim() || '';
      return currentToken.length > 0 && currentToken !== oldToken;
    }, previousToken, { timeout: timeoutMs });
  }

  async handleCaptchaIfVisible(timeoutMs = 600000, checkTimeoutMs = 3000): Promise<void> {
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

      // Token alanının dolmasını bekle
      await this.page.waitForFunction(() => {
        const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const tVal = turnstile ? turnstile.value.trim() : '';
        const rVal = recaptcha ? recaptcha.value.trim() : '';
        return tVal.length > 0 || rVal.length > 0;
      }, undefined, { timeout: timeoutMs, polling: 1000 });

      console.log('✅ [POM] Captcha başarıyla çözüldü (Token algılandı)!');
      await expect(this.submitButton).toBeEnabled({ timeout: 5000 });
    } else {
      console.log('ℹ️ [POM] Captcha bulunamadı veya pasif. Devam ediliyor.');
    }
  }
}
