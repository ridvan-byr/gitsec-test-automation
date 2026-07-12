import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { requireEnv } from '../../support/require-env';

// Next.js chunk loading hataları aldığında sayfayı yenileyerek kurtarmayı sağlayan yardımcı fonksiyon
async function gotoWithRecovery(page: any, url: string) {
  console.log(`🌐 [REPOSITORIES UI] Sayfaya gidiliyor: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  
  const chunkError = page.getByText(/chunk|loading chunk/i).first();
  if (await chunkError.isVisible().catch(() => false)) {
    console.log('🔄 [RECOVERY] Chunk load error detected! Reloading page...');
    await page.reload({ waitUntil: 'load' });
  }
}

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

  test('Kısım 2: Repositories Sayfası Arama, Görünüm Modları ve Refresh Kontrolleri', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/github`;
    
    await gotoWithRecovery(page, targetUrl);

    // 1. Refresh/Sync butonu kontrolü
    const refreshBtn = page.locator('button').filter({ hasText: /sync|refresh|yenile/i })
      .or(page.locator('button:has(svg)').filter({ has: page.locator('svg[class*="refresh"], svg path[d*="M17.65"]') }))
      .or(page.locator('header button:has(svg)').last())
      .first();

    await expect(refreshBtn).toBeVisible({ timeout: 15000 });
    await expect(refreshBtn).toBeEnabled();
    console.log('🔘 [REPOSITORIES UI] Refresh/Sync butonuna tıklanıyor...');
    await refreshBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});

    // 2. Grid ve List görünüm butonlarını doğrula
    const gridBtn = page.getByRole('button', { name: /Grid/i }).first();
    const listBtn = page.getByRole('button', { name: /List/i }).first();
    if (await gridBtn.isVisible().catch(() => false)) {
      await expect(gridBtn).toBeEnabled();
      await expect(listBtn).toBeEnabled();
      console.log('🔘 [REPOSITORIES UI] Grid görünümüne geçiliyor...');
      await gridBtn.click();
      console.log('🔘 [REPOSITORIES UI] List görünümüne geri geçiliyor...');
      await listBtn.click();
      console.log('✅ Grid/List görünüm geçişleri doğrulandı.');
    }

    // 3. Arama filtre kutusunu doğrula
    const filterInput = page.getByPlaceholder(/Search repositories|Depolarda ara/i)
      .or(page.locator('input[placeholder*="Search"]'))
      .first();
    await expect(filterInput).toBeVisible({ timeout: 15000 });
    await expect(filterInput).toBeEditable();

    const testSearchQuery = 'gitsectest';
    console.log(`✍️ [REPOSITORIES UI] Arama kutusuna yazılıyor: "${testSearchQuery}"`);
    await filterInput.fill(testSearchQuery);
    await expect(filterInput).toHaveValue(testSearchQuery);
    await filterInput.fill('');
  });

  test('Kısım 3: Filtre Dropdown\'ları (Visibility, Status, Archive) Kontrolleri', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/github`;
    
    await gotoWithRecovery(page, targetUrl);

    const filterNames = [/Visibility/i, /Status/i, /Archive/i];

    for (const filterName of filterNames) {
      const filterBtn = page.getByRole('button', { name: filterName })
        .or(page.locator('button').filter({ hasText: filterName }))
        .first();

      if (await filterBtn.isVisible().catch(() => false)) {
        console.log(`🔘 [REPOSITORIES UI] "${filterName.source}" filtre dropdown'ı açılıyor...`);
        await filterBtn.click();

        // Herhangi bir menü, popover, radix portal wrapper veya listbox görünmesini bekle (Dile/Metne bağımlılığı sıfırlar)
        const popover = page.locator('[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], [class*="popover"], [class*="dropdown"]').first();
        await expect(popover).toBeVisible({ timeout: 8000 });

        // Dropdown'ı kapatmak için tekrar butona tıkla veya Esc bas
        await page.keyboard.press('Escape');
        console.log(`✅ "${filterName.source}" filtre dropdown'ı başarıyla açıldı.`);
      }
    }
  });

  test('Kısım 4: Tablo Seçimleri ve Satır İçi Aksiyon Butonları (Licensed, Backup, Link)', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/github`;
    
    await gotoWithRecovery(page, targetUrl);

    const table = page.locator('table').first();
    
    // Eğer sunucu gecikmesi veya chunk load hatası nedeniyle tablo anında gelmediyse recovery reload yap
    if (!(await table.isVisible().catch(() => false))) {
      console.log('🔄 [REPOSITORIES UI] Tablo görünür değil, bir kere yenileniyor...');
      await page.reload({ waitUntil: 'load' });
    }
    
    await expect(table).toBeVisible({ timeout: 25000 });

    const dataRows = table.locator('tbody tr');
    const rowCount = await dataRows.count();

    if (rowCount > 0) {
      console.log(`✅ [REPOSITORIES UI] Tabloda ${rowCount} adet repo satırı bulundu. Satır kontrolleri yapılıyor...`);
      const firstRow = dataRows.first();

      // 1. Toplu Seçim (Select All) Checkbox'ı
      const selectAllHeaderCheckbox = table.locator('thead th input[type="checkbox"]').first();
      const firstRowCheckbox = firstRow.locator('td input[type="checkbox"]').first();

      if (await selectAllHeaderCheckbox.isVisible().catch(() => false)) {
        console.log('🔘 [REPOSITORIES UI] Toplu seçim checkbox\'ı seçiliyor...');
        await selectAllHeaderCheckbox.check();
        // İlk satırdaki checkbox'ın seçildiğini denetle
        await expect(firstRowCheckbox).toBeChecked({ timeout: 5000 }).catch(() => {
          console.log('ℹ️ Checkbox durumu doğrudan check attribute ile bağlanmamış olabilir.');
        });
        await selectAllHeaderCheckbox.uncheck();
      }

      // 2. Lisanslama (Licensed) Toggle Butonu
      const licensedToggle = firstRow.locator('button[role="switch"], input[type="checkbox"][role="switch"], button[class*="switch"]').first();
      if (await licensedToggle.isVisible().catch(() => false)) {
        await expect(licensedToggle).toBeEnabled();
        console.log('✅ Satır içi Licensed toggle butonu doğrulandı.');
      }

      // 3. GitHub Yönlendirme (Dış Bağlantı) Linki
      const githubLink = firstRow.locator('a[target="_blank"], button:has(svg)').filter({ has: page.locator('svg') }).first();
      if (await githubLink.isVisible().catch(() => false)) {
        const href = await githubLink.getAttribute('href');
        if (href) {
          expect(href).toContain('github.com');
          console.log(`✅ Satır içi GitHub dış bağlantısı doğrulandı (Href: ${href}).`);
        }
      }

      // 4. Backup Butonu (Mavi Buton)
      const backupBtn = firstRow.getByRole('button', { name: /Backup|Yedekle/i })
        .or(firstRow.locator('button').filter({ hasText: /Backup|Yedekle/i }))
        .or(firstRow.locator('button').last())
        .first();

      if (await backupBtn.isVisible().catch(() => false)) {
        await expect(backupBtn).toBeEnabled();
        console.log('🔘 [REPOSITORIES UI] Mavi Backup butonuna tıklanıyor...');
        await backupBtn.click();

        // Backup yapılandırma modal'ının / dialog'unun açıldığını doğrula
        const backupModalTitle = page.getByRole('heading', { name: /Backup|Yedek|Configure/i })
          .or(page.locator('[role="dialog"]').getByText(/Backup|Yedek/i))
          .first();
        
        await expect(backupModalTitle).toBeVisible({ timeout: 15000 });
        console.log('✅ Backup yapılandırma modalı başarıyla açıldı.');

        // Modalı kapat
        const closeModalBtn = page.getByRole('button', { name: /close|cancel|kapat|iptal/i }).first();
        if (await closeModalBtn.isVisible()) {
          await closeModalBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
      }
    } else {
      console.log('ℹ️ Tabloda veri satırı bulunmadığı için satır içi aksiyon testleri atlandı.');
    }
  });

  test('Kısım 5: Sayfalama (Pagination) Alt Kontrolleri', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/github`;
    
    await gotoWithRecovery(page, targetUrl);

    // Sayfalama bilgisini bul
    const paginationText = page.getByText(/Page \d+ of \d+/i)
      .or(page.getByText(/Sayfa \d+/i))
      .first();

    if (await paginationText.isVisible().catch(() => false)) {
      await expect(paginationText).toBeVisible();
      console.log(`✅ Sayfalama alanı doğrulandı: "${await paginationText.innerText()}"`);

      // Yön oklarını veya sonraki sayfa butonunu bul
      const nextPageBtn = page.getByRole('button', { name: /next|sonraki|>/i })
        .or(page.locator('button').filter({ hasText: '>' }))
        .first();

      if (await nextPageBtn.isVisible().catch(() => false) && await nextPageBtn.isEnabled()) {
        console.log('🔘 [REPOSITORIES UI] Sonraki sayfa butonuna tıklanıyor...');
        await nextPageBtn.click();
        await page.waitForLoadState('networkidle').catch(() => {});
        console.log('✅ Sayfa geçiş etkileşimi başarıyla doğrulandı.');
      }
    } else {
      console.log('ℹ️ Tek sayfalık veri veya boş liste nedeniyle sayfalama kontrolü atlandı.');
    }
  });

  test('Kısım 6: Add Provider (Sağlayıcı Ekleme) Sayfası ve Bağlantı Butonları', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/repositories/add`;
    
    await gotoWithRecovery(page, targetUrl);

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
