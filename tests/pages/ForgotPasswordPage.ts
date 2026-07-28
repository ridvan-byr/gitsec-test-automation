import { expect, type Locator, type Page } from '@playwright/test';
import { requireEnv } from '../support/require-env';
import { requestPasswordResetLink } from '../support/forgot-password-flow';

export class ForgotPasswordPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly passwordInputs: Locator;
  readonly submitButton: Locator;

  get dashboardBaseUrl() {
    return requireEnv('DASHBOARD_BASE_URL');
  }

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page
      .getByRole('textbox', { name: /email/i })
      .or(page.getByPlaceholder('name@example.com'))
      .or(page.locator('input[type="email"], input[name="email"]'))
      .first();
    this.passwordInput = page.locator('input[name="password"]').first();
    this.confirmPasswordInput = page.locator('input[name="confirmPassword"]').first();
    this.passwordInputs = page.locator('input[type="password"]');
    this.submitButton = page
      .getByRole('button', { name: /reset password|update password|change password|set password|save|sıfırla|güncelle|kaydet/i })
      .or(page.locator('button[type="submit"]'))
      .first();
  }

  async gotoForgotPasswordFromLogin(): Promise<void> {
    const forgotPasswordUrl = `${this.dashboardBaseUrl}/forgot-password`;
    console.log(`🚀 [POM] Şifremi unuttum sayfasına gidiliyor: ${forgotPasswordUrl}`);
    await this.page.goto(forgotPasswordUrl, { waitUntil: 'domcontentloaded' });
    await this.waitForPageReady();
    await expect(this.page).toHaveURL(/forgot-password|reset-password|forgot/i);
  }

  async openResetLinkFromEmail(): Promise<string> {
    await this.gotoForgotPasswordFromLogin();
    const { resetLink } = await requestPasswordResetLink(this.page);
    await this.openResetLink(resetLink);
    return resetLink;
  }

  async openResetLink(resetLink: string): Promise<void> {
    console.log('🚀 [POM] Sıfırlama linki açılıyor...');
    await this.page.goto(resetLink, { waitUntil: 'domcontentloaded' });
    await this.waitForPageReady();
    await this.expectResetPasswordPage();
  }

  async prepareResetForm(resetLink: string, email?: string): Promise<void> {
    await this.openResetLink(resetLink);

    await this.emailInput.click();
    await this.emailInput.fill('');
    if (email) {
      await this.fillEmail(email);
    } else {
      await expect(this.emailInput).toHaveValue('');
    }

    await this.clearPasswordFields();
  }

  async expectResetPasswordPage(): Promise<void> {
    await expect(this.page).toHaveURL(/reset|forgot|password|change-password/i);
    await expect(this.emailInput).toBeVisible({ timeout: 20_000 });
    await expect(this.passwordInput).toBeVisible({ timeout: 20_000 });
  }

  async fillEmail(email: string): Promise<void> {
    console.log(`✉️ [POM] Sıfırlama formuna e-posta yazılıyor: ${email}`);
    await expect(this.emailInput).toBeVisible();
    await expect(this.emailInput).toBeEditable();
    await this.emailInput.click();
    await this.emailInput.fill('');
    await this.emailInput.fill(email);
    await expect(this.emailInput).toHaveValue(email);
  }

  async fillPasswords(password: string, confirmPassword: string = password): Promise<void> {
    console.log('🔑 [POM] Şifre alanları dolduruluyor...');
    await this.fillPasswordField(this.passwordInput, password);
    await this.page.waitForTimeout(200);
    await this.fillPasswordField(this.confirmPasswordInput, confirmPassword);

    const currentPassword = await this.passwordInput.inputValue();
    if (currentPassword !== password) {
      await this.fillPasswordField(this.passwordInput, password);
    }

    const currentConfirm = await this.confirmPasswordInput.inputValue();
    if (currentConfirm !== confirmPassword) {
      await this.fillPasswordField(this.confirmPasswordInput, confirmPassword);
    }

    await expect(this.passwordInput).not.toHaveValue('');
    await expect(this.confirmPasswordInput).not.toHaveValue('');
  }

  async fillLongPasswordForValidation(password: string): Promise<void> {
    console.log('🔑 [POM] Sınır değer testi için uzun şifre yazılıyor...');
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.click();
    await this.confirmPasswordInput.fill(password);
  }

  async submitReset(): Promise<void> {
    console.log('🔘 [POM] Şifre sıfırlama formu gönderiliyor...');
    await expect(this.submitButton).toBeVisible();
    await expect(this.submitButton).toBeEnabled();
    await this.submitButton.click();
  }

  async fillResetForm(email: string, password: string, confirmPassword: string = password): Promise<void> {
    await this.fillEmail(email);
    await this.fillPasswords(password, confirmPassword);
  }

  async resetPassword(
    email: string,
    password: string,
    confirmPassword: string = password
  ): Promise<void> {
    await this.fillResetForm(email, password, confirmPassword);

    const responsePromise = this.page.waitForResponse(response => {
      const request = response.request();
      if (request.method() !== 'POST') return false;
      return /\/reset-password(?:\/|$)/i.test(new URL(response.url()).pathname);
    }, { timeout: 30_000 });

    await this.submitReset();
    const response = await responsePromise;
    console.log(`📡 [POM] Şifre sıfırlama API yanıtı: ${response.status()} ${response.url()}`);
    expect(response.status()).toBe(200);

    await this.waitForResetCompletion();

    if (/reset-password/i.test(this.page.url())) {
      console.log('ℹ️ [POM] Sıfırlama sonrası otomatik yönlendirme yok; giriş sayfasına gidiliyor...');
      await this.page.goto(`${this.dashboardBaseUrl}/sign-in`, { waitUntil: 'domcontentloaded' });
    }

    await expect(this.page).toHaveURL(/\/(?:sign-in|login|dashboard)(?:[/?#]|$)/i, { timeout: 20_000 });
  }

  private async waitForPageReady(): Promise<void> {
    await this.page.waitForFunction(() => typeof (window as any).next !== 'undefined', { timeout: 10_000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  private async clearPasswordFields(): Promise<void> {
    await this.fillPasswordField(this.passwordInput, '');
    await this.fillPasswordField(this.confirmPasswordInput, '');
  }

  private async fillPasswordField(field: Locator, value: string): Promise<void> {
    await expect(field).toBeVisible();
    await expect(field).toBeEditable();
    await field.click();
    await field.fill(value);

    let actual = await field.inputValue().catch(() => '');
    if (actual !== value && value.length > 0) {
      await field.fill('');
      await field.pressSequentially(value, { delay: 5 });
      actual = await field.inputValue().catch(() => '');
    }

    if (value.length > 0) {
      expect(actual.length).toBeGreaterThan(0);
    } else {
      await expect(field).toHaveValue('');
    }

    await this.page.waitForTimeout(100);
  }

  private async waitForResetCompletion(): Promise<void> {
    const signInUrlPattern = /\/(?:sign-in|login|dashboard)(?:[/?#]|$)/i;
    const successToast = this.page.locator('[data-sonner-toast], [role="status"], [role="alert"]').filter({
      hasText: /password.*reset|reset.*success|successfully|updated|changed|sıfırlandı|güncellendi|başarılı/i
    }).first();
    const successText = this.page.getByText(/password.*reset|reset.*success|successfully|updated|changed|sıfırlandı|güncellendi|başarılı/i).first();
    const signInLink = this.page.getByRole('link', { name: /sign in|log in|giriş/i }).first();

    await Promise.race([
      this.page.waitForURL(signInUrlPattern, { timeout: 15_000 }),
      successToast.waitFor({ state: 'visible', timeout: 15_000 }),
      successText.waitFor({ state: 'visible', timeout: 15_000 }),
    ]).catch(() => {});

    if (signInUrlPattern.test(this.page.url())) return;

    if (await signInLink.isVisible().catch(() => false)) {
      await signInLink.click();
      await this.page.waitForURL(signInUrlPattern, { timeout: 15_000 }).catch(() => {});
    }
  }
}
