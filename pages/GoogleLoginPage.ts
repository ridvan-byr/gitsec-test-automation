import { Page, Locator } from '@playwright/test';
import { TOTP, Secret } from 'otpauth';

/**
 * Google OAuth hesap giriş sayfasını otomatize eder.
 *
 * Gerekli .env değişkenleri:
 *   GOOGLE_TEST_USER     — Google hesap e-postası (ör: gitsectest@gmail.com)
 *   GOOGLE_TEST_PASSWORD — Google hesap şifresi
 *   GOOGLE_TOTP_SECRET   — Google Authenticator TOTP secret key (base32)
 */
export class GoogleLoginPage {
  readonly page: Page;

  // Giriş alanları
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly emailNextBtn: Locator;
  readonly passwordNextBtn: Locator;
  readonly totpInput: Locator;
  readonly totpNextBtn: Locator;

  constructor(page: Page) {
    this.page = page;

    // Google giriş formu seçicileri
    this.emailInput = page.locator('input[type="email"]');
    this.passwordInput = page.locator('input[type="password"]');

    // "İleri" / "Next" butonu — Google bazen farklı selector kullanır
    this.emailNextBtn = page.locator('#identifierNext')
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki/i }))
      .first();

    this.passwordNextBtn = page.locator('#passwordNext')
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki/i }))
      .first();

    // TOTP (Authenticator) kodu giriş alanı
    this.totpInput = page.locator('input[name="totpPin"]')
      .or(page.locator('#totpPin'))
      .or(page.locator('input[type="tel"]'))
      .first();

    this.totpNextBtn = page.locator('#totpNext')
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki|Doğrula|Verify/i }))
      .first();
  }

  /** Popup kapanmışsa işlem yapma. */
  private isGone(): boolean {
    return this.page.isClosed();
  }

  private async safePause(ms: number): Promise<void> {
    if (this.isGone()) return;
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (this.isGone()) return;
      await this.page.waitForTimeout(100).catch(() => {});
    }
  }

  /**
   * TOTP secret'tan 6 haneli doğrulama kodu üretir.
   */
  static generateTotpCode(secret: string): string {
    const totp = new TOTP({
      issuer: 'Google',
      label: 'gitsectest',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret.replace(/\s/g, '').toUpperCase()),
    });
    return totp.generate();
  }

  /**
   * .env'den Google kimlik bilgilerini okur.
   */
  static getCredentials(): { user: string; password: string; totpSecret: string } {
    const user = process.env.GOOGLE_TEST_USER?.trim() ?? '';
    const password = process.env.GOOGLE_TEST_PASSWORD?.trim() ?? '';
    const totpSecret = process.env.GOOGLE_TOTP_SECRET?.trim() ?? '';

    if (!user || !password) {
      throw new Error(
        'GOOGLE_TEST_USER ve GOOGLE_TEST_PASSWORD .env dosyasında tanımlı olmalı!'
      );
    }
    if (!totpSecret) {
      throw new Error(
        'GOOGLE_TOTP_SECRET .env dosyasında tanımlı olmalı! ' +
        'Google hesabında 2FA > Authenticator App kurulumunda verilen base32 secret key\'i girin.'
      );
    }

    return { user, password, totpSecret };
  }

  /**
   * Google OAuth giriş sayfasının yüklenmesini bekler.
   */
  async waitForLoginPage(timeoutMs = 20_000): Promise<boolean> {
    try {
      await this.page.waitForURL(
        /accounts\.google\.com|google\.com\/o\/oauth2/i,
        { timeout: timeoutMs }
      );
      await this.page.waitForLoadState('domcontentloaded');
      return true;
    } catch {
      console.log('[google-login] Google giriş sayfası yüklenemedi. URL:', this.page.url());
      return false;
    }
  }

  /**
   * E-posta adresini girer ve İleri'ye tıklar.
   */
  async enterEmail(email: string): Promise<void> {
    console.log(`[google-login] E-posta giriliyor: ${email}`);

    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.safePause(500);

    await this.emailNextBtn.click();
    console.log('[google-login] E-posta girildi, İleri tıklandı.');

    // Şifre alanının gelmesini bekle
    await this.safePause(2000);
  }

  /**
   * Şifreyi girer ve İleri'ye tıklar.
   */
  async enterPassword(password: string): Promise<void> {
    console.log('[google-login] Şifre giriliyor...');

    await this.passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.safePause(500);

    await this.passwordNextBtn.click();
    console.log('[google-login] Şifre girildi, İleri tıklandı.');

    // 2FA veya izin ekranının gelmesini bekle
    await this.safePause(3000);
  }

  /**
   * 2FA doğrulama yöntemini belirler.
   */
  async detectTwoFactorMethod(): Promise<'totp' | 'sms' | 'prompt' | 'none'> {
    if (this.isGone()) return 'none';

    // TOTP input var mı?
    const totpVisible = await this.totpInput.isVisible().catch(() => false);
    if (totpVisible) {
      console.log('[google-login] TOTP (Authenticator) kodu girişi tespit edildi.');
      return 'totp';
    }

    // "Google Authenticator" veya "Enter the code" seçeneğine geçmek gerekebilir
    // Google bazen "Try another way" linki gösterir
    const tryAnotherWay = this.page.getByRole('button', { name: /Try another way|Başka bir yöntem dene/i })
      .or(this.page.locator('button, a').filter({ hasText: /Try another way|Başka bir yöntem/i }))
      .first();

    if (await tryAnotherWay.isVisible().catch(() => false)) {
      console.log('[google-login] "Try another way" bulundu, tıklanıyor...');
      await tryAnotherWay.click();
      await this.safePause(2000);

      // Authenticator seçeneğini bul ve tıkla
      const authenticatorOption = this.page.getByText(/Google Authenticator|Authenticator app|Doğrulayıcı uygulama/i)
        .or(this.page.locator('li, div[role="link"], button').filter({ 
          hasText: /authenticator|doğrulayıcı|verification code|doğrulama kodu/i 
        }))
        .first();

      if (await authenticatorOption.isVisible().catch(() => false)) {
        console.log('[google-login] Authenticator seçeneğine tıklanıyor...');
        await authenticatorOption.click();
        await this.safePause(2000);
        return 'totp';
      }
    }

    // SMS/telefon doğrulaması mı?
    const smsHint = await this.page
      .getByText(/phone|telefon|sms|mesaj|code.*sent/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (smsHint) {
      console.log('[google-login] SMS doğrulaması tespit edildi.');
      return 'sms';
    }

    // Google Prompt (telefondan onay) mı?
    const promptHint = await this.page
      .getByText(/tap yes|evet.*dokunun|confirm.*phone|check your phone/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (promptHint) {
      console.log('[google-login] Google Prompt tespit edildi.');
      return 'prompt';
    }

    return 'none';
  }

  /**
   * TOTP kodunu girer ve doğrulamayı tamamlar.
   */
  async enterTotpCode(secret: string): Promise<boolean> {
    const code = GoogleLoginPage.generateTotpCode(secret);
    console.log(`[google-login] TOTP kodu üretildi: ${code}`);

    // TOTP input alanını bekle
    await this.totpInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.totpInput.click();
    await this.totpInput.fill('');
    await this.totpInput.pressSequentially(code, { delay: 50 });
    await this.safePause(500);

    // Doğrula / Next butonuna tıkla
    await this.totpNextBtn.click();
    console.log('[google-login] TOTP kodu girildi, doğrulama gönderildi.');

    // Sonucu bekle
    await this.safePause(3000);

    if (this.isGone()) {
      console.log('[google-login] TOTP sonrası popup kapandı (başarılı redirect).');
      return true;
    }

    // Hata var mı kontrol et
    const error = await this.page
      .getByText(/wrong code|yanlış kod|invalid|geçersiz|try again/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (error) {
      console.error('[google-login] TOTP kodu reddedildi! Secret key doğru mu kontrol edin.');
      return false;
    }

    return true;
  }

  /**
   * Sayfayı ve tüm scrollable container'ları donanım ve programatik
   * yöntemlerle en aşağıya kaydırır (Google'ın scroll algılayıcılarını tetikler).
   */
  private async scrollToBottom(): Promise<void> {
    if (this.isGone()) return;

    console.log('[google-login] [scroll] Kaydırma işlemi başlatıldı...');

    // 1. Programatik Kaydırma
    await this.page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      if (document.scrollingElement) {
        document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      }
      if (document.documentElement) {
        document.documentElement.scrollTop = document.documentElement.scrollHeight;
      }
      
      const scrollables = document.querySelectorAll('*');
      scrollables.forEach(el => {
        if (el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }).catch(() => {});
    await this.safePause(150);

    // 2. Playwright Donanım Klavye Tuşları (isTrusted event tetikler)
    try {
      await this.page.keyboard.press('End').catch(() => {});
      await this.safePause(100);
      for (let i = 0; i < 2; i++) {
        await this.page.keyboard.press('PageDown').catch(() => {});
        await this.safePause(50);
      }
    } catch (e) {
      console.log('[google-login] [scroll] Klavye ile kaydırma hatası:', e);
    }

    // 3. Playwright Donanım Fare Tekerleği (Mouse Wheel)
    try {
      const viewportSize = this.page.viewportSize();
      if (viewportSize) {
        const centerX = Math.floor(viewportSize.width / 2);
        const centerY = Math.floor(viewportSize.height / 2);
        await this.page.mouse.move(centerX, centerY).catch(() => {});
        for (let i = 0; i < 2; i++) {
          await this.page.mouse.wheel(0, 450).catch(() => {});
          await this.safePause(50);
        }
      }
    } catch (e) {
      console.log('[google-login] [scroll] Fare ile kaydırma hatası:', e);
    }

    await this.safePause(100);
    console.log('[google-login] [scroll] Kaydırma tamamlandı.');
  }

  /**
   * OAuth izin (consent) ekranını otomatik onaylar.
   */
  async handleConsentScreen(): Promise<boolean> {
    if (this.isGone()) return true;

    console.log('[google-login] İzin ekranının yüklenmesi bekleniyor...');

    // "İzin ver" / "Allow" / "Continue" / "Devam et" butonu
    const allowBtn = this.page.getByRole('button', { name: /Allow|İzin ver|Kabul et|Continue|Devam/i })
      .or(this.page.locator('#submit_approve_access'))
      .or(this.page.locator('button[type="submit"]').filter({ hasText: /Allow|İzin|Devam|Continue/i }))
      .first();

    // Sayfa içeriğinin yüklendiğinden emin olmak için izin ekranı metinlerinden birini bekle
    try {
      await this.page.locator('text=/erişim istiyor|wants to access|güvendiğinizden|trust|allow|izin/i')
        .first()
        .waitFor({ state: 'visible', timeout: 15_000 });
      console.log('[google-login] İzin ekranı içeriği algılandı.');
    } catch (e) {
      console.log('[google-login] İzin ekranı metni bulunamadı, doğrudan butona odaklanılıyor...');
    }

    try {
      await allowBtn.waitFor({ state: 'attached', timeout: 10_000 });
      console.log('[google-login] Onay butonu DOM\'da hazır.');
    } catch (e) {
      console.log('[google-login] Onay butonu DOM\'da bulunamadı, yine de devam ediliyor.');
    }

    // İlk ve ana kaydırma
    await this.scrollToBottom();

    // Bazen "Gelişmiş" / "Advanced" → "Go to app (unsafe)" akışı olur
    const advancedLink = this.page.getByRole('button', { name: /Advanced|Gelişmiş/i })
      .or(this.page.locator('#details-button'))
      .first();

    // Doğrulanmamış uygulama uyarısı varsa
    if (await advancedLink.isVisible().catch(() => false)) {
      console.log('[google-login] "Doğrulanmamış uygulama" uyarısı — Advanced tıklanıyor...');
      await advancedLink.click();
      await this.safePause(1000);

      const goToApp = this.page.locator('a, button').filter({ hasText: /Go to|Git.*güvenli değil|unsafe/i }).first();
      if (await goToApp.isVisible().catch(() => false)) {
        await goToApp.click();
        console.log('[google-login] "Go to app (unsafe)" tıklandı.');
        await this.safePause(2000);

        // Advanced tıklandıktan sonra tekrar aşağı kaydır
        await this.scrollToBottom();
      }
    }

    // Scope izin checkbox'ları (bazı uygulamalar tek tek izin ister)
    const checkboxes = this.page.locator('input[type="checkbox"]:not(:checked)');
    const checkboxCount = await checkboxes.count().catch(() => 0);
    if (checkboxCount > 0) {
      console.log(`[google-login] ${checkboxCount} adet izin checkbox'ı işaretleniyor...`);
      for (let i = 0; i < checkboxCount; i++) {
        await checkboxes.nth(i).check().catch(() => {});
      }
      await this.safePause(500);

      // Checkbox'lar işaretlendikten sonra tekrar aşağı kaydır (buton aktifleşsin)
      await this.scrollToBottom();
    }

    // Allow/İzin Ver butonuna tıkla
    const allowVisible = await allowBtn.waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);

    if (allowVisible) {
      console.log('[google-login] İzin ekranı — "Allow/Devam" tıklanıyor...');
      // Butonu görünürlüğe getir ve force click yap
      await allowBtn.scrollIntoViewIfNeeded().catch(() => {});
      await allowBtn.click({ force: true });
      await this.safePause(1500);

      // İkinci izin ekranı olabilir (scope onayları)
      if (!this.isGone()) {
        console.log('[google-login] İkinci onay ekranı kontrol ediliyor...');
        const secondAllow = this.page.getByRole('button', { name: /Allow|İzin ver|Confirm|Onayla|Devam/i }).first();
        if (await secondAllow.isVisible().catch(() => false)) {
          console.log('[google-login] İkinci izin ekranı algılandı, aşağı kaydırılıyor...');
          await this.scrollToBottom();
          console.log('[google-login] İkinci izin ekranı — tekrar "Allow/Devam" tıklanıyor...');
          await secondAllow.scrollIntoViewIfNeeded().catch(() => {});
          await secondAllow.click({ force: true });
          await this.safePause(1500);
        }
      }

      return true;
    }

    console.log('[google-login] İzin ekranı bulunamadı veya otomatik geçildi.');
    return true;
  }

  /**
   * Hesap seçme ekranında doğru hesabı seçer (zaten giriş yapılmışsa).
   */
  async handleAccountChooser(email: string): Promise<boolean> {
    if (this.isGone()) return true;

    // Hesap seçme ekranı mı?
    const accountOption = this.page.locator(`[data-email="${email}"]`)
      .or(this.page.locator('li, div[role="link"]').filter({ hasText: email }))
      .first();

    if (await accountOption.isVisible().catch(() => false)) {
      console.log(`[google-login] Hesap seçme ekranı — "${email}" seçiliyor...`);
      await accountOption.click();
      await this.safePause(2000);
      return true;
    }

    // "Use another account" / "Başka bir hesap kullan"
    const useAnother = this.page.getByText(/Use another account|Başka bir hesap kullan/i).first();
    if (await useAnother.isVisible().catch(() => false)) {
      console.log('[google-login] "Başka bir hesap kullan" tıklanıyor...');
      await useAnother.click();
      await this.safePause(2000);
      return false; // E-posta giriş ekranına dönecek
    }

    return false;
  }

  /**
   * Tam otomatik Google OAuth giriş akışı.
   * E-posta → Şifre → 2FA (TOTP) → İzin (Consent) → Tamamlandı
   */
  async completeOAuthLogin(): Promise<boolean> {
    try {
      const { user, password, totpSecret } = GoogleLoginPage.getCredentials();

      // 0. Google bot algılamasını atlatmak için otomasyon izlerini gizle
      await this.page.context().addInitScript(() => {
        // navigator.webdriver'ı gizle
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        // Chrome runtime ekle (Google bunu kontrol ediyor)
        (window as any).chrome = { runtime: {} };
        // Permissions API'yi düzelt
        const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
        if (originalQuery) {
          (window.navigator.permissions as any).query = (parameters: any) =>
            parameters.name === 'notifications'
              ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
              : originalQuery(parameters);
        }
      }).catch(() => {});
      // Mevcut sayfada da çalıştır
      await this.page.evaluate(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        (window as any).chrome = { runtime: {} };
      }).catch(() => {});
      console.log('[google-login] Otomasyon tespiti gizleme uygulandı.');

      // 1. Google giriş sayfasının yüklenmesini bekle
      const loginReady = await this.waitForLoginPage();
      if (!loginReady) return false;

      // 2. Hesap seçme ekranı varsa handle et
      const accountSelected = await this.handleAccountChooser(user);
      if (this.isGone()) return true;

      // 3. E-posta girişi (hesap seçme yoksa veya "başka hesap" seçildiyse)
      const emailVisible = await this.emailInput.isVisible().catch(() => false);
      if (emailVisible) {
        await this.enterEmail(user);
        if (this.isGone()) return true;
      }

      // 4. Şifre girişi
      // Not: Eğer önceden cookie'ler yüklenmişse doğrudan Consent ekranına geçebiliriz,
      // bu yüzden şifre alanını çok uzun süre bekleyip testi yavaşlatmayalım (3000ms yeterlidir).
      const passwordVisible = await this.passwordInput
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false);

      if (passwordVisible) {
        await this.enterPassword(password);
        if (this.isGone()) return true;
      }

      // 5. 2FA kontrolü
      const twoFaMethod = await this.detectTwoFactorMethod();

      if (twoFaMethod === 'totp') {
        const totpOk = await this.enterTotpCode(totpSecret);
        if (!totpOk) {
          console.error('[google-login] TOTP doğrulama başarısız!');
          return false;
        }
        if (this.isGone()) return true;
      } else if (twoFaMethod === 'sms' || twoFaMethod === 'prompt') {
        console.error(`[google-login] ${twoFaMethod.toUpperCase()} doğrulaması algılandı — bu yöntem otomatize edilemez!`);
        console.error('[google-login] Google hesabında 2FA yöntemini "Authenticator App" olarak değiştirin.');
        return false;
      }

      // 6. İzin (consent) ekranı
      await this.safePause(500);
      if (!this.isGone()) {
        await this.handleConsentScreen();
      }

      if (this.isGone()) {
        console.log('[google-login] ✅ Google OAuth giriş ve izin başarıyla tamamlandı!');
        return true;
      }

      // Son kontrol — hala Google sayfasında mıyız?
      const currentUrl = this.page.url();
      if (/accounts\.google\.com/i.test(currentUrl)) {
        console.log(`[google-login] ⚠️ Hala Google sayfasında: ${currentUrl}`);
        // Son bir kez consent/redirect bekleme
        await this.page.waitForURL(/gitsec\.io/i, { timeout: 15_000 }).catch(() => {});
      }

      console.log('[google-login] ✅ Google OAuth akışı tamamlandı.');
      return true;

    } catch (error) {
      console.error('[google-login] ❌ Google OAuth giriş hatası:', error);
      return false;
    }
  }
}
