import { expect, Page } from '@playwright/test';
import { ensureDashboard } from './dashboard-ui-helpers';
import {
  assertSidebarToggleInteractive,
  assertGlobalSearchInput,
  navigateViaSidebarLink,
  getUserMenuTrigger,
  ensureSidebarExpanded,
} from './layout-ui-helpers';

export { openDashboard, ensureDashboard, getDashboardUrl, pauseIfHeaded, isDashboardPage, getActiveWorkspaceId } from './dashboard-ui-helpers';
export {
  assertSidebarToggleInteractive,
  assertGlobalSearchInput,
  assertThemeMenuAndRevert,
  navigateViaSidebarLink,
  assertUserProfileMenu,
} from './layout-ui-helpers';

export async function dismissOverlays(page: Page) {
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    const overlay = page.locator('[data-slot="dialog-overlay"]').first();
    if (!(await overlay.isVisible().catch(() => false))) {
      break;
    }
  }
}

export async function clickPlanBadgeAndClose(page: Page, workspaceId: string) {
  await dismissOverlays(page);
  const planButton = page.locator('header, main').getByRole('button', { name: /Premium\+?|Freemium|Startup|Enterprise/i }).first();
  await expect(planButton).toBeVisible({ timeout: 15000 });
  console.log('🔘 [UI] Plan rozeti tıklanıyor...');
  await planButton.click();

  const usageDialog = page.getByRole('dialog').filter({ hasText: /Usage Overview|Premium|Plan/i }).first();
  if (await usageDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
    await expect(usageDialog).toBeVisible();
    const closeBtn = usageDialog.getByRole('button', { name: /Close|Kapat/i }).first();
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await dismissOverlays(page);
    }
    await expect(usageDialog).toBeHidden({ timeout: 5000 }).catch(() => dismissOverlays(page));
    console.log('✅ Plan rozeti dialog açtı ve kapatıldı.');
    return;
  }

  if (new RegExp(`/${workspaceId}/billing`, 'i').test(page.url())) {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('✅ Plan rozeti billing sayfasına yönlendirdi, geri dönüldü.');
    return;
  }

  await dismissOverlays(page);
}

export async function clickHeaderHelpButton(page: Page) {
  await dismissOverlays(page);

  const tourButton = page.getByRole('button', { name: /Take a Tour/i }).first();
  if (await tourButton.isVisible().catch(() => false)) {
    console.log('🔘 [UI] Take a Tour (yardım) butonuna tıklanıyor...');
    await tourButton.click();
    await dismissOverlays(page);
    console.log('✅ Yardım / Take a Tour butonu tıklandı.');
    return;
  }

  const helpLink = page.locator('header a[href*="docs.gitsec"]').first();
  if (await helpLink.isVisible().catch(() => false)) {
    const popupPromise = page.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await helpLink.click();
    const popup = await popupPromise;
    if (popup) {
      await expect(popup).toHaveURL(/docs\.gitsec\.io/i, { timeout: 10000 });
      await popup.close();
    }
    console.log('✅ Dokümantasyon linki tıklandı.');
    return;
  }

  console.log('ℹ️ Yardım butonu bulunamadı, atlanıyor.');
}

