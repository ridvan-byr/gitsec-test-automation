import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../../pages/ProviderPage';
import type { Page } from '@playwright/test';

const workspaceId = process.env.WORKSPACE_ID ?? '753';
const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';

async function selectScheduleType(page: Page, typeName: 'Daily' | 'Weekly' | 'Monthly' | 'Cron') {
  console.log(`[e2e] Schedule Type seçiliyor: ${typeName}`);
  
  const formContainer = page.locator('form, [role="dialog"], [role="document"], [data-slot="dialog-content"], [data-slot="sheet-content"]').first();
  const typeTrigger = formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').nth(1);
  await typeTrigger.waitFor({ state: 'visible', timeout: 10000 });

  // Eğer aradığımız değer zaten seçili ise (mükerrer tıklamayı önlemek için) atlayalım
  const currentText = (await typeTrigger.innerText().catch(() => '')).trim().toLowerCase();
  if (currentText === typeName.toLowerCase() || currentText.includes(typeName.toLowerCase())) {
    console.log(`[e2e] Schedule Type zaten "${typeName}" seçili durumda, mükerrer seçim atlanıyor.`);
    return;
  }

  // Dialog-overlay veya combobox çakışmasını önlemek için tıklamadan önce Escape ve force click güvenliği
  try {
    await typeTrigger.click({ timeout: 5000 });
  } catch (err) {
    console.log('[e2e] Select trigger tıklanamadı, Escape basıp force: true ile deneniyor...');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await typeTrigger.click({ force: true });
  }

  const option = page.getByRole('option', { name: typeName, exact: true })
    .or(page.locator(`[data-slot="select-item"]:has-text("${typeName}")`))
    .or(page.locator(`[role="option"]:has-text("${typeName}")`))
    .first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click({ force: true });
  console.log(`[e2e] Dropdown ile ${typeName} seçildi.`);
  await page.waitForTimeout(500);
}

async function setCheckboxState(page: Page, labelText: string, shouldBeChecked: boolean) {
  console.log(`[e2e] setCheckboxState çağrıldı. Label: "${labelText}", Hedef: ${shouldBeChecked}`);

  // Yöntem 1: Direct role="checkbox" and name=labelText (or aria-label)
  let checkbox = page.getByRole('checkbox', { name: labelText }).first();
  
  // Yöntem 2: Eğer checkbox label ile ilişkilendirilmişse getByLabel
  if (!(await checkbox.isVisible().catch(() => false))) {
    checkbox = page.getByLabel(labelText).first();
  }

  // Yöntem 3: Label metnini içeren üst div/kart içindeki checkbox'ı bulma
  if (!(await checkbox.isVisible().catch(() => false))) {
    // E.g., a card container containing both labelText and the checkbox button
    checkbox = page.locator('div, button, label').filter({ hasText: labelText }).locator('[role="checkbox"], input[type="checkbox"]').first();
  }

  // Yöntem 4: Label elementinin sibling'i olan veya aynı div içindeki button[role="checkbox"]
  if (!(await checkbox.isVisible().catch(() => false))) {
    const label = page.locator('label, span, p').filter({ hasText: labelText }).first();
    if (await label.isVisible().catch(() => false)) {
      // Find the checkbox sibling or parent sibling
      checkbox = label.locator('..').locator('[role="checkbox"], input[type="checkbox"]').first();
    }
  }

  if (await checkbox.isVisible().catch(() => false)) {
    const isChecked = (await checkbox.getAttribute('aria-checked')) === 'true' || (await checkbox.isChecked().catch(() => false));
    if (isChecked !== shouldBeChecked) {
      console.log(`[e2e] Checkbox "${labelText}" tıklandı. Mevcut: ${isChecked}, Hedef: ${shouldBeChecked}`);
      await checkbox.click({ force: true });
      await page.waitForTimeout(500);
    } else {
      console.log(`[e2e] Checkbox "${labelText}" zaten istenen durumda: ${shouldBeChecked}`);
    }
  } else {
    console.log(`[e2e] Checkbox "${labelText}" bulunamadı.`);
  }
}

