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

  function logTokenExpiration(jwtToken: string, isRefreshed: boolean) {
    try {
      const payloadBase64 = jwtToken.split('.')[1];
      if (!payloadBase64) return;
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      if (payload.exp) {
        const iatMs = payload.auth_time ? payload.auth_time * 1000 : (payload.nbf ? payload.nbf * 1000 : Date.now());
        const expMs = payload.exp * 1000;
        const remainingMs = expMs - Date.now();
        const remainingMins = Math.max(0, Math.round(remainingMs / 60000));
        
        const iatTimeString = new Date(iatMs).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const expTimeString = new Date(expMs).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const expDateString = new Date(expMs).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
        
        const label = isRefreshed ? '🔄 YENİ TAZE OTURUM ALINDI' : '⚡ MEVCUT OTURUM KULLANILIYOR';
        
        console.log(`\n======================================================================`);
        console.log(`🔑 [OTURUM BİLGİSİ] ${label}`);
        console.log(`   📅 Oturum Oluşturulma Saati : ${iatTimeString}`);
        console.log(`   ⏳ Son Kullanma Tarihi/Saati : ${expDateString} - ${expTimeString}`);
        console.log(`   ⏱️ Kalan Kullanım Süresi     : ~${remainingMins} Dakika (${(remainingMins / 60).toFixed(1)} Saat)`);
        console.log(`======================================================================\n`);
      }
    } catch {}
  }

  // ─── AKILLI OTURUM YÖNETİMİ: GEÇERLİ OTURUM VARSA KULLAN, YOKSA YENİLE ───
  let token = '';
  let isFastPathValid = false;

  const targetFileToRead = fs.existsSync(withProviderFile) ? withProviderFile : authFile;

  if (fs.existsSync(targetFileToRead)) {
    try {
      const authData = JSON.parse(fs.readFileSync(targetFileToRead, 'utf8'));
      const gsTokenCookie = authData.cookies?.find((c: any) => c.name === 'gs_token');
      if (gsTokenCookie && gsTokenCookie.value) {
        const cachedToken = gsTokenCookie.value;
        const payloadBase64 = cachedToken.split('.')[1];
        if (payloadBase64) {
          const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
          const exp = payload.exp * 1000;
          const tokenEmail = payload.email || payload.sub || payload.user_email;

          // Token'ın dolmasına en az 15 dakika var mı, e-posta eşleşiyor mu ve localStorage gs-auth içinde geçerli token var mı?
          const isTokenNotExpired = exp - Date.now() > 15 * 60 * 1000;
          const isSameUserEmail = !tokenEmail || tokenEmail.toLowerCase() === appEmail.toLowerCase();
          
          const gsAuthItem = authData.origins?.find((o: any) => o.origin.includes('gitsec.io'))?.localStorage?.find((l: any) => l.name === 'gs-auth');
          const isLocalStorageTokenValid = Boolean(gsAuthItem && gsAuthItem.value && gsAuthItem.value.includes('"token":"ey'));

          if (isTokenNotExpired && isSameUserEmail && isLocalStorageTokenValid) {
            token = cachedToken;
            isFastPathValid = true;
            console.log(`[GLOBAL SETUP] ⚡ [MEVCUT OTURUM KULLANILIYOR] Diskteki oturum geçerli (${appEmail}). Giriş isteği atlanıyor.`);
            logTokenExpiration(token, false);
            await page.context().addCookies(authData.cookies || []);
          } else if (!isLocalStorageTokenValid) {
            console.log(`[auth-setup] 🔄 [OTURUM TAZELEME] Diskteki LocalStorage gs-auth token'ı boş veya eksik. Taze giriş yapılıyor...`);
          }
        }
      }
    } catch (err) {
      console.warn('[auth-setup] ⚠️ Kayıtlı oturum doğrulanırken hata:', err);
    }
  }

  // Eğer mevcut oturum taze değilse Staging API'ye /auth/signin isteği gönder
  if (!isFastPathValid) {
    console.log(`🚀 [GİRİŞ / OTURUM TAZELEME] Diskteki oturum dolmuş veya eksik. GitSec Staging API'sine taze giriş yapılıyor... (Email: ${appEmail})`);
    const response = await request.post(`${apiBaseUrl}/auth/signin`, {
      data: {
        email: appEmail,
        password: appPassword,
      },
    }).catch(() => null);

    if (response && response.ok()) {
      const body = await response.json().catch(() => ({}));
      token = body?.data?.token || '';
      if (token) {
        console.log(`✅ [GİRİŞ / OTURUM TAZELEME] Staging API'sinden %100 YENİ ve TAZE oturum token'ı alındı.`);
        logTokenExpiration(token, true);
      }
    }
  }

  if (!token) {
    throw new Error('❌ [HATA] Ne canlı API girişinden ne de diskten geçerli bir oturum token\'ı alınamadı!');
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

  let decodedUserId = 261;
  let decodedTenantId = 237;
  let decodedName = "Gitsec";
  let decodedSurname = "Test";

  try {
    const payloadBase64 = token.split('.')[1];
    if (payloadBase64) {
      const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
      if (payload.id || payload.sub) decodedUserId = Number(payload.id || payload.sub);
      if (payload.tenant_id) decodedTenantId = Number(payload.tenant_id);
      if (payload.name) decodedName = payload.name;
      if (payload.family_name) decodedSurname = payload.family_name;
    }
  } catch {}

  const gsAuthValue = JSON.stringify({
    state: {
      auth: {
        user: {
          userId: decodedUserId,
          tenantId: decodedTenantId,
          name: decodedName,
          surName: decodedSurname,
          email: appEmail,
          token: token,
          refreshToken: token,
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

  // Tek ve net çerez enjeksiyonu (Mükerrer/Duplicate çakışmalarını engeller)
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

  console.log(`[auth-setup] Dashboard açılıyor ve taze oturum saklanıyor...`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  await page.context().storageState({ path: authFile });

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
        // gitsec.io domainli gs_token çerezlerini ezme, taze olan kalsın!
        if (c.name !== 'gs_token' && !c.domain.includes('gitsec.io')) {
          cookieMap.set(`${c.domain}:${c.name}`, c);
        }
      });

      const originsMap = new Map<string, any>();
      (targetData.origins || []).forEach((o: any) => {
        originsMap.set(o.origin, o);
      });
      (googleSession.origins || []).forEach((o: any) => {
        // gitsec.io origin'ini ezme, taze localStorage gs-auth kalsın!
        if (!o.origin.includes('gitsec.io')) {
          originsMap.set(o.origin, o);
        }
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
