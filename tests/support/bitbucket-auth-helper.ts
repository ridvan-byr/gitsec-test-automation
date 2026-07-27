import fs from 'fs';
import path from 'path';
import { requireEnv } from './require-env';
import { GoogleLoginPage } from '../pages/GoogleLoginPage';
import { pollAtlassianEmailOtp } from './atlassian-email-otp';

export async function injectSavedGoogleSession(context: any): Promise<boolean> {
  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
  if (!fs.existsSync(googleSessionPath)) {
    console.log('[POM] Kayıtlı Google/Atlassian oturum dosyası bulunamadı. Bitbucket bağlantısından önce Oturum Hazırlığı kartını kullanabilirsiniz.');
    return false;
  }

  try {
    const sessionData = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
    const cookies = sessionData.cookies || [];
    if (cookies.length === 0) {
      console.log('[POM] Kayıtlı oturum dosyasında çerez bulunamadı. Lütfen oturumu tazeleyin.');
      return false;
    }

    await context.addCookies(cookies);
    console.log(`[POM] Kayıtlı Google/Atlassian oturum çerezleri Bitbucket pencerelerine aktarıldı (${cookies.length} adet çerez).`);
    return true;
  } catch (error: any) {
    console.warn(`[POM] Kayıtlı oturum çerezleri okunamadı: ${error?.message || error}`);
    return false;
  }
}

export async function saveGoogleSessionFromContext(context: any): Promise<void> {
  try {
    const cookies = await context.cookies();
    const googleCookies = cookies.filter((c: any) => 
      c.domain.includes('google') || c.domain.includes('atlassian')
    );

    if (googleCookies.length > 0) {
      const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
      fs.writeFileSync(googleSessionPath, JSON.stringify({ cookies: googleCookies }, null, 2));
      console.log(`💾 [GOOGLE] Taze Google oturum çerezleri otomatik saklandı (${googleCookies.length} cookies).`);
    }
  } catch (e: any) {
    console.warn(`[POM] Google oturum çerezleri saklanamadı: ${e?.message || e}`);
  }
}

