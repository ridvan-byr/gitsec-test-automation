import { test } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import {
  openDashboard,
  ensureDashboard,
  getDashboardUrl,
  getActiveWorkspaceId,
  dismissOverlays,
  clickDashboardSummaryCardLinks,
  clickBackupStorageUsageWidget,
  assertRecentActivitiesWidget,
  clickWidgetViewAll,
  assertActivitiesBackupPage,
  assertSidebarToggleInteractive,
  assertGlobalSearchInput,
  clickHeadsUpButton,
  clickPlanBadgeAndClose,
  clickHeaderHelpButton,
  clickAllThemeOptions,
  clickAllSidebarNavigation,
  clickAllProfileMenuItems,
} from '../../support/dashboard-layout-ui-helpers';

test.describe('Dashboard & Layout UI — Birleşik Arayüz ve Widget Doğrulama', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;
  let dashboardUrl: string;

  test.beforeAll(() => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    dashboardUrl = getDashboardUrl(dashboardBaseUrl, workspaceId);
  });

  test(
    'Dashboard — tüm tıklanabilir öğeler (kartlar, header, sidebar, profil menüsü)',
    { tag: ['@manual-interactive'] },
    async ({ page }) => {
      test.setTimeout(240_000);

      const activeWorkspaceId = await getActiveWorkspaceId(page, workspaceId);
      const activeDashboardUrl = getDashboardUrl(dashboardBaseUrl, activeWorkspaceId);
      const activityUrlPattern = new RegExp(`/${activeWorkspaceId}/activity`);

      // 1) Dashboard widget'ları (videodaki sıra)
      await test.step('1 — Özet kartlar: Repositories, Backups, Success Rate, Storage Size', async () => {
        await openDashboard(page, dashboardBaseUrl, activeWorkspaceId);
        await clickDashboardSummaryCardLinks(page, activeWorkspaceId, activeDashboardUrl);
      });

      await test.step('2 — Backup Storage Usage grafiği', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickBackupStorageUsageWidget(page);
      });

      await test.step('3 — Recent Activities öğe tıklama', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await assertRecentActivitiesWidget(page, activeDashboardUrl);
      });

      await test.step('4 — Active Tasks → View all', async () => {
        await clickWidgetViewAll(page, /Active Tasks|Aktif Görevler/i, activityUrlPattern, activeDashboardUrl);
        await assertActivitiesBackupPage(page, activeWorkspaceId);
      });

      await test.step('5 — Recently Completed → View all', async () => {
        await clickWidgetViewAll(
          page,
          /Recently Completed|Son Tamamlananlar/i,
          new RegExp(`/${activeWorkspaceId}/(executions|tasks|backups|activity)`),
          activeDashboardUrl,
        );
        await assertActivitiesBackupPage(page, activeWorkspaceId);
      });

      // 2) Header kontrolleri
      await test.step('6 — Sidebar aç/kapa (Toggle Sidebar)', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await assertSidebarToggleInteractive(page);
        await dismissOverlays(page);
      });

      await test.step('7 — Global arama (Ctrl+K)', async () => {
        await assertGlobalSearchInput(page);
      });

      await test.step('8 — Heads up / Take a Tour', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickHeadsUpButton(page);
      });

      await test.step('9 — Plan rozeti (Premium / Startup)', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickPlanBadgeAndClose(page, activeWorkspaceId);
      });

      await test.step('10 — Soru işareti / Take a Tour (yardım)', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickHeaderHelpButton(page);
      });

      await test.step('11 — Tema: Light → Dark → System (System ile bitir)', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickAllThemeOptions(page);
      });

      // 3) Sidebar — tüm menü linkleri
      await test.step('12 — Sidebar: Repositories, Backups, Restores, Schedulers, Storage, Activity, Audit, License, Billing, Documentation', async () => {
        await ensureDashboard(page, activeDashboardUrl);
        await clickAllSidebarNavigation(page, activeWorkspaceId);
      });

      // 4) Profil menüsü
      await test.step('13 — Profil: User Settings, Addresses, Sign out (çıkış)', async () => {
        await clickAllProfileMenuItems(page, activeWorkspaceId);
      });

      await test.step('14 — Tamamlandı', async () => {
        console.log('✅ Dashboard tüm tıklanabilir öğeler testi tamamlandı (Sign out ile oturum kapatıldı).');
      });
    },
  );
});
