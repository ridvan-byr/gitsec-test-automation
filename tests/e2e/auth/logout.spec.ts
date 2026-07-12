import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Logout — Oturum Kapatma E2E Akışı', () => {
  const getDashboardAndLogout = async (page: any, dashboardBaseUrl: string, workspaceId: string) => {
    const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
    console.log(`🌐 [LOGOUT TEST] Dashboard sayfasına yönleniliyor: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    
    // Oturum yüklenene kadar ana layout alanını bekle
    const mainLayout = page.locator('main, aside, nav').first();
    await mainLayout.waitFor({ state: 'visible', timeout: 20000 });

    // Kullanıcı profil tetikleyicisini bul
    const userMenuTrigger = page.locator('button[data-slot="dropdown-menu-trigger"]').filter({ hasText: /@/ })
      .or(page.getByRole('button', { name: /gitsectest/i }))
      .last();

    await expect(userMenuTrigger).toBeVisible({ timeout: 15000 });
    await expect(userMenuTrigger).toBeEnabled();

    console.log('🔘 [LOGOUT TEST] Kullanıcı profil menüsü açılıyor...');
    await userMenuTrigger.click();

    // Açılan dropdown menüde "Sign out" veya "Log out" butonunu bul
    const signOutBtn = page.getByRole('menuitem', { name: /Sign out|Log out|Çıkış/i })
      .or(page.locator('[role="menuitem"]').filter({ hasText: /Sign out|Log out|Çıkış/i }))
      .first();

    await expect(signOutBtn).toBeVisible({ timeout: 8000 });
    await expect(signOutBtn).toBeEnabled();

    // Çıkış yap butonuna tıkla
    console.log('🔘 [LOGOUT TEST] Profil menüsünden Sign out tetikleniyor...');
    await signOutBtn.click();

    // Onay modalı (dialog) içindeki "Sign out" butonunu bekle ve tıkla
    console.log('🔘 [LOGOUT TEST] Onay modalındaki kırmızı Sign out butonuna tıklanıyor...');
    const confirmSignOutBtn = page.locator('[role="dialog"] button').filter({ hasText: /^Sign out$/i })
      .or(page.locator('button').filter({ hasText: /^Sign out$/i }))
      .last();
    
    await expect(confirmSignOutBtn).toBeVisible({ timeout: 5000 });
    await confirmSignOutBtn.click();
  };

  test('Oturum Kapatma Sonrası Korumalı Sayfalara Erişimin Engellenmesi (Güvenlik Doğrulaması)', { tag: ['@smoke', '@critical'] }, async ({ page }) => {
    const workspaceId = requireEnv('WORKSPACE_ID');
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;

    // 1. Giriş yap ve logout işlemini gerçekleştir
    await getDashboardAndLogout(page, dashboardBaseUrl, workspaceId);

    // 2. Çıkış yapıldıktan sonra korumalı dashboard sayfasına tekrar gitmeyi dene (Güvenlik Testi)
    console.log('🔒 [LOGOUT TEST] Çıkış sonrası korumalı sayfaya tekrar erişim deneniyor...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // 3. Sistem oturumun kapandığını doğrulayıp kullanıcıyı giriş sayfasına yönlendirmeli
    console.log('⏳ [LOGOUT TEST] Giriş sayfasına yönlendirme kontrol ediliyor...');
    await expect(page).toHaveURL(/sign-in|login/, { timeout: 20000 });
    console.log('✅ [LOGOUT TEST] Oturumun sunucu tarafında başarıyla sonlandırıldığı doğrulandı.');
  });

  test('Oturum Kapatma Sonrası Giriş Sayfasına Doğru Yönlendirme (Yönlendirme Kontrolü)', { tag: ['@smoke'] }, async ({ page }) => {
    // Staging uygulamasında çıkış yapınca doğrudan workspaceId olmadan '/dashboard' URL'ine yönlenip
    // 404 Page Not Found vermesi hatasını (Known Bug) işaretliyoruz.
    test.fail(true, 'Staging redirects to /dashboard without workspaceId causing 404 (Known Bug)');

    const workspaceId = requireEnv('WORKSPACE_ID');
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    // 1. Giriş yap ve logout işlemini gerçekleştir
    await getDashboardAndLogout(page, dashboardBaseUrl, workspaceId);

    // 2. Çıkış yapıldığı an kullanıcının doğrudan /sign-in sayfasına yönlendirilmesi beklenir
    await expect(page).toHaveURL(/sign-in|login/, { timeout: 15000 });
  });
});
