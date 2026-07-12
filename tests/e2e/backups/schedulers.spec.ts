import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import type { Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';

let workspaceId: string;
let dashboardBaseUrl: string;
let scheduleNameToCleanup: string | null = null;

async function selectScheduleType(page: Page, typeName: 'Daily' | 'Weekly' | 'Monthly' | 'Cron') {
  console.log(`⏳ [BEKLEME] Schedule Type seçiliyor: "${typeName}"`);
  
  // Dialog içindeki 2. combobox Schedule Type dropdown'ıdır (1. combobox = repository seçimi)
  const dialog = page.getByRole('dialog').first();
  const typeTrigger = dialog.getByRole('combobox').nth(1);
  await typeTrigger.waitFor({ state: 'visible', timeout: 10000 });

  const currentText = (await typeTrigger.innerText().catch(() => '')).trim().toLowerCase();
  if (currentText === typeName.toLowerCase() || currentText.includes(typeName.toLowerCase())) {
    console.log(`🔍 [KONTROL] Schedule Type zaten "${typeName}" seçili durumda, mükerrer seçim atlanıyor.`);
    return;
  }

  try {
    await typeTrigger.click({ timeout: 5000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Select trigger tıklanamadı, Escape basıp force: true ile deneniyor...');
    await page.keyboard.press('Escape');
    await typeTrigger.click({ force: true });
  }

  const option = page.getByRole('option', { name: typeName, exact: true }).first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  try {
    await option.click({ timeout: 3000 });
  } catch (err) {
    console.log(`⚠️ [UYARI] "${typeName}" seçeneği normal tıklanamadı, force: true ile deneniyor...`);
    await option.click({ force: true });
  }
  console.log(`🎉 [BAŞARILI] Dropdown ile "${typeName}" seçildi.`);
}

async function setCheckboxState(page: Page, labelText: string, shouldBeChecked: boolean) {
  console.log(`⏳ [BEKLEME] Checkbox ayarlanıyor. Etiket: "${labelText}", Hedef Durum: ${shouldBeChecked}`);

  const checkbox = page.getByRole('checkbox', { name: labelText })
    .or(page.getByLabel(labelText))
    .first();
  
  await checkbox.waitFor({ state: 'visible', timeout: 10000 });
  await checkbox.setChecked(shouldBeChecked);
}

async function fillBaseSchedulerForm(page: Page): Promise<string> {
  const maxRetries = 2;
  let attempt = 0;
  let modalReady = false;

  while (attempt <= maxRetries && !modalReady) {
    if (attempt > 0) {
      console.log(`🔄 [YENİDEN DENEME] Modal/combobox yüklenemedi, sayfa yenileniyor... (Deneme: ${attempt + 1}/${maxRetries + 1})`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const providerPage = new ProviderPage(page);
      await providerPage.recoverFromChunkLoadError();
      await expect(page.locator('main').first()).toBeVisible({ timeout: 15000 }).catch(() => {});
    }

    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i });
    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 15000 });
    await newSchedulerBtn.click();
    console.log('👆 [TIKLAMA] "New Scheduler" butonuna tıklandı.');
    
    // Modal açılmasını dinamik bekle
    try {
      await page.getByRole('dialog').first().waitFor({ state: 'visible', timeout: 10000 });
    } catch (err) {
      console.log('⚠️ [UYARI] Modal açılmadı, yeniden denenecek...');
      attempt++;
      continue;
    }

    // Combobox'ın görünür olmasını bekle
    const repoComboCheck = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    try {
      await repoComboCheck.waitFor({ state: 'visible', timeout: 10000 });
      modalReady = true;
    } catch (err) {
      console.log('⚠️ [UYARI] Repository combobox yüklenemedi (muhtemelen 502 hatası), yeniden denenecek...');
      // Modal açık kalmışsa kapat ve kapanmasını dinamik bekle
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      attempt++;
    }
  }

  if (!modalReady) {
    throw new Error('❌ [HATA] Birden fazla denemeden sonra New Scheduler modalı başarıyla yüklenemedi.');
  }

  const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
  try {
    await repoCombo.click({ timeout: 5000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Repo combobox normal tıklanamadı, force: true ile deneniyor...');
    await repoCombo.click({ force: true });
  }

  // Radix UI select bileşeni role="option" ve data-slot="select-item" kullanır
  const allRepoOptions = page.getByRole('option').or(page.locator('[data-slot="select-item"]'));
  await allRepoOptions.first().waitFor({ state: 'visible', timeout: 15000 });

  // Aktif (data-disabled="false") repository seçeneklerini filtrele
  // Not: data-disabled attribute'ü sadece data-slot öğelerinde mevcut — CSS son çare olarak kabul edilebilir
  const enabledRepoOptions = page.locator('[role="option"][data-disabled="false"], [data-slot="select-item"][data-disabled="false"]');
  const count = await enabledRepoOptions.count();

  if (count > 0) {
    const firstEnabledRepo = enabledRepoOptions.first();
    const repoName = await firstEnabledRepo.innerText().catch(() => 'selected-repo');
    console.log(`🔍 [KONTROL] Aktif repository seçiliyor: "${repoName.trim()}"`);
    try {
      await firstEnabledRepo.click({ timeout: 3000 });
    } catch (err) {
      console.log('⚠️ [UYARI] Repository seçeneği normal tıklanamadı, force: true ile deneniyor...');
      await firstEnabledRepo.click({ force: true });
    }
  } else {
    console.log('⚠️ [UYARI] Aktif (data-disabled="false") repository bulunamadı. Bütün repolar "Excluded" (disabled) durumda. Test skip ediliyor.');
    test.skip(true, 'Bütün repolar "Excluded" (disabled) olduğu için test atlanıyor.');
    return '';
  }

  await page.keyboard.press('Escape');
  // Listbox'ın kapanmasını dinamik bekle
  await page.getByRole('listbox').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  const nameInput = page.getByPlaceholder(/Nightly Full Backup/i)
    .or(page.getByRole('textbox', { name: /name/i }))
    .first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  
  const customName = process.env.E2E_SCHEDULE_NAME;
  const tempScheduleName = customName && customName.trim() !== '' ? customName : `e2e-schedule-${Date.now()}`;
  await nameInput.fill(tempScheduleName);
  console.log(`📝 [BİLGİ] Planlayıcı İsmi girildi: ${tempScheduleName}`);

  const isCron = process.env.E2E_SCHEDULE_TYPE === 'Cron';
  const customTime = process.env.E2E_SCHEDULE_TIME;
  if (customTime && !isCron) {
    console.log(`📝 [BİLGİ] Saat dolduruluyor: ${customTime}`);
    // Time input'lar için getByRole alternatifi bulunmadığından CSS kabul edilebilir (son çare)
    const timeInput = page.locator('input[type="time"]').first();
    await timeInput.waitFor({ state: 'visible', timeout: 10000 });
    await timeInput.fill(customTime);
  }

  if (process.env.E2E_INCLUDE_CODE !== undefined) {
    await setCheckboxState(page, 'Code & Commits', process.env.E2E_INCLUDE_CODE === 'true');
  }
  if (process.env.E2E_INCLUDE_PR !== undefined) {
    await setCheckboxState(page, 'Pull Requests', process.env.E2E_INCLUDE_PR === 'true');
  }
  if (process.env.E2E_INCLUDE_ISSUES !== undefined) {
    await setCheckboxState(page, 'Issues', process.env.E2E_INCLUDE_ISSUES === 'true');
  }

  return tempScheduleName;
}

async function selectTimezone(page: Page) {
  const dialog = page.getByRole('dialog').first();
  
  let isCronText = false;
  try {
    const typeTrigger = dialog.getByRole('combobox').nth(1);
    if (await typeTrigger.isVisible()) {
      const currentType = (await typeTrigger.innerText().catch(() => '')).trim().toLowerCase();
      if (currentType === 'cron' || currentType.includes('cron')) {
        isCronText = true;
      }
    }
  } catch (err) {
    console.log('⚠️ [UYARI] Arayüzden aktif tip okunurken hata oluştu:', err);
  }

  const isCron = isCronText || process.env.E2E_SCHEDULE_TYPE === 'Cron';
  if (isCron) {
    console.log('📝 [BİLGİ] Cron schedule tipi algılandı. Timezone seçimi atlanıyor.');
    return;
  }
  const targetTimezone = process.env.E2E_TIMEZONE;
  if (!targetTimezone) {
    console.log('📝 [BİLGİ] E2E_TIMEZONE belirtilmediği için timezone seçimi atlanıyor.');
    return;
  }

  console.log(`⏳ [BEKLEME] Timezone seçimi tetikleniyor: "${targetTimezone}"`);
  
  // Timezone combobox her zaman dialog içindeki son combobox'tır
  const tzCombo = dialog.getByRole('combobox').last();
  await tzCombo.waitFor({ state: 'visible', timeout: 15000 });
  
  try {
    await tzCombo.click({ timeout: 5000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Timezone combobox normal tıklanamadı, force: true ile deneniyor...');
    await tzCombo.click({ force: true });
  }

  const tzOptions = page.getByRole('option');
  await tzOptions.first().waitFor({ state: 'visible', timeout: 15000 });

  let matchText = targetTimezone;
  if (targetTimezone.includes('İstanbul')) {
    matchText = 'Istanbul';
  } else if (targetTimezone.includes('Eastern')) {
    matchText = 'Eastern';
  }

  const tzOption = tzOptions.filter({ hasText: new RegExp(matchText, 'i') }).first();
  await tzOption.waitFor({ state: 'visible', timeout: 10000 });
  const selectedTzName = await tzOption.innerText().catch(() => targetTimezone);
  console.log(`🔍 [KONTROL] Timezone seçiliyor: "${selectedTzName.trim()}"`);
  try {
    await tzOption.click({ timeout: 3000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Timezone seçeneği normal tıklanamadı, force: true ile deneniyor...');
    await tzOption.click({ force: true });
  }
}

async function selectWeeklyDay(page: Page) {
  const rawDay = process.env.E2E_WEEKDAY || 'Mon';
  
  let dayAbbr = rawDay.substring(0, 3);
  if (rawDay.toLowerCase().startsWith('th')) dayAbbr = 'Thu';
  else if (rawDay.toLowerCase().startsWith('sa')) dayAbbr = 'Sat';
  else if (rawDay.toLowerCase().startsWith('su')) dayAbbr = 'Sun';
  else if (rawDay.toLowerCase().startsWith('tu')) dayAbbr = 'Tue';
  else if (rawDay.toLowerCase().startsWith('we')) dayAbbr = 'Wed';
  else if (rawDay.toLowerCase().startsWith('mo')) dayAbbr = 'Mon';
  else if (rawDay.toLowerCase().startsWith('fr')) dayAbbr = 'Fri';

  console.log(`⏳ [BEKLEME] Weekly Day seçiliyor: "${dayAbbr}"`);

  const dayElement = page.getByRole('checkbox', { name: dayAbbr, exact: true })
    .or(page.getByText(dayAbbr, { exact: true }))
    .first();

  await dayElement.waitFor({ state: 'visible', timeout: 10000 });
  
  const isChecked = (await dayElement.getAttribute('aria-checked')) === 'true' || 
                    (await dayElement.getAttribute('data-state')) === 'checked';
  if (!isChecked) {
    try {
      await dayElement.click({ timeout: 3000 });
    } catch (err) {
      console.log(`⚠️ [UYARI] "${dayAbbr}" normal tıklanamadı, force: true ile deneniyor...`);
      await dayElement.click({ force: true });
    }
    console.log(`🎉 [BAŞARILI] "${dayAbbr}" günü seçildi.`);
  } else {
    console.log(`🔍 [KONTROL] "${dayAbbr}" zaten seçili.`);
  }
}

async function selectMonthlyDay(page: Page) {
  const dayNum = process.env.E2E_MONTHDAY || '1';
  console.log(`⏳ [BEKLEME] Monthly Day seçiliyor: "${dayNum}"`);

  // Dialog içindeki 3. combobox Monthly Day seçimidir (0: repo, 1: type, 2: day)
  const dialog = page.getByRole('dialog').first();
  const dayCombo = dialog.getByRole('combobox').nth(2);
  await dayCombo.waitFor({ state: 'visible', timeout: 10000 });
  try {
    await dayCombo.click({ timeout: 3000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Monthly Day combobox normal tıklanamadı, force: true ile deneniyor...');
    await dayCombo.click({ force: true });
  }

  const option = page.getByRole('option', { name: new RegExp(`^${dayNum}$`) })
    .filter({ hasText: new RegExp(`^${dayNum}$`) })
    .first();
  
  await option.waitFor({ state: 'visible', timeout: 5000 });
  try {
    await option.click({ timeout: 3000 });
  } catch (err) {
    console.log(`⚠️ [UYARI] Monthly Day "${dayNum}" seçeneği normal tıklanamadı, force: true ile deneniyor...`);
    await option.click({ force: true });
  }
  console.log(`🎉 [BAŞARILI] Monthly Day seçildi: "${dayNum}"`);
  // Listbox'ın option.click() ile kapanmasını bekle (Escape modalı da kapatabilir, bu yüzden kullanılmıyor)
  await page.getByRole('listbox').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => {
    // Listbox hâlâ açıksa, dialog içine tıklayarak güvenli şekilde kapat
    await dialog.click({ position: { x: 10, y: 10 } }).catch(() => {});
  });
}

async function fillCronExpression(page: Page) {
  const cronExpr = process.env.E2E_CRON_EXPR || '0 2 * * ?';
  console.log(`⏳ [BEKLEME] Cron ifadesi dolduruluyor: "${cronExpr}"`);

  // getByPlaceholder öncelikli, CSS input[name] son çare
  const cronInput = page.getByPlaceholder('* * * * *')
    .or(page.getByPlaceholder('0 2 * * ?'))
    .or(page.locator('input[name="cron"]'))
    .first();

  await cronInput.waitFor({ state: 'visible', timeout: 10000 });
  await cronInput.fill(cronExpr);
  console.log(`🎉 [BAŞARILI] Cron ifadesi dolduruldu: "${cronExpr}"`);
}

async function saveScheduler(page: Page) {
  console.log('⏳ [BEKLEME] Save/Create Scheduler butonuna basılıyor...');
  // getByRole tek başına yeterli — gereksiz .or() zincirleri kaldırıldı
  const saveBtn = page.getByRole('button', { name: /save|create/i }).first();
  await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
  try {
    await saveBtn.click({ timeout: 5000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Save butonu normal tıklanamadı, force: true ile deneniyor...');
    await saveBtn.click({ force: true });
  }
  console.log('👆 [TIKLAMA] Save/Create Scheduler butonuna tıklandı.');
}

async function deleteSchedulerRow(page: Page, schedulerName: string) {
  const matchingRows = page.locator('tr').filter({ hasText: schedulerName });
  const countBefore = await matchingRows.count();
  
  if (countBefore === 0) {
    console.log(`🔍 [KONTROL] "${schedulerName}" planlayıcısı bulunamadı, silme adımı atlanıyor.`);
    return;
  }

  console.log(`📦 [İŞLEM] Temizlik: "${schedulerName}" planlayıcısı siliniyor... (Mevcut satır sayısı: ${countBefore})`);
  const schedulerRow = matchingRows.first();
  
  let clicked = false;

  // Öncelik 1: getByRole ile erişilebilir silme butonu (aria-label varsa)
  const accessibleDeleteBtn = schedulerRow.getByRole('button', { name: /delete|trash|remove|sil/i }).first();
  if (await accessibleDeleteBtn.isVisible().catch(() => false)) {
    console.log('👆 [TIKLAMA] Erişilebilir silme butonu bulundu, tıklanıyor...');
    await accessibleDeleteBtn.click();
    clicked = true;
  }

  // Öncelik 2: SVG trash icon butonu (aria-label yoksa CSS fallback)
  if (!clicked) {
    const trashIconBtn = schedulerRow.locator('button:has(svg[class*="trash"])')
      .or(schedulerRow.locator('button:has(svg.lucide-trash-2)'))
      .first();
    if (await trashIconBtn.isVisible().catch(() => false)) {
      console.log('👆 [TIKLAMA] SVG trash icon butonu bulundu, tıklanıyor...');
      await trashIconBtn.click();
      clicked = true;
    }
  }

  // Öncelik 3: Satırdaki son buton (silme butonu genellikle sonda)
  if (!clicked) {
    const allButtons = schedulerRow.getByRole('button');
    const btnCount = await allButtons.count();
    if (btnCount > 0) {
      const lastBtn = allButtons.last();
      console.log(`👆 [TIKLAMA] Son buton (${btnCount}. buton) tıklanıyor...`);
      await lastBtn.click();
      clicked = true;
    }
  }

  // Öncelik 4: Menü trigger → menuitem ile silme
  if (!clicked) {
    const rowMenuTrigger = schedulerRow.getByRole('button').filter({ has: page.locator('[aria-haspopup="menu"]') }).first();
    if (await rowMenuTrigger.isVisible().catch(() => false)) {
      await rowMenuTrigger.click();
      const deleteAction = page.getByRole('menuitem', { name: /delete|remove|sil/i }).first();
      await deleteAction.waitFor({ state: 'visible', timeout: 5000 });
      await deleteAction.click();
      clicked = true;
    }
  }

  // Son çare: Metin filtresiyle silme butonu
  if (!clicked) {
    const deleteBtn = schedulerRow.getByRole('button').filter({ hasText: /delete|remove|sil/i }).first();
    await deleteBtn.click();
  }

  // Onay diyalogu: getByRole ile dialog chaining
  const confirmDeleteBtn = page.getByRole('dialog').or(page.getByRole('alertdialog')).first()
    .getByRole('button', { name: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
  if (await confirmDeleteBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
    console.log('👆 [TIKLAMA] Onay diyalogu bulundu, onaylanıyor...');
    await confirmDeleteBtn.click();
  }

  // Sayfayı yenileyerek satır sayısının azaldığını doğrula (toleranslı bekleme döngüsü)
  let countAfter = countBefore;
  await expect(async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    const providerPage = new ProviderPage(page);
    await providerPage.recoverFromChunkLoadError();
    countAfter = await matchingRows.count();
    expect(countAfter).toBeLessThan(countBefore);
  }).toPass({ timeout: 15000, intervals: [3000] }).catch(() => {});

  console.log(`🔍 [KONTROL] Silme sonrası nihai satır sayısı: ${countAfter} (Önce: ${countBefore})`);

  if (countAfter < countBefore) {
    console.log('🎉 [BAŞARILI] Temizlik tamamlandı.');
  } else {
    console.log('⚠️ [UYARI] Planlayıcı satır sayısı azalmadı.');
  }
}

test.describe('Backup Schedulers - Form Yapılandırma', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const providerPage = new ProviderPage(page);

    console.log('🌐 [NAVİGASYON] Dashboard açılıyor...');
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    console.log('🌐 [NAVİGASYON] Sidebar üzerinden Schedulers sayfasına gidiliyor...');
    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i });
    
    // Yükleme hatalarına karşı toleranslı bekleme
    try {
      await schedulersLink.waitFor({ state: 'visible', timeout: 15000 });
      await schedulersLink.click();
      await page.waitForURL(/\/schedulers\b/, { timeout: 8000 });
    } catch (err) {
      console.log('⚠️ [UYARI] Schedulers sayfasına sidebar ile geçilemedi, doğrudan URL ile deneniyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`);
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    }
    
    await providerPage.recoverFromChunkLoadError();

    // Önceki başarısız test koşularından kalan e2e-schedule-* artıklarını temizle
    const staleRows = page.locator('tr').filter({ hasText: /e2e-schedule-\d+/ });
    const staleCount = await staleRows.count().catch(() => 0);
    if (staleCount > 0) {
      console.log(`🧹 [TEMİZLİK] ${staleCount} adet eski e2e-schedule artığı tespit edildi, temizleniyor...`);
      for (let i = 0; i < staleCount; i++) {
        // Her silme sonrası DOM değiştiği için her seferinde ilk satırı hedefle
        const row = page.locator('tr').filter({ hasText: /e2e-schedule-\d+/ }).first();
        if (await row.isVisible().catch(() => false)) {
          const trashBtn = row.getByRole('button', { name: /delete|trash|remove|sil/i })
            .or(row.locator('button:has(svg[class*="trash"])'))
            .or(row.getByRole('button').last())
            .first();
          if (await trashBtn.isVisible().catch(() => false)) {
            await trashBtn.click();
            // Onay diyalogu
            const confirmBtn = page.getByRole('dialog').or(page.getByRole('alertdialog')).first()
              .getByRole('button', { name: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
            if (await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
              await confirmBtn.click();
            }
            // Satırın silinmesini bekle
            await expect(row).toBeHidden({ timeout: 10000 }).catch(() => {});
          }
        }
      }
      // Sayfayı yenile ve temizliği doğrula
      await page.reload({ waitUntil: 'domcontentloaded' });
      await providerPage.recoverFromChunkLoadError();
      const remainingStale = await page.locator('tr').filter({ hasText: /e2e-schedule-\d+/ }).count().catch(() => 0);
      console.log(`🧹 [TEMİZLİK] Temizlik tamamlandı. Kalan artık: ${remainingStale}`);
    }
  });

  test.afterEach(async ({ page }) => {
    if (scheduleNameToCleanup) {
      console.log(`🧹 [afterEach] Temizlik başlatılıyor: "${scheduleNameToCleanup}"`);
      try {
        await deleteSchedulerRow(page, scheduleNameToCleanup);
      } catch (err) {
        console.log('⚠️ [afterEach] Temizlik sırasında hata oluştu (planlayıcı zaten silinmiş veya bulunamadı):', err);
      }
      scheduleNameToCleanup = null;
    }
  });

  test('Daily Scheduler Senaryosu', { tag: '@daily' }, async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Daily Scheduler Senaryosu başlatıldı.');
    const scheduleName = await fillBaseSchedulerForm(page);
    scheduleNameToCleanup = scheduleName;
    
    await selectScheduleType(page, 'Daily');
    await selectTimezone(page);
    await saveScheduler(page);
    
    // Modal kapanmasını dinamik bekle
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    
    // Doğrulama: Eklenen planlayıcı tabloda görünüyor mu?
    const expectedRow = page.locator('tr').filter({ hasText: scheduleName }).first();
    await expect(expectedRow).toBeVisible({ timeout: 15000 });
    console.log(`🎉 [BAŞARILI] Daily Scheduler başarıyla oluşturuldu: "${scheduleName}"`);
    console.log('🎉 [BAŞARILI] Daily Scheduler Senaryosu tamamlandı.');
  });

  test('Weekly Scheduler Senaryosu', { tag: '@weekly' }, async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Weekly Scheduler Senaryosu başlatıldı.');
    const scheduleName = await fillBaseSchedulerForm(page);
    scheduleNameToCleanup = scheduleName;

    await selectScheduleType(page, 'Weekly');
    await selectWeeklyDay(page);
    await selectTimezone(page);
    await saveScheduler(page);
    
    // Modal kapanmasını dinamik bekle
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    
    // Doğrulama: Eklenen planlayıcı tabloda görünüyor mu?
    const expectedRow = page.locator('tr').filter({ hasText: scheduleName }).first();
    await expect(expectedRow).toBeVisible({ timeout: 15000 });
    console.log(`🎉 [BAŞARILI] Weekly Scheduler başarıyla oluşturuldu: "${scheduleName}"`);
    console.log('🎉 [BAŞARILI] Weekly Scheduler Senaryosu tamamlandı.');
  });

  test('Monthly Scheduler Senaryosu', { tag: '@monthly' }, async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Monthly Scheduler Senaryosu başlatıldı.');
    const scheduleName = await fillBaseSchedulerForm(page);
    scheduleNameToCleanup = scheduleName;

    await selectScheduleType(page, 'Monthly');
    await selectMonthlyDay(page);
    await selectTimezone(page);
    await saveScheduler(page);
    
    // Modal kapanmasını dinamik bekle
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    
    // Doğrulama: Eklenen planlayıcı tabloda görünüyor mu?
    const expectedRow = page.locator('tr').filter({ hasText: scheduleName }).first();
    await expect(expectedRow).toBeVisible({ timeout: 15000 });
    console.log(`🎉 [BAŞARILI] Monthly Scheduler başarıyla oluşturuldu: "${scheduleName}"`);
    console.log('🎉 [BAŞARILI] Monthly Scheduler Senaryosu tamamlandı.');
  });

  test('Cron Scheduler Senaryosu', { tag: '@cron' }, async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Cron Scheduler Senaryosu başlatıldı.');
    const scheduleName = await fillBaseSchedulerForm(page);
    scheduleNameToCleanup = scheduleName;

    await selectScheduleType(page, 'Cron');
    await fillCronExpression(page);
    await selectTimezone(page);
    await saveScheduler(page);
    
    // Modal kapanmasını dinamik bekle
    await page.getByRole('dialog').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    
    // Doğrulama: Eklenen planlayıcı tabloda görünüyor mu?
    const expectedRow = page.locator('tr').filter({ hasText: scheduleName }).first();
    await expect(expectedRow).toBeVisible({ timeout: 15000 });
    console.log(`🎉 [BAŞARILI] Cron Scheduler başarıyla oluşturuldu: "${scheduleName}"`);
    console.log('🎉 [BAŞARILI] Cron Scheduler Senaryosu tamamlandı.');
  });
});
