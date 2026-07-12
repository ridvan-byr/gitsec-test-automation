import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { requireEnv } from '../../support/require-env';

test.describe('Backup Snapshots — Arayüz ve Buton Durum Doğrulamaları (UI & Button States)', () => {
  let providerPage: ProviderPage;

  test.beforeEach(async ({ page }) => {
    // 502 ve Next.js static asset yükleme hatalarını yoksay (Staging sunucusu kararlılığı için)
    (page as any).ignoredErrors = [
      /502/,
      /_next\/static\/chunks/i,
      /Failed to load resource/i,
      /ChunkLoadError/i
    ];

    providerPage = new ProviderPage(page);

    // 1. Giriş yap ve dashboard'a git
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. Next.js oturum hidrasyonunun tamamlanması için sidebar/navigasyon alanını bekle
    const sidebar = page.locator('aside, nav, [class*="sidebar"]').first();
    await sidebar.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  test('Kısım 1: Backup Snapshots Sidebar Navigasyonu ve Sayfa Yüklenmesi', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');

    // 1. Sidebar'da Backup Snapshots linkini doğrula ve tıkla
    const backupsSidebarLink = page.getByRole('link', { name: /^Backup Snapshots$/i })
      .or(page.locator(`a[href*="/${workspaceId}/backups"]`))
      .first();

    await expect(backupsSidebarLink).toBeVisible();
    await expect(backupsSidebarLink).toBeEnabled();
    console.log('🔘 [UI TEST] Sidebar Backup Snapshots linkine tıklanıyor...');
    await backupsSidebarLink.click();

    // 2. Sayfa yönlendirmesini doğrula
    await page.waitForURL(new RegExp(`/${workspaceId}/backups`));

    // 3. Sayfa başlığını ("Backup Snapshots") doğrula
    const pageTitle = page.getByRole('heading', { name: 'Backup Snapshots' })
      .or(page.locator('h1, h2').filter({ hasText: 'Backup Snapshots' }))
      .first();
    await expect(pageTitle).toBeVisible({ timeout: 15000 });
    console.log('✅ Sidebar Backup Snapshots navigasyonu ve sayfa yüklenmesi doğrulandı.');
  });

  test('Kısım 2: Üst Bar Butonları (Yenileme ve View Filtre Butonu)', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/backups`;
    await page.goto(targetUrl, { waitUntil: 'load' });

    // 1. Yenileme (Refresh/Sync) butonunu doğrula (lucide-refresh-cw sınıfı veya dairesel ok)
    const refreshBtn = page.locator('button:has(svg.lucide-refresh-cw)')
      .or(page.locator('button').filter({ has: page.locator('svg') }).last())
      .first();

    await expect(refreshBtn).toBeVisible({ timeout: 15000 });
    await expect(refreshBtn).toBeEnabled();
    
    // Yenileme butonuna tıkla ve aktifliğini kontrol et
    console.log('🔘 [UI TEST] Yenileme (Sync/Refresh) butonuna tıklanıyor...');
    await refreshBtn.click();
    console.log('✅ Yenileme butonu başarıyla test edildi.');

    // 2. "View" filtre butonunu doğrula
    const viewBtn = page.getByRole('button', { name: /View/i })
      .or(page.locator('button').filter({ hasText: /View/i }))
      .filter({ visible: true })
      .first();

    await expect(viewBtn).toBeVisible();
    await expect(viewBtn).toBeEnabled();
    console.log('✅ "View" filtre butonu arayüzde başarıyla doğrulandı.');
  });

  test('Kısım 3: Tablo Başlıkları, Satır İçi Silme Butonu ve Diyalog Doğrulaması', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/backups`;
    await page.goto(targetUrl, { waitUntil: 'load' });

    // 1. Tablonun varlığını doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    // 2. Tablo başlık sütunlarını doğrula
    const expectedHeaders = ['Repository Name', 'Provider', 'Scopes', 'Storage', 'Start Time', 'Finish Time', 'Elapsed Time', 'Size'];
    for (const header of expectedHeaders) {
      const headerCell = page.locator('th').filter({ hasText: header }).first();
      await expect(headerCell).toBeVisible();
    }
    console.log('✅ Tablo başlık sütunları başarıyla doğrulandı.');

    // 3. Satır içi silme (trash bin) butonunu ve onay penceresini doğrula (eğer veri varsa)
    const firstRowDeleteBtn = page.locator('tr button:has(svg.lucide-trash, svg.lucide-trash-2)')
      .or(page.locator('tr button').filter({ has: page.locator('svg') }).last())
      .first();

    if (await firstRowDeleteBtn.isVisible().catch(() => false)) {
      console.log('🔘 [UI TEST] Satır içi yedek silme butonuna tıklanıyor...');
      await firstRowDeleteBtn.click();

      // Onay diyalogunu (dialog) doğrula
      const confirmDialog = page.getByRole('dialog')
        .or(page.locator('[role="alertdialog"]'))
        .first();
      await expect(confirmDialog).toBeVisible({ timeout: 8000 });

      // Diyalog başlık veya açıklamasını doğrula
      const dialogText = confirmDialog.getByText(/delete|remove|sure|silmek istediğinizden eminsiniz/i).first();
      await expect(dialogText).toBeVisible();

      // İptal (Cancel) butonunu bul ve tıkla (gerçek yedeği silmemek için)
      const cancelBtn = confirmDialog.getByRole('button', { name: /Cancel|İptal|Close|Kapat/i })
        .or(confirmDialog.locator('button').filter({ hasText: /Cancel|İptal/i }))
        .first();
      
      await expect(cancelBtn).toBeVisible();
      await expect(cancelBtn).toBeEnabled();
      console.log('🔘 [UI TEST] Silme onay modalı iptal ediliyor...');
      await cancelBtn.click();

      // Modalın kapandığını doğrula
      await expect(confirmDialog).toBeHidden();
      console.log('✅ Silme onay modalı ve İptal akışı başarıyla doğrulandı.');
    } else {
      console.log('ℹ️ [UI TEST] Tabloda silinebilecek aktif yedek satırı bulunamadı, silme doğrulaması atlanıyor.');
    }
  });

  test('Kısım 4: Sayfalama (Pagination) Kontrolleri', async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const targetUrl = `${requireEnv('DASHBOARD_BASE_URL')}/${workspaceId}/backups`;
    await page.goto(targetUrl, { waitUntil: 'load' });

    // 1. Satır limit dropdown / seçici kontrolü (Rows per page)
    const limitSelector = page.locator('button[id*="select-trigger"]')
      .or(page.locator('[data-slot="select-trigger"]').filter({ hasText: /10|20|30|40|50|100/ }))
      .first();

    await expect(limitSelector).toBeVisible({ timeout: 15000 });
    console.log('✅ Satır limit dropdown (Rows per page) arayüzde doğrulandı.');

    // 2. Sayfa bilgisi metni (Örn: "Page 1 of 3")
    const pageText = page.getByText(/Page \d+ of \d+/i)
      .or(page.locator('span').filter({ hasText: /Page \d+ of \d+/i }))
      .filter({ visible: true })
      .first();
    await expect(pageText).toBeVisible();

    // 3. Sayfalama numaraları veya sonraki/önceki butonları
    const nextBtn = page.locator('button').filter({ has: page.locator('svg.lucide-chevron-right') })
      .or(page.getByRole('button', { name: '2', exact: true }))
      .filter({ visible: true })
      .first();
    
    await expect(nextBtn).toBeVisible();
    console.log('✅ Sayfalama (Pagination) kontrolleri başarıyla doğrulandı.');
  });
});