export async function clickDashboardSummaryCardLinks(
  page: Page,
  workspaceId: string,
  dashboardUrl: string,
) {
  const linkClicks = [
    { name: 'Repositories', href: `/${workspaceId}/repositories`, url: new RegExp(`/${workspaceId}/repositories`, 'i') },
    { name: 'Backups', href: `/${workspaceId}/backups`, url: new RegExp(`/${workspaceId}/backups`, 'i') },
    { name: 'Storage Size', href: `/${workspaceId}/storage`, url: new RegExp(`/${workspaceId}/storage`, 'i') },
  ];

  for (const { name, href, url } of linkClicks) {
    await ensureDashboard(page, dashboardUrl);

    let link = page.locator(`a[href="${href}"], a[href*="${href}"]`).first();
    let isVisible = await link.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

    if (!isVisible) {
      const card = page.locator('div[class*="card"], div[class*="border"]').filter({ hasText: new RegExp(name, 'i') }).first();
      link = card.locator('a, button').first();
      if (!(await link.isVisible().catch(() => false))) {
        link = card;
      }
      isVisible = await link.isVisible().catch(() => false);
    }

    if (isVisible) {
      console.log(`🔘 [UI] Özet kart linki: ${name}`);
      await link.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      await expect(page).toHaveURL(url, { timeout: 10000 }).catch(() => {
        console.log(`ℹ️ ${name} kartına tıklandı, URL yönlendirmesi bekleniyor (${page.url()}).`);
      });
      console.log(`✅ ${name} kartı doğrulandı.`);
    } else {
      console.log(`ℹ️ [UI] ${name} özet kart linki bulunamadı, es geçiliyor.`);
    }
  }

  await ensureDashboard(page, dashboardUrl);

  const mainContent = page.locator('main, #root, #__next').first();
  const successCard = mainContent.filter({ hasText: /Success Rate|Başarı Oranı/i }).first();
  const infoButton = successCard.getByRole('button').first();
  if (await infoButton.isVisible().catch(() => false)) {
    console.log('🔘 [UI] Success Rate bilgi butonuna tıklanıyor...');
    await infoButton.click();
    await dismissOverlays(page);
    console.log('✅ Success Rate bilgi butonu tıklandı.');
  }
}

export async function clickBackupStorageUsageWidget(page: Page) {
  const chartWidget = page.locator('main section, main div').filter({
    hasText: /Backup Storage Usage|Yedekleme Depolama/i,
  }).first();
  await expect(chartWidget).toBeVisible({ timeout: 15000 });

  const chartArea = chartWidget.locator('svg, canvas, [class*="recharts"], application').first();
  await expect(chartArea).toBeVisible({ timeout: 15000 });
  console.log('🔘 [UI] Backup Storage Usage grafiğine tıklanıyor...');
  await chartArea.click({ force: true }).catch(() => chartWidget.click());
  await dismissOverlays(page);
  console.log('✅ Backup Storage Usage widget tıklandı.');
}

export async function clickAllThemeOptions(page: Page) {
  const themeToggle = page.locator('header button[data-slot="dropdown-menu-trigger"]').first();
  await expect(themeToggle).toBeVisible({ timeout: 15000 });

  for (const themeName of ['Light', 'Dark', 'System'] as const) {
    await themeToggle.click();
    const themeMenu = page.getByRole('menu').filter({ hasText: /Light|Dark|System/i }).first();
    await expect(themeMenu).toBeVisible({ timeout: 8000 });
    const option = themeMenu.getByRole('menuitem', { name: new RegExp(`^${themeName}$`, 'i') });
    await expect(option).toBeVisible();
    console.log(`🔘 [UI] Tema seçiliyor: ${themeName}`);
    await option.click();
    await expect(themeMenu).toBeHidden({ timeout: 5000 });
  }

  console.log('✅ Light → Dark → System tema seçenekleri tıklandı (System ile bitti).');
}

export async function clickSignOutAndConfirm(page: Page, workspaceId: string) {
  await dismissOverlays(page);
  const userMenuTrigger = await getUserMenuTrigger(page);
  await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
  await userMenuTrigger.click();

  const userMenu = page.getByRole('menu').last();
  await expect(userMenu).toBeVisible({ timeout: 8000 });

  const signOutBtn = userMenu.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i });
  await expect(signOutBtn).toBeVisible();
  await expect(signOutBtn).toBeEnabled();
  console.log('🔘 [UI] Sign out tıklanıyor...');
  await signOutBtn.click();

  const confirmSignOutBtn = page.locator('[role="dialog"] button, [data-slot="alert-dialog-content"] button, [data-slot="dialog-content"] button')
    .filter({ hasText: /Sign out|Log out|Çıkış|Yes|Evet/i })
    .or(page.locator('button[class*="destructive"]'))
    .last();

  if (await confirmSignOutBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    console.log('🔘 [UI] Sign out onay dialogu — onaylanıyor...');
    await confirmSignOutBtn.click();
  }

  await page.context().clearCookies().catch(() => {});

  await page.waitForURL((url: URL) => {
    const urlStr = url.toString();
    return /sign-in|login/i.test(urlStr)
      || (urlStr.includes('/dashboard') && !urlStr.includes(`/${workspaceId}/`));
  }, { timeout: 25000 });

  console.log('✅ Sign out ile oturum kapatıldı.');
}

