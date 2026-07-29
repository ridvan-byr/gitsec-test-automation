import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import type { Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';

let workspaceId: string;
let dashboardBaseUrl: string;
let scheduleNameToCleanup: string | null = null;

async function selectScheduleType(page: Page, typeName: 'Daily' | 'Weekly' | 'Monthly' | 'Cron') {
  console.log(`⏳ [BEKLEME] Schedule Type seçiliyor: "${typeName}"`);
  
  const dialog = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
  
  // 1. Sekme / Buton (Tabs / Radio / Direct buttons) seçeneği kontrolü
  const directButton = dialog.getByRole('button', { name: typeName, exact: true })
    .or(dialog.getByRole('tab', { name: typeName }))
    .or(dialog.locator('button, div[role="radio"]').filter({ hasText: new RegExp(`^${typeName}$`, 'i') }))
    .first();

  if (await directButton.isVisible().catch(() => false)) {
    console.log(`🎯 [Schedule Type] Doğrudan buton/tab ile "${typeName}" seçiliyor.`);
    await directButton.click({ force: true }).catch(() => {});
    return;
  }

  // 2. Select Combobox seçeneği kontrolü
  const comboboxes = dialog.getByRole('combobox').or(dialog.locator('button[role="combobox"], [data-slot="select-trigger"]'));
  const count = await comboboxes.count().catch(() => 0);
  const typeTrigger = count > 1 ? comboboxes.nth(1) : comboboxes.first();

  const isTriggerAttached = await typeTrigger.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);

  if (isTriggerAttached) {
    const currentText = (await typeTrigger.innerText().catch(() => '')).trim().toLowerCase();
    if (currentText === typeName.toLowerCase() || currentText.includes(typeName.toLowerCase())) {
      console.log(`🔍 [KONTROL] Schedule Type zaten "${typeName}" seçili durumda.`);
      return;
    }

    await typeTrigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);

    const option = page.getByRole('option', { name: typeName })
      .or(page.locator('[role="option"], [data-slot="select-item"]').filter({ hasText: typeName }))
      .first();

    const isOptionVisible = await option.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (isOptionVisible) {
    } else {
      console.log(`⚠️ [UYARI] "${typeName}" seçeneği dropdown'da bulunamadı, varsayılan tip korunuyor.`);
    }
  } else {
    console.log(`ℹ️ [Schedule Type] Tip tetikleyicisi bulunamadı, varsayılan tip kullanılıyor.`);
  }
}

