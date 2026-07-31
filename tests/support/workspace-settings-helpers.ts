import { expect, Page, APIRequestContext } from '@playwright/test';
import { requireEnv } from './require-env';

export type WorkspaceInfo = {
  id: string;
  name: string;
};

export async function fetchWorkspaceInfo(page: Page, request?: APIRequestContext): Promise<WorkspaceInfo> {
  const workspaceId = requireEnv('WORKSPACE_ID');
  const apiBaseUrl = requireEnv('API_BASE_URL');
  let name = process.env.E2E_WORKSPACE_NAME?.trim() || '';

  if (request) {
    try {
      const authCookie = (await page.context().cookies()).find(c => c.name === 'gs_token');
      if (authCookie?.value) {
        const response = await request.get(`${apiBaseUrl}/api/workspaces`, {
          headers: { Authorization: `Bearer ${authCookie.value}` },
        });
        if (response.ok()) {
          const body = await response.json();
          const list = Array.isArray(body?.data?.list)
            ? body.data.list
            : Array.isArray(body?.data)
              ? body.data
              : body?.data?.id
                ? [body.data]
                : [];
          const match = list.find((ws: { id?: string | number }) => String(ws?.id) === workspaceId) || list[0];
          if (match?.name) {
            name = String(match.name);
          }
        }
      }
    } catch {
      // fallback to sidebar detection below
    }
  }

  if (!name) {
    await page.locator('[data-slot="sidebar"]').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const trigger = page.locator('[data-slot="sidebar"]')
      .getByRole('button')
      .filter({ hasText: /.+/ })
      .first();
    const triggerText = (await trigger.innerText().catch(() => '')).trim();
    if (triggerText) {
      name = triggerText.split('\n')[0].trim();
    }
  }

  if (!name) {
    name = 'Workspace';
  }

  return { id: workspaceId, name };
}

export function getWorkspaceTrigger(page: Page, workspaceName?: string) {
  const byName = workspaceName
    ? page.locator('[data-slot="sidebar"]').getByRole('button', { name: new RegExp(workspaceName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') })
    : page.locator('nothing-matching');

  return byName
    .or(page.locator('[data-slot="sidebar"]').getByRole('button', { name: /Workspace/i }))
    .or(page.locator('[data-slot="sidebar"] list').first().getByRole('button').first())
    .first();
}

export async function ensureSidebarExpanded(page: Page) {
  const sidebar = page.locator('[data-slot="sidebar"]').first();
  const toggleSidebarButton = page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).last();

  if (!(await sidebar.isVisible().catch(() => false))) {
    await expect(toggleSidebarButton).toBeVisible();
    await toggleSidebarButton.click();
  }

  const sidebarState = await sidebar.getAttribute('data-state').catch(() => null);
  if (sidebarState === 'collapsed') {
    await toggleSidebarButton.click();
    await expect(sidebar).toHaveAttribute('data-state', 'expanded', { timeout: 8000 });
  }
}

export async function openWorkspaceSwitcher(page: Page, workspaceName?: string) {
  await page.keyboard.press('Escape');
  await ensureSidebarExpanded(page);

  await expect.poll(async () => {
    const trigger = getWorkspaceTrigger(page, workspaceName);
    if (!(await trigger.isVisible().catch(() => false))) {
      return false;
    }
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    return true;
  }, { timeout: 15000 }).toBe(true);

  const wsTrigger = getWorkspaceTrigger(page, workspaceName);
  const workspaceMenu = page.getByRole('menu').first();
  if (!(await workspaceMenu.isVisible().catch(() => false))) {
    await wsTrigger.click();
  }

  await expect(workspaceMenu).toBeVisible({ timeout: 10000 });
  return { wsTrigger, workspaceMenu };
}

async function findSettingsSurface(page: Page) {
  const dialog = page.getByRole('dialog').first();
  if (await dialog.getByRole('button', { name: 'General' }).isVisible().catch(() => false)) {
    return dialog;
  }
  if (await page.getByText('Workspace Name', { exact: true }).isVisible().catch(() => false)) {
    return page.locator('main').last();
  }
  return null;
}

async function tryOpenSettingsViaDirectUrl(page: Page, workspaceId: string): Promise<boolean> {
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  const candidates = [
    `${dashboardBaseUrl}/${workspaceId}/settings`,
    `${dashboardBaseUrl}/${workspaceId}/workspace-settings`,
  ];

  for (const url of candidates) {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (await findSettingsSurface(page)) {
      console.log(`✅ [WORKSPACE] Settings sayfası URL ile açıldı: ${url}`);
      return true;
    }
  }
  return false;
}

async function tryOpenSettingsViaDropdown(page: Page, workspaceName?: string) {
  const { workspaceMenu } = await openWorkspaceSwitcher(page, workspaceName);
  const settingsBtn = workspaceMenu.getByRole('button', { name: 'Settings', exact: true })
    .or(workspaceMenu.getByText('Settings', { exact: true }))
    .first();

  if (!(await settingsBtn.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape');
    return null;
  }

  await settingsBtn.click();
  const surface = await findSettingsSurface(page);
  if (!surface) {
    await page.keyboard.press('Escape');
    return null;
  }
  console.log('✅ [WORKSPACE] Settings dropdown menüsünden açıldı.');
  return surface;
}

async function tryOpenSettingsViaSidebarLink(page: Page) {
  const settingsLink = page.getByRole('link', { name: /workspace settings|settings/i }).first();
  if (!(await settingsLink.isVisible().catch(() => false))) {
    return null;
  }
  await settingsLink.click();
  const surface = await findSettingsSurface(page);
  if (!surface) {
    return null;
  }
  console.log('✅ [WORKSPACE] Settings sidebar linkinden açıldı.');
  return surface;
}

export async function openSettingsSurface(page: Page, workspaceId: string, workspaceName?: string) {
  const fromDropdown = await tryOpenSettingsViaDropdown(page, workspaceName);
  if (fromDropdown) return fromDropdown;

  const fromSidebar = await tryOpenSettingsViaSidebarLink(page);
  if (fromSidebar) return fromSidebar;

  const fromUrl = await tryOpenSettingsViaDirectUrl(page, workspaceId);
  if (fromUrl) {
    const surface = await findSettingsSurface(page);
    if (surface) return surface;
  }

  return null;
}

export async function isWorkspaceSettingsAvailable(page: Page, workspaceId: string, workspaceName?: string): Promise<boolean> {
  const surface = await openSettingsSurface(page, workspaceId, workspaceName);
  if (surface) {
    await page.keyboard.press('Escape').catch(() => {});
    return true;
  }
  return false;
}