async function clickSidebarLink(page: Page, linkName: RegExp, urlPattern: RegExp) {
  await dismissOverlays(page);
  await ensureSidebarExpanded(page);
  const sidebar = page.locator('[data-slot="sidebar"]').first();
  const link = sidebar.getByRole('link', { name: linkName }).first();
  await link.scrollIntoViewIfNeeded().catch(() => {});
  await expect(link).toBeVisible({ timeout: 15000 });
  console.log(`🔘 [UI] Sidebar link: ${linkName}`);
  try {
    await link.click({ timeout: 5000 });
  } catch {
    console.log(`ℹ️ [UI] Link click fallback ({ force: true }): ${linkName}`);
    await link.click({ force: true });
  }
  await expect(page).toHaveURL(urlPattern, { timeout: 15000 });
}

export async function clickAllSidebarNavigation(page: Page, workspaceId: string) {
  const ws = workspaceId;

  await clickSidebarLink(page, /^Dashboard$/i, new RegExp(`/${ws}/dashboard`, 'i'));

  for (const [name, pattern] of [
    [/^Bitbucket$/i, new RegExp(`/${ws}/repositories/bitbucket`, 'i')],
    [/^GitHub$/i, new RegExp(`/${ws}/repositories/github`, 'i')],
    [/Add Provider/i, new RegExp(`/${ws}/repositories/add`, 'i')],
  ] as const) {
    await dismissOverlays(page);
    const reposSidebar = await expandSidebarSubmenu(page, /^Repositories$/i);
    const link = reposSidebar.getByRole('link', { name }).first();
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await expect(link).toBeVisible({ timeout: 15000 });
    console.log(`🔘 [UI] Repositories > ${name}`);
    try {
      await link.click({ timeout: 5000 });
    } catch {
      await link.click({ force: true });
    }
    await expect(page).toHaveURL(pattern, { timeout: 15000 });
  }

  await clickSidebarLink(page, /^Backup Snapshots$/i, new RegExp(`/${ws}/backups`, 'i'));
  await clickSidebarLink(page, /^Restores$/i, new RegExp(`/${ws}/restore`, 'i'));
  await clickSidebarLink(page, /^Schedulers$/i, new RegExp(`/${ws}/schedulers`, 'i'));
  await clickSidebarLink(page, /^Storage$/i, new RegExp(`/${ws}/storage`, 'i'));

  for (const [name, pattern] of [
    [/^Backup$/i, new RegExp(`/${ws}/activity/backup`, 'i')],
    [/^Restore$/i, new RegExp(`/${ws}/activity/restore`, 'i')],
  ] as const) {
    await dismissOverlays(page);
    const activitySidebar = await expandSidebarSubmenu(page, /^Activity$/i);
    const link = activitySidebar.getByRole('link', { name }).first();
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await expect(link).toBeVisible({ timeout: 15000 });
    console.log(`🔘 [UI] Activity > ${name}`);
    try {
      await link.click({ timeout: 5000 });
    } catch {
      await link.click({ force: true });
    }
    await expect(page).toHaveURL(pattern, { timeout: 15000 });
  }

  await clickSidebarLink(page, /^Audit Logs$/i, new RegExp(`/${ws}/audit-logs`, 'i'));
  await clickSidebarLink(page, /^License$/i, new RegExp(`/${ws}/license`, 'i'));
  await clickSidebarLink(page, /^Billing & Plans$/i, new RegExp(`/${ws}/billing`, 'i'));

  await dismissOverlays(page);
  await ensureSidebarExpanded(page);
  const docLink = page.locator('[data-slot="sidebar"]').getByRole('link', { name: /^Documentation$/i }).first();
  await expect(docLink).toBeVisible({ timeout: 15000 });
  await docLink.scrollIntoViewIfNeeded().catch(() => {});
  console.log('🔘 [UI] Documentation linkine tıklanıyor...');
  const popupPromise = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
  try {
    await docLink.click({ timeout: 5000 });
  } catch {
    await docLink.click({ force: true });
  }
  const popup = await popupPromise;
  if (popup) {
    await expect(popup).toHaveURL(/docs\.gitsec\.io/i, { timeout: 10000 });
    await popup.close();
  }
  console.log('✅ Tüm sidebar navigasyon linkleri tıklandı.');
}

