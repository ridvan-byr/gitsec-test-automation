import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../../pages/ProviderPage';

async function getRepoTable(page: Page): Promise<Locator> {
  const repoTable = page
    .locator('table')
    .filter({ has: page.locator('thead [role="checkbox"], tbody [role="checkbox"]') })
    .first();
  await repoTable.waitFor({ state: 'visible', timeout: 30000 });
  return repoTable;
}

/** İlk veri satırındaki kapsam anahtarı: aria-checked true ≈ included (yedek için gerekli). */
async function ensureFirstRowIncludedForBackup(firstRow: Locator): Promise<void> {
  const scopeSwitch = firstRow.getByRole('switch').first();
  await scopeSwitch.waitFor({ state: 'visible', timeout: 15000 });

  const checked = (await scopeSwitch.getAttribute('aria-checked')) ?? 'false';
  if (checked === 'true') {
    console.log('[e2e] İlk repo zaten dahil (included, switch açık). Backup akışına devam ediliyor.');
    return;
  }

  console.log(
    '[e2e] İlk repo dahil değil (excluded, switch kapalı). Yedek alınabilmesi için satırdaki switch ile dahil ediliyor.'
  );
  await scopeSwitch.scrollIntoViewIfNeeded().catch(() => {});
  await scopeSwitch.click({ force: true });
  await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25000 });
  console.log('[e2e] Switch included konumuna getirildi (aria-checked=true).');
}

test.describe('Repositories - GitHub ilk repo yedekleme', () => {
  test('ilk repo included ise veya switch ile include edilerek Backup now / Start Backup', async ({ page }) => {
    test.setTimeout(180000);
    const providerPage = new ProviderPage(page);

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToRepositoriesGithubViaSidebar();

    const repoTable = await getRepoTable(page);
    const firstRow = repoTable.locator('tbody tr').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });

    await ensureFirstRowIncludedForBackup(firstRow);

    const backupNowBtn = firstRow.getByRole('button', { name: /Backup now/i });
    await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });
    await backupNowBtn.scrollIntoViewIfNeeded().catch(() => {});
    console.log('[e2e] Backup now tıklanıyor (ilk satır).');
    await backupNowBtn.click();

    const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
    await startBackupBtn.waitFor({ state: 'visible', timeout: 20000 });
    console.log('[e2e] Diyalogda Start Backup tıklanıyor.');
    await startBackupBtn.click();

    // İstek fırladıktan / diyalog kapandıktan sonra kısa stabilizasyon (uzun backup bitişini beklemez).
    await page.waitForTimeout(2500);
    console.log('[e2e] Yedekleme isteği gönderildi; bekleme tamamlandı, test sonlanıyor.');
  });
});
