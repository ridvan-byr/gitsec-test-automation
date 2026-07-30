import { expect, Page, Locator } from '@playwright/test';

export function getHeaderSidebarToggle(page: Page) {
  return page.locator('header').getByRole('button', { name: /Toggle Sidebar/i }).first();
}

export function getThemeToggle(page: Page) {
  return page.locator('header button[data-slot="dropdown-menu-trigger"]').first();
}

export async function getUserMenuTrigger(page: Page) {
  const sidebarUser = page.locator('[data-slot="sidebar"] button[data-slot="dropdown-menu-trigger"]')
    .filter({ hasText: /@/ })
    .last();
  await sidebarUser.scrollIntoViewIfNeeded().catch(() => {});
  if (await sidebarUser.isVisible().catch(() => false)) {
    return sidebarUser;
  }
  return page.locator('button[data-slot="dropdown-menu-trigger"]').filter({ hasText: /@/ }).last();
}

export async function openGlobalSearch(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});

  const searchInput = page.getByRole('combobox', { name: 'Search' });
  if (await searchInput.isVisible().catch(() => false)) {
    return searchInput;
  }

  const searchTrigger = page.getByRole('button', { name: 'Search' });
  if (await searchTrigger.isVisible().catch(() => false)) {
    await searchTrigger.click();
  } else {
    await page.keyboard.press('Control+K');
  }

  await expect(searchInput).toBeVisible({ timeout: 15000 });
  return searchInput;
}

export async function assertSidebarToggleInteractive(page: Page) {
  const sidebarToggle = getHeaderSidebarToggle(page);
  const sidebar = page.locator('[data-slot="sidebar"]').first();

  await expect(sidebarToggle).toBeVisible({ timeout: 15000 });
  await expect(sidebarToggle).toBeEnabled();
  await expect(sidebar).toBeAttached();

  const stateBefore = await sidebar.getAttribute('data-state');
  const widthBefore = await sidebar.evaluate(el => el.getBoundingClientRect().width);

  await sidebarToggle.click();

  const stateAfter = await sidebar.getAttribute('data-state');
  const widthAfter = await sidebar.evaluate(el => el.getBoundingClientRect().width);
  const sidebarCollapsed = stateAfter !== stateBefore || widthAfter < widthBefore - 8;

  if (sidebarCollapsed) {
    await getHeaderSidebarToggle(page).click();
    await expect.poll(async () => sidebar.getAttribute('data-state')).toBe(stateBefore);
  } else {
    await expect(page.locator('main').last()).toBeVisible();
    await expect(sidebarToggle).toBeEnabled();
  }
}

export async function assertGlobalSearchInput(page: Page) {
  const searchInput = await openGlobalSearch(page);
  await expect(searchInput).toBeEditable();

  const testQuery = 'gitsec';
  await searchInput.click();
  await searchInput.pressSequentially(testQuery, { delay: 40 });
  await expect.poll(async () => searchInput.inputValue(), { timeout: 8000 }).toBe(testQuery);

  const searchListbox = page.getByRole('listbox', { name: 'Suggestions' });
  await expect(searchListbox).toBeVisible({ timeout: 8000 });

  await searchInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await expect.poll(async () => searchInput.inputValue(), { timeout: 5000 }).toBe('');
  await page.keyboard.press('Escape');
}

export async function assertUserProfileMenu(page: Page) {
  await page.keyboard.press('Escape').catch(() => {});

  const userMenuTrigger = await getUserMenuTrigger(page);
  await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
  await userMenuTrigger.click();

  const userMenu = page.getByRole('menu').last();
  await expect(userMenu).toBeVisible({ timeout: 8000 });

  const signOutBtn = userMenu.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i });
  await expect(signOutBtn).toBeVisible();
  await expect(signOutBtn).toBeEnabled();

  const profileItem = userMenu.getByRole('menuitem').filter({ hasText: /profile|account|billing|settings|profil|hesap/i }).first();
  if (await profileItem.isVisible().catch(() => false)) {
    await expect(profileItem).toBeEnabled();
  }

  await page.keyboard.press('Escape');
  await expect(userMenu).toBeHidden({ timeout: 5000 });
}

export async function assertThemeMenuAndRevert(page: Page) {
  const themeToggle = getThemeToggle(page);
  await expect(themeToggle).toBeVisible({ timeout: 15000 });
  await themeToggle.click();

  const themeMenu = page.getByRole('menu').filter({ hasText: /Light|Dark|System/i }).first();
  await expect(themeMenu).toBeVisible({ timeout: 8000 });

  const lightOption = themeMenu.getByRole('menuitem', { name: /^Light$/i });
  const darkOption = themeMenu.getByRole('menuitem', { name: /^Dark$/i });
  const systemOption = themeMenu.getByRole('menuitem', { name: /^System$/i });
  await expect(lightOption).toBeVisible();
  await expect(darkOption).toBeVisible();
  await expect(systemOption).toBeVisible();

  const readThemeState = () => page.evaluate(() => ({
    htmlDark: document.documentElement.classList.contains('dark'),
    storedTheme: localStorage.getItem('theme')
      ?? localStorage.getItem('gitsec_theme')
      ?? localStorage.getItem('gitsec-theme'),
  }));

  const beforeTheme = await readThemeState();
  await darkOption.click();
  await expect(themeMenu).toBeHidden({ timeout: 5000 });
  await expect.poll(async () => {
    const afterTheme = await readThemeState();
    return afterTheme.htmlDark !== beforeTheme.htmlDark || afterTheme.storedTheme !== beforeTheme.storedTheme;
  }, { timeout: 8000 }).toBe(true);

  await themeToggle.click();
  const themeMenuAgain = page.getByRole('menu').filter({ hasText: /Light|Dark|System/i }).first();
  await expect(themeMenuAgain).toBeVisible({ timeout: 8000 });
  await lightOption.click();
  await expect(themeMenuAgain).toBeHidden({ timeout: 5000 });
}

export async function navigateViaSidebarLink(page: Page, linkName: RegExp, urlPattern: RegExp) {
  await page.keyboard.press('Escape').catch(() => {});

  const sidebar = page.locator('[data-slot="sidebar"]').first();
  const link = sidebar.getByRole('link', { name: linkName }).first();
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible({ timeout: 15000 });
  await link.click();
  await expect(page).toHaveURL(urlPattern, { timeout: 15000 });
}
