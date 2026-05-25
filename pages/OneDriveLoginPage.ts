import { Page, Locator } from '@playwright/test';
import { pollMicrosoftEmailOtp } from '../tests/support/microsoft-email-otp';

export class OneDriveLoginPage {
  readonly page: Page;

  readonly emailInput: Locator;
  readonly nextBtn: Locator;
  readonly otpInput: Locator;

  constructor(page: Page) {
    this.page = page;

    // Microsoft login form selectors
    this.emailInput = page.locator('input[type="email"]')
      .or(page.locator('input[name="loginfmt"]'))
      .or(page.locator('#i0116'))
      .first();

    this.nextBtn = page.locator('#idSIButton9')
      .or(page.locator('input[type="submit"]'))
      .or(page.getByRole('button', { name: /Next|İleri|Sonraki/i }))
      .first();

    this.otpInput = page.locator('input[name="otc"]')
      .or(page.locator('#idTxtBx_SAOTCC_OTC'))
      .or(page.locator('#idTxtBx_SAOTCS_OTC'))
      .or(page.locator('input[type="tel"]'))
      .or(page.locator('input[name="otcPin"]'))
      .or(page.locator('input[placeholder*="code" i]'))
      .or(page.locator('input[placeholder*="kod" i]'))
      .or(page.locator('input[aria-label*="code" i]'))
      .or(page.locator('input[aria-label*="kod" i]'))
      .or(page.locator('input[type="text"]').filter({ hasText: /code|kod/i }))
      .first();
  }

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
   * E-posta adresini girer ve İleri'ye tıklar.
   */
  async enterEmail(email: string): Promise<void> {
    console.log(`[onedrive-login] E-posta giriliyor: ${email}`);
    await this.emailInput.waitFor({ state: 'visible', timeout: 15_000 });
    await this.emailInput.click();
    await this.emailInput.fill(email);
    await this.safePause(500);

    await this.nextBtn.click();
    console.log('[onedrive-login] E-posta girildi, İleri tıklandı.');
    await this.safePause(3000);
  }

  /**
   * "Send Code" / "Kod Gönder" butonunu bulup tıklar.
   */
  async clickSendCode(): Promise<void> {
    console.log('[onedrive-login] "Send Code" / "Kod Gönder" butonu aranıyor...');
    
    const sendCodeBtn = this.page.locator('input[type="submit"][value*="Send code"]')
      .or(this.page.locator('input[type="submit"][value*="Send Code"]'))
      .or(this.page.locator('input[type="submit"][value*="gönder"]'))
      .or(this.page.locator('input[type="submit"][value*="Gönder"]'))
      .or(this.page.getByRole('button', { name: /Send code|Kod gönder|gönder/i }))
      .or(this.page.locator('#idSIButton9'))
      .first();

    await sendCodeBtn.waitFor({ state: 'visible', timeout: 15_000 });
    console.log('[onedrive-login] "Send Code" butonu bulundu, clicking...');
    await sendCodeBtn.click();
    await this.safePause(3000);
  }

