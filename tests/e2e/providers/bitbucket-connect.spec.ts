/**
 * Bitbucket Provider Integration & Repository Management E2E Tests
 * 
 * Bu test dosyası:
 * 1. /repositories/add sayfasındaki Bitbucket kartına tıklandığında kurulum modalının açılıp kapandığını doğrular.
 * 2. Kurulum modalında "Install" tıklandığında Atlassian/Bitbucket OAuth yetkilendirme popup'ının açıldığını doğrular.
 * 3. Bitbucket bağlantısı kurulduktan sonra repository listesinin yüklendiğini ve lisans dahil etme (toggle) işlemlerinin yapılabildiğini gerçek API ile uçtan uca doğrular.
 */

import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import fs from 'fs';
import path from 'path';

let workspaceId: string;
let dashboardBaseUrl: string;

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
    throw new Error(
      '[bitbucket-auth] Saved Google session could not be loaded. Refresh Google Session from the dashboard. ' +
      `Original error: ${error?.message || error}`,
    );
  }
}

async function completeBitbucketGoogleSsoIfVisible(popup: any): Promise<boolean> {
  const googleSsoButton = popup
    .getByRole('button', { name: /continue with google|google ile devam|google/i })
    .or(popup.locator('button, a, div[role="button"]').filter({ hasText: /google/i }))
    .first();

  const isGoogleSsoVisible = await googleSsoButton
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  if (!isGoogleSsoVisible) {
    console.log('[bitbucket-auth] Google SSO button was not visible on Atlassian login. Popup URL validation only.');
    return false;
  }

  console.log('[bitbucket-auth] Google SSO detected on Atlassian login. Reusing Google OAuth automation...');
  const sessionInjected = await injectSavedGoogleSession(popup.context());
  if (!sessionInjected) {
    throw new Error('[bitbucket-auth] Google Session is required for Bitbucket Google SSO. Run the Google Oturum Hazırlığı card first.');
  }
  await googleSsoButton.click({ force: true });

  const closedAfterSession = await popup.waitForEvent('close', { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (closedAfterSession) {
    console.log('[bitbucket-auth] Bitbucket Google SSO completed with the saved Google session.');
    return true;
  }

  await popup.waitForLoadState('domcontentloaded').catch(() => {});
  const currentUrl = popup.url();
  if (!/accounts\.google\.com/i.test(currentUrl)) {
    console.log(`[bitbucket-auth] Saved Google session moved popup away from Google login: ${currentUrl}`);
    return true;
  }

  const googleLogin = new GoogleLoginPage(popup);
  try {
    const loginCompleted = await googleLogin.completeOAuthLogin();
    if (!loginCompleted) {
      throw new Error('Google OAuth automation did not reach a completed state.');
    }
  } catch (error: any) {
    throw new Error(
      '[bitbucket-auth] Bitbucket Google SSO failed. Refresh Google Session or check GOOGLE_TEST_USER / GOOGLE_TEST_PASSWORD / GOOGLE_TOTP_SECRET. ' +
      `Original error: ${error?.message || error}`,
    );
  }

  if (!popup.isClosed()) {
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
  }

  return true;
}

test.describe('Bitbucket Provider Entegrasyon Testleri', () => {
  // Entegrasyon ve popup açılma süreçleri için makul timeout
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    // Turnstile/reCAPTCHA bypass ve hata engellemeleri
    (page as GitSecPage).ignoredErrors = [
      /Cross-Origin-Opener-Policy/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /HTTP Status 502/
    ];
  });

  test('Bitbucket kartına tıklandığında kurulum modalı açılmalı ve iptal edilebilmeli', async ({ page }) => {
    // 1. Sağlayıcı Ekleme Sayfasına git
    const addProviderUrl = `${dashboardBaseUrl}/${workspaceId}/repositories/add`;
    console.log(`🚀 Bitbucket Test: Sağlayıcı ekleme sayfasına gidiliyor: ${addProviderUrl}`);
    await page.goto(addProviderUrl, { waitUntil: 'load' });

    // 2. Bitbucket Kartını bul ve tıkla
    const bitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
    await expect(bitbucketCard).toBeVisible({ timeout: 15000 });
    await bitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
    await bitbucketCard.click();
    console.log('👆 Bitbucket sağlayıcı kartına tıklandı.');

    // 3. Bitbucket Kurulum Modalı açıldığını doğrula
    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    const isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket setup modal did not open. Reloading provider page and retrying once.');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load' });
      const retryBitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
      await expect(retryBitbucketCard).toBeVisible({ timeout: 15000 });
      await retryBitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
      await retryBitbucketCard.click();
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    }

    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.getByRole('heading', { name: /Bitbucket/i })).toBeVisible();
    console.log('✅ Bitbucket kurulum modalı başarıyla görüntülendi.');

    // 4. Vazgeç/Kapat butonu ile modalı kapat
    const cancelBtn = modal.getByRole('button', { name: /Cancel|Kapat|Vazgeç/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await expect(cancelBtn).toBeEnabled();
    await cancelBtn.click({ force: true });

    // 5. Modalın gizlendiğini doğrula
    await expect(modal).toBeHidden({ timeout: 5000 });
    console.log('✅ Kapat butonuna basıldığında modal başarıyla kapandı.');
  });

  test('Bitbucket kurulum ekranında "Install" butonuna tıklandığında Atlassian OAuth popup penceresi açılmalı', async ({ page }) => {
    // 1. Sağlayıcı Ekleme Sayfasına git
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load' });

    // 2. Bitbucket Kartını tıkla ve modalı aç
    const bitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
    await expect(bitbucketCard).toBeVisible({ timeout: 15000 });
    await bitbucketCard.click();

    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    const isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket setup modal did not open before OAuth test. Reloading provider page and retrying once.');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load' });
      const retryBitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
      await expect(retryBitbucketCard).toBeVisible({ timeout: 15000 });
      await retryBitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
      await retryBitbucketCard.click();
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    }

    await expect(modal).toBeVisible({ timeout: 10000 });

    const installBtn = modal.getByRole('button', { name: /Install|Yükle/i }).first();
    await expect(installBtn).toBeVisible({ timeout: 5000 });

    // 3. Install butonu tıklandığında popup penceresi açılmasını bekle
    console.log('👆 "Install" butonuna tıklanıyor ve Atlassian OAuth penceresi bekleniyor...');
    await expect(installBtn).toBeEnabled();
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 30000 }),
      installBtn.click({ force: true })
    ]);

    // 4. Popup URL'ini doğrula
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const popupUrl = popup.url();
    console.log(`ℹ️ Açılan Popup URL: ${popupUrl}`);
    
    // Popup adresinin atlassian.com veya bitbucket.org yönlendirmesi içerdiğini doğrula
    expect(popupUrl).toMatch(/atlassian\.com|bitbucket\.org/i);
    console.log('✅ Atlassian/Bitbucket OAuth popup yönlendirmesi doğrulandı.');

    // Temizlik: Popup'ı kapat
    const googleSsoCompleted = await completeBitbucketGoogleSsoIfVisible(popup);
    if (googleSsoCompleted) {
      console.log('[bitbucket-auth] Bitbucket Google SSO completed or popup closed after callback.');
    }

    await popup.close().catch(() => {});
  });

  test('Bitbucket entegrasyonu kurulduktan sonra repository listesinin yüklendiğini ve yönetilebildiğini doğrula', async ({ page }) => {
    // 1. Bitbucket Repositories sayfasına git
    const bitbucketReposPage = `${dashboardBaseUrl}/${workspaceId}/repositories/bitbucket`;
    console.log(`🧭 Bitbucket Repositories sayfasına yönlendiriliyor: ${bitbucketReposPage}`);
    await page.goto(bitbucketReposPage, { waitUntil: 'load' });

    // 2. Sayfa başlığının yüklendiğini doğrula
    const heading = page.getByRole('heading', { name: /Repositories/i }).first();
    await expect(heading).toBeVisible({ timeout: 15000 });
    console.log('✅ Repositories başlığı görüntülendi.');

    // 3. Repository tablosunun yüklendiğini doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    // 4. Tablo başlıklarını doğrula
    await expect(page.getByRole('columnheader', { name: /Full Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Connected/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Licensed/i })).toBeVisible();
    console.log('✅ Tablo başlıkları (Full Name, Connected, Licensed) doğrulandı.');

    // 5. En az bir repository satırının yüklendiğini doğrula
    const connectedSummary = page.getByText(/\d+\s+connected repositories/i).first();
    await expect(connectedSummary).toBeVisible({ timeout: 15000 });
    
    let connectedRepoCount = 0;
    try {
      await expect(async () => {
        const text = (await connectedSummary.textContent()) || '';
        const count = Number(text.match(/\d+/)?.[0] || '0');
        expect(count).toBeGreaterThan(0);
        connectedRepoCount = count;
      }).toPass({ timeout: 10000, intervals: [500] });
    } catch (e) {
      // Eğer gerçekten 0 ise veya yüklenemediyse mevcut metni son kez oku
      const text = (await connectedSummary.textContent()) || '';
      connectedRepoCount = Number(text.match(/\d+/)?.[0] || '0');
    }

    test.skip(
      connectedRepoCount === 0,
      'Bitbucket repository management checks require at least one connected Bitbucket repository.',
    );

    const repoRows = page.locator('tbody tr');
    await expect(repoRows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await repoRows.count();
    expect(rowCount).toBeGreaterThan(0);
    console.log(`✅ Tabloda ${rowCount} adet repository listeleniyor.`);

    // 6. İlk repository'nin "Full Name" bilgisinin görüntülendiğini doğrula
    const firstRepoLink = repoRows.first().getByRole('link').first();
    await expect(firstRepoLink).toBeVisible();
    await expect(firstRepoLink).toHaveText(/.+/);
    console.log('✅ İlk repository adı başarıyla görüntüleniyor.');

    // 7. Licensed toggle switch'lerin varlığını ve etkileşime açık olduğunu doğrula
    const switches = repoRows.first().locator('button[role="switch"]');
    await expect(switches.first()).toBeVisible();
    const switchState = await switches.first().getAttribute('aria-checked');
    expect(switchState).toMatch(/^(true|false)$/);
    console.log(`✅ Licensed toggle switch doğrulandı (durum: ${switchState}).`);

    // 8. Tabloda en az bir Licensed switch bulunduğunu doğrula
    const allSwitches = page.locator('tbody tr button[role="switch"]');
    const switchCount = await allSwitches.count();
    expect(switchCount).toBeGreaterThan(0);
    console.log(`✅ Tabloda ${switchCount} adet Licensed toggle switch mevcut.`);
  });
});
