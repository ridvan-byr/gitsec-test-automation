import type { Page } from '@playwright/test';

export async function checkIfOnGithubMainPageAndClose(popup: Page): Promise<boolean> {
  if (popup.isClosed()) return true;

  const u = popup.url();
  const isInstallPage =
    /\/installations\/new/i.test(u) ||
    /\/installations\/\d+\/permissions/i.test(u) ||
    /\/apps\/[^/]+\/installations\/new/i.test(u);

  if (isInstallPage) {
    return false;
  }

  let isHostnameMatch = false;
  try {
    const parsed = new URL(u);
    const isInstallTrigger = parsed.pathname.includes('/auth/github/install') || parsed.pathname.includes('/github/install');
    if (
      !isInstallTrigger &&
      (parsed.hostname === 'localhost' ||
        parsed.hostname === '127.0.0.1' ||
        parsed.hostname === 'gitsec.io' ||
        parsed.hostname.endsWith('.gitsec.io'))
    ) {
      isHostnameMatch = true;
    }
  } catch {
    // ignore invalid URL parse edge cases
  }

  const isGithubAuthorizedPage =
    isHostnameMatch ||
    /github\.com\/?$/i.test(u) ||
    /github\.com\/dashboard/i.test(u) ||
    /github\.com\/home/i.test(u);

  if (isGithubAuthorizedPage) {
    await popup.close().catch(() => {});
    return true;
  }

  return false;
}

export async function verifyDashboardConnection(providerPage: any, maxAttempts = 5): Promise<void> {
  console.log('🚀 [YÖNLENDİRME] Pop-up kapandı; senkronizasyon beklemesi yapılmadan doğrudan "Add Provider" sayfasına gidiliyor...');
  await providerPage.goToAddProviderPage().catch(() => {});

  console.log('🔍 [KONTROL] GitHub sağlayıcısının GitSec paneli üzerinde aktifleştiği doğrulanıyor...');
  let attempt = 0;

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

