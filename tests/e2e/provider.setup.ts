import { test as setup, expect } from '../fixtures/test';
import path from 'path';
import fs from 'fs';
import { requireEnv } from '../support/require-env';
import { ProviderPage } from '../pages/ProviderPage';
import { GithubLoginPage } from '../pages/GithubLoginPage';
import { handleBitbucketAuthPopup } from '../support/bitbucket-auth-helper';
import { checkIfOnGithubMainPageAndClose, verifyDashboardConnection } from '../support/github-oauth-helpers';

setup('connect provider if needed', async ({ request, page }) => {
  setup.setTimeout(180000);

  const withProviderFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');
  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const apiBaseUrl = requireEnv('API_BASE_URL');

  // Hangi sağlayıcının bağlandığı denetimi (github, bitbucket veya ikisi de)
  const codeProviderEnv = process.env.E2E_CODE_PROVIDER?.trim().toLowerCase() || '';
  const targetProvider = codeProviderEnv === 'bitbucket' ? 'bitbucket' : (codeProviderEnv === 'github' ? 'github' : 'all');

  console.log(`[PROVIDER SETUP] 🎯 Hedef Kod Sağlayıcısı (E2E_CODE_PROVIDER): "${codeProviderEnv || 'TÜMÜ (GitHub & Bitbucket)'}" -> İşlenecek Tip: ${targetProvider}`);

  // 1. Kayıtlı Google/GitHub/Atlassian Oturum Çerezlerini Enjekte Et (Sign In Sayfasını Atlamak İçin)
  if (fs.existsSync(googleSessionPath)) {
    try {
      const sessionData = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
      const cookies = sessionData.cookies || [];
      if (cookies.length > 0) {
        await page.context().addCookies(cookies);
        console.log(`[PROVIDER SETUP] 🔑 Kayıtlı Google/GitHub/Atlassian çerezleri enjekte edildi (${cookies.length} adet çerez). Sign in adımı atlanacak.`);
      }
    } catch (e: any) {
      console.warn(`[PROVIDER SETUP] ⚠️ Oturum çerezleri okunamadı: ${e?.message || e}`);
    }
  }

  const providerPage = new ProviderPage(page);

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
  if (!workspaceId) workspaceId = '345';

  async function checkProviderStatus(providerName: 'GitHub' | 'Bitbucket'): Promise<boolean> {
    console.log(`[PROVIDER SETUP / KONTROL] 🔍 /repositories/add sayfasında ${providerName} durumu denetleniyor...`);
    try {
      await providerPage.goToAddProviderPage();
      
      const rowLocator = page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]').filter({ hasText: new RegExp(providerName, 'i') }).first();
      const hasRow = await rowLocator.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);

      if (hasRow) {
        const textContent = await rowLocator.textContent().catch(() => '');
        const innerText = await rowLocator.innerText().catch(() => '');
        const cleanLogText = (innerText || textContent || '').trim().replace(/\s+/g, ' ');

        console.log(`[PROVIDER SETUP / KONTROL] 🎯 ${providerName} Satırı Bulundu: "${cleanLogText}"`);

        const isRemoved = /Removed/i.test(cleanLogText);
        if (isRemoved) {
          console.log(`[PROVIDER SETUP / KONTROL] ❌ ${providerName} satırı "Removed" durumunda. Hızlı OAuth bağlantısı başlatılacak.`);
          return false;
        }

        const isActive = /Active/i.test(cleanLogText) || /Configure App/i.test(cleanLogText);
        if (isActive) {
          console.log(`[PROVIDER SETUP / KONTROL] ✅ ${providerName} sağlayıcısı ZATEN AKTİF.`);
          return true;
        }
      }
    } catch (err) {
      console.log(`[PROVIDER SETUP / KONTROL] ⚠️ /repositories/add denetlenirken hata: ${(err as any).message}`);
    }

    return false;
  }

  // A) GitHub Bağlantısı
  if (targetProvider === 'github' || targetProvider === 'all') {
    let isGithubActive = await checkProviderStatus('GitHub');
    if (!isGithubActive) {
      console.log('[PROVIDER SETUP / BAĞLANTI] 🔗 GitHub sağlayıcısı bağlı değil. Hızlı OAuth bağlantısı başlatılıyor...');
      const githubUser = requireEnv('GITHUB_TEST_USER');
      const githubPass = requireEnv('GITHUB_TEST_PASSWORD');

      try {
        await providerPage.goToAddProviderPage();
        const popupPromise = page.waitForEvent('popup', { timeout: 20000 }).catch(() => null);
        await providerPage.selectGithub();
        let popup = await popupPromise;

        if (!popup) {
          const pages = page.context().pages();
          if (pages.length > 1) {
            popup = pages[pages.length - 1];
          } else {
            popup = page;
          }
        }

        if (popup) {
          await popup.waitForLoadState('domcontentloaded').catch(() => {});
          let ghLogin = new GithubLoginPage(popup);

          // 1. İlk yüklemede pop-up ana sayfaya/callback'e düştüyse ERKEN ÇIKIŞ yap
          if (await checkIfOnGithubMainPageAndClose(popup)) {
            await verifyDashboardConnection(providerPage);
          } else {
            // 2. Giriş formu çıkmışsa loginAndHandleTwoFactor çalıştır
            const loginInput = popup.locator('input[name="login"]');
            const isLoginFormVisible = await loginInput.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

            if (isLoginFormVisible) {
              console.log(`🚀 [PROVIDER SETUP / GİTHUB] 🔒 GitHub login formu tespit edildi. Oturum açılıyor (${githubUser})...`);
              const loginOk = await ghLogin.loginAndHandleTwoFactor(githubUser, githubPass);
              if (!loginOk) throw new Error('❌ GitHub login veya 2FA otomasyonla geçilemedi.');
            } else {
              await ghLogin.handleTwoFactorAuthentication().catch(() => {});
            }

            // Cihaz doğrulama (sessions/verified-device / E-posta OTP) denetimi (Sadece Sudo UI varsa)
            if (await ghLogin.isSudoUiVisible()) {
              await ghLogin.handlePostLoginEmailChallenge({ waitForSudoMs: 1000 }).catch(() => {});
            }

            // 3. Giriş yapıldıktan sonra pop-up ana sayfaya düşmüşse ERKEN ÇIKIŞ yap
            if (await checkIfOnGithubMainPageAndClose(popup)) {
              await verifyDashboardConnection(providerPage);
            } else {
              console.log('📦 [PROVIDER SETUP / GİTHUB] İzinler ve Kurulum (Install & Authorize) akışı tamamlanıyor...');
              await ghLogin.completePermissionsInstallFlow().catch(() => {});

              if (!popup.isClosed()) {
                await checkIfOnGithubMainPageAndClose(popup).catch(() => {});
              }
              await verifyDashboardConnection(providerPage);
            }
          }
        }
      } catch (e: any) {
        console.log(`[PROVIDER SETUP / HATA] ⚠️ GitHub OAuth bağlantı denemesi: ${e?.message || e}`);
      }
    }
  }

  // B) Bitbucket Bağlantısı
  if (targetProvider === 'bitbucket' || targetProvider === 'all') {
    let isBitbucketActive = await checkProviderStatus('Bitbucket');
    if (!isBitbucketActive) {
      console.log('[PROVIDER SETUP / BAĞLANTI] 🔗 Bitbucket sağlayıcısı bağlı değil. Hızlı OAuth bağlantısı başlatılıyor...');
      try {
        await providerPage.goToAddProviderPage();
        await providerPage.selectBitbucket();

        // Bitbucket Kurulum Modalı açıldığını doğrula ve "Install" butonuna bas
        let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
        const isModalVisible = await modal.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

        let popup: any = null;
        if (isModalVisible) {
          const installBtn = modal.getByRole('button', { name: /Install|Yükle/i }).first();
          if (await installBtn.isVisible().catch(() => false)) {
            console.log('[PROVIDER SETUP / BITBUCKET] 👆 Kurulum modalındaki "Install" butonuna basılıyor ve OAuth penceresi bekleniyor...');
            const popupPromise = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null);
            await installBtn.click({ force: true }).catch(() => {});
            popup = await popupPromise;
          }
        } else {
          // Modal çıkmadıysa doğrudan popup bekle
          const popupPromise = page.waitForEvent('popup', { timeout: 10000 }).catch(() => null);
          popup = await popupPromise;
        }

        if (popup) {
          await handleBitbucketAuthPopup(popup).catch(() => {});
          if (!popup.isClosed()) {
            await popup.close().catch(() => {});
          }
        }
      } catch (e: any) {
        console.log(`[PROVIDER SETUP / HATA] ⚠️ Bitbucket OAuth bağlantı denemesi: ${e?.message || e}`);
      }

      await expect(async () => {
        await providerPage.goToAddProviderPage();
        const bitbucketRow = page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]').filter({ hasText: /Bitbucket/i }).first();
        const textContent = await bitbucketRow.textContent().catch(() => '');
        const isRemoved = /Removed/i.test(textContent || '');
        const isActive = !isRemoved && (/Active/i.test(textContent || '') || /Configure App/i.test(textContent || ''));
        expect(isActive).toBeTruthy();
      }).toPass({ timeout: 25000, intervals: [2000] });
    }
  }

  // user-with-provider.json sakla
  await page.context().storageState({ path: withProviderFile });
  console.log('[PROVIDER SETUP] 🎉 Provider setup başarıyla tamamlandı. Oturum durumu saklandı.');
});
