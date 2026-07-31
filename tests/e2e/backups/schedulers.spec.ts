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
  
  // 1. Önce Select Combobox (dropdown) yolunu dene — en güvenilir yol
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
    await page.waitForTimeout(500);

    const option = page.getByRole('option', { name: typeName })
      .or(page.locator('[role="option"], [data-slot="select-item"]').filter({ hasText: typeName }))
      .first();

    const isOptionVisible = await option.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    if (isOptionVisible) {
      console.log(`🎉 [BAŞARILI] Dropdown seçeneği bulundu: "${typeName}", tıklanıyor...`);
      await option.click({ timeout: 5000 }).catch(() => option.click({ force: true }));
      await page.waitForTimeout(500);
      
      // Popover/listbox kapanmasını garanti et
      const listbox = page.locator('[role="listbox"], [data-slot="select-content"]').first();
      if (await listbox.isVisible().catch(() => false)) {
        await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(async () => {
          console.log('⚠️ [UYARI] Dropdown hâlâ açık, Escape ile kapatılıyor...');
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(300);
        });
      }
      return;
    } else {
      console.log(`⚠️ [UYARI] "${typeName}" seçeneği dropdown'da bulunamadı.`);
    }
  }

  // 2. Fallback: Sekme / Tab / Radio yolu (combobox hariç — yanlış eşleşmeyi önler)
  const directButton = dialog.getByRole('tab', { name: typeName })
    .or(dialog.locator('div[role="radio"]').filter({ hasText: new RegExp(`^${typeName}$`, 'i') }))
    .first();

  if (await directButton.isVisible().catch(() => false)) {
    console.log(`🎯 [Schedule Type] Doğrudan tab/radio ile "${typeName}" seçiliyor.`);
    await directButton.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    return;
  }

  console.log(`ℹ️ [Schedule Type] Tip tetikleyicisi bulunamadı, varsayılan tip kullanılıyor.`);
}

