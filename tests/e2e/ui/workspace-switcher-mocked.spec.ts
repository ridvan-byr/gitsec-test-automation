import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Workspace Switcher — Çalışma Alanı Değiştirme Mock Akışı', () => {
  test('Dashboard üzerinde workspace switcher açılmalı ve diğer workspace seçildiğinde yönlendirme yapılmalıdır', async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /currentRate/i,
      /Cannot read properties of undefined/i,
      /Failed to load resource/i,
      /HTTP Status 502/i
    ];
    
    const workspaceId = requireEnv('WORKSPACE_ID');
    const apiBaseUrl = requireEnv('API_BASE_URL');
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    // 1. API Sunucusu /api/workspaces endpoint'ini yakala ve iki adet workspace dön
    await page.route(
      (url) => url.href.startsWith(apiBaseUrl),
      async (route) => {
        const urlStr = route.request().url();
        const method = route.request().method();

        if (urlStr.includes('/api/workspaces') && !urlStr.includes('/repositories') && !urlStr.includes('/installations')) {
          console.log(`🛡️ [MOCK API] URL: ${urlStr} (${method}) - Intercepting workspaces`);
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                pagination: {
                  currentPage: 1,
                  maxPage: 1,
                  rowOffset: 0,
                  maxRowsPerPage: 99,
                  resultRowCount: 2,
                  totalRowCount: 2
                },
                list: [
                  {
                    id: Number(workspaceId) || 28,
                    name: "Gitsec's Default Workspace",
                    code: null,
                    description: null,
                    avatarUrl: null,
                    colorCode: null,
                    isDefault: true,
                    isArchived: false,
                    tenantId: 37,
                    archivedAt: null,
                    lastActivityAt: null
                  },
                  {
                    id: 99,
                    name: "Secondary Workspace",
                    code: null,
                    description: null,
                    avatarUrl: null,
                    colorCode: null,
                    isDefault: false,
                    isArchived: false,
                    tenantId: 37,
                    archivedAt: null,
                    lastActivityAt: null
                  }
                ]
              }
            })
          });
        } else {
          // Diğer tüm API isteklerinin gerçek sunucuya gitmesine izin ver
          await route.continue();
        }
      }
    );

    // 2. Dashboard sayfasına git
    const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
    console.log(`🌐 [SWITCHER TEST] Dashboard sayfasına yönleniliyor: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle').catch(() => {});

    // Oturum yüklenene kadar sidebar/nav alanını bekle
    const mainLayout = page.locator('main, aside, nav').first();
    await expect(mainLayout).toBeVisible({ timeout: 20000 });
    
    // Sayfanın tamamen kararlı hale gelmesi (hydration) için kısa bir süre bekle
    await page.waitForTimeout(3000);

    // 3. Workspace Dropdown Trigger'ını bul ve tıkla
    const wsTrigger = page.getByRole('button', { name: /Gitsec's Default Workspace/i })
      .or(page.locator('[data-slot="dropdown-menu-trigger"]'))
      .first();
    
    await expect(wsTrigger).toBeVisible({ timeout: 15000 });
    console.log('🔘 [SWITCHER TEST] Workspace dropdown tetikleyicisine tıklanıyor...');
    await wsTrigger.click();

    // 4. Dropdown menünün açılmasını bekle
    const workspaceMenu = page.getByRole('menu').first();
    await expect(workspaceMenu).toBeVisible({ timeout: 10000 });

    // 5. "Secondary Workspace" seçeneğinin varlığını doğrula ve tıkla
    const secondaryOption = page.locator('[role="menuitem"], [class*="menu-item"], [data-slot="menu-item"]')
      .filter({ hasText: /Secondary Workspace/i })
      .first();
    
    await expect(secondaryOption).toBeVisible({ timeout: 10000 });
    console.log('🔘 [SWITCHER TEST] "Secondary Workspace" seçeneğine tıklanıyor...');
    await secondaryOption.click();

    // 6. Yönlendirmenin gerçekleştiğini doğrula (URL /99/ olmalı)
    console.log('⏳ [SWITCHER TEST] Yeni workspace yönlendirmesi bekleniyor...');
    await expect(page).toHaveURL(/.*\/99\/.*/, { timeout: 25000 });
    
    console.log('🎉 [SWITCHER TEST] Workspace switcher testi başarıyla tamamlandı!');
  });
});
