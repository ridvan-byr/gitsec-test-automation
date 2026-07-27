import { test as setup, expect } from '../fixtures/test';
import path from 'path';
import fs from 'fs';
import { requireEnv } from '../support/require-env';
import { GithubLoginPage } from '../pages/GithubLoginPage';
import { checkIfOnGithubMainPageAndClose } from '../support/github-oauth-helpers';

setup('connect provider if needed', async ({ request, page }) => {
  setup.setTimeout(180000);

  const withProviderFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const apiBaseUrl = requireEnv('API_BASE_URL');

  // Workspace ID algıla
  let workspaceId = process.env.WORKSPACE_ID?.trim();
  if (!workspaceId) {
    try {
      const authData = fs.existsSync(authFile) ? JSON.parse(fs.readFileSync(authFile, 'utf8')) : null;
      const gsToken = authData?.cookies?.find((c: any) => c.name === 'gs_token')?.value;
      if (gsToken) {
        const wsRes = await request.get(`${apiBaseUrl}/api/workspaces`, {
          headers: { Authorization: `Bearer ${gsToken}` }
        });
        if (wsRes.ok()) {
          const wsBody = await wsRes.json();
          const firstWs = wsBody?.data?.list?.[0] || wsBody?.data?.[0];
          if (firstWs?.id) {
            workspaceId = String(firstWs.id);
          }
        }
      }
    } catch {}
  }
  if (!workspaceId) workspaceId = '16';

  async function isGithubConnected(): Promise<boolean> {
    console.log('[PROVIDER SETUP / KONTROL] 🔍 /repositories/add sayfasındaki Provider Installations tablosu denetleniyor...');
    try {
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      
      const githubRowLocator = page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]').filter({ hasText: /GitHub/i }).first();
      const hasGithubRow = await githubRowLocator.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

      if (hasGithubRow) {
        const textContent = await githubRowLocator.textContent().catch(() => '');
        const innerText = await githubRowLocator.innerText().catch(() => '');
        const cleanLogText = (innerText || textContent || '').trim().replace(/\s+/g, ' ');

        console.log(`[PROVIDER SETUP / KONTROL] 🎯 GitHub Satırı Bulundu: "${cleanLogText}"`);

        const isRemoved = /Removed/i.test(cleanLogText) || /Removed/i.test(textContent || '') || /Removed/i.test(innerText || '');
        if (isRemoved) {
          console.log('[PROVIDER SETUP / KONTROL] ❌ GitHub satırı "Removed" durumunda (Kaldırılmış/Pasif). OAuth adımları başlatılacak.');
          return false;
        }

        const isActive = /Active/i.test(cleanLogText) || /Active/i.test(textContent || '');
        if (isActive) {
          console.log('[PROVIDER SETUP / KONTROL] ✅ GitHub satırı "Active" durumunda (Aktif Kurulu). OAuth adımları ATLANACAK.');
          return true;
        }
      }
    } catch (err) {
      console.log(`[PROVIDER SETUP / KONTROL] ⚠️ /repositories/add denetlenirken hata: ${(err as any).message}`);
    }

    return false;
  }

  let isConnected = await isGithubConnected();
  if (isConnected) {
    console.log('[PROVIDER SETUP / KONTROL] ✅ GitHub sağlayıcısının zaten bağlı olduğu doğrulandı.');
  } else {
    console.log('[PROVIDER SETUP / BAĞLANTI] 🔗 GitHub sağlayıcısı bağlı değil. Yeni OAuth bağlantısı başlatılıyor...');
    
    const githubUser = requireEnv('GITHUB_TEST_USER');
    const githubPass = requireEnv('GITHUB_TEST_PASSWORD');

    const performOAuthConnect = async () => {
      const githubInstallButton = page.locator([
        'button:has-text("Install the GitSec app and grant repository permissions")',
        'button:has-text("Install the GitSec.io app and grant repository permissions")',
        'button:has-text("Configure App")',
        '[role="button"]:has-text("Configure App")',
        'button:has-text("GitHub")',
      ].join(', ')).first();

      await githubInstallButton.waitFor({ state: 'visible', timeout: 15000 });
      await githubInstallButton.scrollIntoViewIfNeeded().catch(() => {});

      const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);

      console.log('[PROVIDER SETUP / OAuth] 👆 "Install the GitSec app" / "Configure App" butonuna tıklanıyor...');
      await githubInstallButton.click();

      let popup = await popupPromise;
      let oauthPage = popup ?? page;
      
      console.log('[PROVIDER SETUP / OAuth] ⏳ GitHub OAuth sayfasına yönlendirme bekleniyor...');
      await oauthPage.waitForLoadState('domcontentloaded').catch(() => {});

      const loginInput = oauthPage.locator('input[name="login"]');
      const isLoginRequired = await loginInput.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
      const ghLogin = new GithubLoginPage(oauthPage);

      if (isLoginRequired) {
        console.log(`[PROVIDER SETUP / GİRİŞ] 🔒 GitHub test hesabına giriş yapılıyor... (${githubUser})`);
        const loginOk = await ghLogin.loginAndHandleTwoFactor(githubUser, githubPass);
        if (!loginOk) {
          throw new Error('[PROVIDER SETUP / GİRİŞ] GitHub 2FA otomasyonla tamamlanamadı.');
        }
      } else {
        await ghLogin.handleTwoFactorAuthentication();
      }

      const installAuthorizeButton = oauthPage.getByRole('button', { name: /Install\s*(?:&|and)?\s*Authorize|Yükle\s*(?:ve|&)?\s*Yetkilendir/i })
        .or(oauthPage.locator('button:has-text("Install & Authorize")'))
        .or(oauthPage.locator('button.btn-primary[type="submit"]'))
        .first();

      if (await installAuthorizeButton.isVisible({ timeout: 10000 }).catch(() => false)) {
        console.log('[PROVIDER SETUP / OAuth] 📝 GitSec uygulamasının yetkileri onaylanıyor ("Install & Authorize")...');
        await installAuthorizeButton.scrollIntoViewIfNeeded().catch(() => {});
        await installAuthorizeButton.click({ force: true });
        await page.waitForTimeout(3000);
      }

      if (popup && !popup.isClosed()) {
        await popup.close().catch(() => {});
      }
    };

    try {
      await performOAuthConnect();
    } catch (e) {
      console.log(`[PROVIDER SETUP / HATA] ⚠️ OAuth bağlantı denemesi: ${(e as any).message}`);
    }

    let finalCheck = false;
    await expect(async () => {
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const githubRowLocator = page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]').filter({ hasText: /GitHub/i }).first();
      const textContent = await githubRowLocator.textContent().catch(() => '');
      const isRemoved = /Removed/i.test(textContent || '');
      const isActive = !isRemoved && (/Active/i.test(textContent || '') || /Configure App/i.test(textContent || ''));
      expect(isActive).toBeTruthy();
      finalCheck = true;
    }).toPass({ timeout: 25000, intervals: [2000] });
  }

  // user-with-provider.json sakla
  await page.context().storageState({ path: withProviderFile });
});
