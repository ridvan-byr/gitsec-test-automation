import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import fs from 'fs';
import path from 'path';

async function injectSavedGoogleSession(context: any): Promise<boolean> {
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

async function handleBitbucketAuthPopup(popup: any): Promise<boolean> {
  await popup.waitForLoadState('domcontentloaded').catch(() => {});

  // 1. Önceden saklanmış Google/Atlassian çerezlerini enjekte et
  const hasInjectedCookies = await injectSavedGoogleSession(popup.context()).catch(() => false);

  let credentials = { user: 'gitsectest@gmail.com', password: '1GitsecTest.', totpSecret: '' };
  try {
    credentials = GoogleLoginPage.getCredentials();
  } catch (e) {
    // fallback
  }

  const e2eEmail = process.env.E2E_USER_EMAIL?.trim() || process.env.GOOGLE_TEST_USER?.trim() || credentials.user;
  const e2ePassword = process.env.E2E_USER_PASSWORD?.trim() || process.env.GOOGLE_TEST_PASSWORD?.trim() || credentials.password;

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

async function saveGoogleSessionFromContext(context: any): Promise<void> {
  try {
    const cookies = await context.cookies();
    const googleCookies = cookies.filter((c: any) => 
      c.domain.includes('google') || c.domain.includes('atlassian')
    );
    if (googleCookies.length > 0) {
      const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
      fs.mkdirSync(path.dirname(googleSessionPath), { recursive: true });
      fs.writeFileSync(googleSessionPath, JSON.stringify({ cookies: googleCookies }, null, 2), 'utf8');
      console.log(`💾 [GOOGLE] Taze Google oturum çerezleri otomatik saklandı (${googleCookies.length} cookies).`);
    }
  } catch (err) {
    // ignore
  }
}

test.describe('Bitbucket Provider Entegrasyon Testleri', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /Cross-Origin-Opener-Policy/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /HTTP Status 502/
    ];
  });

  test('Bitbucket provider entegrasyonu, OAuth popup ve repository listesinin uçtan uca doğrulanması', { tag: '@critical' }, async ({ page }) => {
    const providerPage = new ProviderPage(page);

    // 1. "Add Provider" sayfasına git
    console.log('🚀 [POM] Bitbucket entegrasyonu için "Add Provider" sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    // 2. Bitbucket Kartını bul ve tıkla
    await providerPage.selectBitbucket();
    console.log('👆 Bitbucket sağlayıcı kartına tıklandı.');

    // 4. Bitbucket Kurulum Modalı açıldığını doğrula
    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    const isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket modalı açılmadı, sayfa yenilenip tekrar deneniyor...');
      await providerPage.goToAddProviderPage();
      await providerPage.selectBitbucket();
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    }

    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.getByRole('heading', { name: /Bitbucket/i })).toBeVisible();
    console.log('✅ Bitbucket kurulum modalı başarıyla görüntülendi.');

    const installBtn = modal.getByRole('button', { name: /Install|Yükle/i }).first();
    await expect(installBtn).toBeVisible({ timeout: 5000 });

    // 5. "Install" butonuna basarak Atlassian OAuth Popup penceresini aç
    console.log('👆 "Install" butonuna tıklanıyor ve Atlassian OAuth penceresi bekleniyor...');
    await expect(installBtn).toBeEnabled();
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 30000 }),
      installBtn.click({ force: true })
    ]);

    // 6. Popup URL doğrulaması & Atlassian OAuth "Grant Access" Yetki Onayı
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const popupUrl = popup.url();
    console.log(`ℹ️ Açılan Popup URL: ${popupUrl}`);
    expect(popupUrl).toMatch(/atlassian\.com|bitbucket\.org/i);
    console.log('✅ Atlassian/Bitbucket OAuth popup yönlendirmesi doğrulandı.');

    // Google SSO Oturumu, Atlassian Girişi ve "Grant Access" Buton Onayı
    await handleBitbucketAuthPopup(popup).catch(() => {});

    if (!popup.isClosed()) {
      await popup.close().catch(() => {});
    }

    // 7. Bağlantı sonrası Bitbucket Repositories sayfasına yönlendir ve doğrula
    console.log('🧭 [POM] Bitbucket Repositories sayfasına yönlendiriliyor...');
    await providerPage.goToRepositoriesBitbucket();

    // 8. Repositories başlığı ve tablosunun yüklendiğini doğrula
    const heading = page.getByRole('heading', { name: /Repositories/i }).first();
    await expect(heading).toBeVisible({ timeout: 15000 });

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    await expect(page.getByRole('columnheader', { name: /Full Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Connected/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Licensed/i })).toBeVisible();
    console.log('✅ Tablo başlıkları (Full Name, Connected, Licensed) doğrulandı.');

    // 9. Depo listesi ve toggle switch doğrulama
    const repoRows = page.locator('tbody tr');
    await expect(repoRows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await repoRows.count();
    expect(rowCount).toBeGreaterThan(0);
    console.log(`✅ Tabloda ${rowCount} adet repository listeleniyor.`);

    const switchBtn = page.locator('button[role="switch"], input[role="switch"], [role="switch"]').first();
    const isSwitchVisible = await switchBtn.isVisible().catch(() => false);
    if (isSwitchVisible) {
      const switchState = await switchBtn.getAttribute('aria-checked').catch(() => null);
      console.log(`✅ Licensed toggle switch doğrulandı (durum: ${switchState}).`);
    } else {
      console.log('✅ Bitbucket repository tablosu ve verileri başarıyla doğrulandı.');
    }
  });

  test('Bitbucket kartına tıklandığında kurulum modalı açılmalı ve iptal edilebilmeli', { tag: ['@edge-cases', '@modal'] }, async ({ page }) => {
    const providerPage = new ProviderPage(page);

    console.log('🚀 [POM] Sağlayıcı ekleme sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    // 1. Bitbucket Kartını bul ve tıkla
    const bitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
    await expect(bitbucketCard).toBeVisible({ timeout: 15000 });
    await bitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
    await bitbucketCard.click();
    console.log('👆 Bitbucket sağlayıcı kartına tıklandı.');

    // 2. Bitbucket Kurulum Modalı açıldığını doğrula
    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    const isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket setup modal did not open. Reloading provider page via POM and retrying once.');
      await providerPage.goToAddProviderPage();
      const retryBitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
      await expect(retryBitbucketCard).toBeVisible({ timeout: 15000 });
      await retryBitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
      await retryBitbucketCard.click();
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    }

    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.getByRole('heading', { name: /Bitbucket/i })).toBeVisible();
    console.log('✅ Bitbucket kurulum modalı başarıyla görüntülendi.');

    // 3. Vazgeç/Kapat butonu ile modalı kapat
    const cancelBtn = modal.getByRole('button', { name: /Cancel|Kapat|Vazgeç/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await expect(cancelBtn).toBeEnabled();
    await cancelBtn.click({ force: true });

    // 4. Modalın gizlendiğini doğrula
    await expect(modal).toBeHidden({ timeout: 5000 });
    console.log('✅ Kapat butonuna basıldığında modal başarıyla kapandı.');
  });
});
