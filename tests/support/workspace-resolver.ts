import type { Page, APIRequestContext } from '@playwright/test';

let cachedWorkspaceId: string | null = null;

/**
 * Kullanıcının Workspace ID bilgisini tüm testler genelinde %100 otomatik tespit eder.
 * .env dosyasında WORKSPACE_ID olmasa veya yanlış olsa dahi API, LocalStorage ve URL yönlendirmesinden doğru ID'yi bulur.
 */
export async function getWorkspaceId(page: Page, request?: APIRequestContext): Promise<string> {
  if (cachedWorkspaceId) {
    return cachedWorkspaceId;
  }

  const envValue = process.env.WORKSPACE_ID?.trim();
  if (envValue) {
    cachedWorkspaceId = envValue;
    return envValue;
  }

  const apiBaseUrl = process.env.API_BASE_URL || 'https://staging.api.gitsec.io';
  const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL || 'https://staging.dashboard.gitsec.io';

  // 1. API Üzerinden kullanıcının aktif workspace'ini sorgula
  if (request) {
    try {
      const authCookie = (await page.context().cookies()).find(c => c.name === 'gs_token');
      if (authCookie?.value) {
        const res = await request.get(`${apiBaseUrl}/api/workspaces`, {
          headers: { Authorization: `Bearer ${authCookie.value}` }
        });
        if (res.ok()) {
          const body = await res.json();
          const first = body?.data?.list?.[0] || body?.data?.[0] || body?.data;
          if (first?.id) {
            const detected = String(first.id);
            console.log(`🔍 [AUTODETECT] Workspace ID API'den otomatik tespit edildi: ${detected}`);
            cachedWorkspaceId = detected;
            return detected;
          }
        }
      }
    } catch {
      // ignore & try next
    }
  }

  // 2. LocalStorage gs-auth / gs-workspace içerisinden al
  try {
    const lsWorkspaceId = await page.evaluate(() => {
      try {
        const raw = window.localStorage.getItem('gs-auth');
        if (raw) {
          const parsed = JSON.parse(raw);
          return parsed?.state?.auth?.user?.workspaceId || parsed?.state?.workspace?.currentWorkspaceId;
        }
      } catch {
        return null;
      }
      return null;
    });

    if (lsWorkspaceId) {
      const detected = String(lsWorkspaceId);
      console.log(`🔍 [AUTODETECT] Workspace ID LocalStorage'dan otomatik tespit edildi: ${detected}`);
      cachedWorkspaceId = detected;
      return detected;
    }
  } catch {
    // ignore
  }

  // 3. Tarayıcıyı dashboard'a yönlendirip URL'deki workspace id'yi yakala
  try {
    await page.goto(dashboardBaseUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/dashboard\.gitsec\.io\/\d+/i, { timeout: 15_000 }).catch(() => {});
    const match = page.url().match(/dashboard\.gitsec\.io\/(\d+)/);
    if (match) {
      const detected = match[1];
      console.log(`🔍 [AUTODETECT] Workspace ID URL yönlendirmesinden otomatik tespit edildi: ${detected}`);
      cachedWorkspaceId = detected;
      return detected;
    }
  } catch {
    // ignore
  }

  throw new Error('❌ [AUTODETECT] Kullanıcıya ait Workspace ID ne API, ne LocalStorage ne de URL üzerinden otomatik tespit edilemedi.');
}

export function clearWorkspaceCache(): void {
  cachedWorkspaceId = null;
}
