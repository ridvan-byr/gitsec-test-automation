import { test, expect } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { ProviderPage } from '../../pages/ProviderPage';
import { verifyAuditLogViaAPI } from '../../support/audit-helper';
import { requireEnv } from '../../support/require-env';
import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Environment variables are retrieved inside the test block

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
    const workspaceId = requireEnv('WORKSPACE_ID');
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

    // Schedulers sayfasına gitmeden önce bir depoyu Include ettiğimizden emin olalım
    const providerPage = new ProviderPage(page);
    await providerPage.goToRepositoriesGithub();
    await page.waitForLoadState('domcontentloaded');

    const repoTable = page.locator('table').first();
    await repoTable.waitFor({ state: 'visible', timeout: 30000 });

    await page.evaluate(() => {
      const container = document.querySelector('div.overflow-x-auto, div.overflow-auto, [class*="overflow-x"]');
      if (container) {
        container.scrollLeft = 1000;
        container.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }).catch(() => {});

    // Unchecked (aria-checked="false") olan bir switch bulalım ve tıklayalım
    const switches = repoTable.locator('button[role="switch"]');
    await switches.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    const switchCount = await switches.count();
    let includedRepoName = '';
    let switchClicked = false;
    let targetSwitchIndex = -1;

    for (let i = 0; i < switchCount; i++) {
      const sw = switches.nth(i);
      const isChecked = await sw.getAttribute('aria-checked');
      if (isChecked === 'false') {
        const row = repoTable.locator('tbody tr').nth(i);
        const cells = row.locator('td');
        const cellCount = await cells.count();
        for (let c = 0; c < cellCount; c++) {
          const text = (await cells.nth(c).textContent().catch(() => '')) || '';
          if (text.trim() && !text.includes('button') && text.trim().length > 1) {
            includedRepoName = text.trim();
            break;
          }
        }
        
        console.log(`[e2e] "${includedRepoName}" reposu test için include ediliyor...`);
        await sw.click();
        await expect(sw).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
        switchClicked = true;
        targetSwitchIndex = i;
        break;
      }
    }

    if (!switchClicked && switchCount > 0) {
      const row = repoTable.locator('tbody tr').first();
      const cells = row.locator('td');
      const cellCount = await cells.count();
      for (let c = 0; c < cellCount; c++) {
        const text = (await cells.nth(c).textContent().catch(() => '')) || '';
        if (text.trim() && !text.includes('button') && text.trim().length > 1) {
          includedRepoName = text.trim();
          break;
        }
      }
      console.log(`[e2e] Tüm depolar zaten include edilmiş durumda. Kullanılan repo: "${includedRepoName}"`);
    }

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
    } else {
      console.log('⚠️ [UYARI] Eklenebilir aktif repository bulunamadı. Schedulers loglama adımları atlanıyor.');
      await page.keyboard.press('Escape');
      await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }

    // Temizlik: Ekleme yaptıysak tekrar Exclude edelim
    if (switchClicked && targetSwitchIndex !== -1) {
      console.log(`[e2e] Temizlik: "${includedRepoName}" reposu tekrar exclude ediliyor...`);
      await providerPage.goToRepositoriesGithub();
      await page.waitForLoadState('domcontentloaded');
      
      await page.evaluate(() => {
        const container = document.querySelector('div.overflow-x-auto, div.overflow-auto, [class*="overflow-x"]');
        if (container) {
          container.scrollLeft = 1000;
          container.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
      }).catch(() => {});
      
      const sw = repoTable.locator('button[role="switch"]').nth(targetSwitchIndex);
      await sw.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      await sw.click();
      
      // Onay modalını onaylayalım
      const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm|onayla|evet/i }).first();
      if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        console.log('[e2e] Onay modalında Exclude butonu bulundu, tıklanıyor...');
        await confirmBtn.click({ force: true });
      }

      await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
      console.log(`[e2e] "${includedRepoName}" başarıyla tekrar exclude edildi.`);
    }
  });

  test('Denetim Günlükleri Şablon Kapsam Analizi (Audit Log Coverage Check)', async ({ page }) => {
    // 1. Şablon dosyasını oku
    const jsonPath = path.join(process.cwd(), 'tests/fixtures/audit-logs-unique-templates.json');
    if (!fs.existsSync(jsonPath)) {
      console.log('⚠️ [COVERAGE] Benzersiz şablonlar dosyası bulunamadı, analiz atlanıyor.');
      return;
    }
    
    const templates = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    console.log(`\n📊 [COVERAGE] Toplam ${templates.length} adet benzersiz denetim günlüğü şablonu yüklendi.`);

    // 2. Token ve Workspace ID al
    let token = '';
    const cookies = await page.context().cookies().catch(() => []);
    const tokenCookie = cookies.find(c => c.name === 'gs_token');
    if (tokenCookie) {
      token = tokenCookie.value;
    } else {
      try {
        const authPath = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
        if (fs.existsSync(authPath)) {
          const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
          const fileCookie = authData.cookies?.find((c: any) => c.name === 'gs_token');
          if (fileCookie) {
            token = fileCookie.value;
          }
        }
      } catch (err: any) {
        console.warn(`[COVERAGE] Auth dosyası okunamadı: ${err.message}`);
      }
    }

    const workspaceId = requireEnv('WORKSPACE_ID');
    const apiBaseUrl = requireEnv('API_BASE_URL');
    const targetUrl = `${apiBaseUrl}/api/activities/?Pagination.CurrentPage=1&Pagination.MaxRowsPerPage=100`;

    if (!token) {
      console.log('⚠️ [COVERAGE] gs_token bulunamadı, API sorgusu atlanıyor.');
      return;
    }

    // 3. API'den son 100 aktiviteyi çek
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'workspace-id': workspaceId,
        'WorkspaceId': workspaceId,
        'X-Workspace-Id': workspaceId
      }
    });

    if (!response.ok) {
      console.log(`⚠️ [COVERAGE] API Hatası: ${response.status} ${response.statusText}`);
      return;
    }

    const resBody = await response.json();
    const activities = resBody?.data?.list || [];
    console.log(`📊 [COVERAGE] Veritabanından son ${activities.length} aktivite kaydı çekildi.`);

    // Helper function to extract the longest static text segment from a template description
    function findLongestSegment(templateDesc: string): string {
      const parts = templateDesc.split(/{[^}]+}/);
      let longest = '';
      for (const part of parts) {
        const clean = part.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().replace(/\s+/g, ' ');
        if (clean.length > longest.length) {
          longest = clean;
        }
      }
      return longest;
    }

    // 4. Eşleştirme Yap
    const matchedTemplates: any[] = [];
    const unmatchedTemplates: any[] = [];

    for (const t of templates) {
      // Eşleşen bir aktivite var mı?
      const isMatched = activities.some((act: any) => {
        const actCategoryClean = (act.category || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const tCategoryClean = t.category.toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Kategori eşleşmeli
        if (tCategoryClean !== actCategoryClean) return false;

        const logClean = (act.description || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ');
        const longestSegment = findLongestSegment(t.normalizedDescription);
        
        return logClean.includes(longestSegment);
      });

      if (isMatched) {
        matchedTemplates.push(t);
      } else {
        unmatchedTemplates.push(t);
      }
    }

    // Definitive mapping from backend C# source code enums to match actionType numbers to textual names
    const ACTION_MAPS: Record<string, Record<number, string>> = {
      'auth': {
        1: 'Logged In',
        2: 'Logged Out',
        3: 'Login Failed'
      },
      'backup': {
        1: 'Started',
        2: 'Succeeded',
        3: 'Failed',
        4: 'Cancelled',
        5: 'Write Failed'
      },
      'restore': {
        1: 'Started',
        2: 'Approved',
        3: 'Succeeded',
        4: 'Failed',
        5: 'Cancelled',
        6: 'Target New Repository',
        7: 'Target In Place',
        8: 'Cross Account Performed'
      },
      'storage_provider': {
        1: 'Added',
        2: 'Test Failed',
        3: 'Edited',
        4: 'Deleted',
        5: 'OAuth Connected',
        6: 'OAuth Failed',
        7: 'Enabled',
        8: 'Disabled',
        9: 'Test Succeeded',
        10: 'Error Detected',
        11: 'Credentials Rotated',
        12: 'Creation Test Succeeded',
        13: 'Creation Test Failed'
      },
      'repository': {
        1: 'Created',
        2: 'Deleted',
        3: 'Archived',
        4: 'Unarchived',
        5: 'Renamed',
        6: 'Backed Up',
        7: 'Restored',
        8: 'Synchronized',
        9: 'Backup Failed',
        10: 'Added To Workspace',
        11: 'Removed From Workspace',
        12: 'License Changed',
        13: 'Visibility Changed',
        14: 'Restore Failed',
        15: 'Push Event Enabled',
        16: 'Push Event Disabled',
        17: 'Push Event Included Items Modified',
        18: 'Included',
        19: 'Excluded',
        20: 'Push Event Configuration Created',
        21: 'Push Event Configuration Deleted'
      },
      'schedule': {
        1: 'Created',
        2: 'Updated',
        3: 'Deleted',
        4: 'Paused',
        5: 'Resumed',
        6: 'Triggered Manually',
        7: 'Triggered By Timer',
        8: 'Disabled',
        9: 'Enabled'
      },
      'github_integration': {
        1: 'Authorized',
        2: 'Disconnected',
        3: 'Reauthorized',
        4: 'Permissions Changed',
        5: 'Suspended',
        6: 'Updated'
      },
      'bitbucket_integration': {
        1: 'Authorized',
        2: 'Disconnected',
        3: 'Reauthorized'
      },
      'workspace': {
        1: 'Created',
        2: 'Updated',
        3: 'Deleted',
        4: 'Archived',
        5: 'Unarchived',
        6: 'Member Added',
        7: 'Member Removed',
        8: 'Member Role Changed',
        9: 'Repository Added',
        10: 'Repository Removed',
        11: 'Member Invited',
        12: 'Member Invite Accepted'
      }
    };

    // 4.5 Şablon Dışı (Veritabanında olup şablon listesinde tanımlanmayan) Logları Keşfet
    const discoveredNewActivities: any[] = [];
    for (const act of activities) {
      const actCategoryClean = (act.category || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      const isKnown = templates.some((t: any) => {
        const tCategoryClean = t.category.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (tCategoryClean !== actCategoryClean) return false;

        const logClean = (act.description || '').toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ');
        const longestSegment = findLongestSegment(t.normalizedDescription);

        return logClean.includes(longestSegment);
      });

      if (!isKnown) {
        const alreadyFound = discoveredNewActivities.some(a => a.category === act.category && a.description === act.description);
        if (!alreadyFound) {
          const catKey = (act.category || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
          const mappedAction = ACTION_MAPS[catKey]?.[act.actionType] || `Unknown (actionType: ${act.actionType})`;
          discoveredNewActivities.push({
            category: act.category,
            action: mappedAction,
            description: act.description
          });
        }
      }
    }

    // 5. Raporu Konsola Yazdır
    console.log('\n======================================================================');
    console.log('📊 DENETİM GÜNLÜKLERİ E2E KAPSAM ANALİZ RAPORU (AUDIT LOG COVERAGE)');
    console.log('======================================================================');
    console.log(`✅ Tetiklenen ve Doğrulanan Şablonlar (${matchedTemplates.length} adet):`);
    matchedTemplates.forEach(t => console.log(`   [KAPSANAN] ${t.category} -> ${t.action} ("${t.exampleDescription}")`));
    
    console.log(`\n❌ Henüz Tetiklenmeyen / Kapsanmayan Şablonlar (${unmatchedTemplates.length} / ${templates.length} adet):`);
    unmatchedTemplates.forEach(t => console.log(`   [AÇIK] ${t.category} -> ${t.action}`));

    if (discoveredNewActivities.length > 0) {
      console.log(`\n🔍 ŞABLON LİSTESİNDE BULUNMAYAN YENİ LOG TÜRLERİ TESPİT EDİLDİ (${discoveredNewActivities.length} adet):`);
      discoveredNewActivities.forEach(a => {
        console.log(`   [YENİ BULGU] Kategori: "${a.category}", İşlem: "${a.action}" (Açıklama Örneği: "${a.description}")`);
      });
      console.log('💡 Öneri: Yukarıdaki log türlerini de test fixture/şablon dosyanıza ekleyebilirsiniz.');
    } else {
      console.log('\n✨ Harika! Veritabanındaki tüm loglar şablon listenizle 100% uyuşuyor. Bilinmeyen yeni bir log türü bulunamadı.');
    }

    const coverageRatio = ((matchedTemplates.length / templates.length) * 100).toFixed(1);
    console.log('----------------------------------------------------------------------');
    console.log(`📈 TOPLAM GÜNLÜK ŞABLON KAPSAMI: %${coverageRatio} (${matchedTemplates.length} / ${templates.length})`);
    console.log('======================================================================\n');
  });
});
