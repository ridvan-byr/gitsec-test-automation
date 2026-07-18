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

  const fullCmd = process.argv.join(' ').toLowerCase();
  
  const skipGlobalSetupEnv = process.env.SKIP_GLOBAL_SETUP === 'true';
  const hasSkipArgs = fullCmd.includes('register') ||
                     fullCmd.includes('login') ||
                     fullCmd.includes('auth/') ||
                     fullCmd.includes('--skip-gs');

  if (skipGlobalSetupEnv || hasSkipArgs) {
    console.log(`[auth-setup] ⚠️ [DİKKAT] Kurulum adımı atlanıyor. (SKIP_GLOBAL_SETUP: ${skipGlobalSetupEnv}, CLI Argümanı Eşleşmesi: ${hasSkipArgs})`);
    return;
  }

  const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');
  const withProviderFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const apiBaseUrl = requireEnv('API_BASE_URL');
  const appEmail = requireEnv('E2E_USER_EMAIL');
  const appPassword = requireEnv('E2E_USER_PASSWORD');

  // Akıllı Oturum Kontrolü (Session Cache Check - .env E-posta Değişikliği Algılama)
  // Chromium projesinin gerçekten yüklediği dosyayı doğrula.
  if (fs.existsSync(withProviderFile)) {
    try {
      const authData = JSON.parse(fs.readFileSync(withProviderFile, 'utf8'));
      const gsTokenCookie = authData.cookies?.find((c: any) => c.name === 'gs_token');
      if (gsTokenCookie && gsTokenCookie.value) {
        const token = gsTokenCookie.value;
        const payloadBase64 = token.split('.')[1];
        if (payloadBase64) {
          const payload = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
          const exp = payload.exp * 1000; // milisaniye
          const tokenEmail = payload.email || payload.sub || payload.user_email;

          const isTokenNotExpired = exp - Date.now() > 5 * 60 * 1000;
          const isSameUserEmail = !tokenEmail || tokenEmail.toLowerCase() === appEmail.toLowerCase();

          // Eğer token süresi dolmamışsa VE .env içerisindeki e-posta ile uyuşuyorsa oturumu yeniden kullan
          if (isTokenNotExpired && isSameUserEmail) {
            console.log(`[auth-setup] ✅ [GEÇERLİ OTURUM] Mevcut oturum çerezi (${appEmail}) geçerli olduğu için login adımları atlanıyor.`);
            return;
          } else if (!isSameUserEmail) {
            console.log(`[auth-setup] 🔄 [.ENV DEĞİŞİKLİĞİ DETECTED] Ortam değişkenlerindeki e-posta değişti (${tokenEmail} -> ${appEmail}). Oturum yeniden oluşturuluyor...`);
          }
        }
      }
    } catch (err) {
      console.warn('[auth-setup] ⚠️ Mevcut user.json dosyası okunurken hata oluştu, yeniden giriş yapılacak:', err);
    }
  }

  console.log(`🚀 [GİRİŞ] GitSec Staging API'sine giriş isteği gönderiliyor... (Email: ${appEmail}, Endpoint: ${apiBaseUrl}/auth/signin)`);
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
  const token = body?.data?.token;
  if (!token) {
    throw new Error('Auth setup login failed: token not found in response');
  }

  // Workspace ID bilgisini .env olmadan API üzerinden OTOMATİK TESPİT ET
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
          console.log(`[auth-setup] 🔍 Workspace ID API'den otomatik tespit edildi: ${workspaceId}`);
        }
      }
    } catch {
      // ignore
    }
  }
  if (!workspaceId) {
    workspaceId = '16';
  }

  const gsAuthValue = JSON.stringify({
    state: {
      auth: {
        user: {
          userId: body?.data?.userId || body?.data?.user?.id || body?.data?.user?.userId || 797,
          tenantId: body?.data?.tenantId || body?.data?.user?.tenantId || 720,
          name: body?.data?.name || body?.data?.user?.name || "Gitsec",
          surName: body?.data?.surName || body?.data?.user?.surName || "Testt",
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
    state: {
      completedTours: {
        onboarding: 5
      }
    },
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

  // Onboarding'i ve auth state'ini her sayfa load'undan önce localStorage'a yazarak yönlendirmeleri engelleyelim.
  await page.context().addInitScript(`
    try {
      window.localStorage.setItem('gs-tour', ${JSON.stringify(gsTourValue)});
      window.localStorage.setItem('gs-auth', ${JSON.stringify(gsAuthValue)});
    } catch (e) {
      // ignore
    }
  `);

  console.log(`[auth-setup] Dashboard açılıyor ve oturum/localStorage saklanıyor... (URL: ${dashboardBaseUrl}/${workspaceId}/dashboard)`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});

  // user-with-provider.json ve user.json kaydet (origins & localStorage dahil)
  await page.context().storageState({ path: withProviderFile });
  await page.context().storageState({ path: authFile });

  // ─── GITHUB / BITBUCKET OAUTH BAĞLANTI ADIMI KONTROLÜ ───
  // OAuth bağlantısı yalnızca doğrudan 'github-connect' veya 'full-flow-auditor' testleri çalıştırıldığında gereklidir.
  // Lisans (billing), depolama, zamanlayıcı, arayüz vb. tüm diğer testlerde GitHub OAuth adımları tamamen atlanır.
  const isGithubConnectTestRequired = fullCmd.includes('github-connect') || fullCmd.includes('full-flow-auditor');

  if (!isGithubConnectTestRequired) {
    console.log('[auth-setup] ℹ️ GitSec API oturumu açıldı, çerezler ve localStorage saklandı. GitHub/Bitbucket OAuth adımları atlandı.');
    return;
  }

  console.log(`[auth-setup] Dashboard açılıyor... (URL: ${dashboardBaseUrl}/${workspaceId}/dashboard)`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'load', timeout: 30000 });

  const githubUser = process.env.GITHUB_TEST_USER ?? appEmail;
  const githubPass = process.env.GITHUB_TEST_PASSWORD ?? appPassword;

  console.log('[auth-setup] 📍 [NAVİGASYON] Sağlayıcı Ekleme sayfasına yönlendiriliyor... (Path: /repositories/add)');
  try {
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load', timeout: 15000 });
  } catch (err) {
    console.log(`[auth-setup] ⚠️ [UYARI] Sayfa yüklemesi başarısız oldu veya kesildi (${(err as any).message}). Sidebar ("Add Provider" linki) üzerinden geçiş deneniyor...`);
    const addProviderLink = page.getByRole('link', { name: /Add Provider/i }).first();
    await addProviderLink.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await addProviderLink.click().catch(() => {});
  }

  async function isGithubConnected(): Promise<boolean> {
    const githubRow = page.getByRole('row', { name: /GitHub/i }).first();
    const isAttached = await githubRow.waitFor({ state: 'attached', timeout: 2000 }).then(() => true).catch(() => false);
    
    if (!isAttached) {
      console.log(`[auth-setup] 🔍 [KONTROL] GitHub sağlayıcı satırı bulunamadı (DOM'da attached değil). Bağlantı mevcut değil.`);
      return false;
    }
    
    const rowText = await githubRow.textContent({ timeout: 2000 }).catch(() => '');
    if (!rowText || rowText === 'Row not found') {
      console.log(`[auth-setup] 🔍 [KONTROL] GitHub sağlayıcı satırı boş (Metin bulunamadı). Bağlantı mevcut değil.`);
      return false;
    }

    console.log(`[auth-setup] 🔍 [KONTROL] GitHub sağlayıcı satırı kontrol ediliyor... (Arayüz Metni: "${rowText.trim()}")`);

    if (/Removed/i.test(rowText)) {
      console.log(`[auth-setup] 🔍 [KONTROL] Sağlayıcı satırında "Removed" ibaresi tespit edildi (Bağlantı pasif).`);
      return false;
    }

    if (/Active/i.test(rowText) || /Remove/i.test(rowText) || /gitsectest/i.test(rowText)) {
      console.log(`[auth-setup] 🔍 [KONTROL] Sağlayıcı satırında bağlantının aktif olduğunu belirten anahtar kelimeler ("Active", "Remove" veya "gitsectest") tespit edildi (Durum: Bağlı).`);
      return true;
    }

    const hasInstall = /Install/i.test(rowText) || /Connect/i.test(rowText);
    if (!hasInstall && rowText.length > 10) {
      console.log(`[auth-setup] 🔍 [KONTROL] Sağlayıcı satırında "Install" veya "Connect" butonu bulunamadı. Bağlantının kurulu olduğu varsayılıyor (Durum: Bağlı).`);
      return true;
    }
    
    console.log(`[auth-setup] 🔍 [KONTROL] Sağlayıcı satırında "Install" veya "Connect" butonu görünüyor. Bağlantı mevcut değil.`);
    return false;
  }

  let isConnected = await isGithubConnected();
  if (isConnected) {
    console.log('[auth-setup] ✅ [KONTROL] GitHub sağlayıcısının zaten bağlı olduğu doğrulandı. OAuth adımları atlanıyor.');
  } else {
    console.log('[auth-setup] 🔗 [BAĞLANTI] GitHub sağlayıcısı bağlı değil. Yeni OAuth bağlantısı başlatılıyor...');
    const githubInstallButton = page.locator([
      'button:has-text("Install the GitSec app and grant repository permissions")',
      'button:has-text("Configure App")',
      '[role="button"]:has-text("Configure App")',
      'button:has-text("GitHub")',
    ].join(', ')).first();

    await githubInstallButton.waitFor({ state: 'visible', timeout: 15000 });
    await githubInstallButton.scrollIntoViewIfNeeded().catch(() => {});

    const popupPromise = page
      .waitForEvent('popup', { timeout: 15000 })
      .then((p) => p)
      .catch(() => null);

    await prepareGithubOAuthSession(page.context());

    console.log('[auth-setup] 👆 [OAuth] "Install the GitSec app" / "Configure App" butonuna tıklanıyor...');
    await githubInstallButton.click();

    const popup = await popupPromise;
    const oauthPage = popup ?? page;
    
    console.log('[auth-setup] ⏳ [OAuth] GitHub OAuth sayfasına yönlendirme bekleniyor... (URL: github.com)');
    try {
      if (popup) {
        await oauthPage.waitForLoadState();
        await oauthPage.waitForURL(/.*github\.com.*/, { timeout: 30000 });
      } else {
        await page.waitForURL(/.*github\.com.*/, { timeout: 30000 });
      }
    } catch (error) {
      console.log(`[auth-setup] ❌ [HATA] GitHub OAuth sayfasına yönlendirme gerçekleşmedi!`);
      console.log(`[auth-setup]   └─ Mevcut URL: ${oauthPage.url()}`);
      throw error;
    }

    console.log('[auth-setup] ⏳ [GİRİŞ] GitHub oturum açma (Sign in) sayfası denetleniyor...');
    const loginInput = oauthPage.locator('input[name="login"]');
    const isLoginRequired = await loginInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    
    await ensureGithubLoginFormIfEnvUser(oauthPage);

    const ghLogin = new GithubLoginPage(oauthPage);
    const loginRequiredAfterLogout = await oauthPage
      .locator('input[name="login"]')
      .isVisible()
      .catch(() => false);

    if (isLoginRequired || loginRequiredAfterLogout) {
      console.log(`🔒 [GİRİŞ] GitHub test hesabına giriş yapılıyor... (Kullanıcı: ${githubUser})`);
      const loginOk = await ghLogin.loginAndHandleTwoFactor(githubUser, githubPass);
      if (!loginOk) {
        throw new Error(
          '[auth-setup] GitHub 2FA otomasyonla tamamlanamadi.'
        );
      }
    } else {
      console.log('[auth-setup] ℹ️ [GİRİŞ] Oturum açma formu görünmedi (GitHub oturumu zaten açık olabilir).');
      const twoFaOk = await ghLogin.handleTwoFactorAuthentication();
      if (!twoFaOk) {
        throw new Error(
          '[auth-setup] Acik oturumda 2FA otomasyonla gecilemedi.'
        );
      }
    }

    console.log('[auth-setup] ⏳ [OAuth] Uygulama yetkilendirme (Authorize) butonu denetleniyor...');
    const installAuthorizeButton = oauthPage.getByRole('button', { name: /Authorize/i }).first();
    const isAuthorizeRequired = await installAuthorizeButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

    if (isAuthorizeRequired) {
      console.log('[auth-setup] 📝 [OAuth] GitSec uygulamasının yetkileri onaylanıyor (Authorize butonuna tıklandı)...');
      await installAuthorizeButton.scrollIntoViewIfNeeded();
      await installAuthorizeButton.click();
    }

    console.log('[auth-setup] ⏳ [BEKLEME] Yetkilendirme sonrası GitSec paneline dönülmesi bekleniyor...');
    if (popup) {
      await popup.waitForEvent('close', { timeout: 30000 }).catch(() => console.log('[auth-setup] Popup kapanma eventi yakalanamadi.'));
    }

    await page.waitForURL(/\/repositories\/add\b/, { timeout: 60000 }).catch(async () => {
      console.log('[auth-setup] ⚠️ [UYARI] /repositories/add sayfasına geçiş henüz tamamlanamadı. 5 saniye ek süre bekleniyor...');
      await page.waitForLoadState('domcontentloaded');
    });

    let finalCheck = false;
    await expect(async () => {
      console.log('[auth-setup] ⏳ [KONTROL] Arayüz üzerinde sağlayıcı bağlantı durumunun güncellenmesi bekleniyor...');
      await page.reload({ waitUntil: 'load' });
      const connected = await isGithubConnected();
      if (!connected) {
        throw new Error('GitHub provider is not connected yet.');
      }
      finalCheck = true;
    }).toPass({ timeout: 25000, intervals: [3000] });

    if (!finalCheck) {
      const githubRow = page.getByRole('row', { name: /GitHub/i }).first();
      const rowText = await githubRow.textContent().catch(() => 'Row not found');
      throw new Error(`GitHub provider baglanamadi: "Active" durumu halen gorunmuyor. Son satir icerigi: "${rowText}"`);
    }

    console.log('[auth-setup] 🎉 [BAŞARILI] GitHub sağlayıcısı başarıyla bağlandı ve doğrulandı.');
  }

  // user-with-provider.json kaydet
  await page.context().storageState({ path: withProviderFile });

  // user.json olarak da kaydet
  await page.context().storageState({ path: authFile });

  // Google cookie entegrasyonu
  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
  if (fs.existsSync(googleSessionPath)) {
    console.log('[auth-setup] 🔑 [GOOGLE] Kayıtlı Google oturumu (google-session.json) tespit edildi. Oturum çerezleri enjekte ediliyor...');
    try {
      const googleSession = JSON.parse(fs.readFileSync(googleSessionPath, 'utf8'));
      const targetData = JSON.parse(fs.readFileSync(withProviderFile, 'utf8'));
      
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

      fs.writeFileSync(withProviderFile, JSON.stringify(targetData, null, 2), 'utf8');
      console.log('[auth-setup] ✅ [GOOGLE] Google çerezleri başarıyla birleştirildi ve enjekte edildi.');
    } catch (e) {
      console.error('[auth-setup] Google cookie\'leri birleştirilirken hata oluştu:', e);
    }
  }
});
