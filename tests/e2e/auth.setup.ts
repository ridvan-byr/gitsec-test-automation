import { test as setup, expect } from '../fixtures/test';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { GithubLoginPage } from '../pages/GithubLoginPage';
import { requireEnv } from '../support/require-env';
import {
  githubCookiesForStorageState,
  logGithubAuthPlan,
  prepareGithubOAuthSession,
  ensureGithubLoginFormIfEnvUser,
} from '../support/github-auth';

setup('authenticate and connect provider', async ({ request, page }) => {
  setup.setTimeout(180000);

  const combinedEnvAndArgs = (JSON.stringify(process.argv) + JSON.stringify(process.env)).toLowerCase().replace(/\\\\/g, '/');
  const isGithubConnectTest = combinedEnvAndArgs.includes('github-connect');
  
  const skipGlobalSetupEnv = process.env.SKIP_GLOBAL_SETUP === 'true';
  const hasSkipArgs = /register|login|auth\/|--skip-gs/i.test(combinedEnvAndArgs) || isGithubConnectTest;

  if (skipGlobalSetupEnv || hasSkipArgs) {
    console.log(`[auth-setup] ⚠️ [DİKKAT] Kurulum adımı atlanıyor. (github-connect testi çalıştırılıyor, sağlayıcı bağlama işlemi testin kendisine bırakıldı)`);
    return;
  }

  const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');
  const withProviderFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const appEmail = requireEnv('E2E_USER_EMAIL');
  const appPassword = requireEnv('E2E_USER_PASSWORD');

  // ─── HIZLI YOL (FAST PATH): KAYITLI OTURUM KONTROLÜ VE BYPASS ───
  let token = '';
  let isFastPathValid = false;

  if (fs.existsSync(withProviderFile)) {
    try {
      const authData = JSON.parse(fs.readFileSync(withProviderFile, 'utf8'));
      const gsTokenCookie = authData.cookies?.find((c: any) => c.name === 'gs_token');
      if (gsTokenCookie && gsTokenCookie.value) {
        const cachedToken = gsTokenCookie.value;
        const payloadBase64 = cachedToken.split('.')[1];
        if (payloadBase64) {
          const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
          const exp = payload.exp * 1000;
          const tokenEmail = payload.email || payload.sub || payload.user_email;

          const isTokenNotExpired = exp - Date.now() > 5 * 60 * 1000;
          const isSameUserEmail = !tokenEmail || tokenEmail.toLowerCase() === appEmail.toLowerCase();

          if (isTokenNotExpired && isSameUserEmail) {
            // API ucu ile token'ı hızlıca doğrula
            const wsRes = await request.get(`${apiBaseUrl}/api/workspaces`, {
              headers: { Authorization: `Bearer ${cachedToken}` }
            }).catch(() => null);

            if (wsRes && wsRes.ok()) {
              console.log(`[GLOBAL SETUP] ⚡ [HIZLI OTURUM] API oturumu geçerli (${appEmail}). Giriş isteği atlanıyor.`);
              token = cachedToken;
              isFastPathValid = true;

              // Çerezleri ve localStorage scriptini context'e ekle
              await page.context().addCookies(authData.cookies || []);
            }
          }
        }
      }
    } catch (err) {
      console.warn('[auth-setup] ⚠️ Kayıtlı oturum doğrulanırken hata:', err);
    }
  }

  // Eğer Hızlı Oturum geçerli değilse /auth/signin isteği at
  if (!isFastPathValid) {
    console.log(`🚀 [GİRİŞ] GitSec Staging API'sine giriş isteği gönderiliyor... (Email: ${appEmail})`);
    const response = await request.post(`${apiBaseUrl}/auth/signin`, {
      data: {
        email: appEmail,
        password: appPassword,
      },
    });

    if (!response.ok()) {
      throw new Error(`Auth setup login failed: ${response.status()} ${response.statusText()}`);
    }

    const body = await response.json();
    token = body?.data?.token;
    if (!token) {
      throw new Error('Auth setup login failed: token not found in response');
    }
  }

  // Workspace ID otomatik tespiti
  let workspaceId = process.env.WORKSPACE_ID?.trim();
  if (!workspaceId) {
    try {
      const wsRes = await request.get(`${apiBaseUrl}/api/workspaces`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (wsRes.ok()) {
        const wsBody = await wsRes.json();
        const firstWs = wsBody?.data?.list?.[0] || wsBody?.data?.[0];
        if (firstWs?.id) {
          workspaceId = String(firstWs.id);
        }
      }
    } catch {}
  }
  if (!workspaceId) workspaceId = '16';

  const gsAuthValue = JSON.stringify({
    state: {
      auth: {
        user: {
          userId: 797,
          tenantId: 720,
          name: "Gitsec",
          surName: "Testt",
          email: appEmail,
          token: "",
          refreshToken: "",
          uniqueKey: null,
          otpAuthenticationType: null
        }
      }
    },
    version: 0
  });

  const gsTourValue = JSON.stringify({
    state: { completedTours: { onboarding: 5 } },
    version: 0
  });

  // Cookieleri ekleyelim
  const cookiesToInject = [
    {
      name: 'gs_token',
      value: token,
      domain: '.gitsec.io',
      path: '/',
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: 'Lax' as any,
    }
  ];

  const { cookies: githubCookies } = githubCookiesForStorageState();
  cookiesToInject.push(...githubCookies.map((c: any) => ({
    ...c,
    sameSite: c.sameSite as any,
  })));
  await page.context().addCookies(cookiesToInject);

  await page.context().addInitScript(`
    try {
      window.localStorage.setItem('gs-tour', ${JSON.stringify(gsTourValue)});
      window.localStorage.setItem('gs-auth', ${JSON.stringify(gsAuthValue)});
    } catch (e) {}
  `);

  if (!isFastPathValid) {
    console.log(`[auth-setup] Dashboard açılıyor ve oturum saklanıyor...`);
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.context().storageState({ path: authFile });
  }

  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
  if (fs.existsSync(googleSessionPath)) {
    console.log('[auth-setup] 🔑 [GOOGLE] Kayıtlı Google oturumu (google-session.json) tespit edildi. Oturum çerezleri enjekte ediliyor...');
    try {
      const googleSession = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
      const targetData = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      
      const cookieMap = new Map<string, any>();
      (targetData.cookies || []).forEach((c: any) => {
        cookieMap.set(`${c.domain}:${c.name}`, c);
      });
      (googleSession.cookies || []).forEach((c: any) => {
        cookieMap.set(`${c.domain}:${c.name}`, c);
      });

      const originsMap = new Map<string, any>();
      (targetData.origins || []).forEach((o: any) => {
        originsMap.set(o.origin, o);
      });
      (googleSession.origins || []).forEach((o: any) => {
        originsMap.set(o.origin, o);
      });

      targetData.cookies = Array.from(cookieMap.values());
      targetData.origins = Array.from(originsMap.values());

      fs.writeFileSync(authFile, JSON.stringify(targetData, null, 2), 'utf8');
      console.log('[auth-setup] ✅ [GOOGLE] Google çerezleri başarıyla birleştirildi ve enjekte edildi.');
    } catch (e) {
      console.error('[auth-setup] Google cookie\'leri birleştirilirken hata oluştu:', e);
    }
  }
});
