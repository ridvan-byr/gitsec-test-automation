import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { RestorePage } from '../../pages/RestorePage';
import { requireEnv } from '../../support/require-env';

test.describe('Restores & Restore Wizard — Arayüz ve Buton Durum Doğrulamaları (UI & Button States)', () => {
  let providerPage: ProviderPage;
  let restorePage: RestorePage;

  test.beforeEach(async ({ page }) => {
    // 502 ve Next.js static asset yükleme hatalarını yoksay (Staging sunucusu kararlılığı için)
    (page as GitSecPage).ignoredErrors = [
      /502/,
      /_next\/static\/chunks/i,
      /Failed to load resource/i,
      /ChunkLoadError/i
    ];

    providerPage = new ProviderPage(page);
    restorePage = new RestorePage(page);

    // 1. Giriş yap ve dashboard'a git
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. Next.js oturum hidrasyonunun tamamlanması için sidebar/navigasyon alanını bekle
    const sidebar = page.locator('aside, nav, [class*="sidebar"]').first();
    await sidebar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('Kısım 1: Restores Sidebar Navigasyonu ve Listeleme Sayfası Butonu', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');

    // 1. Sidebar'da Restores linkini doğrula ve tıkla
    const restoresSidebarLink = page.getByRole('link', { name: /^Restores$/i })
      .or(page.locator(`a[href*="/${workspaceId}/restore"]`))
      .first();

    await expect(restoresSidebarLink).toBeVisible();
    await expect(restoresSidebarLink).toBeEnabled();
    await restoresSidebarLink.click();

    // 2. Restores listeleme sayfasına yönlendiğini doğrula (çoğul veya tekil kontrolü)
    await page.waitForURL(new RegExp(`/${workspaceId}/restore`));

    // 3. Sayfa başlığı, "Restore Wizard" ve "Refresh" butonunun varlığını doğrula
    const pageTitle = page.getByText(/GitSec Restores|Restores/i).first();
    await expect(pageTitle).toBeVisible();

    const newRestoreBtn = page.getByRole('button', { name: /Restore Wizard|New Restore|Restore/i })
      .or(page.getByRole('link', { name: /Restore Wizard|New Restore|Restore/i }))
      .or(page.locator('a, button').filter({ hasText: /Restore Wizard|New Restore|Restore/i }))
      .first();

    await expect(newRestoreBtn).toBeVisible();
    await expect(newRestoreBtn).toBeEnabled();

    // 4. Yenileme (Sync/Refresh) butonunu doğrula
    const refreshBtn = page.locator('button:has(svg.lucide-refresh-cw)')
      .or(page.locator('button').filter({ has: page.locator('svg') }).last())
      .first();

    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();

    console.log('✅ Sidebar Restores navigasyonu, "Restore Wizard" ve "Refresh" butonu doğrulandı.');
  });

  test('Kısım 2: Restore Sihirbazı Modalı ve Başlangıç Buton Durumları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/restore`, { waitUntil: 'load' });

    // 1. "Restore Wizard" butonuna tıklayarak sihirbaz modalını aç
    const newRestoreBtn = page.getByRole('button', { name: /Restore Wizard|New Restore|Restore/i })
      .or(page.getByRole('link', { name: /Restore Wizard|New Restore|Restore/i }))
      .or(page.locator('a, button').filter({ hasText: /Restore Wizard|New Restore|Restore/i }))
      .first();
    await newRestoreBtn.click();

    // 2. "Start a Restore" modalının açıldığını doğrula
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // 3. Kaynak depo combobox seçici alanının varlığını doğrula
    const repoCombo = dialog.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await expect(repoCombo).toBeVisible();
    await expect(repoCombo).toBeEnabled();

    // 4. "Continue" butonunun başlangıç durumunu doğrula (görünür olmalı)
    const continueBtn = dialog.getByRole('button', { name: /Continue|Next/i })
      .or(dialog.locator('button').filter({ hasText: /Continue/i }))
      .first();
    await expect(continueBtn).toBeVisible();

    // 5. "Cancel" butonunun varlığını doğrula ve tıklanarak modalın kapandığını test et
    const cancelBtn = dialog.getByRole('button', { name: /Cancel|İptal/i })
      .or(dialog.locator('button').filter({ hasText: /Cancel|İptal/i }))
      .first();
    await expect(cancelBtn).toBeVisible();
    await expect(cancelBtn).toBeEnabled();

    await cancelBtn.click();
    await expect(dialog).toBeHidden();
    console.log('✅ Restore Sihirbazı modalı ve başlangıç butonları başarıyla doğrulandı.');
  });

  test('Kısım 3: Restores Listeleme Sayfası Tablo Sütunları, Arama ve Sayfalama Butonları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/restore`, { waitUntil: 'load' });

    // 1. Tablonun varlığını doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    // 2. Tablo başlık sütunlarını doğrula
    const expectedHeaders = ['Target', 'Source', 'Scopes', 'Start Date', 'Finish Date', 'Elapsed Time', 'Size'];
    for (const header of expectedHeaders) {
      const headerCell = table.locator('thead th, thead td').filter({ hasText: new RegExp(header, 'i') }).first();
      await expect(headerCell).toBeVisible();
    }
    console.log('✅ Tablo başlık sütunları doğrulandı.');

    // 3. Tablodaki boş durum (No results found) veya veri satırlarını doğrula
    const noResults = page.getByText(/No results found/i).first();
    const hasNoResults = await noResults.isVisible().catch(() => false);

    if (!hasNoResults) {
      const dataRows = table.locator('tbody tr');
      const dataRowCount = await dataRows.count();
      if (dataRowCount > 0) {
        console.log(`[UI Test] Tabloda ${dataRowCount} restore geçmiş satırı bulundu.`);
      }
    } else {
      console.log('ℹ️ Tabloda henüz restore kaydı bulunmuyor, boş tablo görünümü doğrulandı.');
    }

    // 4. "Search for target repository..." arama kutusunu doğrula
    const filterInput = page.getByPlaceholder(/Search for target repository/i)
      .or(page.locator('input[placeholder*="Search"]'))
      .first();
    if (await filterInput.isVisible().catch(() => false)) {
      await expect(filterInput).toBeEditable();
      console.log('✅ Arama filtre kutusu doğrulandı.');
    }

    // 5. Sayfalama (Pagination) butonlarını doğrula
    const pagination = page.getByText(/Page \d+ of \d+/i)
      .or(page.getByText(/Sayfa \d+/i))
      .filter({ visible: true })
      .first();
    
    await expect(pagination).toBeVisible();
    console.log('✅ Restores sayfalama kontrolü doğrulandı.');
  });
});
