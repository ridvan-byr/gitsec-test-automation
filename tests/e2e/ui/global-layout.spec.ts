import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Global Layout & Common UI Components (Genel Arayüz & Ortak Bileşenler)', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;

  test.beforeEach(async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /502/,
      /_next\/static\/chunks/i,
      /Failed to load resource/i,
      /ChunkLoadError/i
    ];
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    
    const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
    console.log(`🌐 [UI TEST] Dashboard sayfasına yönleniliyor: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    
    // Oturum yüklenene kadar ana layout alanını bekle
    const mainLayout = page.locator('main, aside, nav').first();
    await mainLayout.waitFor({ state: 'visible', timeout: 20000 });
  });

  test('Kısım 1: Sidebar Daraltma ve Genişletme (Toggle Sidebar) Butonu', async ({ page }) => {
    // Sidebar tetikleyici butonunu bul
    const sidebarTrigger = page.locator('[data-slot="sidebar-trigger"]')
      .or(page.getByRole('button', { name: /Toggle Sidebar/i }))
      .or(page.getByTitle('Toggle Sidebar'))
      .first();

    await expect(sidebarTrigger).toBeVisible({ timeout: 15000 });
    await expect(sidebarTrigger).toBeEnabled();

    // Sidebar'ın ana sarmalayıcısını bul
    const sidebarContainer = page.locator('[data-slot="sidebar"], aside, nav[class*="sidebar"]').first();
    await expect(sidebarContainer).toBeVisible();

    // Başlangıçta sidebar geniş/açık durumda olmalı (state: expanded)
    const initialState = await sidebarContainer.getAttribute('data-state');
    console.log(`ℹ️ [UI TEST] Sidebar başlangıç durumu: ${initialState}`);

    // Sidebar'ı daraltmak için tıkla
    console.log('🔘 [UI TEST] Sidebar toggle butonuna tıklanıyor (Collapse)...');
    await sidebarTrigger.click();

    // Eğer sidebar daraltılabilir olarak yapılandırıldıysa daraldığını doğrula
    const collapsibleAttr = await sidebarContainer.getAttribute('data-collapsible');
    if (collapsibleAttr === 'icon' || collapsibleAttr === 'offcanvas') {
      await expect(sidebarContainer).toHaveAttribute('data-state', 'collapsed', { timeout: 8000 });
      console.log('✅ Sidebar başarıyla daraltıldı.');

      // Tekrar genişlet
      console.log('🔘 [UI TEST] Sidebar toggle butonuna tekrar tıklanıyor (Expand)...');
      await sidebarTrigger.click();
      await expect(sidebarContainer).toHaveAttribute('data-state', 'expanded', { timeout: 8000 });
      console.log('✅ Sidebar başarıyla tekrar genişletildi.');
    } else {
      console.log('ℹ️ [UI TEST] Sidebar statik olarak yapılandırılmış (collapsible değil), daralma doğrulaması atlanıyor.');
    }
  });

  test('Kısım 2: Global Arama (Search) Giriş Alanı Kontrolü', async ({ page }) => {
    // Global arama kutusunu bul (Aria-label: "Search" veya placeholder: "Search...")
    const searchInput = page.locator('input[aria-label="Search" i]')
      .or(page.locator('input[placeholder*="Search" i]'))
      .or(page.locator('[data-slot="input"][aria-label="Search" i]'))
      .first();

    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await expect(searchInput).toBeEnabled();

    // Arama alanına test metni yaz
    const testQuery = 'gitsec-test-query';
    console.log(`✍️ [UI TEST] Arama kutusuna yazılıyor: "${testQuery}"`);
    await searchInput.fill(testQuery);

    // Yazılan metnin doğruluğunu doğrula
    await expect(searchInput).toHaveValue(testQuery);
    console.log('✅ Arama kutusuna yazma ve değer doğrulaması başarılı.');

    // Arama kutusunu temizle
    await searchInput.fill('');
    await expect(searchInput).toHaveValue('');
    
    // Arama kutusunun odağını (focus) çekerek dropdown/combobox'ı kapat
    console.log('⌨️ [UI TEST] Arama kutusunun odağı (blur) kapatılıyor...');
    await searchInput.blur();
    await page.waitForTimeout(500); // Kapanması için kısa bir süre bekle
  });

  test('Kısım 3: Kullanıcı Profil Dropdown Menüsü ve Çıkış Butonu Durumu', async ({ page }) => {
    // Sidebar'ın alt kısmında veya üst barda yer alan kullanıcı profil tetikleyicisini bul
    const userMenuTrigger = page.locator('button[data-slot="dropdown-menu-trigger"]').filter({ hasText: /@/ })
      .or(page.getByRole('button', { name: /gitsectest/i }))
      .last();

    await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
    await expect(userMenuTrigger).toBeEnabled();

    console.log('🔘 [UI TEST] Kullanıcı profil menüsü açılıyor...');
    await userMenuTrigger.click();

    // Açılan dropdown menüde "Sign out" veya "Log out" butonunun varlığını kontrol et
    const signOutBtn = page.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i })
      .or(page.locator('[role="menuitem"]').filter({ hasText: /Sign out|Log out|Çıkış/i }))
      .first();

    await expect(signOutBtn).toBeVisible({ timeout: 8000 });
    await expect(signOutBtn).toBeEnabled();
    console.log('✅ Çıkış yap (Sign out) butonu menü içerisinde başarıyla doğrulandı.');

    // Menüyü kapatmak için boş bir yere veya trigger'a tekrar tıkla
    await userMenuTrigger.click({ force: true });
  });

  test('Kısım 4: Tema Değiştirme (Theme Toggle) Dropdown Bileşeni Kontrolü', async ({ page }) => {
    // Tema değiştirme butonunu bul (ikondaki lucide-moon veya lucide-sun sınıfını kontrol et)
    const themeToggle = page.locator('button:has(svg.lucide-moon, svg.lucide-sun)')
      .or(page.locator('button[aria-label*="theme" i]'))
      .or(page.locator('button:has(svg)').filter({ hasText: /theme/i }))
      .first();

    // Tema butonu varsa test et (bazı minimal dashboard düzenlerinde gizli olabilir, yoksa testi pas geç)
    if (await themeToggle.isVisible().catch(() => false)) {
      console.log('🔘 [UI TEST] Tema değiştirici butona tıklanıyor...');
      await themeToggle.click();

      // Tema seçenekleri (Light, Dark, System) görünür olmalı
      const lightThemeOption = page.getByRole('menuitem', { name: /Light/i })
        .or(page.locator('[role="menuitem"]').filter({ hasText: /Light/i }))
        .first();

      const darkThemeOption = page.getByRole('menuitem', { name: /Dark/i })
        .or(page.locator('[role="menuitem"]').filter({ hasText: /Dark/i }))
        .first();

      // E2E Hydration / Klik Yutma koruması: Eğer menü ilk klikte açılmadıysa bekle ve tekrar dene
      try {
        await expect(lightThemeOption).toBeVisible({ timeout: 3000 });
      } catch {
        console.log('⚠️ [UI TEST] Tema menüsü açılmadı (Next.js Hydration gecikmesi olabilir), tekrar deneniyor...');
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        await themeToggle.click({ force: true });
      }

      await expect(lightThemeOption).toBeVisible({ timeout: 8000 });
      await expect(darkThemeOption).toBeVisible({ timeout: 8000 });
      console.log('✅ Tema menüsü seçenekleri (Light/Dark) başarıyla doğrulandı.');

      // Menüyü kapat
      await themeToggle.click({ force: true });
    } else {
      console.log('ℹ️ [UI TEST] Bu sayfada belirgin bir tema değiştirme butonu bulunamadı, adım atlanıyor.');
    }
  });
});
