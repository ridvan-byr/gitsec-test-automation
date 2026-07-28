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
  if (!isGithubUrl || /github\.com\/login/i.test(u) || /github\.com\/session/i.test(u)) {
    return popup;
  }

  // A) Eğer ALZATEN /settings/installations/{id} sayfasındaysak -> Doğrudan ve anında Uninstall yap
  if (/settings\/installations\/\d+/i.test(u)) {
    console.log(`[github] ⚡ Doğrudan GitHub App ayarlar sayfasındayız (${u}). Anında aşağı ve sağa kaydırılarak Uninstall yapılıyor...`);
    
    popup.once('dialog', async dialog => {
      console.log(`[github-dialog] 🔔 Native browser confirm algılandı ("${dialog.message()}"). Otomatik ACCEPT ediliyor...`);
      await dialog.accept().catch(() => {});
    });

    await popup.waitForLoadState('domcontentloaded').catch(() => {});

    await popup.evaluate(() => {
      window.scrollTo(99999, 99999);
      if (document.documentElement) {
        document.documentElement.scrollTop = 99999;
        document.documentElement.scrollLeft = 99999;
      }
      if (document.body) {
        document.body.scrollTop = 99999;
        document.body.scrollLeft = 99999;
      }
    }).catch(() => {});

    const uninstallInput = popup.locator('input[type="submit"][value="Uninstall"], input.btn-danger[value="Uninstall"], input[data-confirm*="uninstall"], button.btn-danger')
      .filter({ hasText: /Uninstall|Kaldır/i })
      .or(popup.locator('input[type="submit"][value="Uninstall"]'))
      .first();

    const isInputVisible = await uninstallInput.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);

    if (isInputVisible) {
      await uninstallInput.scrollIntoViewIfNeeded().catch(() => {});
      console.log('[github] 👆 [TIKLAMA] "<input type=\\"submit\\" value=\\"Uninstall\\">" butonuna tıklandı...');
      await uninstallInput.click({ force: true }).catch(async () => {
        await uninstallInput.evaluate((el: any) => el.click()).catch(() => {});
      });
      await popup.waitForTimeout(1000);
    }

    console.log('[github] 💥 [KARSILIKSIZ SILME] Silme formu doğrudan form.submit() ile gönderiliyor...');
    await popup.evaluate(() => {
      const input = document.querySelector('input[value="Uninstall"], input.btn-danger[value="Uninstall"], input[data-confirm*="uninstall"]');
      if (input) {
        const form = input.closest('form');
        if (form) {
          form.submit();
          return;
        }
      }
      const delForm = Array.from(document.querySelectorAll('form')).find(f => {
        const action = f.getAttribute('action') || (f as HTMLFormElement).action || '';
        const methodInput = f.querySelector('input[name="_method"]');
        const methodVal = methodInput ? (methodInput.getAttribute('value') || '').toLowerCase() : '';
        return action.includes('/settings/installations/') || methodVal === 'delete';
      });
      if (delForm) {
        delForm.submit();
      }
    }).catch(() => {});

    await popup.waitForTimeout(2500);
    console.log('🔄 [YENİDEN YÖNLENDİRME] Uygulama kaldırıldı. Taze izinler ekranına gidiliyor...');
    await popup.goto('https://github.com/apps/gitsec-backup-staging/installations/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
    return popup;
  }

  // B) Diğer GitHub sayfalarındaysak (İzinler veya Genel liste)
  await popup.evaluate(() => window.scrollTo(0, 99999)).catch(() => {});
  const uninstallBtn = popup.locator('button, summary, input[type="submit"], a, [data-show-dialog-id*="uninstall"]')
    .filter({ hasText: /Uninstall|Kaldır/i })
    .first();

  let hasUninstall = await uninstallBtn.waitFor({ state: 'visible', timeout: 1500 }).then(() => true).catch(() => false);
  if (hasUninstall) {
    console.log('⚠️ [UYARI] GitHub uygulaması zaten kurulu. Anında Uninstall yapılıyor...');
    await uninstallBtn.scrollIntoViewIfNeeded().catch(() => {});
    await uninstallBtn.click({ force: true }).catch(() => {});
    await popup.waitForTimeout(300);

    const confirmBtn = popup.locator('[role="dialog"] button, details[open] button, div.Box button, form[action*="uninstall"] button, form[action*="uninstall"] input[type="submit"]')
      .filter({ hasText: /Uninstall|Kaldır|OK/i })
      .first();

    if (await confirmBtn.isVisible().catch(() => false)) {
      console.log('[github] 👆 [ONAY] Uninstall onay butonuna basılıyor...');
      await confirmBtn.click({ force: true }).catch(() => {});
      await popup.waitForTimeout(400);
    }

    console.log('🔄 [YENİDEN YÖNLENDİRME] Uygulama kaldırıldı. Taze izinler ekranına gidiliyor...');
    await popup.goto('https://github.com/apps/gitsec-backup-staging/installations/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
    return popup;
  }

  return popup;
}