async function fillBaseSchedulerForm(page: Page) {
  // 1. New Scheduler butonuna tıkla
  const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i }).or(page.locator('button:has-text("New Scheduler")')).first();
  await newSchedulerBtn.waitFor({ state: 'visible', timeout: 15000 });
  await newSchedulerBtn.click();
  console.log('[e2e] "New Scheduler" butonuna tıklandı.');
  await page.waitForTimeout(1000); // Modal açılış animasyonu için bekleyelim

  // 2. Repository Seçimi
  const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
  await repoCombo.waitFor({ state: 'visible', timeout: 15000 });
  try {
    await repoCombo.click({ timeout: 5000 });
  } catch (err) {
    console.log('[e2e] Repo combobox normal tıklanamadı, force: true ile deneniyor...');
    await repoCombo.click({ force: true });
  }

  // Dropdown listesindeki seçeneklerin yüklenmesini bekleyelim
  const allRepoOptions = page.locator('[role="option"], [data-slot="select-item"]');
  await allRepoOptions.first().waitFor({ state: 'visible', timeout: 15000 });

  // Sadece data-disabled="false" olan (aktif/seçilebilir) repository seçeneğini bulalım
  const enabledRepoOptions = page.locator('[role="option"][data-disabled="false"], [data-slot="select-item"][data-disabled="false"]');
  const count = await enabledRepoOptions.count();

  if (count > 0) {
    const firstEnabledRepo = enabledRepoOptions.first();
    const repoName = await firstEnabledRepo.innerText().catch(() => 'selected-repo');
    console.log(`[e2e] Aktif repository seçiliyor: "${repoName.trim()}"`);
    await firstEnabledRepo.click({ force: true });
  } else {
    console.log('include olan repo yok');
    throw new Error('include olan repo yok');
  }

  // Seçimden sonra popover/overlay'i kapatmak için Escape tuşuna basalım
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 3. Schedule Name Doldurma
  const nameInput = page.getByPlaceholder('e.g. Nightly Full Backup')
    .or(page.locator('input[name="name"]'))
    .or(page.locator('input[placeholder*="Backup"]'))
    .first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  
  const customName = process.env.E2E_SCHEDULE_NAME;
  const tempScheduleName = customName && customName.trim() !== '' ? customName : `e2e-schedule-${Date.now()}`;
  await nameInput.fill(tempScheduleName);
  console.log(`[e2e] Schedule Name yazıldı: ${tempScheduleName}`);

  // 4. Time Doldurma (Cron değilse doldurulur)
  const isCron = process.env.E2E_SCHEDULE_TYPE === 'Cron';
  const customTime = process.env.E2E_SCHEDULE_TIME;
  if (customTime && !isCron) {
    console.log(`[e2e] Time dolduruluyor: ${customTime}`);
    const timeInput = page.locator('input[type="time"]').first();
    await timeInput.waitFor({ state: 'visible', timeout: 10000 });
    await timeInput.fill(customTime);
  }

  // 5. Included Items Checkbox Ayarları
  if (process.env.E2E_INCLUDE_CODE !== undefined) {
    await setCheckboxState(page, 'Code & Commits', process.env.E2E_INCLUDE_CODE === 'true');
  }
  if (process.env.E2E_INCLUDE_PR !== undefined) {
    await setCheckboxState(page, 'Pull Requests', process.env.E2E_INCLUDE_PR === 'true');
  }
  if (process.env.E2E_INCLUDE_ISSUES !== undefined) {
    await setCheckboxState(page, 'Issues', process.env.E2E_INCLUDE_ISSUES === 'true');
  }
}