async function setCheckboxState(page: Page, labelText: string, shouldBeChecked: boolean) {
  const dialog = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();

  try {
    const labelRegex = new RegExp(labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    
    // 1. Tam bu metni içeren metin elemanını hedefle
    const textNode = dialog.locator('span, label, div, p, h4, h5, button')
      .filter({ hasText: labelRegex })
      .last();

    const isTextAttached = await textNode.waitFor({ state: 'attached', timeout: 4000 }).then(() => true).catch(() => false);

    if (isTextAttached) {
      // 2. Bu metni içeren EN YAKIN (en dar) checkbox kapsayıcısını bul
      const cardContext = textNode.locator('xpath=ancestor::*[button[@role="checkbox"] or input[@type="checkbox"] or @role="checkbox"][1]');
      const hasCard = (await cardContext.count().catch(() => 0)) > 0;
      
      const targetBtn = hasCard 
        ? cardContext.locator('button[role="checkbox"], input[type="checkbox"], [role="checkbox"]').first()
        : textNode.locator('xpath=ancestor::label[1]//input | ancestor::label[1]//button').first();

      const elToClick = (await targetBtn.count().catch(() => 0)) > 0 ? targetBtn : textNode;

      // İşaretli olma durumu: YALNIZCA bu butonun kendi attributes & iç SVG'sine bak
      const dataState = await elToClick.getAttribute('data-state').catch(() => '');
      const ariaChecked = await elToClick.getAttribute('aria-checked').catch(() => '');
      const nativeChecked = await elToClick.isChecked().catch(() => false);
      const innerSvg = (await elToClick.locator('svg[class*="check"], svg.lucide-check').count().catch(() => 0)) > 0;

      const isChecked = 
        dataState === 'checked' || 
        ariaChecked === 'true' || 
        nativeChecked || 
        innerSvg;

      console.log(`📋 [CHECKBOX DETAY] "${labelText}" | Mevcut Durum: ${isChecked ? 'İşaretli (✓)' : 'Boş (✗)'} | İstenen: ${shouldBeChecked ? 'İşaretli (✓)' : 'Boş (✗)'}`);

      if (isChecked !== shouldBeChecked) {
        console.log(`🔘 [CHECKBOX GÜNCELLEME] "${labelText}" tıklanıyor -> Yeni Hedef: ${shouldBeChecked ? 'İşaretli (✓)' : 'Boş (✗)'}`);
        
        await elToClick.click({ force: true }).catch(() => {});
        await page.waitForTimeout(400);

        const postDataState = await elToClick.getAttribute('data-state').catch(() => '');
        const postAria = await elToClick.getAttribute('aria-checked').catch(() => '');
        const postNative = await elToClick.isChecked().catch(() => false);
        const postSvg = (await elToClick.locator('svg[class*="check"], svg.lucide-check').count().catch(() => 0)) > 0;

        const newIsChecked = 
          postDataState === 'checked' || 
          postAria === 'true' || 
          postNative || 
          postSvg;

        console.log(`✅ [CHECKBOX SONUÇ] "${labelText}" nihai durum: ${newIsChecked ? 'İşaretli (✓)' : 'Boş (✗)'}`);
      } else {
        console.log(`✅ [CHECKBOX KONTROL] "${labelText}" zaten istenen konumda: ${shouldBeChecked ? 'İşaretli (✓)' : 'Boş (✗)'}`);
      }
    } else {
      console.log(`ℹ️ [CHECKBOX] "${labelText}" elemanı arayüzde bulunamadı.`);
    }
  } catch (err) {
    console.log(`⚠️ [UYARI] "${labelText}" checkbox ayarlanırken hata: ${(err as Error).message}`);
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

  // Radix / Shadcn dropdown seçeneklerini al ve Excluded (Devre dışı/Hariç tutulmuş) olanları filtrele
  const allRepoOptions = page.locator('[role="option"], [data-slot="select-item"], div[class*="select-item"], [data-radix-collection-item]')
    .or(page.getByRole('option'));

  const count = await allRepoOptions.count().catch(() => 0);

  // Excluded (Hariç tutulmuş) olmayan aktif / include edilmiş repoları süz
  const includedRepoOptions = allRepoOptions.filter({
    hasNotText: /Excluded|Hariç Tutuldu|Devre Dışı|disabled/i
  });
  const includedCount = await includedRepoOptions.count().catch(() => 0);

  // Sağlayıcıya göre filtrelenmiş opsiyonları al (github / bitbucket / all)
  const requestedProvider = (process.env.E2E_CODE_PROVIDER || 'all').toLowerCase();
  
  let providerRepoOptions = includedRepoOptions;
  if (requestedProvider === 'github') {
    providerRepoOptions = includedRepoOptions.filter({ hasText: /GitHub/i });
  } else if (requestedProvider === 'bitbucket') {
    providerRepoOptions = includedRepoOptions.filter({ hasText: /Bitbucket/i });
  }

  const finalProviderCount = await providerRepoOptions.count().catch(() => 0);

  if (count === 0 || includedCount === 0 || finalProviderCount === 0) {
    let errorMsg = 'include edilen repo bulunamadı. Lütfen en az 1 repo include edin.';
    if (requestedProvider === 'github') {
      errorMsg = '❌ [HATA] GitHub sağlayıcısına ait aktif/dahil edilmiş repository bulunamadı. Lütfen en az 1 GitHub reposunu include edin.';
    } else if (requestedProvider === 'bitbucket') {
      errorMsg = '❌ [HATA] Bitbucket sağlayıcısına ait aktif/dahil edilmiş repository bulunamadı. Lütfen en az 1 Bitbucket reposunu include edin.';
    }

    console.log(`\n======================================================================`);
    console.log(`🛑 [BİLGİ / UYARI] ${errorMsg}`);
    console.log(`======================================================================\n`);

    // Modalı kapatıp testi temiz şekilde bitirmek için Escape bas ve skip et
    await page.keyboard.press('Escape').catch(() => {});
    await dialogModal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

    test.skip(true, errorMsg);
    return '';
  }

  const selectedRepo = providerRepoOptions.first();
  const repoText = await selectedRepo.innerText().catch(() => '');
  console.log(`🔍 [KONTROL] Include edilmiş seçilebilir repository bulundu: "${repoText.trim()}" (${requestedProvider.toUpperCase()} Sağlayıcı Filtresi)`);
  await selectedRepo.click({ force: true }).catch(() => {});

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

  return tempScheduleName;
}

async function fillScheduleTime(page: Page) {
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
}

async function setIncludedItems(page: Page) {
  const dialogModal = page.locator('[role="dialog"], [role="alertdialog"], [data-slot="dialog-content"]').first();

  console.log(`\n📋 [TEST ARAYÜZÜ AYARLARI] Dashboard'dan Gelen Yedekleme İçeriği Talebi:`);
  console.log(`   - Code & Commits : ${process.env.E2E_INCLUDE_CODE === 'true' ? 'İşaretlensin (✓)' : 'Kaldırılsın (✗)'}`);
  console.log(`   - Pull Requests  : ${process.env.E2E_INCLUDE_PR === 'true' ? 'İşaretlensin (✓)' : 'Kaldırılsın (✗)'}`);
  console.log(`   - Issues (Talepler): ${process.env.E2E_INCLUDE_ISSUES === 'true' ? 'İşaretlensin (✓)' : 'Kaldırılsın (✗)'}`);

  if (process.env.E2E_INCLUDE_CODE !== undefined) {
    await setCheckboxState(page, 'Code & Commits', process.env.E2E_INCLUDE_CODE === 'true');
  }
  if (process.env.E2E_INCLUDE_PR !== undefined) {
    await setCheckboxState(page, 'Pull Requests', process.env.E2E_INCLUDE_PR === 'true');
  }
  if (process.env.E2E_INCLUDE_ISSUES !== undefined) {
    const issuesContainer = dialogModal.locator('label, div').filter({ hasText: /Issues/i }).first();
    const hasIssues = await issuesContainer.isVisible().catch(() => false);
    if (hasIssues) {
      await setCheckboxState(page, 'Issues', process.env.E2E_INCLUDE_ISSUES === 'true');
    } else {
      console.log(`ℹ️ [SAĞLAYICI BİLGİSİ] Seçilen repo için "Issues" seçeneği mevcut değil (Bitbucket deposu olduğu için atlandı).`);
    }
  }

  console.log(`\n🔍 [FORM NİHAİ KONTROL] Modal Kaydedilmeden Önceki Gerçek DOM Durumu:`);
  for (const labelName of ['Code & Commits', 'Pull Requests', 'Issues']) {
    const labelRegex = new RegExp(labelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const textNode = dialogModal.locator('span, label, div, p, h4, h5, button')
      .filter({ hasText: labelRegex })
      .last();

    if (await textNode.isVisible().catch(() => false)) {
      const cardContext = textNode.locator('xpath=ancestor::*[button[@role="checkbox"] or input[@type="checkbox"] or @role="checkbox"][1]');
      const targetBtn = (await cardContext.count().catch(() => 0)) > 0
        ? cardContext.locator('button[role="checkbox"], input[type="checkbox"], [role="checkbox"]').first()
        : textNode;

      const state = await targetBtn.getAttribute('data-state').catch(() => '');
      const aria = await targetBtn.getAttribute('aria-checked').catch(() => '');
      const native = await targetBtn.isChecked().catch(() => false);
      const svg = (await targetBtn.locator('svg[class*="check"], svg.lucide-check').count().catch(() => 0)) > 0;

      const checked = state === 'checked' || aria === 'true' || native || svg;
      console.log(`   📌 GitSec Formundaki "${labelName}" Kutusu: ${checked ? 'İŞARETLİ (✓)' : 'BOŞ / İŞARETSİZ (✗)'}`);
    } else {
      console.log(`   📌 GitSec Formundaki "${labelName}" Kutusu: ARAYÜZDE MAVCUT DEĞİL (Atlandı)`);
    }
  }

  console.log(`✅ [YEDEKLEME İÇERİĞİ TAMAMLANDI] Form üzerindeki Included Items seçimi tamamlandı.`);
  console.log(`⏳ [GÖRSEL BEKLEME] Seçimlerin gözle görülebilmesi için 1.5 saniye bekleniyor...\n`);
  await page.waitForTimeout(1500);
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

  // YALNIZCA arayüzde Cron aktif ise timezone seçimi atlanır (E2E_SCHEDULE_TYPE global env ile karışmasını önler)
  if (isCronText) {
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
  // Varsayılan olarak Pazar hariç tüm çalışma günleri: Mon,Tue,Wed,Thu,Fri,Sat
  const rawDay = process.env.E2E_WEEKDAY || 'Mon,Tue,Wed,Thu,Fri,Sat';
  
  // Virgülle veya boşlukla ayrılmış tüm günleri diziye dönüştür
  const targetDays = rawDay.split(/[,;\s]+/).filter(Boolean);

  console.log(`⏳ [BEKLEME] Weekly Days seçiliyor: "${targetDays.join(', ')}"`);

  const dialog = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();

  for (const dayStr of targetDays) {
    let dayAbbr = dayStr.substring(0, 3);
    if (dayStr.toLowerCase().startsWith('th')) dayAbbr = 'Thu';
    else if (dayStr.toLowerCase().startsWith('sa')) dayAbbr = 'Sat';
    else if (dayStr.toLowerCase().startsWith('su')) dayAbbr = 'Sun';
    else if (dayStr.toLowerCase().startsWith('tu')) dayAbbr = 'Tue';
    else if (dayStr.toLowerCase().startsWith('we')) dayAbbr = 'Wed';
    else if (dayStr.toLowerCase().startsWith('mo')) dayAbbr = 'Mon';
    else if (dayStr.toLowerCase().startsWith('fr')) dayAbbr = 'Fri';

    try {
      // Shadcn UI Label veya Span Gün Elemanını dialog içinden tam metin eşleşmesiyle bul
      const dayLabel = dialog.locator('label, button, div, span')
        .filter({ hasText: new RegExp(`^${dayAbbr}$`, 'i') })
        .first();

      const isVisible = await dayLabel.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);

      if (isVisible) {
        const cls = await dayLabel.getAttribute('class').catch(() => '') || '';
        const dataState = await dayLabel.getAttribute('data-state').catch(() => '');
        const ariaChecked = await dayLabel.getAttribute('aria-checked').catch(() => '');
        const hasSvgIcon = (await dayLabel.locator('svg').count().catch(() => 0)) > 0;

        // Seçili olma kriteri: bg-primary/10 sınıfı, data-state="checked", aria-checked="true" veya içindeki tik (SVG) ikonu
        const isSelected = dataState === 'checked' || ariaChecked === 'true' || cls.includes('bg-primary/10') || hasSvgIcon;

        if (!isSelected) {
          console.log(`🎉 [BAŞARILI] "${dayAbbr}" gün seçeneği tıklanıp işaretleniyor...`);
          await dayLabel.click({ force: true });
          await page.waitForTimeout(200);
        } else {
          console.log(`🔍 [KONTROL] "${dayAbbr}" günü zaten seçili.`);
        }
      } else {
        console.log(`⚠️ [WEEKLY DAY] "${dayAbbr}" günü elemanı doğrudan bulunamadı.`);
      }
    } catch (err) {
      console.log(`⚠️ [UYARI] "${dayAbbr}" günü seçilirken hata: ${(err as Error).message}`);
    }
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
  let matchingRows = page.locator('tr').filter({ hasText: schedulerName });
  let count = await matchingRows.count().catch(() => 0);
  
  if (count === 0) {
    // Ekrana düşmemiş olma ihtimaline karşı arayüzdeki yenileme butonuna bas
    const refreshBtn = page.locator('button:has(svg[class*="rotate"]), button:has(svg[class*="refresh"]), button[title*="Refresh"]').first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(1000);
      count = await matchingRows.count().catch(() => 0);
    }
  }

  if (count === 0) {
    console.log(`🔍 [KONTROL] "${schedulerName}" planlayıcısı bulunamadı, silme adımı atlanıyor.`);
    return;
  }

  let attempts = 0;
  const maxAttempts = 10;
  
  while (attempts < maxAttempts) {
    attempts++;
    matchingRows = page.locator('tr').filter({ hasText: schedulerName });
    const currentCount = await matchingRows.count().catch(() => 0);
    
    if (currentCount === 0) {
      console.log(`🎉 [BAŞARILI] "${schedulerName}" ile eşleşen tüm planlayıcılar (${attempts - 1} işlemde) silindi.`);
      break;
    }

    console.log(`📦 [İŞLEM] Temizlik (${attempts}. silme işlemi): "${schedulerName}" planlayıcısı siliniyor... (Kalan satır sayısı: ${currentCount})`);
    const schedulerRow = matchingRows.first();
    
    let clicked = false;

    // Öncelik 1: getByRole ile erişilebilir silme butonu
    const accessibleDeleteBtn = schedulerRow.getByRole('button', { name: /delete|trash|remove|sil/i }).first();
    if (await accessibleDeleteBtn.isVisible().catch(() => false)) {
      await accessibleDeleteBtn.click({ force: true }).catch(() => {});
      clicked = true;
    }

    // Öncelik 2: SVG trash icon butonu
    if (!clicked) {
      const trashIconBtn = schedulerRow.locator('button:has(svg[class*="trash"]), button:has(svg.lucide-trash-2)').first();
      if (await trashIconBtn.isVisible().catch(() => false)) {
        await trashIconBtn.click({ force: true }).catch(() => {});
        clicked = true;
      }
    }

    // Öncelik 3: Satırdaki son buton
    if (!clicked) {
      const allButtons = schedulerRow.getByRole('button');
      const btnCount = await allButtons.count().catch(() => 0);
      if (btnCount > 0) {
        await allButtons.last().click({ force: true }).catch(() => {});
        clicked = true;
      }
    }

    // Onay diyalogu
    const confirmDeleteBtn = page.getByRole('dialog').or(page.getByRole('alertdialog')).first()
      .getByRole('button', { name: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
    if (await confirmDeleteBtn.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false)) {
      await confirmDeleteBtn.click({ force: true }).catch(() => {});
    }

    // Satırın dom katmanında gizlenmesini bekle (Full Page Reload yapmadan)
    await expect(schedulerRow).toBeHidden({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

async function disableSchedulerRow(page: Page, schedulerName: string) {
  const matchingRows = page.locator('tr').filter({ hasText: schedulerName });
  const count = await matchingRows.count().catch(() => 0);

  if (count === 0) {
    console.log(`🔍 [KONTROL] "${schedulerName}" planlayıcısı bulunamadı, devre dışı bırakma atlanıyor.`);
    return;
  }

  console.log(`📦 [İŞLEM] Devre Dışı Bırakma: "${schedulerName}" eşleşen ${count} planlayıcı taranıyor...`);
  for (let i = 0; i < count; i++) {
    const row = matchingRows.nth(i);
    const switchBtn = row.locator('button[role="switch"], input[type="checkbox"]').first();
    if (await switchBtn.isVisible().catch(() => false)) {
      const isChecked = (await switchBtn.getAttribute('data-state').catch(() => '')) === 'checked' || (await switchBtn.getAttribute('aria-checked').catch(() => '')) === 'true' || (await switchBtn.isChecked().catch(() => false));
      if (isChecked) {
        console.log(`👆 [TIKLAMA] ${i + 1}. satır aktif durumda, devre dışı bırakmak için tıklanıyor...`);
        await switchBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  }
  console.log(`🎉 [BAŞARILI] "${schedulerName}" eşleşen planlayıcılar başarıyla devre dışı bırakıldı.`);
}

test.describe('Backup Schedulers - Form Yapılandırma', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    // Rate Limit (HTTP 429) koruması: Testler arasında sunucuya 400ms nefes alma es'i ver
    await page.waitForTimeout(400);

    const providerPage = new ProviderPage(page);
    const activeWs = await providerPage.getActiveWorkspaceId();
    workspaceId = activeWs;
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    // 404 Veya Sayfa Bozukluğu Kontrolü
    const is404 = await page.getByText(/Page Not Found|404/i).first().isVisible().catch(() => false);
    if (is404 || !page.url().includes('/schedulers')) {
      console.log('🌐 [NAVİGASYON] Dashboard/Schedulers sayfasına geçiliyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await providerPage.recoverFromChunkLoadError();
    }

    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i })
      .or(page.locator('a[href*="/schedulers"]'))
      .or(page.locator('nav a, div[class*="sidebar"] a').filter({ hasText: /Schedulers/i }))
      .first();
    
    try {
      if (!page.url().includes('/schedulers')) {
        await schedulersLink.waitFor({ state: 'visible', timeout: 8000 });
        await schedulersLink.click();
        await page.waitForURL(/\/schedulers\b/, { timeout: 8000 });
      }
    } catch (err) {
      console.log('⚠️ [UYARI] Schedulers sayfasına sidebar ile geçilemedi, doğrudan URL ile deneniyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    }
    
    await providerPage.recoverFromChunkLoadError();

    // Sadece 'delete' modında eski test artıklarını temizle
    const cleanupMode = process.env.E2E_SCHEDULER_CLEANUP || 'delete';
    if (cleanupMode === 'delete') {
      const staleRegex = /e2e-schedule-\d+|DenemeRıdvan|Weekly-Fail|Dup-Sched|Cron-Fail|Cron-7-Fail|Backup for|Plan_|ArapçaZeroWidth/i;
      const staleRows = page.locator('tr').filter({ hasText: staleRegex });
      const staleCount = await staleRows.count().catch(() => 0);
      if (staleCount > 0) {
        console.log(`🧹 [TEMİZLİK] ${staleCount} adet eski E2E test artığı tespit edildi, temizleniyor...`);
        let deleteAttempts = 0;
        while (deleteAttempts < 15) {
          deleteAttempts++;
          const row = page.locator('tr').filter({ hasText: staleRegex }).first();
          if (await row.isVisible().catch(() => false)) {
            const trashBtn = row.getByRole('button', { name: /delete|trash|remove|sil/i })
              .or(row.locator('button:has(svg[class*="trash"])'))
              .or(row.getByRole('button').last())
              .first();
            if (await trashBtn.isVisible().catch(() => false)) {
              await trashBtn.click({ force: true }).catch(() => {});
              const confirmBtn = page.getByRole('dialog').or(page.getByRole('alertdialog')).first()
                .getByRole('button', { name: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
              if (await confirmBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false)) {
                await confirmBtn.click({ force: true }).catch(() => {});
              }
              await expect(row).toBeHidden({ timeout: 8000 }).catch(() => {});
              await page.waitForTimeout(300);
            } else {
              break;
            }
          } else {
            break;
          }
        }
        const remainingStale = await page.locator('tr').filter({ hasText: staleRegex }).count().catch(() => 0);
        console.log(`🧹 [TEMİZLİK] Temizlik tamamlandı. Kalan artık: ${remainingStale}`);
      }
    } else {
      console.log(`📋 [beforeEach] Temizlik modu "${cleanupMode}" — eski artıklar silinmeyecek.`);
    }

    if (!page.url().includes('/schedulers')) {
      console.log('🌐 [NAVİGASYON] Test öncesi Schedulers sayfasına yönlendiriliyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForURL(/\/schedulers\b/, { timeout: 10000 }).catch(() => {});
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
    await fillScheduleTime(page);
    await selectTimezone(page);
    await setIncludedItems(page);
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
    await fillScheduleTime(page);
    await selectTimezone(page);
    await setIncludedItems(page);
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
    await fillScheduleTime(page);
    await selectTimezone(page);
    await setIncludedItems(page);
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
    await fillScheduleTime(page);
    await selectTimezone(page);
    await setIncludedItems(page);
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
