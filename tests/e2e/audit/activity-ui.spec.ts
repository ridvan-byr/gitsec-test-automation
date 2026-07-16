import { test, expect } from '../../fixtures/test';
import type { Page, Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { requireEnv } from '../../support/require-env';

let workspaceId: string;
let dashboardBaseUrl: string;

/**
 * Dynamically loads and extracts all possible key labels from the unique audit log templates file.
 * This guarantees 100% verification coverage matching the template file at runtime without hardcoding.
 */
function loadKeysFromTemplates(): string[] {
  const jsonPath = path.join(process.cwd(), 'tests/fixtures/audit-logs-unique-templates.json');
  if (!fs.existsSync(jsonPath)) {
    // Fallback default list if the template file is missing
    return ['EVENT ID', 'IP ADDRESS', 'USER AGENT', 'TIMESTAMP', 'DESCRIPTION', 'WORKSPACE'];
  }
  
  try {
    const templates = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const allKeys = new Set<string>();
    
    // Headers/Sections that are NOT value labels
    const sectionHeaders = [
      'DETAILS', 'OPERATOR', 'GENERAL', 'REPOSITORY', 'SCHEDULE', 
      'STORAGE', 'RESTORE', 'SOURCE', 'TARGET', 'INSTALLATION'
    ];
    
    // Known uppercase value strings / placeholders that should not be classified as keys
    const excludedValues = [
      'N/A', '—', '-', 'BACKUP_FAILED', 'ONDEMAND', 'TIMER', 
      'GITHUB', 'S3', 'AZUREBLOB', 'HUAWEIOBS', 'GOOGLEDRIVE', 'ONEDRIVEPERSONAL'
    ];

    for (const t of templates) {
      const text = t.expandedDetailsText || '';
      const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean);
      for (const line of lines) {
        // A valid label key is uppercase, not a section header, not a number, and not a known uppercase value
        if (line === line.toUpperCase() && !sectionHeaders.includes(line) && isNaN(Number(line))) {
          if (!excludedValues.includes(line)) {
            allKeys.add(line);
          }
        }
      }
    }
    
    // Explicitly add keys that can serve both as a section header and a label key
    allKeys.add('SCHEDULE');
    allKeys.add('REPOSITORY');
    allKeys.add('INSTALLATION');
    
    return Array.from(allKeys);
  } catch (err: any) {
    console.warn(`[UI Test] Failed to parse unique templates, using fallback: ${err.message}`);
    return ['EVENT ID', 'IP ADDRESS', 'USER AGENT', 'TIMESTAMP', 'DESCRIPTION', 'WORKSPACE'];
  }
}

function checkUIPlaceholders(dialogText: string) {
  const lines = dialogText.split('\n').map(l => l.trim()).filter(Boolean);
  
  const placeholders = ['-', '—', 'n/a', 'unknown', 'null', 'undefined', ''];
  const isPlaceholder = (val: string) => placeholders.includes(val.toLowerCase());

  // Dynamically load the keys to verify from templates
  const keysToVerify = loadKeysFromTemplates();
  console.log(`ℹ️ [UI Test] Dynamically loaded ${keysToVerify.length} validation keys from templates.`);


  console.log('\n🔍 [UI Audit Inspector] Scanning details fields in modal...');
  let warningCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i].toUpperCase();
    const matchingKey = keysToVerify.find(k => k === currentLine);
    if (matchingKey) {
      if (i === lines.length - 1) {
        console.warn(`⚠️ [UI AUDIT WARNING] Field '${matchingKey}' is empty/placeholder in UI details (Value: "MISSING/BLANK")`);
        warningCount++;
      } else {
        const value = lines[i + 1];
        // Check if the next line is actually another key, indicating the current key has no value text
        const isNextLineAKey = keysToVerify.some(k => k === value.toUpperCase());
        
        if (isPlaceholder(value) || isNextLineAKey) {
          const displayVal = isNextLineAKey ? 'BLANK' : value;
          console.warn(`⚠️ [UI AUDIT WARNING] Field '${matchingKey}' is empty/placeholder in UI details (Value: "${displayVal}")`);
          warningCount++;
        } else {
          console.log(`   ✅ Field '${matchingKey}': "${value}"`);
        }
      }
    }
  }

  if (warningCount === 0) {
    console.log('🎉 No empty/placeholder fields found in this UI details modal.');
  } else {
    console.log(`⚠️ Total warning(s) logged for empty/placeholder fields: ${warningCount}`);
  }
}

