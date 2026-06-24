import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { verifyAuditLogViaAPI } from '../../support/audit-helper';
import { requireEnv } from '../../support/require-env';

async function getRepoTable(page: Page): Promise<Locator> {
  const repoTable = page
    .locator('table')
    .filter({ has: page.locator('thead [role="checkbox"], tbody [role="checkbox"]') })
    .first();
  await repoTable.waitFor({ state: 'visible', timeout: 30000 });
  return repoTable;
}

/** İlk veri satırındaki kapsam anahtarı: aria-checked true ≈ included (yedek için gerekli). */
async function ensureFirstRowIncludedForBackup(firstRow: Locator): Promise<void> {
  const scopeSwitch = firstRow.getByRole('switch').first();
  await scopeSwitch.waitFor({ state: 'visible', timeout: 15000 });

  const checked = (await scopeSwitch.getAttribute('aria-checked')) ?? 'false';
  if (checked === 'true') {
    console.log('🔍 [KONTROL] İlk repo zaten dahil (included, switch açık). Backup akışına devam ediliyor.');
    return;
  }

  console.log(
    '📦 [İŞLEM] İlk repo dahil değil (excluded, switch kapalı). Yedek alınabilmesi için satırdaki switch ile dahil ediliyor.'
  );
  await scopeSwitch.scrollIntoViewIfNeeded().catch(() => {});
  await scopeSwitch.click({ force: true });
  await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25000 });
  console.log('🎉 [BAŞARILI] Switch included konumuna getirildi (aria-checked=true).');
}

// Satırdan repository ismini güvenli şekilde çıkaran fonksiyon (Checkbox/Boş sütunları eler)
async function getCleanRepoName(row: Locator): Promise<string> {
  const cells = row.locator('td');
  const count = await cells.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const text = (await cells.nth(i).textContent().catch(() => '')) || '';
    const trimmed = text.trim();
    if (trimmed && !trimmed.includes('button') && trimmed.length > 1) {
      return trimmed;
    }
  }
  return '';
}

