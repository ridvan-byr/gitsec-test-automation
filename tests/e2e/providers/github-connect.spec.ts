import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import type { Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';
import { checkIfOnGithubMainPageAndClose } from '../../support/github-oauth-helpers';

async function handleUninstallIfAlreadyInstalled(
  popup: Page,
  page: Page,
  providerPage: ProviderPage
): Promise<Page> {
  if (popup.isClosed()) return popup;

  const u = popup.url();
  const isGithubUrl = /github\.com/i.test(u);
  if (!isGithubUrl) {
    return popup;
  }

  const uninstallBtn = popup.locator('button')
    .filter({ hasText: /Uninstall|Kaldır|Yüklemeyi kaldır|Yüklemeyi Kaldır/i })
    .or(popup.locator('input[type="submit"][value*="Uninstall"]'))
    .or(popup.locator('input[type="submit"][value*="Kaldır"]'))
    .or(popup.locator('input[type="submit"][value*="Yüklemeyi kaldır"]'))
    .or(popup.locator('button[value*="Uninstall"]'))
    .or(popup.locator('button[value*="Kaldır"]'))
    .first();
  const hasUninstall = await uninstallBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  
  if (hasUninstall) {
    console.log('⚠️ [UYARI] GitHub uygulaması başka bir hesap veya çalışma alanında zaten kurulu. Temiz bir test için uygulama kaldırılıyor...');
    
    // Accept confirm dialogs automatically
    popup.on('dialog', async dialog => {
      console.log(`[github] 👆 [ONAY] GitHub onay penceresi kabul ediliyor... (Mesaj: "${dialog.message()}")`);
      await dialog.accept().catch(() => {});
    });

    await uninstallBtn.scrollIntoViewIfNeeded().catch(() => {});
    await uninstallBtn.click({ force: true });
    
    console.log('⏳ [BEKLEME] Uygulamanın kaldırılması (Uninstall) bekleniyor...');
    await expect(uninstallBtn).toBeHidden({ timeout: 15000 }).catch(() => {});
    if (!popup.isClosed()) {
      await popup.close().catch(() => {});
    }

    console.log('🔄 [YENİLEME] GitSec "Add Provider" sayfası yeniden yükleniyor...');
    await page.reload({ waitUntil: 'load' });

    console.log('👆 [TIKLAMA] Yeni bir yetkilendirme penceresi açmak için GitHub seçeneğine tekrar tıklanıyor...');
    const [newPopup] = await Promise.all([page.waitForEvent('popup'), providerPage.selectGithub()]);
    await newPopup.waitForLoadState('domcontentloaded');
    await newPopup.waitForURL(/.*github\.com.*/);
    return newPopup;
  }

  const isGithubHomeOrDashboard = 
    /github\.com\/?$/i.test(u) || 
    /github\.com\/dashboard/i.test(u) || 
    /github\.com\/home/i.test(u);

  if (isGithubHomeOrDashboard) {
    console.log('⚠️ [UYARI] GitHub ana sayfasına/paneline yönlendirildi. Uygulamayı kaldırmak için doğrudan entegrasyon ayarlarına gidiliyor...');
    await popup.goto('https://github.com/settings/installations', { waitUntil: 'domcontentloaded' }).catch(() => {});

    const configureLink = popup.locator('a[href*="/settings/installations/"]').first();
    const hasConfigureLink = await configureLink.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (hasConfigureLink) {
      console.log('👆 [TIKLAMA] Kurulu uygulama yapılandırma bağlantısı bulundu, tıklanıyor...');
      await configureLink.click();
      await popup.waitForLoadState('domcontentloaded');
      
      const innerUninstallBtn = popup.locator('button')
        .filter({ hasText: /Uninstall|Kaldır|Yüklemeyi kaldır|Yüklemeyi Kaldır/i })
        .or(popup.locator('input[type="submit"][value*="Uninstall"]'))
        .or(popup.locator('input[type="submit"][value*="Kaldır"]'))
        .or(popup.locator('input[type="submit"][value*="Yüklemeyi kaldır"]'))
        .or(popup.locator('button[value*="Uninstall"]'))
        .or(popup.locator('button[value*="Kaldır"]'))
        .first();
      const hasInnerUninstall = await innerUninstallBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      if (hasInnerUninstall) {
        console.log('⚠️ [UYARI] Uygulama, GitHub ayarlar sayfası üzerinden kaldırılıyor...');
        popup.on('dialog', async dialog => {
          console.log(`[github] 👆 [ONAY] GitHub onay penceresi kabul ediliyor... (Mesaj: "${dialog.message()}")`);
          await dialog.accept().catch(() => {});
        });
        await innerUninstallBtn.scrollIntoViewIfNeeded().catch(() => {});
        await innerUninstallBtn.click({ force: true });
        await expect(innerUninstallBtn).toBeHidden({ timeout: 15000 }).catch(() => {});
      }
    } else {
      console.log('🔍 [KONTROL] Mevcut aktif kurulumlar listesinde herhangi bir öğe bulunamadı.');
    }

    if (!popup.isClosed()) {
      await popup.close().catch(() => {});
    }

    console.log('🔄 [YENİLEME] GitSec "Add Provider" sayfası yeniden yükleniyor...');
    await page.reload({ waitUntil: 'load' });

    console.log('👆 [TIKLAMA] Temiz bir popup açmak için GitHub butonuna tekrar tıklanıyor...');
    const [newPopup] = await Promise.all([page.waitForEvent('popup'), providerPage.selectGithub()]);
    await newPopup.waitForLoadState('domcontentloaded');
    await newPopup.waitForURL(/.*github\.com.*/);
    return newPopup;
  }

  return popup;
}

async function verifyDashboardConnection(providerPage: ProviderPage) {
  console.log('🔍 [KONTROL] GitHub sağlayıcısının GitSec paneli üzerinde aktifleştiği doğrulanıyor...');
  await expect(async () => {
    const url = providerPage.page.url();
    if (url.includes('/repositories/github')) {
      console.log('🎉 [BAŞARILI] GitHub bağlantısı başarıyla doğrulandı (Kullanıcı /repositories/github sayfasına yönlendirildi).');
      return;
    }

    const isConnected = await providerPage.isGithubAlreadyConnectedOnAddProvider();
    if (isConnected) return;

    console.log('⏳ [BEKLEME] GitHub sağlayıcısı henüz aktifleşmedi, sayfa yenileniyor...');
    if (!url.includes('/repositories/add')) {
      await providerPage.goToAddProviderPage().catch(() => {});
    } else {
      await providerPage.page.reload({ waitUntil: 'load' });
    }
    throw new Error('Not connected yet');
  }).toPass({ timeout: 40000, intervals: [3000] });
  console.log('🎉 [BAŞARILI] GitHub sağlayıcı bağlantısı başarıyla doğrulandı.');
}

test.describe('Provider Entegrasyonları', () => {
  test.setTimeout(240000);

  test('GitHub provider bagli olsa da popup acilip kapanmali', { tag: '@critical' }, async ({ page }) => {
    const githubUsername = requireEnv('GITHUB_TEST_USER');
    const githubPassword = requireEnv('GITHUB_TEST_PASSWORD');
    const providerPage = new ProviderPage(page);

    console.log('🚀 [GİRİŞ] Doğrudan "Add Provider" sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    console.log('👆 [TIKLAMA] 3. "GitHub" seçeneğine tıklanıyor ve popup penceresi açılması bekleniyor...');
    let [popup] = await Promise.all([page.waitForEvent('popup'), providerPage.selectGithub()]);

    let popupGithubPage = new GithubLoginPage(popup);
    console.log('⏳ [BEKLEME] 4. GitHub popup penceresinin yüklenmesi bekleniyor... (Yönlendirme: github.com)');
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForURL(/.*github\.com.*/);

    // EĞER ZATEN KURULUYSA (başka bir hesap/workspace için veya testi sıfırlamak için) UNINSTALL EDELİM:
    popup = await handleUninstallIfAlreadyInstalled(popup, page, providerPage);
    popupGithubPage = new GithubLoginPage(popup);

    // İlk yüklemede aranan sayfaya yönlendirildiyse erken çıkış yap
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      await verifyDashboardConnection(providerPage);
      return;
    }

    const loginInput = popup.locator('input[name="login"]');
    if (await loginInput.isVisible().catch(() => false)) {
      console.log(`🚀 [GİRİŞ] 5. GitHub login formu tespit edildi. Kullanıcı adı ve şifre giriliyor... (Hesap: ${githubUsername})`);
      const loginOk = await popupGithubPage.loginAndHandleTwoFactor(githubUsername, githubPassword);
      if (!loginOk) {
        throw new Error('❌ GitHub login veya 2FA otomasyonla geçilemedi.');
      }
    } else {
      console.log('🔍 [KONTROL] GitHub login formu çıkmadı. (Oturum zaten açık olabilir)');
      const twoFaOk = await popupGithubPage.handleTwoFactorAuthentication();
      if (!twoFaOk) {
        throw new Error('❌ Açık oturumda 2FA otomasyonla geçilemedi.');
      }
    }

    // Giriş/2FA/Mail doğrulama sonrasında hedeflenen sayfaya atıldıysa hemen erken çıkış yap
    popup = await handleUninstallIfAlreadyInstalled(popup, page, providerPage);
    popupGithubPage = new GithubLoginPage(popup);

    if (await checkIfOnGithubMainPageAndClose(popup)) {
      await verifyDashboardConnection(providerPage);
      return;
    }

    console.log('📦 [İŞLEM] 6. GitHub Uygulama İzinleri ve Kurulum (Install) akışı başlatılıyor...');
    const flowOk = await popupGithubPage.completePermissionsInstallFlow();
    if (!flowOk) {
      throw new Error('❌ GitHub izin/kurulum akışı tamamlanamadı.');
      }
    
    // Akış tamamlandıktan sonra hedeflenen sayfaya atıldıysa popup'ı kapat ve bitir
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      await verifyDashboardConnection(providerPage);
      return;
    }

    if (popup.isClosed()) {
      console.log('🎉 [BAŞARILI] Popup penceresi başarıyla kapandı.');
    } else {
      const u = popup.url();
      const onInstallations =
        /github\.com\/settings\/installations/.test(u) || /github\.com\/apps\/[^/]+\/installations/.test(u);
      if (onInstallations) {
        console.log('🧹 [OTURUM] GitHub installations ayarlar sayfasına gelindi, popup kapatılıyor...');
        if (!popup.isClosed()) await popup.close();
      } else {
        throw new Error(`❌ Install butonu yok ve akış tamamlanamadı. (Son URL: ${u})`);
      }
    }

    await verifyDashboardConnection(providerPage);
    console.log('🎉 [BAŞARILI] GitHub bağlantı/popup test akışı başarıyla tamamlandı.');
  });

  test('GitHub Bağla butonuna çoklu spam tıklama yapıldığında tek bir OAuth penceresi açılmalı', { tag: ['@edge-cases', '@spam'] }, async ({ page }) => {
    const providerPage = new ProviderPage(page);
    await providerPage.goToAddProviderPage();

    const githubActionButton = page.locator('button, [role="button"]')
      .filter({ hasText: /Install the GitSec(?:\.io)? app and grant repository permissions|Configure App/i })
      .first();

    await githubActionButton.waitFor({ state: 'visible', timeout: 20000 });

    const popups: any[] = [];
    page.context().on('page', (p) => {
      popups.push(p);
    });

    // Spam click the button 5 times very rapidly
    for (let i = 0; i < 5; i++) {
      githubActionButton.click({ force: true }).catch(() => {});
    }

    await expect(page.locator('main').first()).toBeVisible({ timeout: 10000 });

    // Verify we didn't open multiple OAuth windows (maximum 1 popup page)
    console.log(`ℹ️ Açılan popup sayısı: ${popups.length}`);
    expect(popups.length).toBeLessThanOrEqual(1);
    
    // Cleanup popups
    for (const p of popups) {
      if (!p.isClosed()) {
        await p.close().catch(() => {});
      }
    }
  });
});
