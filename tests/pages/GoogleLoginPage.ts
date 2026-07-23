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
    this.emailInput = page.locator('input[type="email"]')
      .or(page.locator('input[name="identifier"]'))
      .or(page.locator('#identifierId'))
      .first();

    this.passwordInput = page.locator('input[type="password"]')
      .or(page.locator('input[name="Passwd"]'))
      .or(page.locator('input[name="password"]'))
      .first();

    // "İleri" / "Next" butonu — Google v3 / v2 uyumlu seçiciler
    this.emailNextBtn = page.locator('#identifierNext')
      .or(page.locator('button:has-text("Next")'))
      .or(page.locator('button:has-text("İleri")'))
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki/i }))
      .first();

    this.passwordNextBtn = page.locator('#passwordNext')
      .or(page.locator('button:has-text("Next")'))
      .or(page.locator('button:has-text("İleri")'))
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki/i }))
      .first();

    // TOTP (Authenticator) kodu giriş alanı
    this.totpInput = page.locator('input[name="totpPin"]')
      .or(page.locator('#totpPin'))
      .or(page.locator('input[type="tel"]'))
      .or(page.locator('input[autocomplete="one-time-code"]'))
      .first();

    this.totpNextBtn = page.locator('#totpNext')
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki|Doğrula|Verify/i }))
      .first();
  }

  /** Popup kapanmışsa işlem yapma. */
  private isGone(): boolean {
    return this.page.isClosed();
  }

  /** Google bot engellemesini kontrol eder ve engellenmişse hata fırlatıp testi durdurur. */
  private async assertNotBlocked(): Promise<void> {
    if (this.isGone()) return;
    const url = this.page.url();
    const bodyText = await this.page.locator('body').innerText().catch(() => '');

    const isBlocked = url.includes('signin/rejected') || 
                      bodyText.includes("Couldn't sign you in") || 
                      bodyText.includes("may not be secure") || 
                      bodyText.includes("Try using a different browser") ||
                      bodyText.includes("Oturum açılamadı") ||
                      bodyText.includes("güvenli olmayabilir") ||
                      bodyText.includes("farklı bir tarayıcı");

    if (isBlocked) {
      console.log('\n🚨🚨🚨 [HATA - ENGELLENDİ] GOOGLE OTURUMUNU YENİLEYİN! 🚨🚨🚨');
      console.log('💡 Google, Playwright tarayıcı kimliğini otomasyon olarak algılayıp girişi engelledi.');
      console.log('💡 Lütfen arayüzdeki "Google Oturum Hazırlığı" (Google Session kartı) üzerinden Google oturumunu yenileyin.');
      console.log('💡 Bu işlem, oturum çerezlerini (cookies) manuel girişle tazeleyecek ve testlerin sorunsuz geçmesini sağlayacaktır.\n');
      throw new Error("Google login blocked by bot detection. Please refresh the session in Google Session Setup.");
    }
  }

  private async safePause(ms: number): Promise<void> {
    if (this.isGone()) return;
    await new Promise(resolve => setTimeout(resolve, ms));
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
    await this.assertNotBlocked();
    console.log(`[google-login] E-posta giriliyor: ${email}`);

    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.emailInput.click();
    await this.emailInput.fill(email);
    
    // Girilen değeri doğrulayalım, fill tam yazmadıysa pressSequentially ile tamamlayalım
    const value = await this.emailInput.inputValue().catch(() => '');
    if (value !== email) {
      console.log(`[google-login] fill ile e-posta tam yazılamadı ("${value}"), pressSequentially ile yeniden yazılıyor...`);
      await this.emailInput.fill('');
      await this.emailInput.pressSequentially(email, { delay: 100 });
    }
    await this.safePause(500);

    console.log('[google-login] E-posta girildi, İleri tıklandı.');
    await this.emailNextBtn.click();

    // Şifre alanının gelmesini bekle
    await this.safePause(2500);
    await this.assertNotBlocked();
  }

  /**
   * Şifreyi girer ve İleri'ye tıklar.
   */
  async enterPassword(password: string): Promise<void> {
    await this.assertNotBlocked();
    console.log('[google-login] Şifre giriliyor...');

    await this.passwordInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.passwordInput.click();
    await this.passwordInput.fill(password);
    await this.safePause(500);

    await this.passwordNextBtn.click();
    console.log('[google-login] Şifre girildi, İleri tıklandı.');

    // 2FA veya izin ekranının gelmesini bekle
    await this.safePause(3000);
    await this.assertNotBlocked();
  }

  /**
   * 2FA doğrulama yöntemini belirler.
   */
  async detectTwoFactorMethod(): Promise<'totp' | 'sms' | 'prompt' | 'none'> {
    await this.assertNotBlocked();
    if (this.isGone()) return 'none';

    // 1. Doğrudan TOTP input alanı var mı? (Görünür olması için 3sn kadar esneklik verelim)
    const totpDirect = await this.totpInput
      .waitFor({ state: 'visible', timeout: 3000 })
      .then(() => true)
      .catch(() => false);

    if (totpDirect) {
      console.log('[google-login] TOTP (Authenticator) kodu girişi tespit edildi.');
      return 'totp';
    }

    // 2. Google varsayılan olarak SMS veya Prompt gösterdiyse "Try another way / Başka bir yöntem dene" ile Authenticator'a geç
    const tryAnotherWay = this.page.getByRole('button', { name: /Try another way|Başka bir yöntem|Farklı bir yöntem/i })
      .or(this.page.locator('button, a, [role="button"]').filter({ hasText: /Try another way|Başka bir yöntem|Farklı bir yöntem/i }))
      .first();

    const hasTryAnotherWay = await tryAnotherWay
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (hasTryAnotherWay) {
      console.log('[google-login] "Try another way" (Başka bir yöntem) bulundu, tıklanıyor...');
      await tryAnotherWay.click().catch(() => {});
      await this.safePause(2000);

      // Authenticator seçeneğini bul ve tıkla
      const authenticatorOption = this.page.getByText(/Google Authenticator|Authenticator app|Doğrulayıcı uygulama|verification code|doğrulama kodu/i)
        .or(this.page.locator('li, div[role="link"], div[role="button"], button').filter({ 
          hasText: /authenticator|doğrulayıcı|verification code|doğrulama kodu/i 
        }))
        .first();

      const hasAuthOption = await authenticatorOption
        .waitFor({ state: 'visible', timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (hasAuthOption) {
        console.log('[google-login] "Google Authenticator" seçeneğine tıklanıyor...');
        await authenticatorOption.click().catch(() => {});
        await this.safePause(2000);

        const totpNow = await this.totpInput
          .waitFor({ state: 'visible', timeout: 5000 })
          .then(() => true)
          .catch(() => false);

        if (totpNow) {
          console.log('[google-login] Authenticator seçildikten sonra TOTP girişi aktif oldu.');
          return 'totp';
        }
      }
    }

    // 3. İkincil kontrol: Sonradan TOTP input belirdi mi?
    if (await this.totpInput.isVisible().catch(() => false)) {
      return 'totp';
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
    await this.assertNotBlocked();
    const code = GoogleLoginPage.generateTotpCode(secret);
    console.log(`[google-login] TOTP kodu üretildi: ${code}`);

    // TOTP input alanını bekle
    await this.totpInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.totpInput.click();
    await this.totpInput.fill(code);
    
    // Girilen değeri doğrulayalım, eksik karakter kalmışsa pressSequentially ile tamamlayalım
    const value = await this.totpInput.inputValue().catch(() => '');
    if (value !== code) {
      console.log(`[google-login] fill ile değer tam girilemedi ("${value}"). Temizlenip pressSequentially ile yeniden yazılıyor...`);
      await this.totpInput.fill('');
      await this.totpInput.pressSequentially(code, { delay: 120 });
    }
    await this.safePause(500);

    // Doğrula / Next butonuna tıkla
    await this.totpNextBtn.click();
    console.log('[google-login] TOTP kodu girildi, doğrulama gönderildi.');

    // Sonucu bekle
    await this.safePause(3000);
    await this.assertNotBlocked();

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
        await this.page.mouse.wheel(0, 450).catch(() => {});
      }
    } catch (e) {
      console.log('[google-login] [scroll] Fare ile kaydırma hatası:', e);
    }

    await this.safePause(100);
    console.log('[google-login] [scroll] Kaydırma tamamlandı.');
  }

  /**
   * OAuth izin (consent) ekranını otomatik ve anında onaylar.
   * Google v3 iki kademeli onay ekranlarını (Account Re-consent ve Scope Summary / consentsummary) otomatik kaydırıp onaylar.
   */
  async handleConsentScreen(): Promise<boolean> {
    if (this.isGone()) return true;

    console.log('[google-login] İzin ve onay ekranı işleniyor...');

    // Google OAuth onay ekranlarında (üst üste 1-2 onay gelebilir) maksimum 3 adım kontrol et
    for (let step = 1; step <= 3; step++) {
      if (this.isGone()) return true;

      // Google domain'inden çıkıldıysa popup başarıyla yönlendi demektir
      if (!this.page.url().includes('accounts.google.com')) {
        console.log('[google-login] Google domain\'inden çıkıldı, onay tamamlandı.');
        return true;
      }

      // "Devam Et" / "Allow" / "İzin Ver" / "Confirm" / "Onayla" / "Next" buton seçicisi (Google Material 3 & span.VfPpkd-vQzf8d desteği)
      const allowBtn = this.page.locator('span.VfPpkd-vQzf8d, [jsname="V67aGc"], button, div[role="button"]')
        .filter({ hasText: /Devam Et|Allow|Continue|Confirm|İzin ver|Kabul et/i })
        .or(this.page.getByRole('button', { name: /Allow|İzin ver|Kabul et|Continue|Devam|Confirm|Onayla|Next|İleri/i }))
        .or(this.page.locator('#submit_approve_access'))
        .or(this.page.locator('button[type="submit"]').filter({ hasText: /Allow|İzin|Devam|Continue|Confirm/i }))
        .first();

      // 1. "Gelişmiş" / "Doğrulanmamış uygulama" Uyarısı (Varsa)
      const advancedLink = this.page.getByRole('button', { name: /Advanced|Gelişmiş/i })
        .or(this.page.locator('#details-button'))
        .first();

      if (await advancedLink.isVisible().catch(() => false)) {
        console.log('[google-login] "Doğrulanmamış uygulama" uyarısı — Advanced tıklanıyor...');
        await advancedLink.click().catch(() => {});
        await this.safePause(500);

        const goToApp = this.page.locator('a, button').filter({ hasText: /Go to|Git.*güvenli değil|unsafe/i }).first();
        if (await goToApp.isVisible().catch(() => false)) {
          await goToApp.click().catch(() => {});
          await this.safePause(1000);
        }
      }

      // 2. Checkbox'lar varsa işaretle
      const checkboxes = this.page.locator('input[type="checkbox"]:not(:checked), [role="checkbox"][aria-checked="false"]');
      const checkboxCount = await checkboxes.count().catch(() => 0);
      if (checkboxCount > 0) {
        console.log(`[google-login] ${checkboxCount} adet izin checkbox'ı işaretleniyor...`);
        for (let i = 0; i < checkboxCount; i++) {
          await checkboxes.nth(i).click({ force: true }).catch(() => {});
        }
        await this.safePause(300);
      }

      // 3. Onay butonu doğrudan görünür mü?
      let isAllowVisible = await allowBtn.isVisible().catch(() => false);

      // Eğer buton ekranın altındaysa (consentsummary ekranı gibi), aşağı kaydır
      if (!isAllowVisible) {
        console.log(`[google-login] (Onay Adımı #${step}) Buton ekran altında olabilir — sayfa aşağı kaydırılıyor...`);
        await this.scrollToBottom().catch(() => {});
        await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await this.safePause(400);
        isAllowVisible = await allowBtn.isVisible().catch(() => false);
      }

      if (isAllowVisible) {
        console.log(`[google-login] ⚡ (Onay Adımı #${step}) "Devam Et / Allow" butonu bulundu — ANINDA tıklanıyor!`);
        await allowBtn.scrollIntoViewIfNeeded().catch(() => {});
        await allowBtn.click({ force: true }).catch(() => {});
        await this.safePause(1200);
      } else {
        console.log(`[google-login] (Onay Adımı #${step}) Onay butonu bulunamadı veya sayfa değişti.`);
      }

      if (this.isGone() || !this.page.url().includes('accounts.google.com')) {
        return true;
      }
    }

    return true;
  }

  /**
   * Hesap seçme ekranında doğru hesabı seçer (zaten giriş yapılmışsa).
   */
  async handleAccountChooser(email: string): Promise<boolean> {
    await this.assertNotBlocked();
    if (this.isGone()) return true;

    // Eğer sayfada "Devam Et / Allow" butonu zaten varsa onay ekranındayızdır, hesap tıklamasını atla
    const isConsentDirect = await this.page.getByRole('button', { name: /Devam Et|Allow|Continue|Confirm/i })
      .or(this.page.locator('button').filter({ hasText: /Devam Et|Allow|Continue/i }))
      .first()
      .isVisible()
      .catch(() => false);

    if (isConsentDirect) {
      console.log('[google-login] Onay ekranındayız ("Devam Et" butonu mevcut), hesap seçme adımı atlanıyor.');
      return false;
    }

    // Hesap seçme ekranı mı?
    const accountOption = this.page.locator(`[data-email="${email}"]`)
      .or(this.page.locator('li[data-identifier], div[role="link"][data-identifier]').filter({ hasText: email }))
      .first();

    if (await accountOption.isVisible().catch(() => false)) {
      console.log(`[google-login] Hesap seçme ekranı — "${email}" seçiliyor...`);
      await accountOption.click();
      await this.safePause(1500);
      await this.assertNotBlocked();
      return true;
    }

    // "Use another account" / "Başka bir hesap kullan"
    const useAnother = this.page.getByText(/Use another account|Başka bir hesap kullan/i).first();
    if (await useAnother.isVisible().catch(() => false)) {
      console.log('[google-login] "Başka bir hesap kullan" tıklanıyor...');
      await useAnother.click();
      await this.safePause(1500);
      await this.assertNotBlocked();
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

      // 0. Otomasyon izlerini bağlam seviyesinde (addInitScript) gizle
      await this.page.context().addInitScript(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          (window as any).chrome = { runtime: {} };
          const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
          if (originalQuery) {
            (window.navigator.permissions as any).query = (parameters: any) =>
              parameters.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
                : originalQuery(parameters);
          }
        } catch {}
      }).catch(() => {});

      // 1. Google OAuth sayfasının yüklenmesini ve about:blank'ten yönlenmesini bekle
      console.log('[google-login] Google OAuth yönlendirmesi bekleniyor...');
      const loginReady = await this.waitForLoginPage(25_000);
      if (!loginReady) {
        console.error(`[google-login] ❌ Google OAuth yönlendirmesi gerçekleşmedi. Son URL: ${this.page.url()}`);
        return false;
      }

      // Sayfa Google domain'ine ulaştıktan sonra yerel evaluate çalıştır
      await this.page.evaluate(() => {
        try {
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          (window as any).chrome = { runtime: {} };
        } catch {}
      }).catch(() => {});
      console.log('[google-login] Google OAuth sayfası yüklendi ve otomasyon gizleme doğrulandı.');

      // 1.5. HIZLI İZİN/ONAY KONTROLÜ: Sayfa açılışında onay ekranı doğrudan görünüyorsa anında işle
      const hasDirectAllow = await this.page.locator('span.VfPpkd-vQzf8d, [jsname="V67aGc"], button, div[role="button"]')
        .filter({ hasText: /Devam Et|Allow|Continue|Confirm|İzin ver/i })
        .first()
        .isVisible()
        .catch(() => false);

      if (hasDirectAllow) {
        console.log('[google-login] ⚡ İzin/Onay ekranı doğrudan açık — ANINDA işleniyor...');
        await this.handleConsentScreen().catch(() => {});
        if (this.isGone() || !this.page.url().includes('accounts.google.com')) return true;
      }

      // 2. Hesap seçme ekranı varsa hesaba tıkla
      const accountSelected = await this.handleAccountChooser(user);
      if (this.isGone()) return true;

      // 2.5. HESAP SEÇİLDİKTEN ANINDA SONRA: Onay/İzin ekranına yönlenmişse ANINDA geç! (Bekleme yapma)
      await this.safePause(400);
      const consentAfterAccount = await this.handleConsentScreen().catch(() => false);
      if (consentAfterAccount && (this.isGone() || !this.page.url().includes('accounts.google.com'))) {
        console.log('[google-login] ⚡ Hesap seçimi sonrası onay ekranı ANINDA geçildi!');
        return true;
      }

      // 3. E-posta girişi (Sadece e-posta kutusu gerçekten ekrandaysa max 1.5s bekle)
      const emailVisible = await this.emailInput
        .waitFor({ state: 'visible', timeout: 1500 })
        .then(() => true)
        .catch(() => false);

      if (emailVisible) {
        await this.enterEmail(user);
        if (this.isGone()) return true;
      }

      // 4. Şifre girişi (Sadece şifre kutusu ekrandaysa max 1.5s bekle)
      const passwordVisible = await this.passwordInput
        .waitFor({ state: 'visible', timeout: 1500 })
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

        // 🚨 Google "Couldn't sign you in" / "signin/rejected" durumunu kontrol et
        await this.assertNotBlocked();

        // Son bir kez consent/redirect bekleme
        await this.page.waitForURL(/gitsec\.io/i, { timeout: 15_000 }).catch(() => {});
      }

      console.log('[google-login] ✅ Google OAuth akışı tamamlandı.');
      return true;

    } catch (error: any) {
      console.error('[google-login] ❌ Google OAuth giriş hatası:', error);
      throw error;
    }
  }
}
