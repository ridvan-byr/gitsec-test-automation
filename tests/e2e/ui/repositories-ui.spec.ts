import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { requireEnv } from '../../support/require-env';

test.describe('Repositories & Provider Management — Arayüz ve Buton Durum Doğrulamaları (UI & Button States)', () => {
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

  test('Kısım 1: Repositories Sidebar Akordeonu ve GitHub Navigasyonu', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');

    // 1. Sidebar'da Repositories toggle butonunun (akordeon) varlığını doğrula ve tıkla
    const repoAccordion = page.getByRole('button', { name: /Repositories/i })
      .or(page.locator('aside button').filter({ hasText: /Repositories/i }))
      .first();

    await expect(repoAccordion).toBeVisible();
    await expect(repoAccordion).toBeEnabled();

    // GitHub linkini bul, görünür değilse akordeonu aç
    const githubLink = page.getByRole('link', { name: /^GitHub$/i })
      .or(page.locator(`aside a[href*="/${workspaceId}/repositories/github"]`))
      .first();

    if (!(await githubLink.isVisible().catch(() => false))) {
      await repoAccordion.click();
      await page.waitForTimeout(500); // Açılış animasyonu için
    }

    await expect(githubLink).toBeVisible();
    await expect(githubLink).toBeEnabled();
    await githubLink.click();

    // 2. GitHub depoları listeleme sayfasına yönlendiğini doğrula
    await page.waitForURL(new RegExp(`/${workspaceId}/repositories/github`));
    console.log('✅ Sidebar Repositories akordeonu ve GitHub navigasyonu başarıyla doğrulandı.');
  });

  test('Kısım 2: Repositories Listeleme Sayfası Tablosu, Arama ve Include Toggle Butonları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/github`, { waitUntil: 'load' });

    // 1. Depolar tablosunun varlığını doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 25000 });

    // 2. Tablo başlık sütunlarını doğrula
    const expectedHeaders = ['Full Name', 'Description', 'Default Branch', 'Visibility', 'Connected'];
    for (const header of expectedHeaders) {
      const headerCell = table.locator('thead th, thead td').filter({ hasText: new RegExp(header, 'i') }).first();
      await expect(headerCell).toBeVisible();
    }
    console.log('✅ Depo listeleme tablo sütun başlıkları doğrulandı.');

    // 2b. Grid ve List görünüm butonlarını doğrula
    const gridBtn = page.getByRole('button', { name: /Grid/i }).first();
    const listBtn = page.getByRole('button', { name: /List/i }).first();
    if (await gridBtn.isVisible().catch(() => false)) {
      await expect(gridBtn).toBeEnabled();
      await expect(listBtn).toBeEnabled();
      console.log('✅ Grid ve List görünüm butonları doğrulandı.');
    }

    // 3. Tablodaki veri veya boş durum kontrolü
    const noResults = page.getByText(/No results found|No repositories found/i).first();
    const hasNoResults = await noResults.isVisible().catch(() => false);

    if (!hasNoResults) {
      const dataRows = table.locator('tbody tr');
      const dataRowCount = await dataRows.count();
      if (dataRowCount > 0) {
        console.log(`[UI Test] Tabloda ${dataRowCount} repository satırı bulundu. Dahil etme (Include) veya Push Event butonları kontrol ediliyor...`);
        const firstRow = dataRows.first();

        // Depoları dahil edip etmeme switch / toggle butonu veya Push Event ikonu
        const toggleSwitch = firstRow.locator('button[role="switch"], input[type="checkbox"], [class*="switch"], button').first();
        if (await toggleSwitch.isVisible().catch(() => false)) {
          await expect(toggleSwitch).toBeEnabled();
          console.log('✅ Depo dahil etme/aksiyon butonu doğrulandı.');
        }
      }
    } else {
      console.log('ℹ️ Tabloda repository bulunamadı.');
    }

    // 4. "Search repositories" arama kutusunu doğrula
    const filterInput = page.getByPlaceholder(/Search repositories|Depolarda ara/i)
      .or(page.locator('input[placeholder*="Search"]'))
      .first();
    if (await filterInput.isVisible().catch(() => false)) {
      await expect(filterInput).toBeEditable();
      console.log('✅ Arama filtre kutusu doğrulandı.');
    }

    // 5. Sayfalama (Pagination) butonlarını doğrula
    const pagination = page.getByText(/Page \d+ of \d+/i)
      .or(page.getByText(/Sayfa \d+/i))
      .first();
    if (await pagination.isVisible().catch(() => false)) {
      await expect(pagination).toBeVisible();
      console.log('✅ Repositories sayfalama kontrolü doğrulandı.');
    }
  });

  test('Kısım 3: Add Provider (Sağlayıcı Ekleme) Sayfası ve Bağlantı Butonları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/add`, { waitUntil: 'load' });

    // 1. Sayfada sağlayıcılar listesini doğrula
    const pageTitle = page.getByText(/Add Provider|Sağlayıcı Ekle/i).first();
    await expect(pageTitle).toBeVisible();

    // 2. GitHub sağlayıcı satırını ve Configure/Install butonunu doğrula
    const githubRow = page.getByRole('row', { name: /GitHub/i })
      .or(page.locator('tr').filter({ hasText: /GitHub/i }))
      .first();
    await expect(githubRow).toBeVisible();

    const githubActionButton = githubRow.getByRole('button')
      .or(githubRow.locator('button, a'))
      .filter({
        hasText: /Configure App|Install|Approve|Active/i,
      })
      .first();
    await expect(githubActionButton).toBeVisible();
    await expect(githubActionButton).toBeEnabled();
    console.log('✅ GitHub sağlayıcı bağlantı/ayarlar butonu doğrulandı.');

    // 3. Bitbucket sağlayıcı satırını ve Configure/Install butonunu doğrula
    const bitbucketRow = page.getByRole('row', { name: /Bitbucket/i })
      .or(page.locator('tr').filter({ hasText: /Bitbucket/i }))
      .first();
    if (await bitbucketRow.isVisible().catch(() => false)) {
      const bitbucketBtn = bitbucketRow.getByRole('button')
        .or(bitbucketRow.locator('button, a'))
        .first();
      await expect(bitbucketBtn).toBeVisible();
      await expect(bitbucketBtn).toBeEnabled();
      console.log('✅ Bitbucket sağlayıcı bağlantı butonu doğrulandı.');
    }
  });
});
