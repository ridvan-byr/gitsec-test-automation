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
    /settings\/installations\/\d+$/i.test(u) ||
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

