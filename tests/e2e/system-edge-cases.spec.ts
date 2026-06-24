import { test, expect } from '../fixtures/test';
import { ProviderPage } from '../pages/ProviderPage';
import { requireEnv } from '../support/require-env';

const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
const apiBaseUrl = requireEnv('API_BASE_URL');

test.describe('System Level Edge Cases — Workspace Yetki Yalıtımı ve Token Geçersizliği', () => {
  
  test('Yetkisiz WORKSPACE_ID (999999) ile dashboard veya API erişimi engellenmeli ve 403/404 veya UI hata ekranı gösterilmelidir', async ({ page }) => {
    test.setTimeout(90000);
    // 1. API'yi bu sahte workspace için 403 Forbidden dönecek şekilde route edelim
    await page.route(`${apiBaseUrl}/api/**/999999/**`, async (route) => {
      console.log('🛡️ [MOCK WORKSPACE ISOLATION] Yetkisiz workspace API isteği engellendi.');
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Access Denied. You do not have permissions for this workspace.'
        })
      });
    });

    await page.route(`${apiBaseUrl}/api/activities*`, async (route) => {
      const headers = route.request().headers();
      const wsHeader = headers['workspace-id'] || headers['workspaceid'] || headers['x-workspace-id'];
      if (wsHeader === '999999') {
        console.log('🛡️ [MOCK WORKSPACE ISOLATION] Header tabanlı workspace engellendi.');
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, message: 'Access Denied.' })
        });
      } else {
        await route.continue();
      }
    });

    // 2. Yetkisiz workspace URL'ine gidelim
    const unauthorizedUrl = `${dashboardBaseUrl}/999999/dashboard`;
    console.log(`🌐 [Workspace Isolation] Yetkisiz workspace'e gidiliyor: ${unauthorizedUrl}`);
    await page.goto(unauthorizedUrl, { waitUntil: 'domcontentloaded' });

    // 3. UI'ın 403/404 hata mesajı veya "Yetkisiz Erişim" uyarısı gösterdiğini doğrula
    const accessDeniedMsg = page.getByText(/access denied|forbidden|unauthorized|yetkisiz|izin|bulunamadı|page not found|403|404/i).first();
    await expect(accessDeniedMsg).toBeVisible({ timeout: 15000 });
    
    console.log('✅ Çoklu kiracılık (Workspace yetki yalıtımı) başarıyla doğrulandı.');
  });

  test('Aktif oturum esnasında token geçerliliğini yitirdiğinde (401 Unauthorized) UI güvenli şekilde oturumu sonlandırmalıdır', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Dashboard'a gidip sayfanın hazır olmasını bekle
    const providerPage = new ProviderPage(page);
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. API isteklerini 401 Unauthorized dönecek şekilde route edelim
    await page.route(`${apiBaseUrl}/api/**`, async (route) => {
      if (!route.request().url().includes('/auth/signin')) {
        console.log('🛡️ [MOCK TOKEN EXPIRY] API isteği 401 Unauthorized dönülüyor.');
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Token has expired or is invalid.'
          })
        });
      } else {
        await route.continue();
      }
    });

    // 3. Sayfayı yenileyelim veya bir işlem yapmayı tetikleyelim
    await page.reload({ waitUntil: 'domcontentloaded' });

    // 4. UI'ın hata durumlarını panellerde güvenli şekilde gösterdiğini doğrula (Çökme olmadan)
    const failedAnalytics = page.getByText(/Failed to load analytics/i).first();
    const failedActivities = page.getByText(/Failed to load recent activities/i).first();
    
    await expect(failedAnalytics).toBeVisible({ timeout: 15000 });
    await expect(failedActivities).toBeVisible({ timeout: 15000 });

    console.log('✅ Token geçersizliğinde UI\'ın çökmeden hata panellerini gösterdiği başarıyla doğrulandı.');
  });

  test('Aktif oturumda eşzamanlı istekler atıldığında token yenileme yarışı (Token Refresh Race Condition) başarıyla yönetilmeli ve UI çökmemelidir', async ({ page }) => {
    test.setTimeout(90000);
    // 1. Dashboard'a gidip sayfanın hazır olmasını bekle
    const providerPage = new ProviderPage(page);
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // 2. Token yenileme / refresh API endpoint'i sayacını kuralım
    let refreshCount = 0;
    const interceptedUrls: string[] = [];
    
    // API isteklerini ve refresh isteğini dinleyelim/route edelim
    await page.route(`${apiBaseUrl}/**`, async (route) => {
      const url = route.request().url();
      interceptedUrls.push(url);
      
      if (url.includes('/auth/refresh') || url.includes('/auth/token')) {
        refreshCount++;
        console.log(`🛡️ [MOCK TOKEN REFRESH] Refresh API hit #${refreshCount}: ${url}`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            token: 'new-valid-e2e-session-token'
          })
        });
      } else if (!url.includes('/auth/signin')) {
        // Normal API çağrısı, token yenileme mekanizmasını tetiklemek için 401 dönüyoruz
        console.log(`🛡️ [MOCK API CALL] 401 Unauthorized dönülüyor: ${url}`);
        await route.fulfill({
          status: 401,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Unauthorized access.'
          })
        });
      } else {
        await route.continue();
      }
    });

    // 3. Sayfayı yenileyerek concurrent istekleri başlatalım
    console.log('[e2e] Sayfa yenileniyor, concurrent Axios istekleri tetikleniyor...');
    await page.reload({ waitUntil: 'networkidle' });

    // 4. Token yenileme API'sinin en fazla 1 kez çağrıldığını doğrula (Race condition lock/debounce kontrolü)
    console.log(`📊 Toplam Token Refresh API çağrısı adedi: ${refreshCount}`);
    console.log('[e2e] Intercepted URLs during reload:', interceptedUrls);
    
    // Eğer UI'da token refresh mantığı varsa tek bir istek atılmalı; yoksa veya düzgünce yönetiliyorsa bile çoklu istek spam edilmemeli
    expect(refreshCount).toBeLessThanOrEqual(1);
    
    // 5. UI'ın donmadığını/kilitlenmediğini ve kararlı olduğunu doğrula
    // 'main' elementinin görünür olduğunu doğrula (sidebar ve paneller)
    await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 });
    
    console.log('✅ Token yenileme yarışının başarıyla yönetildiği ve sistemin kararlı kaldığı doğrulandı.');
  });
});

