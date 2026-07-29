import { test } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import { openDashboard, pauseIfHeaded } from '../../support/dashboard-ui-helpers';
import {
  assertSidebarToggleInteractive,
  assertGlobalSearchInput,
  assertUserProfileMenu,
  assertThemeMenuAndRevert,
  navigateViaSidebarLink,
} from '../../support/layout-ui-helpers';

test.describe('Global Layout & Common UI Components (Genel Arayüz & Ortak Bileşenler)', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;

  test.beforeAll(() => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  });

  test('Ortak Arayüz & Navigasyon Bileşenleri — Sidebar, Arama, Profil, Tema', { tag: ['@manual-interactive'] }, async ({ page }) => {
    await openDashboard(page, dashboardBaseUrl, workspaceId);

    await test.step('Kısım 1: Sidebar Daraltma ve Genişletme (Toggle Sidebar) Butonu', async () => {
      await assertSidebarToggleInteractive(page);
      await page.keyboard.press('Escape').catch(() => {});
    });

    await test.step('Kısım 2: Global Arama (Search) Giriş Alanı Kontrolü', async () => {
      await assertGlobalSearchInput(page);
    });

    await test.step('Kısım 3: Kullanıcı Profil Dropdown Menüsü ve Çıkış Butonu Durumu', async () => {
      await assertUserProfileMenu(page);
    });

    await test.step('Kısım 4: Tema Değiştirme (Theme Toggle) Dropdown Bileşeni Kontrolü', async () => {
      await assertThemeMenuAndRevert(page);
    });

    await test.step('Kısım 5: Backup Snapshots sayfasında ortak bileşenler', async () => {
      await navigateViaSidebarLink(page, /^Backup Snapshots$/i, new RegExp(`/${workspaceId}/backups`));
      await assertSidebarToggleInteractive(page);
      await assertGlobalSearchInput(page);
      console.log('✅ Backup Snapshots sayfasında ortak layout bileşenleri doğrulandı.');
    });

    await pauseIfHeaded(page);
  });
});
