import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { requireEnv } from '../../support/require-env';

test.describe('Backup Schedulers — Arayüz ve Buton Durum Doğrulamaları (UI & Button States)', () => {
  let providerPage: ProviderPage;

  test.beforeEach(async ({ page }) => {
    providerPage = new ProviderPage(page);

    // 1. Giriş yap ve dashboard'a git
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. Next.js oturum hidrasyonunun tamamlanması için sidebar/navigasyon alanını bekle
    const sidebar = page.locator('aside, nav, [class*="sidebar"]').first();
    await sidebar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('Kısım 1: Schedulers Sidebar Navigasyonu ve Listeleme Sayfası Butonu', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');

    // 1. Sidebar'da Schedulers linkini doğrula ve tıkla
    const schedulersSidebarLink = page.getByRole('link', { name: /^Schedulers$/i })
      .or(page.locator(`a[href*="/${workspaceId}/schedulers"]`))
      .first();

    await expect(schedulersSidebarLink).toBeVisible();
    await expect(schedulersSidebarLink).toBeEnabled();
    await schedulersSidebarLink.click();

    // 2. Schedulers listeleme sayfasına yönlendiğini doğrula
    await page.waitForURL(new RegExp(`/${workspaceId}/schedulers`));

    // 3. "New Scheduler" butonunun varlığını doğrula
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i })
      .or(page.locator('button').filter({ hasText: /New Scheduler/i }))
      .first();

    await expect(newSchedulerBtn).toBeVisible();
    await expect(newSchedulerBtn).toBeEnabled();

    // 4. Yenileme (Sync/Refresh) butonunu doğrula
    const refreshBtn = page.locator('button:has(svg.lucide-refresh-cw)')
      .or(page.locator('button').filter({ has: page.locator('svg') }).last())
      .first();

    await expect(refreshBtn).toBeVisible();
    await expect(refreshBtn).toBeEnabled();

    console.log('✅ Sidebar Schedulers navigasyonu, "New Scheduler" ve "Refresh" butonu doğrulandı.');
  });

  test('Kısım 2: New Scheduler Modalı, Başlangıç Buton Durumları ve Form Kısıtları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/schedulers`, { waitUntil: 'load' });

    // 1. "New Scheduler" modalını aç
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i })
      .or(page.locator('button').filter({ hasText: /New Scheduler/i }))
      .first();
    await newSchedulerBtn.click();

    // 2. Modalın (dialog) görünür olmasını bekle
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // 3. Başlangıçta "Save/Create" butonunun görünür olduğunu doğrula
    const saveBtn = dialog.getByRole('button', { name: /save|create|confirm|submit/i })
      .or(dialog.locator('button').filter({ hasText: /Save|Create/i }))
      .first();
    await expect(saveBtn).toBeVisible();

    // 4. Cancel/Close butonlarının tıklanabilir olduğunu doğrula
    const cancelBtn = dialog.getByRole('button', { name: /cancel|iptal|close|kapat/i })
      .or(dialog.locator('button').filter({ hasText: /Cancel/i }))
      .first();
    await expect(cancelBtn).toBeVisible();
    await expect(cancelBtn).toBeEnabled();

    // 5. Repository combobox alanının varlığını doğrula
    const repoCombo = dialog.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await expect(repoCombo).toBeVisible();
    await expect(repoCombo).toBeEnabled();

    // 6. Kapatma butonuna tıklayarak modalın başarıyla kapandığını doğrula
    await cancelBtn.click();
    await expect(dialog).toBeHidden();
    console.log('✅ New Scheduler modalı ve başlangıç buton durumları doğrulandı.');
  });

  test('Kısım 3: Sıklık Türü (Frequency) Seçim Butonları ve Dinamik Form Alanları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/schedulers`, { waitUntil: 'load' });

    // 1. Modalı aç
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i }).first();
    await newSchedulerBtn.click();
    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ state: 'visible', timeout: 10000 });

    // 2. Schedule Type combobox'ına tıkla
    const typeTrigger = dialog.getByRole('combobox').nth(1);
    await typeTrigger.click();

    // 3. Dropdown seçeneklerinden "Weekly" seç
    const weeklyOption = page.getByRole('option', { name: 'Weekly', exact: true }).first();
    await weeklyOption.click();

    // 4. Haftanın günleri checkbox butonlarının görünür olduğunu doğrula (Mon, Tue, vb.)
    const monCheckbox = page.getByRole('checkbox', { name: 'Mon' }).or(page.getByLabel('Mon')).first();
    await expect(monCheckbox).toBeVisible();
    await expect(monCheckbox).toBeEnabled();

    // 5. Tekrar sıklık türünü "Cron" olarak değiştir
    await typeTrigger.click();
    const cronOption = page.getByRole('option', { name: 'Cron', exact: true }).first();
    await cronOption.click();

    // 6. Cron expression input kutusunun görünür olduğunu doğrula
    const cronInput = page.getByPlaceholder(/0 0 \* \* \*/i)
      .or(page.locator('input[placeholder*="*"]'))
      .first();
    await expect(cronInput).toBeVisible();
    await expect(cronInput).toBeEditable();

    // 7. Modalı kapat
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    console.log('✅ Dinamik sıklık butonları ve form alanları başarıyla doğrulandı.');
  });

  test('Kısım 4: Schedulers Listeleme Sayfası Tablo Sütunları, Arama ve Sayfalama Butonları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/schedulers`, { waitUntil: 'load' });

    // 1. Tablonun varlığını doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    // 2. Tablo başlık sütunlarını doğrula
    const expectedHeaders = ['Scheduler Name', 'Repository Name', 'Type', 'Schedule', 'Status'];
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
        console.log(`[UI Test] Tabloda ${dataRowCount} zamanlayıcı satırı bulundu. Satır içi butonlar doğrulanıyor...`);
        const firstRow = dataRows.first();

        // Aktif/Pasif durum switch butonu
        const toggleSwitch = firstRow.locator('button[role="switch"], input[type="checkbox"], [class*="switch"]').first();
        if (await toggleSwitch.isVisible().catch(() => false)) {
          await expect(toggleSwitch).toBeEnabled();
          console.log('✅ Zamanlayıcı toggle switch butonu doğrulandı.');
        }

        // Satır içi Çalıştır (Play/Run) butonu
        const playBtn = firstRow.locator('button:has(svg.lucide-play), button:has(svg[class*="play"])')
          .or(firstRow.locator('button').filter({ has: page.locator('svg') }).first());
        if (await playBtn.isVisible().catch(() => false)) {
          await expect(playBtn).toBeEnabled();
          console.log('✅ Zamanlayıcı anlık çalıştırma (play) butonu doğrulandı.');
        }

        // Satır içi Silme (Trash) butonu
        const trashBtn = firstRow.locator('button:has(svg[class*="trash"]), button:has(svg.lucide-trash)').first();
        if (await trashBtn.isVisible().catch(() => false)) {
          await expect(trashBtn).toBeEnabled();
          console.log('✅ Zamanlayıcı silme (trash) butonu doğrulandı.');
        }
      }
    } else {
      console.log('ℹ️ Tabloda zamanlayıcı bulunmuyor, boş tablo görünümü doğrulandı.');
    }

    // 4. "Filter by name" arama kutusunu doğrula
    const filterInput = page.getByPlaceholder(/Filter by name/i)
      .or(page.locator('input[placeholder*="Filter"]'))
      .first();
    if (await filterInput.isVisible().catch(() => false)) {
      await expect(filterInput).toBeEditable();
      console.log('✅ Zamanlayıcı arama filtre kutusu doğrulandı.');
    }

    // 5. Sayfalama (Pagination) butonlarını doğrula
    const pagination = page.getByText(/Page \d+ of \d+/i)
      .or(page.getByText(/Sayfa \d+/i))
      .filter({ visible: true })
      .first();
    
    await expect(pagination).toBeVisible();
    console.log('✅ Schedulers sayfalama kontrolü doğrulandı.');
  });
});
