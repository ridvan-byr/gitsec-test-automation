import { chromium, request as playwrightRequest } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { GithubLoginPage } from './pages/GithubLoginPage';
import {
  githubCookiesForStorageState,
  logGithubAuthPlan,
  prepareGithubOAuthSession,
  ensureGithubLoginFormIfEnvUser,
} from './tests/support/github-auth';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function globalSetup(): Promise<void> {
  // Eğer register veya login gibi auth testleri çalıştırılıyorsa global-setup'ı tamamen atlıyoruz.
  // Çünkü bu testler giriş yapmamış (unauthenticated) temiz bir state ile başlamalıdır.
  if (process.argv.some(arg => arg.includes('register.spec.ts') || arg.includes('login.spec.ts'))) {
    console.log('[global-setup] Auth testi calistiriliyor. Global setup tamamen atlandi.');
    return;
  }

  const authFile = path.join(process.cwd(), 'playwright/.auth/user.json');
  const withProviderFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  const workspaceId = process.env.WORKSPACE_ID ?? '753';
  const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';
  const apiBaseUrl = process.env.API_BASE_URL ?? 'https://dev.api.gitsec.io';
  const appEmail = requireEnv('E2E_USER_EMAIL');
  const appPassword = requireEnv('E2E_USER_PASSWORD');
  const githubUser = process.env.GITHUB_TEST_USER ?? appEmail;
  const githubPass = process.env.GITHUB_TEST_PASSWORD ?? appPassword;
  logGithubAuthPlan();

  const api = await playwrightRequest.newContext();
  const response = await api.post(`${apiBaseUrl}/auth/signin`, {
    data: {
      email: appEmail,
      password: appPassword,
    },
  });

  if (!response.ok()) {
    throw new Error(`Global setup login failed: ${response.status()} ${response.statusText()}`);
  }

  const body = await response.json();
  const token = body?.data?.token;
  if (!token) {
    throw new Error('Global setup login failed: token not found in response');
  }

  const { cookies: githubCookies, origins: githubOrigins } = githubCookiesForStorageState();

  const dashboardOrigin = new URL(dashboardBaseUrl).origin;

  const gsAuthValue = JSON.stringify({
    state: {
      auth: {
        user: {
          userId: body?.data?.user?.id || body?.data?.user?.userId || 797,
          tenantId: body?.data?.user?.tenantId || 720,
          name: body?.data?.user?.name || "Gitsec",
          surName: body?.data?.user?.surName || "Testt",
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

  const storageState = {
    cookies: [
      {
        name: 'gs_token',
        value: token,
        domain: '.gitsec.io',
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax' as const,
      },
      ...githubCookies
    ],
    origins: [
      {
        origin: dashboardOrigin,
        localStorage: [
          {
            name: 'gs-auth',
            value: gsAuthValue
          },
          {
            name: 'gs-tour',
            value: gsTourValue
          }
        ]
      },
      ...githubOrigins
    ],
  };

  fs.writeFileSync(authFile, JSON.stringify(storageState, null, 2), 'utf-8');

  const browser = await chromium.launch();
  const context = await browser.newContext({ storageState: authFile });
  // Onboarding'i tamamen atlamak için her sayfa load'undan önce localStorage'a gs-tour state'i yaz.
  // Bu init script, context içindeki tüm sayfalar için geçerlidir.
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'gs-tour',
        JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
      );
    } catch {
      // ignore
    }
  });
  const page = await context.newPage();

  console.log('[global-setup] Dashboard aciliyor...');
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'load' });

  // Not: Onboarding, gs-tour localStorage ile skip ediliyor.

  // EĞER KULLANICI ÖZELLİKLE "github-connect.spec.ts" TESTİNİ ÇALIŞTIRIYORSA:
  // Amacımız bağlama aşamasını test etmek olduğu için, global-setup'ın bu işi otomatik yapmasını ENGELLEYELİM.
  if (process.argv.some(arg => arg.includes('github-connect.spec.ts'))) {
    console.log('[global-setup] DİKKAT: "github-connect" testi çalıştırılıyor! Otomatik OAuth atlanıyor, işi teste bırakıyoruz.');
    await page.context().storageState({ path: 'playwright/.auth/user-with-provider.json' });
    await browser.close();
    return;
  }

  await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load' });
  async function isGithubConnected(): Promise<boolean> {
    // "GitHub" satırını bul
    const githubRow = page.getByRole('row', { name: /GitHub/i }).first();
    await githubRow.waitFor({ state: 'attached', timeout: 2000 }).catch(() => {});
    
    const rowText = await githubRow.textContent().catch(() => '');
    if (!rowText || rowText === 'Row not found') {
      console.log(`[global-setup] isGithubConnected: Satir bos. Bagli degil.`);
      return false;
    }

    console.log(`[global-setup] isGithubConnected kontrolu. Satir metni: "${rowText}"`);

    // Eğer kullanıcı provider'ı manuel olarak sildiyse (test etmek için), satırda "Removed" yazabiliyor
    // (Örn: "GitHubgitsectest-cmd-RemovedUser"). Bu durumda provider bağlı DEĞİLDİR.
    if (/Removed/i.test(rowText)) {
      console.log(`[global-setup] isGithubConnected: 'Removed' kelimesi bulundu. Provider bagli degil!`);
      return false;
    }

    // Eğer satırda "Active", "Remove" (Removed değil, sadece Remove butonu) veya "gitsectest" geçiyorsa bağlıdır.
    if (/Active/i.test(rowText) || /Remove/i.test(rowText) || /gitsectest/i.test(rowText)) {
      console.log(`[global-setup] isGithubConnected: Active/Remove/gitsectest kelimesi bulundu. Bagli.`);
      return true;
    }

    // Alternatif olarak; eğer satırda "Install" kelimesi YOKSA ve satır boş değilse bağlı kabul edebiliriz.
    // Fakat metni ekrana basalım ki yanlışlıkla bağlı demiyorsak görelim.
    const hasInstall = /Install/i.test(rowText) || /Connect/i.test(rowText);
    if (!hasInstall && rowText.length > 10) {
      console.log(`[global-setup] isGithubConnected: Install veya Connect yok, bagli saniyor. Bagli.`);
      return true;
    }
    
    console.log(`[global-setup] isGithubConnected: Install var, bagli degil.`);
    return false;
  }

  let isConnected = await isGithubConnected();
  if (isConnected) {
    console.log('[global-setup] GitHub provider zaten bagli, OAuth atlandi.');
  } else {
    console.log('[global-setup] GitHub provider bagli degil, OAuth baslatiliyor...');
    const githubInstallButton = page.getByRole('button', {
      name: /Git[Hh]ub.*Install the GitSec app and grant repository permissions/i,
    });

    await githubInstallButton.waitFor({ state: 'visible', timeout: 15000 });
    await githubInstallButton.scrollIntoViewIfNeeded().catch(() => {});

    // Bazi akışlarda popup açılır (window.open), bazılarında aynı sekmede github.com'a yönlenir.
    const popupPromise = page
      .waitForEvent('popup', { timeout: 15000 })
      .then((p) => p)
      .catch(() => null);

    await prepareGithubOAuthSession(page.context());

    console.log('[global-setup] GitHub install butonuna tiklaniyor...');
    await githubInstallButton.click();

    const popup = await popupPromise;
    const oauthPage = popup ?? page;
    
    console.log('[global-setup] GitHub yonlendirmesi bekleniyor...');
    try {
      if (popup) {
        await oauthPage.waitForLoadState();
        await oauthPage.waitForURL(/.*github\.com.*/, { timeout: 30000 });
      } else {
        await page.waitForURL(/.*github\.com.*/, { timeout: 30000 });
      }
    } catch (error) {
      console.log(`[global-setup] HATA: github.com'a yonlendirme gerceklesmedi!`);
      console.log(`[global-setup] Mevcut URL: ${oauthPage.url()}`);
      throw error;
    }

    console.log('[global-setup] GitHub login sayfasi kontrol ediliyor...');
    // Login input'unun gelmesi anlık olmayabilir, waitFor ile bekleyelim.
    const loginInput = oauthPage.locator('input[name="login"]');
    const isLoginRequired = await loginInput.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    
    await ensureGithubLoginFormIfEnvUser(oauthPage);

    const ghLogin = new GithubLoginPage(oauthPage);
    const loginRequiredAfterLogout = await oauthPage
      .locator('input[name="login"]')
      .isVisible()
      .catch(() => false);

    if (isLoginRequired || loginRequiredAfterLogout) {
      console.log('[global-setup] GitHub giris bilgileri dolduruluyor...');
      const loginOk = await ghLogin.loginAndHandleTwoFactor(githubUser, githubPass);
      if (!loginOk) {
        throw new Error(
          '[global-setup] GitHub 2FA otomasyonla tamamlanamadi. Elle giris yapip playwright/.auth/github.json kaydedin veya e-posta 2FA + GITHUB_MAIL_* kullanin.'
        );
      }
    } else {
      console.log('[global-setup] Login formu gorunmedi (Zaten giris yapilmis olabilir).');
      const twoFaOk = await ghLogin.handleTwoFactorAuthentication();
      if (!twoFaOk) {
        throw new Error(
          '[global-setup] Acik oturumda 2FA otomasyonla gecilemedi; elle giris veya kayitli github.json gerekli.'
        );
      }
    }

    console.log('[global-setup] Authorize butonu kontrol ediliyor...');
    // Sadece "Install & Authorize" değil, genel olarak "Authorize" kelimesini arayalım
    const installAuthorizeButton = oauthPage.getByRole('button', { name: /Authorize/i }).first();
    const isAuthorizeRequired = await installAuthorizeButton.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);

    if (isAuthorizeRequired) {
      console.log('[global-setup] Uygulama yetkilendiriliyor...');
      await installAuthorizeButton.scrollIntoViewIfNeeded();
      await installAuthorizeButton.click();
    } else {
      console.log('[global-setup] Authorize/Install butonu gorunmedi (Daha once yetkilendirilmis olabilir).');
      console.log(`[global-setup] Su anki GitHub URL'si: ${oauthPage.url()}`);
      
      // Ekranda ne hata/uyarı olduğunu görmek için sayfanın metnini alalım (ilk 500 karakter).
      const rawText = await oauthPage.locator('body').textContent().catch(() => '');
      const pageText = rawText || '';
      console.log(`[global-setup] Ekranda yazanlar: ${pageText.substring(0, 500).replace(/\n/g, ' ')}...`);
    }

    console.log('[global-setup] Dashboard ekranina donus bekleniyor...');
    // Yetkilendirme sonrası dashboard/repositories ekranına dönülene kadar bekle.
    if (popup) {
      await popup.waitForEvent('close', { timeout: 30000 }).catch(() => console.log('[global-setup] Popup kapanma eventi yakalanamadi.'));
    }

    // Popup ya da redirect sonrası repos add sayfasına gelmesini bekliyoruz.
    await page.waitForURL(/\/repositories\/add\b/, { timeout: 60000 }).catch(async () => {
      console.log('[global-setup] /repositories/add URL\'si dogrulanamadi, 5 saniye daha bekleniyor...');
      await page.waitForTimeout(5000);
    });

    // Active statüsüne geçmesi birkaç saniye sürebilir (backend senkronizasyonu).
    // Bazen SPA otomatik yenilemedigi icin eger active degilse sayfayi tekrar yenileyerek kontrol ediyoruz.
    let finalCheck = false;
    for (let i = 0; i < 6; i++) {
      console.log(`[global-setup] Provider durumunun guncellenmesi icin sayfa yenileniyor... (Deneme ${i + 1})`);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(3000); // UI'ın oturması ve verinin çekilmesi için tolerans
      
      finalCheck = await isGithubConnected();
      if (finalCheck) {
        break;
      }
    }

    if (!finalCheck) {
      // Eğer hala active değilse, satırda ne yazdığına bakalım.
      const githubRow = page.getByRole('row', { name: /GitHub/i }).first();
      const rowText = await githubRow.textContent().catch(() => 'Row not found');
      console.log(`[global-setup] Hata: GitHub satiri bulundu ancak "Active" gorulemedi. Satir icerigi: "${rowText}"`);
      throw new Error('GitHub provider baglanamadi: "Active" durumu halen gorunmuyor.');
    }

    console.log('[global-setup] GitHub provider baglama adimi tamamlandi.');
  }

  await context.storageState({ path: withProviderFile });

  // Eğer kaydedilmiş bir Google oturumu varsa, bunu yeni üretilen dosyalarla birleştir
  const googleSessionPath = path.join(process.cwd(), 'playwright/.auth/google-session.json');
  if (fs.existsSync(googleSessionPath)) {
    console.log('[global-setup] google-session.json bulundu, Google cookie\'leri ekleniyor...');
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
      console.log('[global-setup] Google cookie\'leri user-with-provider.json dosyasına başarıyla enjekte edildi.');
      
      // user.json dosyasına da enjekte et
      if (fs.existsSync(authFile)) {
        const userData = JSON.parse(fs.readFileSync(authFile, 'utf8'));
        const userCookieMap = new Map<string, any>();
        (userData.cookies || []).forEach((c: any) => {
          userCookieMap.set(`${c.domain}:${c.name}`, c);
        });
        (googleSession.cookies || []).forEach((c: any) => {
          userCookieMap.set(`${c.domain}:${c.name}`, c);
        });
        userData.cookies = Array.from(userCookieMap.values());
        fs.writeFileSync(authFile, JSON.stringify(userData, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('[global-setup] Google cookie\'leri birleştirilirken hata oluştu:', e);
    }
  }

  await context.close();
  await browser.close();
  await api.dispose();
}

export default globalSetup;
