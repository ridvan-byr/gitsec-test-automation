import { test } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import {
  openDashboard,
  ensureDashboard,
  getDashboardUrl,
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
    { tag: ['@manual-interactive'], timeout: 240_000 },
    async ({ page }) => {
      test.setTimeout(240_000);

      const activityUrlPattern = new RegExp(`/${workspaceId}/activity`);

      // 1) Dashboard widget'ları (videodaki sıra)
      await test.step('1 — Özet kartlar: Repositories, Backups, Success Rate, Storage Size', async () => {
        await openDashboard(page, dashboardBaseUrl, workspaceId);
        await clickDashboardSummaryCardLinks(page, workspaceId, dashboardUrl);
      });

      await test.step('2 — Backup Storage Usage grafiği', async () => {
        await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
        await ensureDashboard(page, dashboardUrl);
        await clickBackupStorageUsageWidget(page);
      });

      await test.step('3 — Recent Activities öğe tıklama', async () => {
        await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
        await ensureDashboard(page, dashboardUrl);
        await assertRecentActivitiesWidget(page, dashboardUrl);
      });

      await test.step('4 — Active Tasks → View all', async () => {
        await clickWidgetViewAll(page, /Active Tasks|Aktif Görevler/i, activityUrlPattern, dashboardUrl);
        await assertActivitiesBackupPage(page, workspaceId);
      });

      await test.step('5 — Recently Completed → View all', async () => {
        await clickWidgetViewAll(
          page,
          /Recently Completed|Son Tamamlananlar/i,
          new RegExp(`/${workspaceId}/(executions|tasks|backups|activity)`),
          dashboardUrl,
        );
        await assertActivitiesBackupPage(page, workspaceId);
      });

      // 2) Header kontrolleri
      await test.step('6 — Sidebar aç/kapa (Toggle Sidebar)', async () => {
        await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
        await ensureDashboard(page, dashboardUrl);
        await assertSidebarToggleInteractive(page);
        await dismissOverlays(page);
      });

      await test.step('7 — Global arama (Ctrl+K)', async () => {
        await assertGlobalSearchInput(page);
      });

      await test.step('8 — Heads up / Take a Tour', async () => {
        await ensureDashboard(page, dashboardUrl);
        await clickHeadsUpButton(page);
      });

      await test.step('9 — Plan rozeti (Premium / Startup)', async () => {
        await ensureDashboard(page, dashboardUrl);
        await clickPlanBadgeAndClose(page, workspaceId);
      });

      await test.step('10 — Soru işareti / Take a Tour (yardım)', async () => {
        await ensureDashboard(page, dashboardUrl);
        await clickHeaderHelpButton(page);
      });

      await test.step('11 — Tema: Light → Dark → System (System ile bitir)', async () => {
        await ensureDashboard(page, dashboardUrl);
        await clickAllThemeOptions(page);
      });

      // 3) Sidebar — tüm menü linkleri
      await test.step('12 — Sidebar: Repositories, Backups, Restores, Schedulers, Storage, Activity, Audit, License, Billing, Documentation', async () => {
        await page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' });
        await ensureDashboard(page, dashboardUrl);
        await clickAllSidebarNavigation(page, workspaceId);
      });

      // 4) Profil menüsü
      await test.step('13 — Profil: User Settings, Addresses, Sign out (çıkış)', async () => {
        await clickAllProfileMenuItems(page, workspaceId);
      });

      await test.step('14 — Tamamlandı', async () => {
        console.log('✅ Dashboard tüm tıklanabilir öğeler testi tamamlandı (Sign out ile oturum kapatıldı).');
      });
    },
  );
});
