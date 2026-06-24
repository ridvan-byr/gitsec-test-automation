import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { ProviderPage } from '../../pages/ProviderPage';
import { verifyAuditLogViaAPI } from '../../support/audit-helper';
import { requireEnv } from '../../support/require-env';
import type { Page } from '@playwright/test';

const workspaceId = requireEnv('WORKSPACE_ID');
const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

async function deleteSchedulerRow(page: Page, schedulerName: string) {
  // Schedulers listesinin yüklenmesi ve satırların render edilmesi için bekleyelim
  const table = page.locator('table, tbody, [role="table"]').first();
  await table.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

  const matchingRows = page.locator('tr').filter({ hasText: schedulerName });
  await matchingRows.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  
  const countBefore = await matchingRows.count();
  if (countBefore === 0) {
    console.log(`[e2e] "${schedulerName}" satırı bulunamadı, silme atlanıyor.`);
    return;
  }

  console.log(`[e2e] Temizlik: "${schedulerName}" planlayıcısı siliniyor...`);
  const schedulerRow = matchingRows.first();
  let clicked = false;

  const trashIconBtn = schedulerRow.locator('button:has(svg[class*="trash"])')
    .or(schedulerRow.locator('button:has(svg.lucide-trash)'))
    .or(schedulerRow.locator('button:has(svg.lucide-trash-2)'))
    .first();
  if (await trashIconBtn.isVisible().catch(() => false)) {
    console.log('[e2e] SVG trash icon butonu bulundu, tıklanıyor...');
    await trashIconBtn.click();
    clicked = true;
  }

  if (!clicked) {
    const allButtons = schedulerRow.locator('button');
    const btnCount = await allButtons.count();
    if (btnCount > 0) {
      console.log('[e2e] Satırdaki son buton tıklanıyor...');
      await allButtons.nth(btnCount - 1).click();
      clicked = true;
    }
  }

  const confirmDeleteBtn = page.locator('[role="dialog"] button, [role="alertdialog"] button')
    .filter({ hasText: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
  
  if (await confirmDeleteBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    console.log('[e2e] Silme onay butonu bulundu, tıklanıyor...');
    await confirmDeleteBtn.click();
    await schedulerRow.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  }

  console.log('[e2e] Silme işlemi tamamlandı.');
}

test.describe('Denetim Günlüğü / Aktivite Kayıtları (Activity & Audit Logs)', () => {
  test.setTimeout(180000); // Kapsamlı test senaryoları için süreyi uzatalım

  test.beforeEach(async ({ page }) => {
    const providerPage = new ProviderPage(page);
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
  });

  test('Tüm sistem aktivitelerinin (Auth, Storage ve Scheduler) loglandığını doğrula', async ({ page }) => {
    const storagePage = new StoragePage(page);
    
    // Benzersiz test isimleri
    const storageConnName = `Act-Storage-${Date.now()}`;
    const schedulerName = `Act-Sched-${Date.now()}`;

    const bucketName = requireEnv('AWS_S3_BUCKET');
    const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
    const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = requireEnv('AWS_REGION');

    // ─────────────────────────────────────────────────────────────
    // 🔑 KISIM 1: KULLANICI GİRİŞ LOGUNU (AUTH LOG) DOĞRULA
    // ─────────────────────────────────────────────────────────────
    console.log('🔑 KISIM 1: Giriş logu kontrol ediliyor...');
    await verifyAuditLogViaAPI(page, {
      category: 'Auth',
      descriptionRegex: /Logged In|Giriş|logged in/i
    });
    console.log('✅ Kullanıcı giriş olayına ait log kaydı başarıyla doğrulandı.');

    // ─────────────────────────────────────────────────────────────
    // 📦 KISIM 2: STORAGE PROVIDER LOGLARINI DOĞRULA
    // ─────────────────────────────────────────────────────────────
    console.log('📦 KISIM 2: Depolama Sağlayıcısı işlemleri başlatılıyor...');
    
    await storagePage.navigateToStoragePage();
    await storagePage.cleanupExistingTestProviders('aws');
    await storagePage.clickAddStorageProvider();
    await storagePage.selectS3Provider();

    // Connection Test API'sini mock'layalım
    await page.route(
      (url) => url.href.includes('/storage') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log(`🛡️ [MOCK] Connection Test API isteği yakalandı.`);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            message: 'Connection test successful',
            errors: [],
            data: { isSuccessful: true, provider: 1, durationMs: 100, checks: [] }
          })
        });
      }
    );

    await storagePage.fillAWSForm(storageConnName, bucketName, accessKeyId, secretAccessKey, awsRegion);
    await storagePage.testS3Connection();
    await storagePage.saveStorageProvider();
    await storagePage.verifyProviderActive(storageConnName);

    // Ekleme logunu kontrol et
    await verifyAuditLogViaAPI(page, {
      category: 'Storage Provider',
      descriptionRegex: new RegExp(`(Created|Added|Eklendi).*${storageConnName}|${storageConnName}.*(Created|Added|Eklendi)`, 'i')
    });
    console.log(`✅ Depolama sağlayıcısı ekleme logu başarıyla doğrulandı.`);

    // Sağlayıcıyı sil
    await storagePage.navigateToStoragePage();
    await storagePage.cleanupExistingTestProviders('aws');

    // Silme logunu kontrol et
    await verifyAuditLogViaAPI(page, {
      category: 'Storage Provider',
      descriptionRegex: /Deleted|Silindi/i
    });
    console.log(`✅ Depolama sağlayıcısı silme logu başarıyla doğrulandı.`);

    // ─────────────────────────────────────────────────────────────
    // ⏰ KISIM 3: BACKUP SCHEDULER LOGLARINI DOĞRULA
    // ─────────────────────────────────────────────────────────────
    console.log('⏰ KISIM 3: Zamanlayıcı (Scheduler) işlemleri başlatılıyor...');

    // Schedulers sayfasına git
    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i })
      .or(page.locator(`a[href*="/${workspaceId}/schedulers"]`))
      .first();
    await schedulersLink.waitFor({ state: 'visible', timeout: 15000 });
    await schedulersLink.click();
    await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    console.log('[e2e] Schedulers sayfasına ulaşıldı.');

    // Yeni Zamanlayıcı Ekle
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i })
      .or(page.locator('button:has-text("New Scheduler")'))
      .first();
    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 15000 });
    await newSchedulerBtn.click();
    console.log('[e2e] "New Scheduler" butonuna tıklandı.');

    // Dialog/Modal içinden repo seç
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'visible', timeout: 10000 });
    const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await repoCombo.waitFor({ state: 'visible', timeout: 15000 });
    await repoCombo.click();

    // Seçeneklerin yüklenmesini bekle
    const allRepoOptions = page.locator('[role="option"], [data-slot="select-item"]');
    await allRepoOptions.first().waitFor({ state: 'visible', timeout: 15000 });

    const enabledRepoOptions = page.locator('[role="option"][data-disabled="false"], [data-slot="select-item"][data-disabled="false"]');
    const enabledCount = await enabledRepoOptions.count();
    if (enabledCount > 0) {
      const firstEnabledRepo = enabledRepoOptions.first();
      const repoName = await firstEnabledRepo.innerText().catch(() => 'selected-repo');
      console.log(`[e2e] Aktif repository seçiliyor: "${repoName.trim()}"`);
      await firstEnabledRepo.click({ force: true });
    } else {
      throw new Error('[e2e] Eklenebilir aktif repository bulunamadı.');
    }
    await page.keyboard.press('Escape');
    await page.locator('[role="listbox"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    // İsim yaz
    const nameInput = page.getByPlaceholder('e.g. Nightly Full Backup')
      .or(page.locator('input[name="name"]'))
      .or(page.locator('input[placeholder*="Backup"]'))
      .first();
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    await nameInput.fill(schedulerName);
    console.log(`[e2e] Schedule Name yazıldı: ${schedulerName}`);

    // Kaydet
    const saveBtn = page.getByRole('button', { name: /save|create|confirm|submit/i })
      .or(page.locator('button:has-text("Save")'))
      .or(page.locator('button:has-text("Create")'))
      .or(page.locator('button:has-text("Save Scheduler")'))
      .or(page.locator('button:has-text("Create Scheduler")'))
      .first();
    await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
    await saveBtn.click();
    console.log('[e2e] Kaydet butonuna tıklandı.');

    // Modalın kapanmasını bekle
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 10000 });
    console.log('[e2e] Zamanlayıcı oluşturma modali kapandı.');

    // listede belirdiğini doğrula (race-condition engellemek için)
    const schedulerRow = page.locator('tr').filter({ hasText: schedulerName }).first();
    await expect(schedulerRow).toBeVisible({ timeout: 15000 });
    console.log(`[e2e] Zamanlayıcı listede başarıyla doğrulandı: ${schedulerName}`);

    // Ekleme logunu kontrol et
    await verifyAuditLogViaAPI(page, {
      category: 'Schedule',
      descriptionRegex: new RegExp(`(Created|Added|Eklendi).*${schedulerName}|${schedulerName}.*(Created|Added|Eklendi)`, 'i')
    });
    console.log(`✅ Zamanlayıcı ekleme logu başarıyla doğrulandı.`);

    // Schedulers sayfasına dön ve sil
    await schedulersLink.click();
    await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    await deleteSchedulerRow(page, schedulerName);

    // Silme logunu kontrol et
    await verifyAuditLogViaAPI(page, {
      category: 'Schedule',
      descriptionRegex: new RegExp(`(Deleted|Removed|Silindi).*${schedulerName}|${schedulerName}.*(Deleted|Removed|Silindi)`, 'i')
    });
    console.log(`✅ Zamanlayıcı silme logu başarıyla doğrulandı.`);
  });
});