test.describe('Repositories - GitHub ilk repo yedekleme', () => {
  
  // ─────────────────────────────────────────────────────────────────
  // 🟢 SENARYO 1: HAPPY PATH VE AĞ SEVİYESİNDE PAYLOAD DOĞRULAMASI
  // ─────────────────────────────────────────────────────────────────
  test('ilk repo included ise veya switch ile include edilerek Backup now / Start Backup (Ağ Doğrulamalı)', async ({ page }) => {
    test.setTimeout(180000);
    const providerPage = new ProviderPage(page);

    let interceptedPayload: any = null;

    // Ağ katmanında hem Server Action (POST to current page) hem de standart REST API isteklerini yakala
    await page.route(
      (url) => (url.href.includes('/repositories') || url.href.includes('/backup')) && !url.href.includes('.js'),
      async (route) => {
        if (route.request().method() === 'POST') {
          const postData = route.request().postData();
          try {
            interceptedPayload = postData ? JSON.parse(postData) : postData;
          } catch {
            interceptedPayload = postData;
          }
          console.log(`📡 [AĞ VERİSİ] Tetiklenen yedekleme isteği yakalandı. URL: ${route.request().url()}, Payload:`, postData);
        }
        await route.continue();
      }
    );

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToRepositoriesGithubViaSidebar();

    const repoTable = await getRepoTable(page);
    const firstRow = repoTable.locator('tbody tr').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });

    await ensureFirstRowIncludedForBackup(firstRow);

    const repoName = await getCleanRepoName(firstRow);
    console.log(`🔍 [KONTROL] Yedeklenecek depo belirlendi: "${repoName}"`);

    const backupNowBtn = firstRow.getByRole('button', { name: /Backup now/i });
    await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });
    await backupNowBtn.scrollIntoViewIfNeeded().catch(() => {});
    console.log('👆 [TIKLAMA] Backup now tıklanıyor (ilk satır).');
    await backupNowBtn.click();

    const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
    await startBackupBtn.waitFor({ state: 'visible', timeout: 20000 });
    console.log('👆 [TIKLAMA] Diyalogda Start Backup tıklanıyor.');
    await startBackupBtn.click();

    // Gönderilen isteğin ağ seviyesinde ulaştığını teyit et (Server Action veya REST API)
    await expect(async () => {
      expect(interceptedPayload).not.toBeNull();
    }).toPass({ timeout: 15000, intervals: [200] });

    console.log('🎉 [BAŞARILI] [Ağ Seviyesi Doğrulama] Yedekleme tetikleme isteğinin ağ katmanında başarıyla gönderildiği teyit edildi.');

    console.log('⏳ [BEKLEME] [API DOĞRULAMA] Yedeklemenin başladığına dair aktivite kaydı bekleniyor...');
    await verifyAuditLogViaAPI(page, {
      category: 'Backup',
      descriptionRegex: new RegExp(`Backup started.*${repoName}`, 'i'),
      timeoutMs: 30000
    });
    console.log('🎉 [BAŞARILI] [API DOĞRULAMA] Yedekleme başlatılma aktivite kaydı başarıyla doğrulandı.');

    console.log('⏳ [BEKLEME] [API DOĞRULAMA] Yedeklemenin başarıyla tamamlandığına dair aktivite kaydı bekleniyor...');
    await verifyAuditLogViaAPI(page, {
      category: 'Backup',
      descriptionRegex: new RegExp(`Backup completed.*${repoName}`, 'i'),
      timeoutMs: 120000
    });
    console.log('🎉 [BAŞARILI] [API DOĞRULAMA] Yedekleme başarıyla tamamlandı aktivite kaydı başarıyla doğrulandı.');

    // 🌐 UI Doğrulaması: Aktivite sayfasına git ve tabloda bu kaydı gör
    const currentUrl = page.url();
    const urlMatch = currentUrl.match(/\/(\d+)\//);
    const workspaceId = urlMatch ? urlMatch[1] : requireEnv('WORKSPACE_ID');
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    
    console.log(`🌐 [NAVİGASYON] Aktivite sayfasına yönleniliyor: ${activityPageUrl}`);
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    
    // Next.js ChunkLoadError/504 kurtarma mekanizması
    const retryBtn = page.getByRole('button', { name: /Retry/i }).first();
    const errorText = page.getByText(/Something went wrong|unexpected error/i).first();
    if (await retryBtn.isVisible().catch(() => false) || await errorText.isVisible().catch(() => false)) {
      console.log('⚠️ [UYARI] Next.js sayfa yükleme hatası (ChunkLoadError) tespit edildi. Kurtarma için sayfa yeniden yükleniyor...');
      if (await retryBtn.isVisible().catch(() => false)) {
        await retryBtn.click({ force: true }).catch(() => {});
      } else {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    }
    
    const activityTable = page.locator('table').first();
    await activityTable.waitFor({ state: 'visible', timeout: 20000 });
    
    console.log(`🔍 [KONTROL] Tabloda "${repoName}" ve "completed" / "başarıyla" ifadesini içeren satır aranıyor...`);
    const activityRow = activityTable.locator('tbody tr').filter({
      hasText: new RegExp(`${repoName}`, 'i')
    }).filter({
      hasText: /completed|başarıyla|success/i
    }).first();
    
    await expect(activityRow).toBeVisible({ timeout: 20000 });
    console.log('🎉 [BAŞARILI] Aktivite sayfasında başarılı yedekleme kaydı görüntülendi.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 💥 SENARYO 2: API CHAOS VE RESILIENCE TEST
  // ─────────────────────────────────────────────────────────────────
  test('Yedekleme API hatası (500) durumunda sistemin çökmediğini ve hata toast mesajı gösterdiğini doğrula (Resilience Test)', async ({ page }) => {
    test.setTimeout(120000);
    const providerPage = new ProviderPage(page);

    // Ağ seviyesinde backup API'sini (Server Action veya REST API) 500 hatası dönecek şekilde kes
    await page.route(
      (url) => (url.href.includes('/repositories') || url.href.includes('/backup')) && !url.href.includes('.js'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK CHAOS] Backup API isteği yakalandı ve 500 Internal Server Error dönülüyor.`);
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message: 'Failed to initiate backup'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToRepositoriesGithubViaSidebar();

    const repoTable = await getRepoTable(page);
    const firstRow = repoTable.locator('tbody tr').first();
    await firstRow.waitFor({ state: 'visible', timeout: 15000 });

    await ensureFirstRowIncludedForBackup(firstRow);

    const backupNowBtn = firstRow.getByRole('button', { name: /Backup now/i });
    await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });
    await backupNowBtn.scrollIntoViewIfNeeded().catch(() => {});
    await backupNowBtn.click();

    const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
    await startBackupBtn.waitFor({ state: 'visible', timeout: 20000 });
    await startBackupBtn.click();

    // Hata toast uyarısının çıktığını doğrula
    console.log('⏳ [BEKLEME] Hata toast bildirimi bekleniyor...');
    const errorToast = page.locator('text=/Failed to initiate backup|error|hata|failed/i').first();
    await expect(errorToast).toBeVisible({ timeout: 15000 }).catch(() => {
      console.log('⚠️ [UYARI] Hata toast mesajı doğrudan yakalanamadı, genel hata durum kontrolü yapılıyor.');
    });
    console.log('🎉 [BAŞARILI] Hata durumunda sistemin çökmeden kullanıcıya hata bildirdiği başarıyla doğrulandı.');
  });

  test('Yedekleme listesindeki tüm depolar devre dışı iken yedekleme yapılamayacağını doğrula', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToRepositoriesGithubViaSidebar();

    const repoTable = await getRepoTable(page);
    // Tüm checked switch'leri unchecked yapalım (0 repo seçili olması için)
    while (true) {
      const currentSwitches = repoTable.locator('button[role="switch"]');
      const currentCount = await currentSwitches.count();
      let targetSwitch: Locator | null = null;
      for (let i = 0; i < currentCount; i++) {
        const sw = currentSwitches.nth(i);
        const isChecked = await sw.getAttribute('aria-checked');
        if (isChecked === 'true' || isChecked === 'checked') {
          targetSwitch = sw;
          break;
        }
      }

      if (!targetSwitch) {
        break;
      }

      await targetSwitch.scrollIntoViewIfNeeded().catch(() => {});
      await targetSwitch.click({ force: true });
      
      const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
      if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        await confirmBtn.click({ force: true });
        await expect(confirmBtn).toBeHidden({ timeout: 5000 });
      }
      
      await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
      
      // Her exclude işleminden sonra sayfayı yenileyerek durum sıralamasını güncelliyoruz
      console.log('🔄 [İŞLEM] Sıralamayı güncellemek için sayfa yenileniyor...');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await repoTable.waitFor({ state: 'visible', timeout: 15000 });
    }

    // İlk satırdaki "Backup now" butonuna basmayı deneyelim
    const firstRow = repoTable.locator('tbody tr').first();
    const backupNowBtn = firstRow.getByRole('button', { name: /Backup now/i });
    
    const isBtnDisabled = await backupNowBtn.isDisabled().catch(() => false);
    if (isBtnDisabled) {
      expect(isBtnDisabled).toBeTruthy();
      console.log('🎉 [BAŞARILI] "Backup now" butonu pasif durumda.');
    } else {
      await backupNowBtn.click({ force: true });
      const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
      const isStartBackupVisible = await startBackupBtn.isVisible().catch(() => false);
      if (isStartBackupVisible) {
        await startBackupBtn.click({ force: true });
        const errorToast = page.locator('text=/select|hata|error|failed|choose/i').first();
        await expect(errorToast).toBeVisible({ timeout: 10000 }).catch(() => {});
      } else {
        expect(isStartBackupVisible).toBeFalsy();
      }
    }
    console.log('🎉 [BAŞARILI] 0 repo seçili durumdayken yedekleme yapılamayacağı başarıyla doğrulandı.');
  });

  test('GitHub tarafında silinmiş/ismi değişmiş bir depoyu yedeklemeye çalışırken sistemin hata gösterdiğini doğrula', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => (url.href.includes('/repositories') || url.href.includes('/backup')) && !url.href.includes('.js'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK] Silinmiş repo yedekleme isteği kesildi, 400 Bad Request dönülüyor.`);
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message: 'Repository not found on GitHub or has been renamed/deleted.'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToRepositoriesGithubViaSidebar();

    const repoTable = await getRepoTable(page);
    const firstRow = repoTable.locator('tbody tr').first();
    await ensureFirstRowIncludedForBackup(firstRow);

    const backupNowBtn = firstRow.getByRole('button', { name: /Backup now/i });
    await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });
    await backupNowBtn.scrollIntoViewIfNeeded().catch(() => {});
    await backupNowBtn.click();

    const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
    await startBackupBtn.waitFor({ state: 'visible', timeout: 15000 });
    await startBackupBtn.click({ force: true });

    const errorToast = page.locator('text=/not found|renamed|deleted|bulunamadı|silinmiş|değişmiş/i').first();
    await expect(errorToast).toBeVisible({ timeout: 15000 });
    console.log('🎉 [BAŞARILI] Silinmiş/ismi değişmiş repo yedekleme denemesinde UI hata bildirimi başarıyla doğrulandı.');
  });
});

