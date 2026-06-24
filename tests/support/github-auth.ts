import type { BrowserContext, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const GITHUB_AUTH_FILE = path.join(process.cwd(), 'playwright/.auth/github.json');

export function getGithubTestUser(): string | undefined {
  const v = process.env.GITHUB_TEST_USER?.trim();
  return v || undefined;
}

export function getGithubTestPassword(): string | undefined {
  const v = process.env.GITHUB_TEST_PASSWORD?.trim();
  return v || undefined;
}

/** playwright/.auth/github.json içindeki oturumu kullan (varsayılan: hayır, .env öncelikli). */
export function useSavedGithubSession(): boolean {
  const v = process.env.GITHUB_USE_SAVED_SESSION?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export function loadGithubStorageFromFile(): { cookies: unknown[]; origins: unknown[] } {
  if (!fs.existsSync(GITHUB_AUTH_FILE)) {
    return { cookies: [], origins: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(GITHUB_AUTH_FILE, 'utf-8'));
    return { cookies: data.cookies ?? [], origins: data.origins ?? [] };
  } catch {
    console.log('[github-auth] ⚠️ [UYARI] Eski GitHub oturum dosyası okunamadı. (Dosya: playwright/.auth/github.json)');
    return { cookies: [], origins: [] };
  }
}

/** global-setup / test: .env hesabı için kayıtlı GitHub çerezlerini storage state’e ekleme. */
export function githubCookiesForStorageState(): { cookies: unknown[]; origins: unknown[] } {
  const envUser = getGithubTestUser();
  if (envUser && !useSavedGithubSession()) {
    if (fs.existsSync(GITHUB_AUTH_FILE)) {
      console.log(
        `[github-auth] ℹ️ [BİLGİ] Kayıtlı GitHub oturumu yoksayılıyor, .env dosyası ile yeni giriş yapılacak. (Kullanıcı: ${envUser}, Dosya: playwright/.auth/github.json)`
      );
      console.log('[github-auth] 💡 [BİLGİ] Kayıtlı oturumu kullanmak için GITHUB_USE_SAVED_SESSION=1 yapabilirsiniz.');
    }
    return { cookies: [], origins: [] };
  }
  if (fs.existsSync(GITHUB_AUTH_FILE)) {
    const loaded = loadGithubStorageFromFile();
    console.log(`[github-auth] 🔑 [OTURUM] Kayıtlı GitHub oturumu yükleniyor. (${loaded.cookies.length} adet çerez yüklendi)`);
    return loaded;
  }
  return { cookies: [], origins: [] };
}

export function logGithubAuthPlan(): void {
  const envUser = getGithubTestUser();
  if (envUser) {
    console.log(`[github-auth] 🚀 [PLAN] Test süreci için hedef GitHub hesabı belirlendi: ${envUser} (Kaynak: .env GITHUB_TEST_USER)`);
  } else {
    console.log('[github-auth] ℹ️ [BİLGİ] GITHUB_TEST_USER tanımlı değil; E2E_USER_EMAIL veya kayıtlı tarayıcı oturumu kullanılacak.');
  }
}

function isGithubCookieDomain(domain: string): boolean {
  const d = domain.replace(/^\./, '').toLowerCase();
  return d === 'github.com' || d.endsWith('.github.com');
}

export async function clearGithubCookies(context: BrowserContext): Promise<void> {
  const all = await context.cookies();
  const githubOnly = all.filter((c) => isGithubCookieDomain(c.domain));
  if (githubOnly.length === 0) {
    return;
  }
  const keep = all.filter((c) => !isGithubCookieDomain(c.domain));
  await context.clearCookies();
  if (keep.length > 0) {
    await context.addCookies(keep);
  }
  console.log(`[github-auth] 🧹 [OTURUM] Tarayıcıdaki eski GitHub çerezleri temizlendi. (${githubOnly.length} adet çerez silindi, .env ile yeni giriş zorlanacak)`);
}

/**
 * OAuth öncesi: .env hesabı kullanılacaksa github.com oturumunu sıfırla.
 */
export async function prepareGithubOAuthSession(context: BrowserContext): Promise<void> {
  logGithubAuthPlan();
  if (getGithubTestUser() && !useSavedGithubSession()) {
    await clearGithubCookies(context);
  }
}

/** Login formu yoksa farklı hesaba geçmeyi dene (logout → tekrar OAuth). */
export async function ensureGithubLoginFormIfEnvUser(oauthPage: Page): Promise<void> {
  const envUser = getGithubTestUser();
  if (!envUser || useSavedGithubSession()) {
    return;
  }

  const loginInput = oauthPage.locator('input[name="login"]');
  if (await loginInput.isVisible().catch(() => false)) {
    return;
  }

  const body = ((await oauthPage.locator('body').innerText().catch(() => '')) || '').toLowerCase();
  const envLower = envUser.toLowerCase();
  if (body.includes(envLower)) {
    console.log(`[github-auth] 🔍 [KONTROL] GitHub arayüzünde doğru test hesabı açık: ${envUser}`);
    return;
  }

  console.log(
    `[github-auth] ⚠️ [UYARI] GitHub oturumu başka hesapta (login formu yok, "${envUser}" metinde yok). Çıkış deneniyor...`
  );

  await clearGithubCookies(oauthPage.context());
  await oauthPage.goto('https://github.com/logout', { waitUntil: 'domcontentloaded', timeout: 20_000 }).catch(() => {});
  await oauthPage.evaluate(() => new Promise(r => setTimeout(r, 800)));

  const signOut = oauthPage
    .getByRole('button', { name: /sign out|çıkış/i })
    .or(oauthPage.locator('button[type="submit"]').filter({ hasText: /sign out/i }))
    .first();
  if (await signOut.isVisible().catch(() => false)) {
    await signOut.click().catch(() => {});
    await oauthPage.evaluate(() => new Promise(r => setTimeout(r, 1000)));
  }

  await clearGithubCookies(oauthPage.context());
}