async function selectTimezone(page: Page) {
  const formContainer = page.locator('form, [role="dialog"], [role="document"], [data-slot="dialog-content"], [data-slot="sheet-content"]').first();
  
  // Arayüzdeki aktif seçili zamanlayıcı tipini kontrol edelim
  let isCronText = false;
  try {
    const typeTrigger = formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').nth(1);
    if (await typeTrigger.isVisible()) {
      const currentType = (await typeTrigger.innerText().catch(() => '')).trim().toLowerCase();
      if (currentType === 'cron' || currentType.includes('cron')) {
        isCronText = true;
      }
    }
  } catch (err) {
    console.log('[e2e] Arayüzden aktif tip okunurken hata oluştu:', err);
  }

  const isCron = isCronText || process.env.E2E_SCHEDULE_TYPE === 'Cron';
  if (isCron) {
    console.log('[e2e] Cron schedule tipi algılandı. Timezone seçimi atlanıyor.');
    return;
  }
  const targetTimezone = process.env.E2E_TIMEZONE;
  if (!targetTimezone) {
    console.log('[e2e] E2E_TIMEZONE belirtilmediği için timezone seçimi atlanıyor.');
    return;
  }

  console.log(`[e2e] Timezone seçimi tetikleniyor: "${targetTimezone}"`);
  
  // Sonuncu combobox her zaman Timezone'dur (Zamanlayıcı tipine göre combobox sayısı 3 ya da 4 olur)
  const comboCount = await formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').count();
  const tzCombo = formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').nth(comboCount - 1);
  await tzCombo.waitFor({ state: 'visible', timeout: 15000 });
  
  try {
    await tzCombo.click({ timeout: 5000 });
  } catch (err) {
    console.log('[e2e] Timezone combobox normal tıklanamadı, force: true ile deneniyor...');
    await tzCombo.click({ force: true });
  }

  // Dropdown listesindeki seçeneklerin yüklenmesini bekleyelim
  const tzOptions = page.locator('[role="option"], [data-slot="select-item"]');
  const firstTz = tzOptions.first();
  await firstTz.waitFor({ state: 'visible', timeout: 15000 });

  // Seçeneklerin içinden aradığımız timezone değerini içeren olanı bulalım
  let matchText = targetTimezone;
  if (targetTimezone.includes('İstanbul')) {
    matchText = 'Istanbul';
  } else if (targetTimezone.includes('Eastern')) {
    matchText = 'Eastern';
  }

  const tzOption = tzOptions.filter({ hasText: new RegExp(matchText, 'i') }).first();
  await tzOption.waitFor({ state: 'visible', timeout: 10000 });
  const selectedTzName = await tzOption.innerText().catch(() => targetTimezone);
  console.log(`[e2e] Timezone seçiliyor: "${selectedTzName.trim()}"`);
  await tzOption.click({ force: true });
  await page.waitForTimeout(500);
}

async function selectWeeklyDay(page: Page) {
  const rawDay = process.env.E2E_WEEKDAY || 'Mon';
  
  // Abbreviate to first 3 letters as in Gitsec UI
  let dayAbbr = rawDay.substring(0, 3);
  if (rawDay.toLowerCase().startsWith('th')) dayAbbr = 'Thu';
  else if (rawDay.toLowerCase().startsWith('sa')) dayAbbr = 'Sat';
  else if (rawDay.toLowerCase().startsWith('su')) dayAbbr = 'Sun';
  else if (rawDay.toLowerCase().startsWith('tu')) dayAbbr = 'Tue';
  else if (rawDay.toLowerCase().startsWith('we')) dayAbbr = 'Wed';
  else if (rawDay.toLowerCase().startsWith('mo')) dayAbbr = 'Mon';
  else if (rawDay.toLowerCase().startsWith('fr')) dayAbbr = 'Fri';

  console.log(`[e2e] Weekly Day seçiliyor: ${dayAbbr}`);

  // Gitsec'de haftalık gün seçimi buton/checkbox/badge şeklinde görünür
  const dayElement = page.getByRole('checkbox', { name: dayAbbr, exact: true })
    .or(page.locator(`button:has-text("${dayAbbr}")`))
    .or(page.locator(`div[role="checkbox"]:has-text("${dayAbbr}")`))
    .or(page.getByText(dayAbbr, { exact: true }))
    .first();

  await dayElement.waitFor({ state: 'visible', timeout: 10000 });
  
  const isChecked = (await dayElement.getAttribute('aria-checked')) === 'true' || 
                    (await dayElement.getAttribute('data-state')) === 'checked';
  if (!isChecked) {
    await dayElement.click({ force: true });
    console.log(`[e2e] "${dayAbbr}" günü seçildi.`);
  } else {
    console.log(`[e2e] "${dayAbbr}" zaten seçili.`);
  }
}

