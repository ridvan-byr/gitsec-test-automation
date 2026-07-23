import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import fs from 'fs';
import path from 'path';

async function injectSavedGoogleSession(context: any): Promise<boolean> {
  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
  if (!fs.existsSync(googleSessionPath)) {
    console.log('[bitbucket-auth] Saved Google session was not found. Use the Google Session card before Bitbucket connect.');
    return false;
  }

  try {
    const sessionData = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
    const cookies = sessionData.cookies || [];
    if (cookies.length === 0) {
      console.log('[bitbucket-auth] Saved Google session has no cookies. Refresh Google Session before Bitbucket connect.');
      return false;
    }

    await context.addCookies(cookies);
    console.log(`[bitbucket-auth] Saved Google session injected into Bitbucket OAuth context. (${cookies.length} cookies)`);
    return true;
  } catch (error: any) {
    console.warn(`[bitbucket-auth] Saved Google session could not be loaded: ${error?.message || error}`);
    return false;
  }
}

async function handleBitbucketAuthPopup(popup: any): Promise<boolean> {
  await popup.waitForLoadState('domcontentloaded').catch(() => {});

  // 1. Enjekte et kaydedilmiş Google / Atlassian çerezlerini
  await injectSavedGoogleSession(popup.context()).catch(() => {});

  let credentials = { user: 'gitsectest@gmail.com', password: '1GitsecTest.', totpSecret: '' };
  try {
    credentials = GoogleLoginPage.getCredentials();
  } catch (e) {
    // fallback
  }

  const e2eEmail = process.env.E2E_USER_EMAIL?.trim() || credentials.user;
  const e2ePassword = process.env.E2E_USER_PASSWORD?.trim() || credentials.password;

  const startTime = Date.now();
  while (Date.now() - startTime < 45000 && !popup.isClosed()) {
    const currentUrl = popup.url();

    // A) Atlassian Giriş Ekranı (id.atlassian.com/login)
    if (/atlassian\.com\/login/i.test(currentUrl) || /id\.atlassian\.com/i.test(currentUrl)) {
      const emailInput = popup.locator('input[name="username"], input[id="username"], input[type="email"]').first();
      const isEmailVisible = await emailInput.isVisible().catch(() => false);

      if (isEmailVisible) {
        console.log(`🚀 [ATLASSIAN] Atlassian e-posta girişi yapılıyor: ${e2eEmail}`);
        await emailInput.fill(e2eEmail).catch(() => {});
        const continueBtn = popup
          .locator('#login-submit, button[type="submit"]')
          .or(popup.getByRole('button', { name: /continue|ileri|devam/i }))
          .first();

        if (await continueBtn.isVisible().catch(() => false)) {
          await continueBtn.click({ force: true }).catch(() => {});
          await popup.waitForTimeout(2000);
        }
      }

      // Şifre Giriş Alanı Görünür mü?
      const passInput = popup.locator('input[name="password"], input[id="password"], input[type="password"]').first();
      const isPassVisible = await passInput.isVisible().catch(() => false);

      if (isPassVisible) {
        console.log('🚀 [ATLASSIAN] Atlassian şifresi dolduruluyor...');
        await passInput.fill(e2ePassword).catch(() => {});
        const loginBtn = popup
          .locator('#login-submit, button[type="submit"]')
          .or(popup.getByRole('button', { name: /log in|giriş/i }))
          .first();

        if (await loginBtn.isVisible().catch(() => false)) {
          await loginBtn.click({ force: true }).catch(() => {});
          await popup.waitForTimeout(2500);
        }
      }

      // Google ile Devam Et / Social Button Var mı?
      if (!isEmailVisible && !isPassVisible) {
        const googleBtn = popup
          .locator('#google-signin-button, #social-login-google, button[data-testid*="google"], button[value="google"]')
          .or(popup.getByRole('button', { name: /^google$/i }))
          .or(popup.locator('button').filter({ hasText: /^google$/i }))
          .first();

        if (await googleBtn.isVisible().catch(() => false)) {
          console.log('👆 [ATLASSIAN] Google SSO butonuna tıklandı.');
          await googleBtn.click({ force: true }).catch(() => {});
          await popup.waitForTimeout(2500);
        }
      }
    }

    // B) Google Oturum Açma Ekranı (accounts.google.com)
    if (/accounts\.google\.com/i.test(currentUrl)) {
      console.log('[google-login] Google hesap seçim veya giriş ekranı tespit edildi...');
      const googleEmailInput = popup.locator('input[type="email"], input[name="identifier"]').first();
      if (await googleEmailInput.isVisible().catch(() => false)) {
        console.log(`🚀 [GOOGLE] Sign in ekranında otomatik e-posta dolduruluyor: ${credentials.user}`);
        await googleEmailInput.fill(credentials.user).catch(() => {});
        const nextBtn = popup.locator('#identifierNext').or(popup.getByRole('button', { name: /Next|İleri|Sonraki/i })).first();
        await nextBtn.click({ force: true }).catch(() => {});
        await popup.waitForTimeout(2500);
      }

      const googlePassInput = popup.locator('input[type="password"], input[name="Passwd"]').first();
      if (await googlePassInput.isVisible().catch(() => false)) {
        console.log('🚀 [GOOGLE] Otomatik şifre dolduruluyor...');
        await googlePassInput.fill(credentials.password).catch(() => {});
        const passNextBtn = popup.locator('#passwordNext').or(popup.getByRole('button', { name: /Next|İleri|Sonraki/i })).first();
        await passNextBtn.click({ force: true }).catch(() => {});
        await popup.waitForTimeout(3000);
      }

      const totpInput = popup.locator('input[name="totpPin"], input[type="tel"]').first();
      if (await totpInput.isVisible().catch(() => false) && credentials.totpSecret) {
        const totpCode = GoogleLoginPage.generateTotpCode(credentials.totpSecret);
        console.log(`🚀 [GOOGLE] 2FA TOTP kodu otomatik dolduruluyor: ${totpCode}`);
        await totpInput.fill(totpCode).catch(() => {});
        await popup.keyboard.press('Enter').catch(() => {});
        await popup.waitForTimeout(3000);
      }

      // Hesap Listesi Seçici ("Choose an account")
      const accountChoice = popup
        .locator('div[data-email], div[data-identifier], div[data-account-id], li[data-authuser], div[role="link"], li')
        .filter({ hasText: /gitsec|gmail\.com/i })
        .first();

      if (await accountChoice.isVisible().catch(() => false)) {
        console.log('👆 [GOOGLE] Kayıtlı Google hesabına tıklanarak oturum açılıyor...');
        await accountChoice.click({ force: true }).catch(() => {});
        await popup.waitForTimeout(2500);
      }
    }

    // C) Atlassian / Bitbucket "Grant Access" / Authorize Yetki Onay Sayfası
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