export async function handleBitbucketAuthPopup(popup: any): Promise<boolean> {
  await popup.waitForLoadState('domcontentloaded').catch(() => {});

  // 1. Önceden saklanmış Google/Atlassian çerezlerini enjekte et
  const hasInjectedCookies = await injectSavedGoogleSession(popup.context()).catch(() => false);

  let credentials = { user: '', password: '', totpSecret: '' };
  try {
    credentials = GoogleLoginPage.getCredentials();
  } catch (e) {
    // fallback
  }

  const e2eEmail = requireEnv('BITBUCKET_TEST_USER');
  const e2ePassword = requireEnv('BITBUCKET_TEST_PASSWORD');

  let directLoginAttempted = false;
  let googleSsoTriggered = false;
  const startTime = Date.now();

  while (Date.now() - startTime < 50000 && !popup.isClosed()) {
    const currentUrl = popup.url();

    // A) Atlassian Giriş Ekranı (id.atlassian.com/login)
    if (/atlassian\.com\/login/i.test(currentUrl) || /id\.atlassian\.com/i.test(currentUrl)) {
      // reCAPTCHA veya Robot denetim uyarısı varsa doğrudan Google SSO'ya geç
      const captchaMsg = popup.locator('text=/confirm you\'re not a robot|make sure it\'s really you|reCAPTCHA|doğrulamasında sorun|security check|robot/i').first();
      const hasCaptcha = await captchaMsg.isVisible().catch(() => false);

      if (hasCaptcha) {
        console.log('⚠️ [ATLASSIAN] Captcha / Robot güvenlik denetimi algılandı ("Please confirm you\'re not a robot") — Otomatik Google SSO Fallback tetikleniyor...');
        googleSsoTriggered = true;
      }

      // 1. Birincil Yol (Primary): Atlassian E-posta Girişi
      const emailInput = popup.locator('input[name="username"], input[id="username"], input[type="email"]').first();
      const isEmailVisible = await emailInput.isVisible().catch(() => false);

      if (isEmailVisible && !directLoginAttempted && !googleSsoTriggered) {
        console.log(`🚀 [ATLASSIAN BİRİNCİL GİRİŞ] E-posta giriliyor: ${e2eEmail}`);
        await emailInput.fill(e2eEmail).catch(() => {});
        const continueBtn = popup
          .locator('#login-submit, button[type="submit"]')
          .or(popup.getByRole('button', { name: /continue|ileri|devam/i }))
          .first();

        if (await continueBtn.isVisible().catch(() => false)) {
          await continueBtn.click({ force: true }).catch(() => {});
          directLoginAttempted = true;
          await popup.waitForTimeout(1000);

          // E-posta gönderildikten hemen sonra robot uyarısı çıktı mı?
          const postCaptcha = await captchaMsg.isVisible().catch(() => false);
          if (postCaptcha) {
            console.log('⚠️ [ATLASSIAN] E-posta sonrası Robot uyarısı belirdi — ANINDA "Google ile Devam Et" butonuna geçiliyor!');
            googleSsoTriggered = true;
          }
        }
      }

      // 2. Birincil Yol: Atlassian Şifre Girişi
      const passInput = popup.locator('input[name="password"], input[id="password"], input[type="password"]').first();
      const isPassVisible = await passInput.isVisible().catch(() => false);

      if (isPassVisible && !googleSsoTriggered) {
        console.log('🚀 [ATLASSIAN BİRİNCİL GİRİŞ] Şifre giriliyor ve Oturum Açılıyor...');
        await passInput.fill(e2ePassword).catch(() => {});
        const loginBtn = popup
          .locator('#login-submit, button[type="submit"]')
          .or(popup.getByRole('button', { name: /log in|giriş/i }))
          .first();

        if (await loginBtn.isVisible().catch(() => false)) {
          await loginBtn.click({ force: true }).catch(() => {});
          await popup.waitForTimeout(2000);
        }
      }

      // 2b) Atlassian E-posta Doğrulama Kodu (MFA) Ekranı ("We've emailed you a code")
      const mfaHeading = popup.locator('text=/We\'ve emailed you a code|Check your email to continue/i').first();
      const isMfaVisible = (await mfaHeading.isVisible().catch(() => false)) || /atlassian\.com\/login\/mfa/i.test(currentUrl);

      if (isMfaVisible) {
        console.log('📧 [ATLASSIAN MFA] E-posta doğrulama ekranı tespit edildi ("We\'ve emailed you a code"). IMAP ile 6 haneli kod alınıyor...');
        try {
          const otpCode = await pollAtlassianEmailOtp({ maxWaitMs: 30000 });
          console.log(`🚀 [ATLASSIAN MFA] IMAP ile doğrulama kodu başarıyla alındı: ${otpCode}`);

          const codeInputs = popup.locator('input[type="text"], input[type="tel"], input[name*="code"], input[id*="code"], input[autocomplete="one-time-code"]');
          const count = await codeInputs.count().catch(() => 0);

          if (count === 6) {
            for (let i = 0; i < 6; i++) {
              await codeInputs.nth(i).fill(otpCode[i]).catch(() => {});
            }
          } else if (count > 0) {
            await codeInputs.first().fill(otpCode).catch(() => {});
          } else {
            await popup.keyboard.type(otpCode).catch(() => {});
          }

          await popup.waitForTimeout(300);
          const verifyBtn = popup.locator('button:has-text("Verify"), button[type="submit"], #mfa-submit').first();
          if (await verifyBtn.isVisible().catch(() => false)) {
            console.log('👆 [ATLASSIAN MFA] "Verify" butonuna basılıyor...');
            await verifyBtn.click({ force: true }).catch(() => {});
          } else {
            await popup.keyboard.press('Enter').catch(() => {});
          }
          await popup.waitForTimeout(3000).catch(() => {});
        } catch (err: any) {
          console.log(`⚠️ [ATLASSIAN MFA] Kod otomatik alınamadı veya girilemedi: ${err?.message}`);
        }
      }

      // 3. Yedek Yol (Fallback): "Google ile Devam Et" SSO Butonu
      if ((!isEmailVisible && !isPassVisible && !popup.isClosed()) || googleSsoTriggered) {
        const googleBtn = popup
          .locator('#google-signin-button, #social-login-google, button[data-testid*="google"], button[value="google"]')
          .or(popup.getByRole('button', { name: /^google$/i }))
          .or(popup.locator('button').filter({ hasText: /^google$/i }))
          .first();

        if (await googleBtn.isVisible().catch(() => false)) {
          console.log('👆 [ATLASSIAN YEDEK GİRİŞ] "Google ile Devam Et" SSO butonuna tıklandı.');
          await googleBtn.click({ force: true }).catch(() => {});
          googleSsoTriggered = true;
          await popup.waitForTimeout(2000);
        }
      }
    }

    // B) Google Oturum Açma Ekranı (accounts.google.com) - Fallback Çalıştığında
    if (/accounts\.google\.com/i.test(currentUrl)) {
      console.log('[google-login] Google OAuth yönlendirmesi algılandı. Çerezler ve oturum kontrol ediliyor...');

      // 1. Doğrudan Onay / Hesap Seçimi
      const accountChoice = popup
        .locator('div[data-email], div[data-identifier], div[data-account-id], li[data-authuser], div[role="link"], li')
        .filter({ hasText: new RegExp(credentials.user, 'i') })
        .or(popup.locator('span.VfPpkd-vQzf8d, [jsname="V67aGc"], button').filter({ hasText: /Devam Et|Allow|Continue/i }))
        .first();

      if (await accountChoice.isVisible().catch(() => false)) {
        console.log('⚡ [GOOGLE SSO] Kayıtlı Google oturumu bulundu — Hesap/Devam Et butonuna tıklandı!');
        await accountChoice.click({ force: true }).catch(() => {});
        await popup.waitForTimeout(2000);
      } else {
        // 2. Çerez Süresi Dolmuş mu? (Fail-Fast ve Self-Healing Denetimi)
        const googleEmailInput = popup.locator('input[type="email"], input[name="identifier"]').first();
        const isFreshGoogleLoginNeeded = await googleEmailInput.isVisible().catch(() => false);

        if (isFreshGoogleLoginNeeded) {
          if (credentials.totpSecret) {
            console.log('🛡️ [SELF-HEALING] Google çerez süresi dolmuş ancak TOTP Secret mevcut — Tam otomatik Google girişi yapılıyor...');
            await googleEmailInput.fill(credentials.user).catch(() => {});
            const nextBtn = popup.locator('#identifierNext').or(popup.getByRole('button', { name: /Next|İleri|Sonraki/i })).first();
            await nextBtn.click({ force: true }).catch(() => {});
            await popup.waitForTimeout(2000);

            const googlePassInput = popup.locator('input[type="password"], input[name="Passwd"]').first();
            if (await googlePassInput.isVisible().catch(() => false)) {
              await googlePassInput.fill(credentials.password).catch(() => {});
              const passNextBtn = popup.locator('#passwordNext').or(popup.getByRole('button', { name: /Next|İleri|Sonraki/i })).first();
              await passNextBtn.click({ force: true }).catch(() => {});
              await popup.waitForTimeout(2500);
            }

            const totpInput = popup.locator('input[name="totpPin"], input[type="tel"]').first();
            if (await totpInput.isVisible().catch(() => false)) {
              const totpCode = GoogleLoginPage.generateTotpCode(credentials.totpSecret);
              console.log(`🚀 [SELF-HEALING] 2FA TOTP kodu otomatik üretildi ve girildi: ${totpCode}`);
              await totpInput.fill(totpCode).catch(() => {});
              await popup.keyboard.press('Enter').catch(() => {});
              await popup.waitForTimeout(2500);
            }
          } else {
            console.error('\n🚨 [FAIL-FAST UYARISI] Atlassian direkt girişi tamamlanamadı VE Google oturum çerezinin süresi dolmuş!');
            console.error('👉 Aksiyon: Lütfen Dashboard üzerindeki "Google Oturum Hazırlığı" kartındaki "Oturumu Yenile" butonuna basarak Google çerezlerini tazeleyin.\n');
            throw new Error('BITBUCKET_AUTH_FAILED: Atlassian girişi geçilemedi ve Google oturum çerezi (google-session.json) süresi dolmuş. Lütfen Dashboard üzerindeki Google Oturum Hazırlığı kartından oturumu tazeleyin.');
          }
        }
      }
    }

    // C) Atlassian / Bitbucket "Grant Access" / Authorize Yetki Onayı
    const grantButton = popup
      .getByRole('button', { name: /grant access|authorize|allow|erişime izin ver|yetkilendir|kabul et/i })
      .or(popup.locator('input[type="submit"][value*="Grant"]'))
      .or(popup.locator('input[type="submit"][value*="Authorize"]'))
      .or(popup.locator('button[id*="grant"]'))
      .first();

    if (await grantButton.isVisible().catch(() => false)) {
      console.log('👆 [ATLASSIAN] Bitbucket "Grant access" / "Erişime İzin Ver" butonuna tıklandı.');
      await grantButton.click({ force: true }).catch(() => {});
      await popup.waitForTimeout(2000);
    }

    if (popup.isClosed()) {
      console.log('🎉 [ATLASSIAN] Bitbucket OAuth popup başarıyla kapandı.');
      await saveGoogleSessionFromContext(popup.context());
      return true;
    }

    await popup.waitForTimeout(1000);
  }

  await saveGoogleSessionFromContext(popup.context());
  return popup.isClosed();
}
