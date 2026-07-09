import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { ProviderPage } from '../../pages/ProviderPage';
import { requireEnv } from '../../support/require-env';

test.describe('Storage Providers — Arayüz ve Buton Durum Doğrulamaları (UI & Button States)', () => {
  let storagePage: StoragePage;
  let providerPage: ProviderPage;

  test.beforeEach(async ({ page }) => {
    storagePage = new StoragePage(page);
    providerPage = new ProviderPage(page);

    // 1. Giriş yap ve dashboard'un yüklenmesini bekle
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. Next.js oturum hidrasyonunun tamamlanması için sidebar/navigasyon alanını bekle
    const sidebar = page.locator('aside, nav, [class*="sidebar"]').first();
    await sidebar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('Kısım 1: Sidebar ve Listeleme Sayfası Yönlendirme Butonlarını Doğrula', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');

    // 1. Sidebar'da Storage linkinin görünür ve tıklanabilir olduğunu doğrula
    const storageSidebarLink = page.getByRole('link', { name: /Storage|Depolama/i })
      .or(page.locator(`a[href*="/${workspaceId}/storage"]`))
      .first();

    await expect(storageSidebarLink).toBeVisible();
    await expect(storageSidebarLink).toBeEnabled();

    // 2. Sidebar linkine tıklayarak sayfaya geçiş yap
    await storageSidebarLink.click();
    await page.waitForURL(new RegExp(`/${workspaceId}/storage`));

    // 3. "Add Storage Provider" butonunun görünür ve tıklanabilir olduğunu doğrula
    const addStorageBtn = page.getByRole('button', { name: /Add Storage Provider|Depolama Sağlayıcısı Ekle/i })
      .or(page.getByRole('link', { name: /Add Storage Provider|Depolama Sağlayıcısı Ekle/i }))
      .or(page.locator('a, button').filter({ hasText: /Add Storage Provider|Depolama Sağlayıcısı Ekle/i }))
      .first();

    await expect(addStorageBtn).toBeVisible();
    await expect(addStorageBtn).toBeEnabled();
  });

  test('Kısım 2: Sağlayıcı Türü Seçim Kartlarının Görünürlüğünü ve AWS S3 Navigasyonunu Doğrula', async ({ page }) => {
    // 1. Depolama listeleme sayfasına git ve Add butonunu tıkla
    await storagePage.navigateToStoragePage();
    
    const addStorageBtn = page.getByRole('button', { name: /Add Storage Provider/i })
      .or(page.getByRole('link', { name: /Add Storage Provider/i }))
      .or(page.locator('a, button').filter({ hasText: /Add Storage Provider/i }))
      .first();
    await addStorageBtn.click();
    await page.waitForURL(new RegExp(/\/storage\/add/));

    // 2. Platformda desteklenen tüm sağlayıcı kartlarının görünür olduğunu doğrula
    const providerNames = [
      /AWS S3/i,
      /Azure Blob/i,
      /Huawei OBS/i,
      /Google Drive/i,
      /OneDrive/i
    ];

    for (const name of providerNames) {
      console.log(`[UI Test] Sağlayıcı kartı görünürlük kontrolü: ${name}`);
      const card = page.locator('h3, h4, p, div, span, button, a')
        .filter({ hasText: name })
        .first();
      await expect(card).toBeVisible();
      console.log(`✅ ${name} kartı görünür.`);
    }

    // 3. AWS S3 kartına tıklandığında form sayfasına yönlendirdiğini doğrula (tek kart derinlik testi)
    console.log('[UI Test] AWS S3 kartı tıklanarak form navigasyonu doğrulanıyor...');
    const awsCard = page.locator('h3, h4, p, div, span, button, a')
      .filter({ hasText: /^AWS S3$/ })
      .first();
    await awsCard.click();
    await page.waitForURL(/provider=AWS/i, { timeout: 15000 });
    console.log(`✅ AWS S3 kartı başarıyla form sayfasına yönlendirdi: ${page.url()}`);

    // 4. Form sayfasında "Back" butonunun varlığını doğrula
    const backBtn = page.getByRole('link', { name: /Back|Geri/i })
      .or(page.locator('a, button').filter({ hasText: /Back|Geri/i }))
      .first();
    await expect(backBtn).toBeVisible();
    console.log('✅ Form sayfasındaki "Back" butonu görünür.');
  });

  test('Kısım 3: Form Butonlarının Başlangıç Durumu ve Navigasyon Kontrolü', async ({ page }) => {
    // 1. Depolama listeleme sayfasına git ve Add butonunu tıkla
    await storagePage.navigateToStoragePage();
    
    const addStorageBtn = page.getByRole('button', { name: /Add Storage Provider/i })
      .or(page.getByRole('link', { name: /Add Storage Provider/i }))
      .or(page.locator('a, button').filter({ hasText: /Add Storage Provider/i }))
      .first();
    await addStorageBtn.click();
    await page.waitForURL(new RegExp(/\/storage\/add/));

    // 2. AWS S3 sağlayıcısını seç
    await storagePage.selectS3Provider();

    // 3. Buton locator'ları
    const saveBtn = storagePage.saveBtn;
    const testConnectionBtn = storagePage.testConnectionBtn;
    const cancelBtn = page.getByRole('link', { name: /Cancel|Back|Geri|İptal/i })
      .or(page.locator('a, button').filter({ hasText: /Cancel|Back|Geri|İptal/i }))
      .first();

    // 4. Form boşken Save butonunun devre dışı (disabled) olduğunu doğrula
    console.log('[UI Test] Form boşken Save butonunun devre dışı olduğu doğrulanıyor...');
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeDisabled();

    // 5. Test Connection butonunun görünür olduğunu doğrula
    console.log('[UI Test] Test Connection butonunun görünür olduğu doğrulanıyor...');
    await expect(testConnectionBtn).toBeVisible();

    // 6. Cancel/Back butonunun görünür olduğunu doğrula
    console.log('[UI Test] Cancel/Back butonunun görünür olduğu doğrulanıyor...');
    await expect(cancelBtn).toBeVisible();

    // 7. Form alanlarının doldurulabilir (editable) olduğunu doğrula
    console.log('[UI Test] Form alanlarının doldurulabilirliği kontrol ediliyor...');
    await expect(storagePage.awsConnectionNameInput).toBeEditable();
    await expect(storagePage.awsBucketInput).toBeEditable();
    await expect(storagePage.awsAccessKeyInput).toBeEditable();
    await expect(storagePage.awsSecretKeyInput).toBeEditable();

    // 8. Sadece bağlantı adı girildikten sonra Save'in hala disabled olduğunu doğrula (kısmi form)
    console.log('[UI Test] Kısmi form ile Save butonunun hala devre dışı olduğu doğrulanıyor...');
    await storagePage.awsConnectionNameInput.fill('UI Test S3 Connection');
    await expect(saveBtn).toBeDisabled();

    // 9. Cancel/Back butonuna tıklayınca listeleme sayfasına dönüldüğünü doğrula
    console.log('[UI Test] Cancel/Back butonunun yönlendirmesi doğrulanıyor...');
    await cancelBtn.click();
    await page.waitForURL(new RegExp(`/${storagePage.workspaceId}/storage`));
    console.log('✅ Cancel/Back butonu başarıyla listeleme sayfasına geri yönlendirdi.');
  });

  test('Kısım 4: Listeleme Sayfası Bileşenlerini (Tablo, Filtre, Sayfalama) Doğrula', async ({ page }) => {
    // 1. Storage ana listeleme sayfasına git
    await storagePage.navigateToStoragePage();

    // 2. Sayfa başlığını doğrula
    const pageTitle = page.getByText(/GitSec Storages|Storage Providers/i).first();
    await expect(pageTitle).toBeVisible();
    console.log('✅ Sayfa başlığı görünür.');

    // 3. "Add Storage Provider" butonunun görünür olduğunu doğrula
    const addStorageBtn = page.getByRole('button', { name: /Add Storage Provider/i })
      .or(page.getByRole('link', { name: /Add Storage Provider/i }))
      .or(page.locator('a, button').filter({ hasText: /Add Storage Provider/i }))
      .first();
    await expect(addStorageBtn).toBeVisible();
    await expect(addStorageBtn).toBeEnabled();

    // 4. Tablonun veya "No results" mesajının varlığını doğrula
    const table = page.locator('table').first();
    const hasTable = await table.isVisible().catch(() => false);

    if (hasTable) {
      console.log('[UI Test] Tablo bulundu.');

      // A. Tablo başlık sütunlarını doğrula
      const expectedHeaders = ['Name', 'Type', 'Region', 'Status', 'Created', 'Enabled', 'Actions'];
      for (const header of expectedHeaders) {
        const headerCell = table.locator('thead th, thead td').filter({ hasText: new RegExp(header, 'i') }).first();
        await expect(headerCell).toBeVisible();
      }
      console.log('✅ Tüm tablo başlık sütunları doğrulandı.');

      // B. Tabloda veri satırları varsa butonları denetle
      const dataRows = table.locator('tbody tr').filter({ hasNot: page.getByText(/No results/i) });
      const dataRowCount = await dataRows.count();

      if (dataRowCount > 0) {
        console.log(`[UI Test] Tabloda ${dataRowCount} adet veri satırı bulundu. Aksiyon butonları denetleniyor...`);
        const firstRow = dataRows.first();

        // Aksiyon menüsü tetikleyicisini veya inline butonları denetle
        const actionsTrigger = firstRow.locator('button[aria-haspopup="menu"]')
          .or(firstRow.getByRole('button', { name: /Open menu|actions/i }))
          .or(firstRow.locator('button').last())
          .first();

        if (await actionsTrigger.isVisible().catch(() => false)) {
          await expect(actionsTrigger).toBeEnabled();
          console.log('✅ Satır içi aksiyon menü butonu doğrulandı.');
        }
      } else {
        console.log('ℹ️ Tabloda veri satırı yok ("No results found"). Aksiyon buton kontrolü atlandı.');
        // "No results found" mesajının kendisini doğrula
        const noResults = page.getByText(/No results found/i).first();
        await expect(noResults).toBeVisible();
        console.log('✅ "No results found" boş durum mesajı doğru gösterildi.');
      }
    }

    // 5. "Filter by name" arama kutusunun varlığını doğrula
    const filterInput = page.getByPlaceholder(/Filter by name|İsme göre filtrele/i)
      .or(page.locator('input[placeholder*="Filter"]'))
      .first();
    if (await filterInput.isVisible().catch(() => false)) {
      await expect(filterInput).toBeEditable();
      console.log('✅ Filtre arama kutusu doldurulabilir.');
    }

    // 6. Sayfalama (Pagination) kontrolünün varlığını doğrula
    const pagination = page.getByText(/Page \d+ of \d+/i)
      .or(page.getByText(/Sayfa \d+/i))
      .first();
    if (await pagination.isVisible().catch(() => false)) {
      await expect(pagination).toBeVisible();
      console.log('✅ Sayfalama kontrolü görünür.');
    }

    // 7. "View" butonunun varlığını doğrula (tablo görünüm değiştirici)
    const viewBtn = page.getByRole('button', { name: /View|Görünüm/i })
      .or(page.locator('button').filter({ hasText: /View/i }))
      .first();
    if (await viewBtn.isVisible().catch(() => false)) {
      await expect(viewBtn).toBeEnabled();
      console.log('✅ "View" (Görünüm) butonu doğrulandı.');
    }
  });
});