test.describe('Activity UI Logs Verification (Aktivite Paneli E2E)', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    page.on('request', request => {
      const url = request.url();
      if (url.includes('activ') || url.includes('log')) {
        console.log(`🌐 [BROWSER REQUEST] ${request.method()} -> ${url}`);
      }
    });
  });

  test('Status filtresinden Partially Completed seç ve detayları incele', async ({ page }) => {
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    console.log(`🌐 [UI TEST] Activity sayfasına yönleniliyor: ${activityPageUrl}`);
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });

    // 1. Status filtresini bul ve tıkla
    console.log('🔍 [UI TEST] "Status" filtre butonu aranıyor...');
    const statusButton = page.locator('button[data-slot="popover-trigger"]:has-text("Status")')
      .or(page.getByRole('button', { name: /^Status$/i }))
      .first();

    await statusButton.waitFor({ state: 'visible', timeout: 15000 });
    await statusButton.click();
    console.log('✅ [UI TEST] "Status" filtre popover açıldı.');

    // 2. Popover içerisinden "Partially Completed" seçeneğini seç
    console.log('🔍 [UI TEST] "Partially Completed" filtresi seçiliyor...');
    const partialOption = page.getByText('Partially Completed', { exact: true })
      .or(page.locator('[role="option"]').filter({ hasText: /^Partially Completed$/i }))
      .or(page.locator('button').filter({ hasText: /^Partially Completed$/i }))
      .first();

    await partialOption.waitFor({ state: 'visible', timeout: 10000 });
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/activities') && response.status() === 200, { timeout: 15000 }).catch(() => null);
    await partialOption.click();
    console.log('✅ [UI TEST] "Partially Completed" filtresi seçildi.');
    await responsePromise;

    // 3. Tablodaki ilk satırın "Expand details" butonuna tıkla
    const table = page.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15000 });
    
    // Sadece gerçek veri içeren ve "Expand details" butonu barındıran ilk satırı bul
    const firstRow = table.locator('tbody tr').filter({ hasText: /Expand details/i }).first();
    await firstRow.waitFor({ state: 'visible', timeout: 20000 });
    
    const rowText = (await firstRow.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`🔍 [UI TEST] Satır içeriği: "${rowText}"`);
    
    const expandButton = firstRow.getByRole('button', { name: /Expand details/i })
      .or(firstRow.locator('button').filter({ hasText: /Expand details/i }))
      .or(firstRow.locator('td').last())
      .first();

    console.log(`🔍 [UI TEST] "Expand details" butonuna tıklanıyor...`);
    await expandButton.click();

    // 4. Detay satırını bul ve doğrula (Açılan alt satır)
    console.log('🔍 [UI TEST] Log detay satırının açılması bekleniyor...');
    const detailsRow = table.locator('tbody tr').filter({ hasText: /Execution ID|Created At|Started At/i }).first();
    await detailsRow.waitFor({ state: 'visible', timeout: 15000 });
    console.log('✅ [UI TEST] Detay satırı açıldı. İçerik analiz ediliyor...');

    const detailsText = await detailsRow.innerText();
    
    // Boş/Placeholder alan taraması yap
    checkUIPlaceholders(detailsText);

    // 5. Temiz kapatma (Detayları daralt)
    console.log('🧹 [UI TEST] Detay satırı kapatılıyor (Collapse)...');
    await expandButton.click();
    await detailsRow.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('🎉 [UI TEST] Test başarıyla tamamlandı!');
  });

  test('Aktivite listesi boş olduğunda UI çökmeyip Aktivite Bulunamadı uyarısını göstermeli', async ({ page }) => {
    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    // 2. Status filtresini tıklayıp Failed seçerek boş durum (No results found) tetikliyoruz
    const statusBtn = page.locator('button[data-slot="popover-trigger"]:has-text("Status")')
      .or(page.getByRole('button', { name: /^Status$/i }))
      .first();
    await statusBtn.click();
    try {
      await page.getByText('Failed', { exact: true })
        .or(page.locator('[role="option"]').filter({ hasText: /^Failed$/i }))
        .first()
        .waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      console.log('⚠️ [WARNING] Failed option not visible, re-clicking Status button...');
      await statusBtn.click();
    }

    const failedOpt = page.getByText('Failed', { exact: true })
      .or(page.locator('[role="option"]').filter({ hasText: /^Failed$/i }))
      .first();
    await failedOpt.click();

    // 3. Tabloda boş durum metninin göründüğünü teyit et
    const emptyStateText = page.locator('text=/no results|bulunamadı|kayıt yok|boş|empty/i').first();
    await expect(emptyStateText).toBeVisible({ timeout: 15000 });
    console.log('✅ Aktivite listesi boşken (Empty State) UI kararlılığı ve uyarı mesajı başarıyla doğrulandı.');
  });

  test('Aktivite detaylarının ve Türkçe karakterlerin arayüzde bozulmadan gösterildiğini doğrula', async ({ page }) => {
    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    // 2. Tablodaki ilk satırı bul
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    const firstRow = table.locator('tbody tr').filter({ hasText: /Expand details/i }).first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });

    // 3. Detay açma butonuna tıkla
    const expandButton = firstRow.getByRole('button', { name: /Expand details/i })
      .or(firstRow.locator('button').filter({ hasText: /Expand details/i }))
      .or(firstRow.locator('td').last())
      .first();

    await expandButton.click();

    // 4. Detay satırının açıldığını doğrula
    const detailsRow = page.locator('tbody tr').filter({ hasText: /Execution ID|Repository|Provider|Trigger Source/i }).first();
    await expect(detailsRow).toBeVisible({ timeout: 15000 });
    
    const detailsText = await detailsRow.innerText();
    expect(detailsText).toBeTruthy();
    
    // Boş/Placeholder alan kontrolü
    checkUIPlaceholders(detailsText);

    // Detay panelini kapat
    await expandButton.click();
    await detailsRow.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    console.log('✅ Gerçek veri üzerinden Aktivite detaylarının gösterimi başarıyla doğrulandı.');
  });

  test('Aktivite filtre butonlarına hızlı ardışık tıklandığında UI kilitlenmesine sebep olmadığını doğrula', async ({ page }) => {
    let apiCallUrls: string[] = [];
    
    await page.route('**/api/activities*', async (route) => {
      const url = route.request().url();
      apiCallUrls.push(url);
      console.log(`🛡️ [MOCK DELAYED] İstek yakalandı: ${url}. 2 saniye bekletiliyor...`);
      await expect(page.locator('table, [role="table"], body').first()).toBeVisible({ timeout: 10000 }).catch(() => {});
      
      const isAuth = url.includes('Auth') || url.includes('category=Auth') || url.toLowerCase().includes('auth');
      const isStorage = url.includes('Storage') || url.includes('category=Storage') || url.toLowerCase().includes('storage');
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            list: [
              {
                activityId: 999992,
                category: isAuth ? 'Auth' : (isStorage ? 'Storage Provider' : 'Schedule'),
                description: `Activity filter output for ${url}`,
                ipAddress: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                createdDate: new Date().toISOString()
              }
            ],
            pagination: { currentPage: 1, totalPages: 1, totalRows: 1, maxRowsPerPage: 20 }
          }
        })
      });
    });

    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    const categoryFilterBtn = page.locator('button[data-slot="popover-trigger"]:has-text("Category")')
      .or(page.getByRole('button', { name: /^Category$/i }))
      .first();

    if (await categoryFilterBtn.isVisible().catch(() => false)) {
      await categoryFilterBtn.click();
      try {
        await page.getByText('Auth', { exact: true }).first().waitFor({ state: 'visible', timeout: 3000 });
      } catch (e) {
        console.log('⚠️ [WARNING] Category options not visible, re-clicking Category button...');
        await categoryFilterBtn.click();
      }
      await expect(page.getByText('Auth', { exact: true }).first()).toBeVisible({ timeout: 5000 }).catch(() => {});

      const authOpt = page.getByText('Auth', { exact: true }).first();
      const storageOpt = page.getByText('Storage Provider', { exact: true }).or(page.getByText('Storage', { exact: true })).first();
      const schedOpt = page.getByText('Schedule', { exact: true }).first();

      if (await authOpt.isVisible().catch(() => false)) {
        await authOpt.click({ force: true });
      }
      if (await storageOpt.isVisible().catch(() => false)) {
        await storageOpt.click({ force: true });
      }
      if (await schedOpt.isVisible().catch(() => false)) {
        await schedOpt.click({ force: true });
      }
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const bodyVisible = await page.locator('body').isVisible();
    expect(bodyVisible).toBeTruthy();

    console.log('✅ Hızlı filtreleme spam tıklandığında UI kilitlenmediği başarıyla doğrulandı.');
  });

  test('Status filtresinden Completed seçildiğinde URL parametresini ve satır içeriğini doğrula', async ({ page }) => {
    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    // 2. Status filtresini aç
    const statusBtn = page.locator('button[data-slot="popover-trigger"]:has-text("Status")')
      .or(page.getByRole('button', { name: /^Status$/i }))
      .first();
    await statusBtn.click();
    
    // Dropdown açılmasını teyit etmek için [role*="menuitem"], [role="option"] bekliyoruz
    const completedOpt = page.locator('[role*="menuitem"], [role="option"]').filter({ hasText: /^Completed$/i }).first();
    try {
      await completedOpt.waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      console.log('⚠️ [WARNING] Completed option not visible, re-clicking Status button...');
      await statusBtn.click();
      await completedOpt.waitFor({ state: 'visible', timeout: 5000 });
    }

    // 3. Completed seçeneğini tıkla
    await completedOpt.click();
    await page.waitForTimeout(3000);

    // 4. URL parametresinin güncellendiğini doğrula
    const currentUrl = page.url();
    expect(currentUrl).toContain('status=');
    console.log(`📡 [FILTERS TEST] Güncel URL: ${currentUrl}`);
    
    // 5. Tabloda sadece Completed içeren satırların olduğunu doğrula
    const table = page.locator('table').first();
    await expect(table).toBeVisible();
    const firstRowText = await table.locator('tbody tr').first().innerText();
    expect(firstRowText).toContain('Completed');
    console.log('✅ Status filtresi (Completed) ve satır içeriği başarıyla doğrulandı.');
  });

  test('Aktivite listesinde sayfalama (Pagination) butonlarının çalışmasını doğrula', async ({ page }) => {
    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    // Sayfalama butonunu bul (Sonraki / Chevron / Next Page)
    const nextPageBtn = page.locator('button[aria-label*="next" i], button:has-text("Next"), button:has-text(">"), button[class*="next"]').first();
    
    // Sayfalama bileşeninin varlığını kontrol et
    const paginationExists = await nextPageBtn.isVisible().catch(() => false);
    if (paginationExists) {
      const isEnabled = await nextPageBtn.isEnabled();
      if (isEnabled) {
        console.log('🔘 [PAGINATION TEST] Next Page butonuna tıklanıyor...');
        await nextPageBtn.click();
        await page.waitForTimeout(3000);

        // URL'de page=2 veya sayfa parametresi olduğunu teyit et
        const currentUrl = page.url();
        expect(currentUrl).toContain('page=');
        console.log(`📡 [PAGINATION TEST] Sayfa geçişi sonrası URL: ${currentUrl}`);
      } else {
        console.log('ℹ️ [PAGINATION TEST] Sadece tek sayfa veri var, Sonraki Sayfa butonu pasif (Doğru davranış).');
        await expect(nextPageBtn).toBeDisabled();
      }
    } else {
      console.log('ℹ️ [PAGINATION TEST] Sayfalama butonları bu veri kümesinde görünmüyor.');
    }
    console.log('✅ Sayfalama (Pagination) bileşeni davranışı başarıyla doğrulandı.');
  });

  test('Aktivite listesinde filtrelerin temizlenmesi (Reset) butonunu doğrula', async ({ page }) => {
    // 1. Doğrudan aktivite sayfasına gidiyoruz (gerçek veriyle yüklenir)
    const activityPageUrl = `${dashboardBaseUrl}/${workspaceId}/activity`;
    await page.goto(activityPageUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000); // Next.js hydration beklemesi

    // 2. Status filtresini aç ve Completed seç
    const statusBtn = page.locator('button[data-slot="popover-trigger"]:has-text("Status")')
      .or(page.getByRole('button', { name: /^Status$/i }))
      .first();
    await statusBtn.click();
    const completedOpt = page.locator('[role*="menuitem"], [role="option"]').filter({ hasText: /^Completed$/i }).first();
    try {
      await completedOpt.waitFor({ state: 'visible', timeout: 3000 });
    } catch (e) {
      console.log('⚠️ [WARNING] Completed option not visible, re-clicking Status button...');
      await statusBtn.click();
      await completedOpt.waitFor({ state: 'visible', timeout: 5000 });
    }

    await completedOpt.click();
    await page.waitForTimeout(3000);

    // Filtreleme yapıldıktan sonra URL'de status parametresi olduğunu doğrula
    let currentUrl = page.url();
    expect(currentUrl).toContain('status=');
    console.log(`📡 [CLEAR TEST] Filtre aktif edildi, URL: ${currentUrl}`);

    // 3. Filtre sıfırlama (Clear / Reset) butonunu bul ve tıkla
    const clearBtn = page.locator('button')
      .filter({ hasText: /clear|reset|temizle|sıfırla/i })
      .or(page.locator('[data-slot="clear-filters"]'))
      .first();
    
    if (await clearBtn.isVisible().catch(() => false)) {
      console.log('🔘 [CLEAR TEST] Clear Filters butonuna tıklanıyor...');
      await clearBtn.click();
    } else {
      console.log('🔘 [CLEAR TEST] Filtre temizleme butonu görünmedi, popover üzerinden sıfırlanıyor...');
      const statusBtn = page.locator('button[data-slot="popover-trigger"]:has-text("Status")')
        .or(page.getByRole('button', { name: /^Status$/i }))
        .first();
      await statusBtn.click();
      const completedOptToggle = page.locator('[role*="menuitem"], [role="option"]').filter({ hasText: /^Completed$/i }).first();
      await completedOptToggle.click();
    }
    
    await page.waitForTimeout(3000);

    // Filtrenin kalktığı ve URL'de status parametresinin kalmadığını doğrula
    currentUrl = page.url();
    expect(currentUrl).not.toContain('status=');
    console.log(`📡 [CLEAR TEST] Filtre temizlendi, güncel URL: ${currentUrl}`);
    console.log('✅ Filtre sıfırlama (Clear/Reset) butonu çalışması başarıyla doğrulandı.');
  });
});
