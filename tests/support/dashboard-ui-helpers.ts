import { expect, Page } from '@playwright/test';
import { GitSecPage } from '../fixtures/test';

export function configureDashboardPageErrors(page: Page) {
  (page as GitSecPage).ignoredErrors = [
    /502/,
    /404/,
    /_next\/static\/chunks/i,
    /Failed to load resource/i,
    /ChunkLoadError/i
  ];
}

async function waitForDashboardReady(page: Page) {
  const tourButton = page.getByRole('button', { name: 'Take a Tour' });
  const layout = page.locator('main, aside, nav').first();

  try {
    await expect(tourButton).toBeVisible({ timeout: 20000 });
    return;
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(tourButton.or(layout)).toBeVisible({ timeout: 20000 });
  }
}

export function getDashboardUrl(dashboardBaseUrl: string, workspaceId: string) {
  return `${dashboardBaseUrl}/${workspaceId}/dashboard`;
}

export async function openDashboard(page: Page, dashboardBaseUrl: string, workspaceId: string) {
  configureDashboardPageErrors(page);
  const targetUrl = getDashboardUrl(dashboardBaseUrl, workspaceId);
  console.log(`🌐 [UI TEST] Dashboard sayfasına yönleniliyor: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /Page Not Found/i })).toBeHidden({ timeout: 5000 });
  await waitForDashboardReady(page);
  await page.locator('main, aside, nav').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  return targetUrl;
}

/** Sayfa zaten dashboard URL'sindeyse asla yeniden yüklemez. */
export async function ensureDashboard(page: Page, targetUrl: string) {
  configureDashboardPageErrors(page);
  await page.keyboard.press('Escape').catch(() => {});

  if (page.url().includes('/dashboard')) {
    return;
  }

  console.log(`↩️ [UI TEST] Dashboard'a dönülüyor: ${targetUrl}`);
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await waitForDashboardReady(page);
}

export type DashboardSessionState = { opened: boolean };

/** Headed modda tarayıcının anında kapanmasını önlemek için kısa bekleme. */
export async function pauseIfHeaded(page: Page, ms = 1200) {
  if (process.env.PW_HEADED === '1') {
    await page.waitForTimeout(ms);
  }
}

/** Suite boyunca tek sefer aç; sayfa dashboard'da değilse yeniden yükler. */
export async function prepareDashboardSession(
  page: Page,
  session: DashboardSessionState,
  dashboardBaseUrl: string,
  workspaceId: string,
) {
  const dashboardUrl = getDashboardUrl(dashboardBaseUrl, workspaceId);
  const onDashboard = page.url().includes('/dashboard');

  if (!session.opened || !onDashboard) {
    await openDashboard(page, dashboardBaseUrl, workspaceId);
    session.opened = true;
    return dashboardUrl;
  }

  await ensureDashboard(page, dashboardUrl);
  return dashboardUrl;
}