  /**
   * OTP Kodunu girer ve doğrular.
   */
  async enterOtpCode(code: string): Promise<void> {
    console.log(`[onedrive-login] OTP Kodu giriliyor: ${code}`);
    
    // Wait for the input to be attached first
    await this.otpInput.waitFor({ state: 'attached', timeout: 20_000 });
    await this.otpInput.scrollIntoViewIfNeeded().catch(() => {});
    
    // Split (6 haneli ayrı kutu) olup olmadığını kontrol et
    const allOtcInputs = this.page.locator('input[name="otc"]')
      .or(this.page.locator('#idTxtBx_SAOTCC_OTC'))
      .or(this.page.locator('#idTxtBx_SAOTCS_OTC'))
      .or(this.page.locator('input[type="tel"]'))
      .or(this.page.locator('input[name="otcPin"]'))
      .or(this.page.locator('input[placeholder*="code" i]'))
      .or(this.page.locator('input[placeholder*="kod" i]'))
      .or(this.page.locator('input[maxlength="1"]'));

    const inputCount = await allOtcInputs.count().catch(() => 0);
    console.log(`[onedrive-login] Tespit edilen OTP input sayısı: ${inputCount}`);

    let fillSuccess = false;

    if (inputCount >= 6) {
      console.log('[onedrive-login] Split (6 haneli ayrı kutu) OTP alanı tespit edildi. Haneler sırayla giriliyor...');
      try {
        for (let i = 0; i < 6; i++) {
          const digitInput = allOtcInputs.nth(i);
          const char = code[i] || '';
          if (char) {
            await digitInput.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
            await digitInput.fill(char, { timeout: 2000 });
            await this.safePause(50);
          }
        }
        fillSuccess = true;
        console.log('[onedrive-login] Ayrı kutular Playwright fill() ile başarıyla dolduruldu.');
      } catch (err) {
        console.log('[onedrive-login] Ayrı kutulara Playwright fill() başarısız oldu, programatik split doldurma denenecek...', (err as any).message);
      }

      // Sadece Playwright fill() başarısız olduysa programmatic fallback'i çalıştır
      if (!fillSuccess) {
        try {
          await this.page.evaluate((otpVal) => {
            const inputs = Array.from(document.querySelectorAll('input')).filter(i => {
              const type = i.type;
              const isVisible = i.offsetWidth > 0 && i.offsetHeight > 0;
              return isVisible && (type === 'text' || type === 'tel' || type === 'number');
            });
            
            const otpDigits = inputs.filter(i => {
              const isOtc = i.name?.toLowerCase().includes('otc') || i.id?.toLowerCase().includes('otc') || i.className?.toLowerCase().includes('otc');
              const isSingle = i.getAttribute('maxlength') === '1' || i.style.width === '1em' || i.style.width === '2em';
              return isOtc || isSingle;
            });

            if (otpDigits.length >= 6) {
              for (let i = 0; i < 6; i++) {
                if (otpDigits[i] && otpVal[i]) {
                  otpDigits[i].value = otpVal[i];
                  otpDigits[i].dispatchEvent(new Event('input', { bubbles: true }));
                  otpDigits[i].dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
              console.log('[onedrive-login] DOM split inputlar başarıyla dolduruldu.');
            }
          }, code);
          fillSuccess = true;
        } catch (evaluateErr) {
          console.log('[onedrive-login] DOM split doldurma fallback hatası (muhtemelen yönlendirme başladı):', (evaluateErr as any).message);
        }
      }

    } else {
      // Tek bir input alanı varsa
      console.log('[onedrive-login] Tek bir OTP giriş alanı mevcut. Tümü dolduruluyor...');
      try {
        await this.otpInput.waitFor({ state: 'visible', timeout: 5000 });
        await this.otpInput.click({ timeout: 3000 });
        await this.otpInput.fill(code, { timeout: 5000 });
        fillSuccess = true;
      } catch (err) {
        console.log('[onedrive-login] Playwright fill() başarısız oldu, programatik değer aktarımı denenecek...', err);
        // Fallback: programmatic value setting
        try {
          await this.page.evaluate((c) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const otpInput = inputs.find(i => 
              i.name?.includes('otc') || 
              i.id?.includes('OTC') || 
              i.type === 'tel' || 
              i.placeholder?.toLowerCase().includes('code') ||
              i.placeholder?.toLowerCase().includes('kod')
            );
            if (otpInput) {
              otpInput.value = c;
              otpInput.dispatchEvent(new Event('input', { bubbles: true }));
              otpInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }, code);
          fillSuccess = true;
        } catch (evaluateErr) {
          console.log('[onedrive-login] DOM tekli input doldurma fallback hatası:', (evaluateErr as any).message);
        }
      }
    }

    await this.safePause(500);

    // split OTP (6 hane) otomatik olarak formu gönderir. Bu yüzden OTP inputu hala sayfadaysa veya yönlenme başlamadıysa buton tıklanır.
    // Tekli OTP alanında ise her zaman buton tıklanmalıdır.
    let shouldClickVerify = true;
    if (inputCount >= 6 && fillSuccess) {
      // Eğer split OTP başarıyla girildiyse, sayfa muhtemelen çoktan yönlenmeye başladı veya yönlendi.
      // Kontrol edelim: OTP inputu hala görünür/aktif mi?
      const isOtcInputStillVisible = await allOtcInputs.first().isVisible().catch(() => false);
      if (!isOtcInputStillVisible) {
        console.log('[onedrive-login] Split OTP girildikten sonra otomatik yönlendirme başladı. Doğrula butonuna tıklama atlanıyor.');
        shouldClickVerify = false;
      }
    }

    if (shouldClickVerify) {
      const verifyBtn = this.page.locator('#idSIButton9')
        .or(this.page.locator('input[type="submit"]'))
        .or(this.page.getByRole('button', { name: /Sign in|Oturum aç|Doğrula|Verify/i }))
        .first();

      try {
        const isVisible = await verifyBtn.waitFor({ state: 'visible', timeout: 4000 })
          .then(() => true)
          .catch(() => false);
        
        if (isVisible) {
          console.log('[onedrive-login] Doğrula butonu görünür, tıklanıyor...');
          await verifyBtn.click({ timeout: 4000 }).catch((e) => {
            console.log('[onedrive-login] Doğrula butonuna tıklanırken hata (muhtemelen yönlendirme başladı):', (e as any).message);
          });
        } else {
          console.log('[onedrive-login] Doğrula butonu görünür değil, adım atlanıyor.');
        }
      } catch (e) {
        console.log('[onedrive-login] Doğrula butonu beklenirken/tıklanırken hata oluştu:', (e as any).message);
      }
    }

    await this.safePause(4000);
  }

  /**
   * "Stay signed in?" / "Oturumunuz açık kalsın mı?" ekranını onaylar.
   */
  async handleStaySignedIn(): Promise<void> {
    if (this.isGone()) return;

    console.log('[onedrive-login] "Stay signed in?" / "Oturumunuz açık kalsın mı?" ekranı kontrol ediliyor...');

    // Hem modern Fluent UI butonunu hem de eski submit inputunu destekleyen seçici grubu
    const yesBtn = this.page.locator('#idSIButton9, button[data-testid="primaryButton"], input[type="submit"], input[value="Yes"], input[value="Evet"], button:has-text("Yes"), button:has-text("Evet")').first();
    const isBtnVisible = await yesBtn.waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    if (!isBtnVisible) {
      console.log('[onedrive-login] "Stay signed in" butonu görünür olmadı veya otomatik geçildi.');
      return;
    }

    console.log('[onedrive-login] "Stay signed in" butonu bulundu. Onaylama döngüsü başlatılıyor...');

    // Döngü ile buton kaybolana kadar veya sayfa değişene kadar tıklamayı deneyelim
    for (let attempt = 1; attempt <= 6; attempt++) {
      if (this.isGone()) {
        console.log('[onedrive-login] Sayfa kapandı, döngü sonlandırıldı.');
        return;
      }

      // Butonun hala görünür olduğunu kontrol et
      const visible = await yesBtn.isVisible().catch(() => false);
      if (!visible) {
        console.log('[onedrive-login] "Yes" butonu artık görünür değil, "Stay signed in" adımı başarıyla geçildi.');
        break;
      }

      console.log(`[onedrive-login] "Yes" tıklama denemesi #${attempt}...`);
      
      let clickSuccess = false;
      // Playwright click
      try {
        await yesBtn.click({ timeout: 4000 });
        console.log(`[onedrive-login] Playwright click denemesi #${attempt} başarılı.`);
        clickSuccess = true;
      } catch (err) {
        console.log(`[onedrive-login] Playwright click denemesi #${attempt} başarısız:`, (err as any).message);
      }

      if (this.isGone()) {
        console.log('[onedrive-login] Sayfa kapandı, döngü sonlandırıldı.');
        return;
      }

      // Sadece Playwright click başarısız olduysa DOM-level click dene
      if (!clickSuccess) {
        try {
          const clickedViaDom = await this.page.evaluate(() => {
            const btn = (
              document.querySelector('#idSIButton9') || 
              document.querySelector('button[data-testid="primaryButton"]') ||
              document.querySelector('input[type="submit"]')
            ) as HTMLInputElement | HTMLButtonElement | null;
            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
              btn.click();
              return true;
            }
            const inputs = Array.from(document.querySelectorAll('input[type="submit"], button, input[type="button"]')) as (HTMLInputElement | HTMLButtonElement)[];
            const yBtn = inputs.find(i => {
              const val = (i.value || i.textContent || '').toLowerCase().trim();
              const isVisible = i.offsetWidth > 0 && i.offsetHeight > 0;
              const isPrimary = i.getAttribute('data-testid') === 'primaryButton';
              return isVisible && (isPrimary || val === 'yes' || val === 'evet' || val.includes('yes') || val.includes('evet'));
            });
            if (yBtn) {
              yBtn.click();
              return true;
            }
            return false;
          });
          console.log(`[onedrive-login] DOM-level click denemesi #${attempt} sonucu: ${clickedViaDom}`);
        } catch (domErr) {
          console.log(`[onedrive-login] DOM-level click denemesi #${attempt} hatası:`, (domErr as any).message);
        }
      }

      await this.safePause(2000);
    }
  }

  /**
   * Erişim İzni / Consent ekranını onaylar.
   */
  async handleConsentScreen(): Promise<boolean> {
    if (this.isGone()) return true;

    console.log('[onedrive-login] Erişim izni ekranı bekleniyor...');

    const acceptBtn = this.page.locator('#idBtn_Accept, #uc-accept, button[data-testid="primaryButton"], input[type="submit"][value*="Accept"], input[type="submit"][value*="Kabul"], input[type="submit"][value*="Yes"], input[type="submit"][value*="Evet"], button:has-text("Accept"), button:has-text("Kabul et"), button:has-text("İzin ver")').first();

    const isBtnVisible = await acceptBtn.waitFor({ state: 'visible', timeout: 25_000 })
      .then(() => true)
      .catch(() => false);

    if (!isBtnVisible) {
      console.log('[onedrive-login] Kabul Et butonu görünür olmadı veya otomatik geçildi.');
      return false;
    }

    console.log('[onedrive-login] Kabul Et / İzin Ver butonu bulundu. Onaylama döngüsü başlatılıyor...');

    for (let attempt = 1; attempt <= 6; attempt++) {
      if (this.isGone()) {
        console.log('[onedrive-login] Sayfa kapandı, döngü sonlandırıldı.');
        return true;
      }

      const visible = await acceptBtn.isVisible().catch(() => false);
      if (!visible) {
        console.log('[onedrive-login] Kabul Et butonu artık görünür değil, "Consent" adımı başarıyla geçildi.');
        break;
      }

      console.log(`[onedrive-login] Kabul Et tıklama denemesi #${attempt}...`);

      let clickSuccess = false;
      try {
        await acceptBtn.click({ timeout: 4000 });
        console.log(`[onedrive-login] Playwright Kabul Et click denemesi #${attempt} başarılı.`);
        clickSuccess = true;
      } catch (err) {
        console.log(`[onedrive-login] Playwright Kabul Et click denemesi #${attempt} başarısız:`, (err as any).message);
      }

      if (this.isGone()) {
        console.log('[onedrive-login] Sayfa kapandı, döngü sonlandırıldı.');
        return true;
      }

      // Sadece Playwright click başarısız olduysa DOM-level click dene
      if (!clickSuccess) {
        try {
          const clickedViaDom = await this.page.evaluate(() => {
            const btn = (
              document.querySelector('#idBtn_Accept') || 
              document.querySelector('#uc-accept') ||
              document.querySelector('button[data-testid="primaryButton"]')
            ) as HTMLInputElement | HTMLButtonElement | null;
            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
              btn.click();
              return true;
            }
            const inputs = Array.from(document.querySelectorAll('input[type="submit"], button, input[type="button"]')) as (HTMLInputElement | HTMLButtonElement)[];
            const consentBtn = inputs.find(i => {
              const val = (i.value || i.textContent || '').toLowerCase().trim();
              const isVisible = i.offsetWidth > 0 && i.offsetHeight > 0;
              const isPrimary = i.getAttribute('data-testid') === 'primaryButton';
              return isVisible && (
                isPrimary ||
                val.includes('accept') || 
                val.includes('kabul') || 
                val.includes('izin') || 
                val === 'yes' || 
                val === 'evet'
              );
            });
            if (consentBtn) {
              consentBtn.click();
              return true;
            }
            return false;
          });
          console.log(`[onedrive-login] DOM-level Kabul Et click denemesi #${attempt} sonucu: ${clickedViaDom}`);
        } catch (domErr) {
          console.log(`[onedrive-login] DOM-level Kabul Et click denemesi #${attempt} hatası:`, (domErr as any).message);
        }
      }

      await this.safePause(2000);
    }

    return true;
  }