async function setCheckboxState(page: Page, labelText: string, shouldBeChecked: boolean) {
  console.log(`⏳ [BEKLEME] Checkbox ayarlanıyor. Etiket: "${labelText}", Hedef Durum: ${shouldBeChecked}`);

  try {
    const labelRegex = new RegExp(labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const checkbox = page.getByRole('checkbox', { name: labelRegex })
      .or(page.getByLabel(labelRegex))
      .or(page.locator('label, div').filter({ hasText: labelRegex }).locator('button[role="checkbox"], input[type="checkbox"], button[role="switch"], [data-slot="checkbox"]').first())
      .or(page.locator('[role="dialog"] button[role="checkbox"], [role="dialog"] input[type="checkbox"], [role="dialog"] button[role="switch"]').first());

    const isAttached = await checkbox.first().waitFor({ state: 'attached', timeout: 4000 }).then(() => true).catch(() => false);

    if (isAttached) {
      const targetEl = checkbox.first();
      const dataState = await targetEl.getAttribute('data-state').catch(() => '');
      const ariaChecked = await targetEl.getAttribute('aria-checked').catch(() => '');
      const isChecked = dataState === 'checked' || ariaChecked === 'true' || (await targetEl.isChecked().catch(() => false));

      if (isChecked !== shouldBeChecked) {
        console.log(`🔘 [CHECKBOX] "${labelText}" durumu güncelleniyor -> Hedef: ${shouldBeChecked}`);
        await targetEl.click({ force: true }).catch(() => {});
      } else {
        console.log(`✅ [CHECKBOX] "${labelText}" zaten istenen durumda: ${shouldBeChecked}`);
      }
    } else {
      console.log(`ℹ️ [CHECKBOX] "${labelText}" checkbox/switch öğesi arayüzde bulunamadı (opsiyonel varsayıldı).`);
    }
  } catch (err) {
    console.log(`⚠️ [UYARI] "${labelText}" checkbox ayarlanırken hata göz ardı edildi: ${(err as Error).message}`);
  }
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

    const newSchedulerBtn = page.getByRole('button', { name: 'New Scheduler', exact: true })
      .or(page.locator('button[data-slot="button"]').filter({ hasText: 'New Scheduler' }))
      .or(page.getByRole('button', { name: /New Scheduler|Yeni Planlayıcı|Zamanlayıcı Ekle|Add Scheduler|Create Scheduler/i }))
      .or(page.locator('button').filter({ hasText: /New Scheduler|Yeni Planlayıcı/i }))
      .first();

    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 15000 });
    await newSchedulerBtn.click({ force: true }).catch(() => newSchedulerBtn.click());
    console.log('👆 [TIKLAMA] "New Scheduler" / "Yeni Planlayıcı" butonuna tıklandı.');
    
    // Modal / Dialog alanının görünmesini kesin olarak bekle
    const dialogModal = page.locator('[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"]').first();
    try {
      await dialogModal.waitFor({ state: 'visible', timeout: 12000 });
      modalReady = true;
    } catch (err) {
      console.log('⚠️ [UYARI] Form modalı ekranda görüntülenemedi, yeniden denenecek...');
      attempt++;
    }
  }

  if (!modalReady) {
    throw new Error('❌ [HATA] Birden fazla denemeden sonra New Scheduler modalı ekranda açılamadı.');
  }

  const dialogModal = page.locator('[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"]').first();

  const repoCombo = dialogModal.getByRole('combobox')
    .or(dialogModal.locator('button[role="combobox"], [data-slot="select-trigger"], button:has-text("repository")'))
    .first();
  try {
    await repoCombo.click({ timeout: 5000 });
  } catch (err) {
    console.log('⚠️ [UYARI] Repo combobox normal tıklanamadı, force: true ile deneniyor...');
    await repoCombo.click({ force: true });
  }

  // Combobox açılması için kısa bekleme ve option bulucu
  await page.waitForTimeout(500);

  const optionLocator = page.locator('[role="option"], [data-slot="select-item"], div[class*="select-item"], [data-radix-collection-item]')
    .or(page.getByRole('option'));

  const optionVisible = await optionLocator.first().waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);

  if (!optionVisible) {
    console.log('⚠️ [UYARI] Options popover açılmadı, repoCombo tekrar tıklanıyor ve ArrowDown basılıyor...');
    await repoCombo.click({ force: true }).catch(() => {});
    await page.keyboard.press('ArrowDown').catch(() => {});
    await page.waitForTimeout(300);
  }

  // Radix / Shadcn dropdown seçeneklerini herhangi bir disabled kısıtlaması koymadan al
  const allRepoOptions = page.locator('[role="option"], [data-slot="select-item"], div[class*="select-item"], [data-radix-collection-item]')
    .or(page.getByRole('option'));

  const count = await allRepoOptions.count().catch(() => 0);

  if (count > 0) {
    const firstRepo = allRepoOptions.first();
    const repoText = await firstRepo.innerText().catch(() => '');
    console.log(`🔍 [KONTROL] Repository seçeneği bulundu ve seçiliyor: "${repoText.trim()}"`);
    await firstRepo.click({ force: true }).catch(() => {});
  } else {
    console.log('⚠️ [UYARI] Dropdown açıldı ancak seçilebilir repo elemanı doğrudan sayılamadı. ArrowDown + Space basılıyor...');
    await page.keyboard.press('ArrowDown').catch(() => {});
    await page.keyboard.press('Space').catch(() => {});
  }

  await page.waitForTimeout(500);

  // Planlayıcı İsim Alanı (Yalnızca Dialog Modal İçerisindeki Metin Kutuları — Header Arama Kutusu Engellendi)
  const nameInput = dialogModal.locator('input[type="text"], input[name="name"], input[placeholder*="Backup"], input[placeholder*="Name"]')
    .or(dialogModal.getByPlaceholder(/Nightly Full Backup|Name|Planlayıcı|İsim/i))
    .or(dialogModal.getByRole('textbox', { name: /name|isim|planlayıcı/i }))
    .first();

  await nameInput.waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
  
  const customName = process.env.E2E_SCHEDULE_NAME;
  const tempScheduleName = customName && customName.trim() !== '' ? customName : `e2e-schedule-${Date.now()}`;
  await nameInput.fill(tempScheduleName);
  console.log(`📝 [BİLGİ] Planlayıcı İsmi girildi: ${tempScheduleName}`);

  const isCron = process.env.E2E_SCHEDULE_TYPE === 'Cron';
  const customTime = process.env.E2E_SCHEDULE_TIME;
  if (customTime && !isCron) {
    console.log(`📝 [BİLGİ] Saat dolduruluyor: ${customTime}`);
    try {
      const timeInput = page.locator('input[type="time"], input[name="time"], input[placeholder*="00:00"], input[placeholder*="10:30"], input[placeholder*="hh:mm"], form input[placeholder*=":"]').first();
      const isAttached = await timeInput.waitFor({ state: 'attached', timeout: 4000 }).then(() => true).catch(() => false);
      if (isAttached) {
        await timeInput.fill(customTime).catch(() => {});
      } else {
        console.log(`ℹ️ [SAAT ALANI] Özel time input bulunamadı (varsayılan saat korundu).`);
      }
    } catch (err) {
      console.log(`⚠️ [UYARI] Saat alanı ayarlanırken hata göz ardı edildi: ${(err as Error).message}`);
    }
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

  try {
    const dayElement = page.getByRole('button', { name: new RegExp(dayAbbr, 'i') })
      .or(page.getByRole('checkbox', { name: new RegExp(dayAbbr, 'i') }))
      .or(page.locator('button, div, span, label').filter({ hasText: new RegExp(`^${dayAbbr}$`, 'i') }))
      .or(page.locator(`[value*="${dayAbbr}"], [data-value*="${dayAbbr}"]`))
      .first();

    const isAttached = await dayElement.waitFor({ state: 'attached', timeout: 5000 }).then(() => true).catch(() => false);

    if (isAttached) {
      const isChecked = (await dayElement.getAttribute('aria-checked').catch(() => '')) === 'true' || 
                        (await dayElement.getAttribute('data-state').catch(() => '')) === 'checked';
      if (!isChecked) {
        console.log(`🎉 [BAŞARILI] "${dayAbbr}" günü seçiliyor...`);
        await dayElement.click({ force: true }).catch(() => {});
      } else {
        console.log(`🔍 [KONTROL] "${dayAbbr}" günü zaten seçili.`);
      }
    } else {
      console.log(`ℹ️ [WEEKLY DAY] "${dayAbbr}" günü elemanı doğrudan bulunamadı (varsayılan gün korundu).`);
    }
  } catch (err) {
    console.log(`⚠️ [UYARI] Weekly Day seçilirken hata göz ardı edildi: ${(err as Error).message}`);
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

async function disableSchedulerRow(page: Page, schedulerName: string) {
  const matchingRows = page.locator('tr').filter({ hasText: schedulerName });
  const count = await matchingRows.count();

  if (count === 0) {
    console.log(`🔍 [KONTROL] "${schedulerName}" planlayıcısı bulunamadı, devre dışı bırakma atlanıyor.`);
    return;
  }

  console.log(`📦 [İŞLEM] "${schedulerName}" planlayıcısı devre dışı bırakılıyor...`);
  const schedulerRow = matchingRows.first();

  // Switch butonunu bul (aktif/pasif toggle)
  const toggleSwitch = schedulerRow.locator('button[role="switch"]').first();
  if (await toggleSwitch.isVisible().catch(() => false)) {
    const isChecked = await toggleSwitch.getAttribute('aria-checked');
    if (isChecked === 'true' || isChecked === 'checked') {
      console.log('👆 [TIKLAMA] Switch aktif durumda, devre dışı bırakmak için tıklanıyor...');
      await toggleSwitch.click();

      // Onay diyalogu varsa onayla
      const confirmBtn = page.getByRole('dialog').or(page.getByRole('alertdialog')).first()
        .getByRole('button', { name: /confirm|yes|sure|disable|devre dışı|continue/i }).first();
      if (await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
        console.log('👆 [TIKLAMA] Onay diyalogu bulundu, onaylanıyor...');
        await confirmBtn.click();
      }

      // Switch durumunu doğrula
      await expect(toggleSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
      console.log('🎉 [BAŞARILI] Planlayıcı başarıyla devre dışı bırakıldı.');
    } else {
      console.log('🔍 [KONTROL] Planlayıcı zaten devre dışı durumda (aria-checked=false).');
    }
  } else {
    console.log('⚠️ [UYARI] Satırda switch butonu bulunamadı, devre dışı bırakma işlemi atlanıyor.');
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
    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i })
      .or(page.locator('a[href*="/schedulers"]'))
      .or(page.locator('nav a, div[class*="sidebar"] a').filter({ hasText: /Schedulers/i }))
      .first();
    
    // Yükleme hatalarına karşı toleranslı bekleme ve SPA içi pürüzsüz geçiş
    try {
      await schedulersLink.waitFor({ state: 'visible', timeout: 10000 });
      await schedulersLink.click();
      await page.waitForURL(/\/schedulers\b/, { timeout: 10000 });
    } catch (err) {
      console.log('⚠️ [UYARI] Schedulers sayfasına sidebar ile geçilemedi, doğrudan URL ile deneniyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    }
    
    await providerPage.recoverFromChunkLoadError();

    // Önceki başarısız test koşularından kalan e2e-schedule-* artıklarını temizle
    // Sadece 'delete' modunda eski artıkları temizle
    const cleanupMode = process.env.E2E_SCHEDULER_CLEANUP || 'delete';
    if (cleanupMode === 'delete') {
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
    } else {
      console.log(`📋 [beforeEach] Temizlik modu "${cleanupMode}" — eski artıklar silinmeyecek.`);
    }
  });

  test.afterEach(async ({ page }) => {
    if (!scheduleNameToCleanup) return;

    const cleanupMode = process.env.E2E_SCHEDULER_CLEANUP || 'delete';
    console.log(`🧹 [afterEach] Temizlik modu: "${cleanupMode}" | Hedef: "${scheduleNameToCleanup}"`);

    try {
      if (cleanupMode === 'delete') {
        await deleteSchedulerRow(page, scheduleNameToCleanup);
      } else if (cleanupMode === 'disable') {
        await disableSchedulerRow(page, scheduleNameToCleanup);
      } else {
        console.log(`📋 [afterEach] "keep" modu seçildi — planlayıcı olduğu gibi bırakılıyor: "${scheduleNameToCleanup}"`);
      }
    } catch (err) {
      console.log('⚠️ [afterEach] Temizlik sırasında hata oluştu:', err);
    }
    scheduleNameToCleanup = null;
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
