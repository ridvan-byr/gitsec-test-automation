import { test, expect } from '../fixtures/test';
import { requireEnv } from '../support/require-env';

test('Debug 500 error on repository addition/deletion', async ({ page }) => {
  const workspaceId = requireEnv('WORKSPACE_ID');
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

  // Monitor all API responses
  page.on('response', async response => {
    const url = response.url();
    if (url.includes('repository-workspaces')) {
      const status = response.status();
      console.log(`\n📡 API Response: ${url}`);
      console.log(`   Status: ${status}`);
      try {
        const text = await response.text();
        console.log(`   Body: ${text}`);
      } catch (e: any) {
        console.log(`   Body: (could not read body: ${e.message})`);
      }
    }
  });

  const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
  await page.goto(targetUrl, { waitUntil: 'load' });

  // Open settings -> repositories
  const wsTrigger = page.locator('[data-slot="dropdown-menu-trigger"]').filter({ hasText: /Default Wor/i }).first();
  await wsTrigger.click();
  await page.waitForTimeout(1000);

  const settingsOption = page.getByText('Settings', { exact: true }).first();
  await settingsOption.click();
  await page.waitForTimeout(2000);

  const dialog = page.locator('[role="dialog"]').first();
  const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
  await reposTab.click();
  await page.waitForTimeout(2000);

  // Try to delete gitsectest-cmd/DenemeTest2
  const row = dialog.locator('tbody tr').filter({ hasText: 'gitsectest-cmd/DenemeTest2' }).first();
  if (await row.isVisible().catch(() => false)) {
    console.log('🗑️ Attempting to delete gitsectest-cmd/DenemeTest2...');
    const deleteBtn = row.locator('button').filter({ has: page.locator('svg') }).last();
    await deleteBtn.click();
    await page.waitForTimeout(1000);

    const confirmBtn = page.locator('button').filter({ hasText: /Confirm|Delete|Yes|Remove|Sil/i }).first();
    if (await confirmBtn.isVisible().catch(() => false)) {
      await confirmBtn.click();
    }
    await page.waitForTimeout(3000);
  }

  // Try to add gitsectest-cmd/DenemeTest2 back
  console.log('🔄 Attempting to add gitsectest-cmd/DenemeTest2 back...');
  const repoSelect = dialog.getByRole('button', { name: /Select a repository/i })
    .or(dialog.locator('button').filter({ hasText: /Select a repository/i }))
    .first();
  await repoSelect.click();
  await page.waitForTimeout(1000);

  const option = page.locator('[role="option"], [data-slot="select-item"], [class*="select-item"]').filter({ hasText: 'gitsectest-cmd/DenemeTest2' }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    await page.waitForTimeout(500);

    const addRepoBtn = dialog.getByRole('button', { name: /Add Repository/i });
    await addRepoBtn.click();
    await page.waitForTimeout(3000);
  } else {
    console.log('⚠️ Option for DenemeTest2 not found in dropdown!');
  }
});