  /**
   * Tam otomatik Microsoft / OneDrive OAuth giriş akışı.
   */
  async completeOAuthLogin(): Promise<boolean> {
    try {
      const email = process.env.GITHUB_TEST_USER || 'gitsectest@gmail.com';
      const startTime = new Date();

      // 1. E-posta giriş
      await this.enterEmail(email);
      if (this.isGone()) return true;

      // 2. Send Code butona bas
      await this.clickSendCode();
      if (this.isGone()) return true;

      // 3. Gmail'den 6 haneli kodu çek
      console.log('[onedrive-login] Gmail kutusundan Microsoft OTP kodu bekleniyor...');
      const otpCode = await pollMicrosoftEmailOtp({
        minReceivedAt: startTime,
        lookbackMinutes: 5,
        maxWaitMs: 90_000,
      });

      console.log(`[onedrive-login] Gmail'den alınan 6 haneli doğrulama kodu: "${otpCode}"`);

      // 4. Kodu gir
      await this.enterOtpCode(otpCode);
      if (this.isGone()) return true;

      // 4.5. Stay Signed In ekranını onayla
      await this.handleStaySignedIn();
      if (this.isGone()) return true;

      // 5. İzin Ver / Kabul Et
      await this.handleConsentScreen();

      console.log('[onedrive-login] ✅ Microsoft / OneDrive OAuth giriş ve izin başarıyla tamamlandı!');
      return true;
    } catch (error) {
      console.error('[onedrive-login] ❌ OneDrive OAuth giriş hatası:', error);
      return false;
    }
  }
}