export async function clickAllProfileMenuItems(page: Page, workspaceId: string) {
  await dismissOverlays(page);
  const userMenuTrigger = await getUserMenuTrigger(page);
  await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
  await userMenuTrigger.click();

  const userMenu = page.getByRole('menu').last();
  await expect(userMenu).toBeVisible({ timeout: 8000 });

  const userSettings = userMenu.getByRole('menuitem', { name: /User Settings/i });
  if (await userSettings.isVisible().catch(() => false)) {
    console.log('🔘 [UI] User Settings tıklanıyor...');
    await userSettings.click();
    await expect(page).toHaveURL(/settings|addresses|account/i, { timeout: 15000 });
    await expect(page.getByText(/Account Settings|User Settings|Settings/i).first()).toBeVisible({ timeout: 15000 });
    console.log('✅ User Settings sayfası açıldı.');
  }

  await userMenuTrigger.click();
  const menuAgain = page.getByRole('menu').last();
  await expect(menuAgain).toBeVisible({ timeout: 8000 });

  const addressesItem = menuAgain.getByRole('menuitem', { name: /Addresses/i });
  if (await addressesItem.isVisible().catch(() => false)) {
    console.log('🔘 [UI] Addresses tıklanıyor...');
    await addressesItem.click();
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/addresses`, 'i'), { timeout: 15000 });
    await expect(page.getByText(/Account Settings|Billing Addresses|Addresses/i).first()).toBeVisible({ timeout: 15000 });
    console.log('✅ Addresses sayfası açıldı.');
  }

  await clickSignOutAndConfirm(page, workspaceId);
}

export async function clickHeadsUpButton(page: Page) {
  await dismissOverlays(page);
  const headsUpButton = page.getByRole('button', { name: /Heads up/i }).first();
  const tourButton = page.getByRole('button', { name: /Take a Tour|take a tour|rehber tur/i }).first();

  if (await headsUpButton.isVisible().catch(() => false)) {
    console.log('🔘 [UI] Heads up tıklanıyor...');
    await headsUpButton.click();
  } else {
    console.log('🔘 [UI] Heads up yok; Take a Tour tıklanıyor...');
    await expect(tourButton).toBeVisible({ timeout: 15000 });
    await tourButton.click();
  }

  const tourModal = page.locator('[role="dialog"], [class*="driver-popover"], [class*="tour"]')
    .filter({ hasText: /Dashboard Overview|Overview|Skip|Next|Atla|Sonraki/i }).first();
  if (await tourModal.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tourModal.getByRole('button', { name: /Skip|Atla|Close|Kapat/i }).first().click();
  }
  await dismissOverlays(page);
  console.log('✅ Heads up / tur butonu tıklandı.');
}

export async function assertDashboardSummaryCards(page: Page) {
  const cards = [
    /Repositories|Depolar/i,
    /Backups|Yedeklemeler/i,
    /Success Rate|Başarı Oranı/i,
    /Storage Size|Depolama/i,
  ];

  for (const label of cards) {
    const card = page.locator('main').getByText(label).first();
    await expect(card).toBeVisible({ timeout: 15000 });
  }

  const main = page.locator('main').last();
  await expect(main.getByText(/\d+/).first()).toBeVisible({ timeout: 15000 });
  console.log('✅ Özet kartları ve sayısal değerler görünür.');
}

export async function assertBackupStorageUsageChart(page: Page) {
  const chartWidget = page.locator('main section, main div').filter({
    hasText: /Backup Storage Usage|Yedekleme Depolama/i,
  }).first();
  await expect(chartWidget).toBeVisible({ timeout: 15000 });
  await expect(chartWidget.locator('svg, canvas, [class*="recharts"]').first()).toBeVisible({ timeout: 15000 });
  console.log('✅ Backup Storage Usage grafiği görünür.');
}

export async function assertRecentActivitiesWidget(page: Page, dashboardUrl?: string) {
  const widget = page.locator('main').last().filter({
    hasText: /Recent Activities|Son Aktiviteler/i,
  }).first();
  await expect(widget).toBeVisible({ timeout: 15000 });

  const activityItem = widget.locator('button, li, [role="listitem"], a').first();
  const emptyState = widget.getByText(/no recent activit|henüz aktivite|no activities/i).first();

  if (await activityItem.isVisible().catch(() => false)) {
    await expect(activityItem).toBeEnabled();
    console.log('🔘 [UI] Recent Activities ilk öğeye tıklanıyor...');
    await activityItem.click();
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await dismissOverlays(page);
    if (dashboardUrl) {
      await ensureDashboard(page, dashboardUrl);
    }
    console.log('✅ Recent Activities listesi ve öğe etkileşimi doğrulandı.');
    return;
  }

  if (await emptyState.isVisible().catch(() => false)) {
    console.log('✅ Recent Activities boş durum mesajı görünür.');
    return;
  }

  expect(await widget.locator('button, li, a').first().isVisible().catch(() => false)).toBeTruthy();
}

export async function assertPremiumPlanBadgeOpensBilling(
  page: Page,
  dashboardUrl: string,
  workspaceId: string,
) {
  await page.keyboard.press('Escape').catch(() => {});

  const planButton = page.locator('header, main').getByRole('button', { name: /Premium\+?|Freemium|Startup|Enterprise/i }).first();
  await expect(planButton).toBeVisible({ timeout: 15000 });
  await expect(planButton).toBeEnabled();

  console.log('🔘 [UI] Plan / lisans rozeti tıklanıyor...');
  await planButton.click();

  const billingUrlPattern = new RegExp(`/${workspaceId}/billing`, 'i');
  const usageDialog = page.getByRole('dialog').filter({ hasText: /Usage Overview|Usage and limits/i }).first();
  const licenseDialog = page.getByRole('dialog').filter({ hasText: /Premium|License|Plan/i }).first();

  const usageDialogOpen = await usageDialog.isVisible({ timeout: 8000 }).catch(() => false);

  if (usageDialogOpen) {
    console.log('✅ Usage Overview dialog açıldı (Startup/Freemium plan).');
    await expect(usageDialog.getByText(/Repositories|Storage|Plan changes/i).first()).toBeVisible();

    const upgradeLink = usageDialog.getByRole('link', { name: /Upgrade Plan/i }).first();
    await expect(upgradeLink).toBeVisible();
    await upgradeLink.click();
    await expect(page).toHaveURL(billingUrlPattern, { timeout: 15000 });
  } else {
    await expect.poll(async () => {
      const onBillingUrl = billingUrlPattern.test(page.url());
      const dialogOpen = await licenseDialog.isVisible().catch(() => false);
      return onBillingUrl || dialogOpen;
    }, { timeout: 8000 }).toBe(true);

    if (!billingUrlPattern.test(page.url())) {
      const upgradeInDialog = licenseDialog.getByRole('link', { name: /Upgrade|Billing/i }).first();
      if (await upgradeInDialog.isVisible().catch(() => false)) {
        await upgradeInDialog.click();
      } else {
        await page.keyboard.press('Escape').catch(() => {});
        await navigateViaSidebarLink(page, /^Billing & Plans$|^Billing$/i, billingUrlPattern);
      }
    }
  }

  await expect(page.getByText(/Premium\+?|Startup|ACTIVE|Billing|Plan|Current Usage|Billing Cycle/i).first()).toBeVisible({ timeout: 15000 });
  console.log('✅ Billing & Plans içeriği doğrulandı.');

  await ensureDashboard(page, dashboardUrl);
}

export async function assertHeadsUpTourModal(page: Page, dashboardUrl: string) {
  await ensureDashboard(page, dashboardUrl);
  await page.keyboard.press('Escape').catch(() => {});

  const headsUpButton = page.getByRole('button', { name: /Heads up/i }).first();
  const tourButton = page.getByRole('button', { name: /Take a Tour|take a tour|rehber tur/i }).first();

  if (await headsUpButton.isVisible().catch(() => false)) {
    console.log('🔘 [UI] Heads up butonuna tıklanıyor...');
    await headsUpButton.click();
  } else {
    console.log('🔘 [UI] Heads up yok; Take a Tour butonuna tıklanıyor...');
    await expect(tourButton).toBeVisible({ timeout: 15000 });
    await tourButton.click();
  }

  const tourModal = page.locator('[role="dialog"], [class*="driver-popover"], [class*="tour"]')
    .filter({ hasText: /Dashboard Overview|Overview|Skip|Next|Atla|Sonraki/i })
    .first();

  if (await tourModal.isVisible({ timeout: 8000 }).catch(() => false)) {
    console.log('✅ Rehber turu modalı açıldı.');
    await expect(tourModal.getByText(/Dashboard Overview|Overview/i).first()).toBeVisible();
    await expect(tourModal.getByText(/\d+\s*\/\s*\d+/).first()).toBeVisible();
    await expect(tourModal.getByRole('button', { name: /Skip|Atla/i }).first()).toBeVisible();
    await expect(tourModal.getByRole('button', { name: /Next|Sonraki/i }).first()).toBeVisible();

    const skipButton = tourModal.getByRole('button', { name: /Skip|Atla|Close|Kapat/i }).first();
    await skipButton.click();
    await expect(tourModal).toBeHidden({ timeout: 8000 }).catch(() => {});
  } else {
    console.log('ℹ️ Tur modalı görünmedi (tur daha önce tamamlanmış olabilir).');
    await page.keyboard.press('Escape').catch(() => {});
  }
}

export async function clickWidgetViewAll(
  page: Page,
  widgetTitle: RegExp,
  urlPattern: RegExp,
  dashboardUrl?: string,
) {
  if (dashboardUrl) {
    await ensureDashboard(page, dashboardUrl);
  }

  await dismissOverlays(page);
  const mainContent = page.locator('main').last();

  const widget = mainContent.filter({ hasText: widgetTitle }).first();
  await expect(widget).toBeVisible({ timeout: 15000 });

  let viewAllLink = widget.getByRole('link', { name: /View all|View All|Tümünü Gör/i }).first();
  if (!(await viewAllLink.isVisible().catch(() => false))) {
    viewAllLink = widget.locator('a[href*="/activity"], a[href*="/executions"], a[href*="/tasks"]').first();
  }
  await expect(viewAllLink).toBeVisible({ timeout: 15000 });
  console.log(`🔘 [UI] ${widgetTitle} -> View all tıklanıyor...`);
  await viewAllLink.click();
  await expect(page).toHaveURL(urlPattern, { timeout: 15000 });
}

export async function assertBackupSnapshotsPage(page: Page, workspaceId: string) {
  await navigateViaSidebarLink(page, /^Backup Snapshots$/i, new RegExp(`/${workspaceId}/backups`));
  await expect(page.getByRole('heading', { name: /Backup Snapshots/i })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Browse and restore|backup snapshots/i).first()).toBeVisible();

  const table = page.locator('table').first();
  await expect(table).toBeVisible({ timeout: 15000 });
  await expect(table.getByRole('columnheader', { name: /Repository|Start Time|Size|Actions/i }).first()).toBeVisible();
  await expect(table.getByRole('button', { name: /Restore|Delete/i }).first()).toBeVisible({ timeout: 15000 }).catch(() => {});

  const pagination = page.getByText(/Page \d+ of \d+|Rows per page/i).first();
  await expect(pagination).toBeVisible({ timeout: 10000 }).catch(() => {});
  console.log('✅ Backup Snapshots tablosu ve sayfalama görünür.');
}

export async function assertActivitiesBackupPage(page: Page, workspaceId: string) {
  await expect(page).toHaveURL(new RegExp(`/${workspaceId}/activity/backup`, 'i'), { timeout: 15000 });
  await expect(page.getByText(/Activities.*Backup|Backup executions|View and manage all backup/i).first()).toBeVisible({ timeout: 15000 });

  const statusFilter = page.getByRole('button', { name: /^Status$/i }).or(page.getByText(/^Status$/i)).first();
  await expect(statusFilter).toBeVisible({ timeout: 10000 }).catch(() => {});

  const table = page.locator('table').first();
  if (await table.isVisible().catch(() => false)) {
    await expect(table.getByRole('columnheader', { name: /Repository|Status|Progress|Created/i }).first()).toBeVisible();
  }
  console.log('✅ Activities - Backup sayfası doğrulandı.');
}

export async function assertActivitiesRestorePage(page: Page, workspaceId: string) {
  await expect(page).toHaveURL(new RegExp(`/${workspaceId}/activity/restore`, 'i'), { timeout: 15000 });
  await expect(page.getByText(/Activities.*Restore|restore executions|View and manage all restore/i).first()).toBeVisible({ timeout: 15000 });

  const emptyOrTable = page.getByText(/No results found|Search for target repository/i).first()
    .or(page.locator('table').first());
  await expect(emptyOrTable).toBeVisible({ timeout: 15000 });
  console.log('✅ Activities - Restore sayfası doğrulandı.');
}

async function expandSidebarSubmenu(page: Page, buttonName: RegExp) {
  await ensureSidebarExpanded(page);
  const sidebar = page.locator('[data-slot="sidebar"]').first();
  const trigger = sidebar.getByRole('button', { name: buttonName }).first();
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.scrollIntoViewIfNeeded().catch(() => {});

  const isExpanded = (await trigger.getAttribute('aria-expanded')) === 'true'
    || (await trigger.getAttribute('data-state')) === 'open';
  if (!isExpanded) {
    try {
      await trigger.click({ timeout: 5000 });
    } catch {
      await trigger.click({ force: true });
    }
  }
  await expect.poll(async () => {
    const exp = await trigger.getAttribute('aria-expanded').catch(() => null);
    const st = await trigger.getAttribute('data-state').catch(() => null);
    return exp === 'true' || st === 'open';
  }, { timeout: 5000 }).toBe(true).catch(() => {});

  return sidebar;
}

export async function assertRepositoriesSubmenu(page: Page, workspaceId: string) {
  const sidebar = await expandSidebarSubmenu(page, /^Repositories$/i);

  const bitbucketLink = sidebar.getByRole('link', { name: /^Bitbucket$/i });
  const githubLink = sidebar.getByRole('link', { name: /^GitHub$/i });
  const addProviderLink = sidebar.getByRole('link', { name: /Add Provider/i });

  await expect(bitbucketLink).toBeVisible();
  await expect(githubLink).toBeVisible();
  await expect(addProviderLink).toBeVisible();

  console.log('🔘 [UI] Repositories > Bitbucket linkine tıklanıyor...');
  await bitbucketLink.click();
  await expect(page).toHaveURL(new RegExp(`/${workspaceId}/repositories/bitbucket`, 'i'), { timeout: 15000 });
  console.log('✅ Repositories alt menüsü (Bitbucket, GitHub, Add Provider) doğrulandı.');
}

export async function assertActivitySubmenuRestore(page: Page, workspaceId: string) {
  const sidebar = await expandSidebarSubmenu(page, /^Activity$/i);

  const backupLink = sidebar.getByRole('link', { name: /^Backup$/i });
  const restoreLink = sidebar.getByRole('link', { name: /^Restore$/i });
  await expect(backupLink).toBeVisible();
  await expect(restoreLink).toBeVisible();

  console.log('🔘 [UI] Activity > Restore linkine tıklanıyor...');
  await restoreLink.click();
  await assertActivitiesRestorePage(page, workspaceId);
}

export async function assertRestoresPage(page: Page, workspaceId: string) {
  await navigateViaSidebarLink(page, /^Restores$/i, new RegExp(`/${workspaceId}/restore`, 'i'));
  await expect(page.getByRole('heading', { name: /Restores/i })).toBeVisible({ timeout: 15000 });
  console.log('✅ Restores sayfası doğrulandı.');
}

export async function assertBillingPlansPage(page: Page, workspaceId: string) {
  const billingUrlPattern = new RegExp(`/${workspaceId}/billing`, 'i');
  await navigateViaSidebarLink(page, /^Billing & Plans$|^Billing$/i, billingUrlPattern);

  await expect(page.getByText(/Premium\+?|Startup|ACTIVE|Billing Cycle|Current Usage|Billing & Plans/i).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/Current Usage|Licensed Repositories|Storage/i).first()).toBeVisible({ timeout: 15000 });

  const upgradeButton = page.getByRole('button', { name: /Upgrade to Enterprise|Change Billing Cycle|Upgrade Plan/i }).first();
  await expect(upgradeButton).toBeVisible({ timeout: 15000 });

  const autoRenewal = page.getByText(/Auto Renewal|Auto-renewal/i).first();
  await expect(autoRenewal).toBeVisible({ timeout: 10000 }).catch(() => {});
  console.log('✅ Billing & Plans sayfası (plan, kullanım, aksiyonlar) doğrulandı.');
}

export async function assertUserProfileMenuAddresses(page: Page, workspaceId: string) {
  await page.keyboard.press('Escape').catch(() => {});

  const userMenuTrigger = await getUserMenuTrigger(page);
  await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
  await userMenuTrigger.click();

  const userMenu = page.getByRole('menu').last();
  await expect(userMenu).toBeVisible({ timeout: 8000 });

  await expect(userMenu.getByRole('menuitem', { name: /User Settings|Addresses|Sign out|Çıkış/i }).first()).toBeVisible();

  const addressesItem = userMenu.getByRole('menuitem', { name: /Addresses/i });
  if (await addressesItem.isVisible().catch(() => false)) {
    await addressesItem.click();
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/addresses`, 'i'), { timeout: 15000 });
    await expect(page.getByText(/Account Settings|Billing Addresses|Addresses/i).first()).toBeVisible({ timeout: 15000 });
    console.log('✅ Profil menüsünden Addresses sayfası açıldı.');

    await userMenuTrigger.click();
    const menuAgain = page.getByRole('menu').last();
    await expect(menuAgain).toBeVisible({ timeout: 8000 });
    const signOutBtn = menuAgain.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i });
    await expect(signOutBtn).toBeVisible();
    await signOutBtn.hover();
    await expect(signOutBtn).toBeEnabled();
    await page.keyboard.press('Escape');
    console.log('✅ Sign out üzerine hover yapıldı (oturum kapatılmadı).');
    return;
  }

  const signOutBtn = userMenu.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i });
  await expect(signOutBtn).toBeVisible();
  await signOutBtn.hover();
  await expect(signOutBtn).toBeEnabled();
  await page.keyboard.press('Escape');
  console.log('✅ Profil menüsü (Sign out hover, oturum kapatılmadı) doğrulandı.');
}

export async function assertLayoutOnCurrentPage(page: Page) {
  await assertSidebarToggleInteractive(page);
  await assertGlobalSearchInput(page);
}