async function selectMonthlyDay(page: Page) {
  const dayNum = process.env.E2E_MONTHDAY || '1';
  console.log(`[e2e] Monthly Day seçiliyor: ${dayNum}`);

  const formContainer = page.locator('form, [role="dialog"], [role="document"], [data-slot="dialog-content"], [data-slot="sheet-content"]').first();
  // Monthly seçildiğinde 2. indexteki combobox "Day of Month" olur
  const dayCombo = formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').nth(2);
  await dayCombo.waitFor({ state: 'visible', timeout: 10000 });
  await dayCombo.click({ force: true });

  const option = page.getByRole('option', { name: new RegExp(`^${dayNum}$`), exact: true })
    .or(page.locator(`[data-slot="select-item"]:has-text("${dayNum}")`))
    .or(page.locator(`[role="option"]:has-text("${dayNum}")`))
    .filter({ hasText: new RegExp(`^${dayNum}$`) })
    .first();
  
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click({ force: true });
  console.log(`[e2e] Monthly Day seçildi: ${dayNum}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

async function fillCronExpression(page: Page) {
  const cronExpr = process.env.E2E_CRON_EXPR || '0 2 * * ?';
  console.log(`[e2e] Cron ifadesi dolduruluyor: ${cronExpr}`);

  const cronInput = page.locator('input[name="cron"]')
    .or(page.locator('input[placeholder*="* * * * *"]'))
    .or(page.locator('input[placeholder*="0 2 * * ?"]'))
    .first();

  await cronInput.waitFor({ state: 'visible', timeout: 10000 });
  await cronInput.fill(cronExpr);
  console.log(`[e2e] Cron ifadesi dolduruldu: ${cronExpr}`);
}

async function saveScheduler(page: Page) {
  console.log('[e2e] Save/Create Scheduler butonuna basılıyor...');
  const saveBtn = page.getByRole('button', { name: /save|create|confirm|submit/i })
    .or(page.locator('button:has-text("Save")'))
    .or(page.locator('button:has-text("Create")'))
    .or(page.locator('button:has-text("Save Scheduler")'))
    .or(page.locator('button:has-text("Create Scheduler")'))
    .first();
  await saveBtn.waitFor({ state: 'visible', timeout: 15000 });
  await saveBtn.click();
  console.log('[e2e] Save/Create Scheduler butonuna tıklandı.');
}

test.describe('Backup Schedulers - Form Yapılandırma', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    const providerPage = new ProviderPage(page);

    console.log('[e2e] Dashboard açılıyor...');
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    console.log('[e2e] Sidebar üzerinden Schedulers sayfasına gidiliyor...');
    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i }).or(page.locator(`a[href*="/${workspaceId}/schedulers"]`)).first();
    await schedulersLink.waitFor({ state: 'visible', timeout: 15000 });
    await schedulersLink.click();

    await page.waitForURL(/\/schedulers\b/, { timeout: 25000 });
    console.log('[e2e] Schedulers sayfası URL doğrulandı:', page.url());

    // Güvenlik amaçlı: Eğer bir yönlendirme olduysa ve tekrar dashboard'a döndüyse, direct navigate yapalım.
    await page.waitForTimeout(2000);
    if (!page.url().includes('/schedulers')) {
      console.log('[e2e] Schedulers sayfasından çıkılmış, direkt link ile tekrar gidiliyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`);
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    }
  });

  test('Daily Scheduler Senaryosu @daily', async ({ page }) => {
    await fillBaseSchedulerForm(page);
    await selectScheduleType(page, 'Daily');
    await selectTimezone(page);
    await saveScheduler(page);
    console.log('[e2e] Daily Scheduler senaryosu tamamlandı.');
    await page.waitForTimeout(3000);
  });

  test('Weekly Scheduler Senaryosu @weekly', async ({ page }) => {
    await fillBaseSchedulerForm(page);
    await selectScheduleType(page, 'Weekly');
    await selectWeeklyDay(page);
    await selectTimezone(page);
    await saveScheduler(page);
    console.log('[e2e] Weekly Scheduler senaryosu tamamlandı.');
    await page.waitForTimeout(3000);
  });

  test('Monthly Scheduler Senaryosu @monthly', async ({ page }) => {
    await fillBaseSchedulerForm(page);
    await selectScheduleType(page, 'Monthly');
    await selectMonthlyDay(page);
    await selectTimezone(page);
    await saveScheduler(page);
    console.log('[e2e] Monthly Scheduler senaryosu tamamlandı.');
    await page.waitForTimeout(3000);
  });

  test('Cron Scheduler Senaryosu @cron', async ({ page }) => {
    await fillBaseSchedulerForm(page);
    await selectScheduleType(page, 'Cron');
    await fillCronExpression(page);
    await selectTimezone(page);
    await saveScheduler(page);
    console.log('[e2e] Cron Scheduler senaryosu tamamlandı.');
    await page.waitForTimeout(3000);
  });
});