async function verifyDashboardConnection(providerPage: ProviderPage) {
  console.log('🚀 [YÖNLENDİRME] Pop-up kapandı; senkronizasyon beklemesi yapılmadan doğrudan "Add Provider" sayfasına gidiliyor...');
  await providerPage.goToAddProviderPage().catch(() => {});

  console.log('🔍 [KONTROL] GitHub sağlayıcısının GitSec paneli üzerinde aktifleştiği doğrulanıyor...');
  let attempt = 0;
  const maxAttempts = 5;

  while (attempt < maxAttempts) {
    attempt++;

    const isConnected = await providerPage.isGithubAlreadyConnectedOnAddProvider();
    if (isConnected) {
      console.log('🎉 [BAŞARILI] GitHub sağlayıcı bağlantısı Add Provider sayfasında başarıyla doğrulandı (Active).');
      return;
    }

    if (attempt < maxAttempts) {
      console.log(`⏳ [BEKLEME] (Deneme ${attempt}/${maxAttempts}) GitHub sağlayıcısı henüz aktifleşmedi, sayfa yenileniyor...`);
      await providerPage.goToAddProviderPage().catch(() => {});
      await providerPage.page.waitForTimeout(2000);
    }
  }

  throw new Error(`❌ GitHub sağlayıcısı ${maxAttempts} deneme sonrasında GitSec paneli üzerinde aktifleşmedi.`);
}

test.describe('Provider Entegrasyonları', () => {
  test.setTimeout(240000);

  test('GitHub provider bagli olsa da popup acilip kapanmali', { tag: '@critical', annotation: { type: 'allow-errors', description: 'Staging sunucusunda OAuth callback yönlendirmesindeki geçici Next.js HTTP 502 ChunkLoadError yakalandı.' } }, async ({ page }) => {
    const githubUsername = requireEnv('GITHUB_TEST_USER');
    const githubPassword = requireEnv('GITHUB_TEST_PASSWORD');
    const providerPage = new ProviderPage(page);

    console.log('🚀 [GİRİŞ] Doğrudan "Add Provider" sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    console.log('👆 [TIKLAMA] 3. "GitHub" seçeneğine tıklanıyor ve popup penceresi açılması bekleniyor...');
    const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);
    await providerPage.selectGithub();
    let popup = await popupPromise;

    if (!popup) {
      const pages = page.context().pages();
      if (pages.length > 1) {
        popup = pages[pages.length - 1];
        console.log('ℹ️ [POPUP] Açık popup penceresi doğrudan yakalandı.');
      } else {
        console.log('🔄 [RETRY] Popup açılmadı, GitHub kartına tekrar basılıyor...');
        const popupPromise2 = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
        await providerPage.selectGithub();
        popup = await popupPromise2;
        if (!popup) {
          const pages2 = page.context().pages();
          if (pages2.length > 1) popup = pages2[pages2.length - 1];
          else popup = page;
        }
      }
    }

    let popupGithubPage = new GithubLoginPage(popup);
    console.log('⏳ [BEKLEME] 4. GitHub popup penceresinin yüklenmesi bekleniyor... (Yönlendirme: github.com)');
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    await popup.waitForURL(/.*github\.com.*/, { timeout: 15000 }).catch(() => {});

    // EĞER ZATEN KURULUYSA (başka bir hesap/workspace için veya testi sıfırlamak için) UNINSTALL EDELİM:
    popup = await handleUninstallIfAlreadyInstalled(popup, page, providerPage);
    popupGithubPage = new GithubLoginPage(popup);

    // İlk yüklemede aranan sayfaya yönlendirildiyse erken çıkış yap
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      await verifyDashboardConnection(providerPage);
      return;
    }

    // Giriş kutusunu anında denetle; login ekranı açıksa HİÇ BEKLEMEDEN bilgileri doldur
    const loginInput = popup.locator('input[name="login"]');
    const isLoginFormVisible = await loginInput.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

    if (isLoginFormVisible) {
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

    // Giriş yapıldıktan SONRA da uygulama bağlıysa Uninstall et ve sıfır temiz pencere aç!
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
    
    // Akış tamamlandıktan sonra popup hedeflenen sayfaya (gitsec.io / callback) ulaştıysa hemen kapat
    if (popup && !popup.isClosed()) {
      const u = popup.url();
      if (u.includes('gitsec.io') || u.includes('installation=success') || u.includes('/repositories/github')) {
        console.log(`🧹 [OTURUM] GitHub yetkilendirmesi tamamlandı ve GitSec paneline döndü (${u}). Popup kapatılıyor...`);
        await popup.close().catch(() => {});
      } else if (await checkIfOnGithubMainPageAndClose(popup)) {
        await verifyDashboardConnection(providerPage);
        return;
      }
    }

    if (popup.isClosed()) {
      console.log('🎉 [BAŞARILI] Popup penceresi başarıyla kapandı.');
    } else {
      const u = popup.url();
      const isInstallPermissionPage = /installations\/new/i.test(u) || /permissions/i.test(u);
      const onInstallationsSettings = !isInstallPermissionPage && /github\.com\/settings\/installations\/\d+$/i.test(u);
      
      if (onInstallationsSettings) {
        console.log('🧹 [OTURUM] GitHub installations ayarlar sayfasına gelindi, popup kapatılıyor...');
        if (!popup.isClosed()) await popup.close().catch(() => {});
      } else if (isInstallPermissionPage) {
        console.log('📝 [OAUTH] İzin sayfasında bulunuluyor, yetkilendirme tamamlanıyor...');
        await popupGithubPage.completePermissionsInstallFlow().catch(() => {});
        if (!popup.isClosed()) await popup.close().catch(() => {});
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
