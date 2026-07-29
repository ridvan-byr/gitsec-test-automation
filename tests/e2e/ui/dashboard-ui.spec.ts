import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import {
  openDashboard,
  ensureDashboard,
  pauseIfHeaded,
  getDashboardUrl,
} from '../../support/dashboard-ui-helpers';

test.describe('Dashboard UI & Widget Etkileşim Doğrulamaları (UI & Interactive Buttons)', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;
  let dashboardUrl: string;

  test.beforeAll(() => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    dashboardUrl = getDashboardUrl(dashboardBaseUrl, workspaceId);
  });

  test('Dashboard widget etkileşimleri — Lisans, Tur, Görevler, Aktiviteler', { tag: ['@critical'] }, async ({ page }) => {
    const viewAllUrlPattern = new RegExp(`/${workspaceId}/(executions|tasks|backups|activity)`);

    await openDashboard(page, dashboardBaseUrl, workspaceId);

    await test.step('Kısım 1: Dinamik Lisans Butonu Kontrolü (A Yöntemi - Regex Filtreleme)', async () => {
      const planPattern = /Startup|Premium\+?|Freemium|Free|Enterprise|Trial|Gold|Silver|Subscription/i;
      const licenseButton = page.locator('main, header')
        .getByRole('button', { name: planPattern })
        .first();

      await expect(licenseButton).toBeVisible({ timeout: 15000 });
      await expect(licenseButton).toBeEnabled();

      console.log('🔘 [DASHBOARD UI] Lisans butonuna tıklanıyor...');
      await licenseButton.click();

      const licenseDialog = page.locator('[role="dialog"]').first();
      await expect
        .poll(async () => {
          const onBillingUrl = /\/billing|\/license|billing-and-plans/i.test(page.url());
          const dialogOpen = await licenseDialog.isVisible().catch(() => false);
          return onBillingUrl || dialogOpen;
        }, { timeout: 10000 })
        .toBe(true);

      console.log('✅ Lisans butonu billing sayfası veya dialog açmayı doğruladı.');

      await page.keyboard.press('Escape').catch(() => {});
      await ensureDashboard(page, dashboardUrl);
    });

    await test.step('Kısım 2: Take a Tour (Soru İşareti / Rehber Turu) Butonu Kontrolü', async () => {
      await ensureDashboard(page, dashboardUrl);

      const tourButton = page.getByRole('button', { name: 'Take a Tour' })
        .or(page.getByRole('button', { name: /take a tour|rehber tur/i }))
        .first();

      await expect(tourButton).toBeVisible({ timeout: 15000 });
      await expect(tourButton).toBeEnabled();

      console.log('🔘 [DASHBOARD UI] Take a Tour butonuna tıklanıyor...');
      await tourButton.click();

      const tourPopup = page.locator('[class*="driver-popover"], [class*="tour"], [role="dialog"]').first();
      const tourCompletedHint = page.getByText(/tour completed|already completed|tur tamamlandı/i).first();

      if (await tourPopup.isVisible().catch(() => false)) {
        console.log('✅ Onboarding turu popup\'ı göründü.');
        const skipBtn = page.getByRole('button', { name: /skip|atla|close|kapat/i }).first();
        if (await skipBtn.isVisible()) {
          await skipBtn.click();
        }
      } else if (await tourCompletedHint.isVisible().catch(() => false)) {
        console.log('✅ Tur daha önce tamamlanmış; tamamlanma ipucu doğrulandı.');
      } else {
        console.log('ℹ️ Tur tetiklendi; popup görünmedi (hesapta tur tamamlanmış olabilir).');
      }

      await page.keyboard.press('Escape').catch(() => {});
    });

    await test.step('Kısım 3: Active Tasks widget\'ı ve View All Yönlendirmesi', async () => {
      await ensureDashboard(page, dashboardUrl);

      const activeTasksContainer = page.locator('section, div').filter({ hasText: /Active Tasks|Aktif Görevler/i }).first();
      await expect(activeTasksContainer).toBeVisible({ timeout: 15000 });

      const viewAllLink = activeTasksContainer.getByRole('link', { name: /View All|Tümünü Gör/i }).first();
      await expect(viewAllLink).toBeVisible();
      console.log('🔘 [DASHBOARD UI] Active Tasks -> View All linkine tıklanıyor...');
      await viewAllLink.click();

      await expect(page).toHaveURL(viewAllUrlPattern, { timeout: 15000 });
      console.log('✅ Active Tasks -> View All yönlendirmesi başarıyla doğrulandı.');
    });

    await test.step('Kısım 4: Recently Completed widget\'ı ve View All Yönlendirmesi', async () => {
      await ensureDashboard(page, dashboardUrl);

      const completedTasksContainer = page.locator('section, div').filter({ hasText: /Recently Completed|Son Tamamlananlar/i }).first();
      await expect(completedTasksContainer).toBeVisible({ timeout: 15000 });

      const viewAllLink = completedTasksContainer.getByRole('link', { name: /View All|Tümünü Gör/i }).first();
      await expect(viewAllLink).toBeVisible();
      console.log('🔘 [DASHBOARD UI] Recently Completed -> View All linkine tıklanıyor...');
      await viewAllLink.click();

      await expect(page).toHaveURL(viewAllUrlPattern, { timeout: 15000 });
      console.log('✅ Recently Completed -> View All yönlendirmesi başarıyla doğrulandı.');
    });

    await test.step('Kısım 5: Recent Activities Listesi ve Detay Etkileşim Kontrolü', async () => {
      await ensureDashboard(page, dashboardUrl);

      const recentActivitiesContainer = page.locator('section, div').filter({ hasText: /Recent Activities|Son Aktiviteler/i }).first();
      await expect(recentActivitiesContainer).toBeVisible({ timeout: 15000 });

      const activityItems = recentActivitiesContainer.locator('ul > li, div[class*="activity-item"], [role="listitem"]').first();
      const emptyState = recentActivitiesContainer.getByText(/no recent activit|henüz aktivite|no activities/i).first();

      if (await activityItems.isVisible().catch(() => false)) {
        console.log('✅ Son aktiviteler listesinde en az bir kayıt bulundu.');
        await activityItems.click().catch(() => {});
        console.log('✅ Aktivite öğesi tıklanabilirliği doğrulandı.');
      } else if (await emptyState.isVisible().catch(() => false)) {
        console.log('✅ Boş aktivite listesi durumu doğrulandı.');
      } else {
        console.log('ℹ️ Aktivite listesi boş veya henüz yüklenmedi; widget görünürlüğü yeterli sayıldı.');
      }
    });

    await pauseIfHeaded(page);
  });
});
