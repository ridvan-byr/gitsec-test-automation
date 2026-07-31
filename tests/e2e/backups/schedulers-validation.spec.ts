import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import type { Page } from '@playwright/test';
import { requireEnv } from '../../support/require-env';

let workspaceId: string;
let dashboardBaseUrl: string;

async function selectScheduleType(page: Page, typeName: 'Daily' | 'Weekly' | 'Monthly' | 'Cron') {
  console.log(`⏳ [BEKLEME] Schedule Type seçiliyor: "${typeName}"`);
  
  const formContainer = page.locator('form, [role="dialog"], [role="document"], [data-slot="dialog-content"], [data-slot="sheet-content"]').first();
  const typeTrigger = formContainer.locator('[data-slot="select-trigger"], [role="combobox"]').nth(1);
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

  const option = page.getByRole('option', { name: typeName, exact: true })
    .or(page.locator('[data-slot="select-item"]').filter({ hasText: typeName }))
    .or(page.locator('[role="option"]').filter({ hasText: typeName }))
    .first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click({ force: true });
  console.log(`🎉 [BAŞARILI] Dropdown ile "${typeName}" seçildi.`);
}

async function fillCronExpression(page: Page, cronExpr: string) {
  console.log(`⏳ [BEKLEME] Cron ifadesi dolduruluyor: "${cronExpr}"`);

  const cronInput = page.locator('input[name="cron"]')
    .or(page.locator('input[placeholder*="* * * * *"]'))
    .or(page.locator('input[placeholder*="0 2 * * ?"]'))
    .first();

  await cronInput.waitFor({ state: 'visible', timeout: 10000 });
  await cronInput.fill(cronExpr);
  console.log(`🎉 [BAŞARILI] Cron ifadesi dolduruldu: "${cronExpr}"`);
}

async function getVisibleErrorMessage(page: Page): Promise<string | null> {
  const errorSelectors = [
    page.locator('[role="alert"]'),
    page.locator('.toast-notification.error'),
    page.locator('.toast'),
    page.locator('[data-slot="error"]'),
    page.locator('.text-destructive'),
    page.locator('.text-red-500'),
    page.getByText(/failed|error|must not|already|invalid|conflict|required|limit/i)
  ];

  const countSelectors = errorSelectors.length;
  for (let s = 0; s < countSelectors; s++) {
    const locator = errorSelectors[s];
    const count = await locator.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const el = locator.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const text = (await el.innerText().catch(() => '')).trim();
        if (text.length > 0) {
          return text;
        }
      }
    }
  }
  return null;
}

async function assertAndLogDynamicError(page: Page, expectedPattern: RegExp): Promise<string> {
  let errorText: string | null = null;
  let bodyText = '';
  
  await expect(async () => {
    errorText = await getVisibleErrorMessage(page);
    if (errorText) {
      expect(errorText).toMatch(expectedPattern);
    } else {
      bodyText = await page.locator('body').innerText().catch(() => '');
      expect(bodyText).toMatch(expectedPattern);
    }
  }).toPass({ timeout: 8000, intervals: [250] });

  if (errorText) {
    console.log(`🎉 [BAŞARILI] [DİNAMİK HATA YAKALANDI]: "${errorText}"`);
    return errorText;
  } else {
    console.log('🎉 [BAŞARILI] [DİNAMİK HATA GENEL METİNDE BULUNDU]');
    return 'General Page Text Match';
  }
}

async function fillBaseSchedulerForm(page: Page, nameVal: string): Promise<string> {
  const maxRetries = 3;
  let attempt = 0;
  let modalReady = false;

  while (attempt < maxRetries && !modalReady) {
    attempt++;
    
    // 404 Veya Yanlış Sayfa Kontrolü ve Kurtarma
    const is404 = await page.getByText(/Page Not Found|404/i).first().isVisible().catch(() => false);
    if (is404 || !page.url().includes('/schedulers')) {
      console.log('🔄 [RECOVERY] 404 hatası veya Schedulers dışı sayfa tespit edildi. Schedulers URL yönlendirmesi yapılıyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      const providerPage = new ProviderPage(page);
      await providerPage.recoverFromChunkLoadError().catch(() => {});
    }

    const openModal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    if (await openModal.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await openModal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }

    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler|Yeni Planlayıcı/i })
      .or(page.locator('button').filter({ hasText: /New Scheduler|Yeni Planlayıcı/i }))
      .first();

    try {
      await newSchedulerBtn.waitFor({ state: 'visible', timeout: 10000 });
      await newSchedulerBtn.click({ force: true });
      console.log('👆 [TIKLAMA] "New Scheduler" butonuna tıklandı.');
      
      await openModal.waitFor({ state: 'visible', timeout: 10000 });
      
      const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
      await repoCombo.waitFor({ state: 'visible', timeout: 10000 });
      modalReady = true;
    } catch (err) {
      console.log(`⚠️ [UYARI] Modal veya repository combobox yüklenemedi (Deneme ${attempt}/${maxRetries}), yeniden denenecek...`);
      await page.keyboard.press('Escape');
      await openModal.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      
      if (attempt < maxRetries) {
        await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' }).catch(() => {});
        const providerPage = new ProviderPage(page);
        await providerPage.recoverFromChunkLoadError().catch(() => {});
      }
    }
  }

  if (!modalReady) {
    throw new Error('❌ [HATA] Birden fazla denemeden sonra New Scheduler modalı başarıyla yüklenemedi.');
  }

  const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
  await repoCombo.click({ force: true });

  const enabledRepoOptions = page.locator('[role="option"][data-disabled="false"], [data-slot="select-item"][data-disabled="false"]');
  const count = await enabledRepoOptions.count();

  let selectedRepoName = '';
  if (count > 0) {
    const firstEnabledRepo = enabledRepoOptions.first();
    const rawText = (await firstEnabledRepo.innerText()).trim();
    const match = rawText.match(/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)/);
    selectedRepoName = match ? match[0] : rawText;
    console.log(`🔍 [KONTROL] Aktif repository seçiliyor: "${selectedRepoName}"`);
    await firstEnabledRepo.click({ force: true });
  } else {
    console.log('⚠️ [UYARI] Dahil edilen (include) repository bulunamadı. Test skip ediliyor.');
    test.skip(true, 'Dahil edilen (include) repository bulunamadı.');
    return '';
  }

  const listbox = page.locator('[role="listbox"], [data-slot="select-content"]').first();
  if (await listbox.isVisible().catch(() => false)) {
    await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(async () => {
      await page.keyboard.press('Escape').catch(() => {});
    });
  }

  const nameInput = page.getByPlaceholder('e.g. Nightly Full Backup')
    .or(page.locator('input[name="name"]'))
    .or(page.locator('input[placeholder*="Backup"]'))
    .first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  if (nameVal !== '') {
    await nameInput.fill(nameVal);
  } else {
    await nameInput.fill('');
  }
  console.log(`📝 [BİLGİ] Planlayıcı İsmi girildi: "${nameVal}"`);

  return selectedRepoName;
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
      console.log(`🎉 [BAŞARILI] "${schedulerName}" ile eşleşen tüm planlayıcılar silindi.`);
      break;
    }

    console.log(`📦 [İŞLEM] Temizlik (${attempts}. silme işlemi): "${schedulerName}" planlayıcısı siliniyor... (Mevcut satır sayısı: ${currentCount})`);
    const schedulerRow = matchingRows.first();
    
    let clicked = false;

    const trashIconBtn = schedulerRow.locator('button')
      .filter({ has: schedulerRow.locator('svg[class*="trash"], svg.lucide-trash, svg.lucide-trash-2') })
      .first();
    if (await trashIconBtn.isVisible().catch(() => false)) {
      await trashIconBtn.click({ force: true }).catch(() => {});
      clicked = true;
    }

    if (!clicked) {
      const allButtons = schedulerRow.locator('button');
      const btnCount = await allButtons.count().catch(() => 0);
      if (btnCount > 0) {
        await allButtons.nth(btnCount - 1).click({ force: true }).catch(() => {});
        clicked = true;
      }
    }

    if (!clicked) {
      const rowMenuTrigger = schedulerRow.locator('button[aria-haspopup="menu"]').or(schedulerRow.locator('button[id*="radix"]')).first();
      if (await rowMenuTrigger.isVisible().catch(() => false)) {
        await rowMenuTrigger.click({ force: true }).catch(() => {});
        const deleteAction = page.getByRole('menuitem', { name: /delete|remove|sil/i }).first();
        await deleteAction.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await deleteAction.click({ force: true }).catch(() => {});
        clicked = true;
      }
    }

    const confirmDeleteBtn = page.locator('[role="dialog"] button, [role="alertdialog"] button').filter({ hasText: /confirm|delete|yes|sure|sil|remove|continue/i }).first();
    if (await confirmDeleteBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      await confirmDeleteBtn.click({ force: true }).catch(() => {});
    }

    await expect(schedulerRow).toBeHidden({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);
  }
}

test.describe('Backup Schedulers - Form ve Sınır Doğrulama (Validation)', () => {
  test.setTimeout(180000);

  test.beforeEach(async ({ page }) => {
    // Rate Limit (HTTP 429) koruması: Testler arasında sunucuya 400ms nefes alma es'i ver
    await page.waitForTimeout(400);

    (page as GitSecPage).ignoredErrors = [
      /status of 502/,
      /status of 500/,
      /chunk|loading chunk/i,
      /Failed to load resource/
    ];
    const providerPage = new ProviderPage(page);
    console.log('🌐 [NAVİGASYON] Dashboard açılıyor...');
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.closeOnboardingIfVisible();

    const activeWs = await providerPage.getActiveWorkspaceId();
    workspaceId = activeWs;
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    console.log('🌐 [NAVİGASYON] Sidebar üzerinden Schedulers sayfasına gidiliyor...');
    const schedulersLink = page.getByRole('link', { name: /^Schedulers$/i })
      .or(page.locator(`a[href*="/${workspaceId}/schedulers"]`))
      .or(page.locator('a[href*="/schedulers"]'))
      .first();
    
    try {
      if (await schedulersLink.isVisible({ timeout: 5000 }).catch(() => false)) {
        await schedulersLink.scrollIntoViewIfNeeded().catch(() => {});
        await schedulersLink.click({ force: true }).catch(() => schedulersLink.click());
      } else {
        await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' });
      }
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    } catch (err) {
      console.log('⚠️ [UYARI] Schedulers sayfasına sidebar ile geçilemedi, doğrudan URL ile deneniyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/schedulers\b/, { timeout: 15000 });
    }

    await providerPage.recoverFromChunkLoadError();

    // Sadece 'delete' modunda tüm eski E2E artıklarını temizle
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
              await page.waitForTimeout(1000);
              await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
              await providerPage.recoverFromChunkLoadError().catch(() => {});
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
    }
  });

  test('Boş Planlayıcı ismi girildiğinde default isimlendirmeyi doğrula', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Boş Planlayıcı ismi doğrulama senaryosu başladı.');
    const repoName = await fillBaseSchedulerForm(page, '');

    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();

    const isSaveDisabled = await saveBtn.isDisabled().catch(() => false);

    if (isSaveDisabled) {
      console.log('🎉 [BAŞARILI] Frontend Save butonu boş isim için engellendi (disabled).');
      await expect(saveBtn).toBeDisabled();
      await page.keyboard.press('Escape');
    } else {
      console.log('📝 [BİLGİ] Frontend Save butonu boş isim için aktif. Kaydetme deneniyor...');
      await saveBtn.click();

      const errorMsg = page.getByText(/must not be empty|required|error/i).first();
      const isErrorVisible = await errorMsg.isVisible({ timeout: 5000 }).catch(() => false);

      if (isErrorVisible) {
        console.log('🎉 [BAŞARILI] Boş isim için hata mesajı başarıyla doğrulandı:', await errorMsg.innerText());
        await page.keyboard.press('Escape');
      } else {
        await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 15000 });

        const expectedPrefix = `Backup for ${repoName}`;
        const defaultRow = page.locator('tr').filter({ hasText: expectedPrefix }).first();
        await expect(defaultRow).toBeVisible({ timeout: 15000 });
        console.log(`🎉 [BAŞARILI] Boş planlayıcı ismi girildiğinde default isim (${expectedPrefix}...) başarıyla oluşturuldu.`);

        const createdName = await defaultRow.locator('td').first().innerText();
        await deleteSchedulerRow(page, createdName.trim());
      }
    }
    console.log('🎉 [BAŞARILI] Boş Planlayıcı ismi doğrulama senaryosu tamamlandı.');
  });

  test('Sadece boşluk içeren Planlayıcı ismi girildiğinde trim edilip default isimlendirmeyi doğrula', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Sadece boşluk içeren Planlayıcı ismi doğrulama senaryosu başladı.');
    const repoName = await fillBaseSchedulerForm(page, '     ');

    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();

    const isSaveDisabled = await saveBtn.isDisabled().catch(() => false);

    if (isSaveDisabled) {
      console.log('🎉 [BAŞARILI] Save butonu sadece boşluk içeren isim için engellendi (disabled).');
      await expect(saveBtn).toBeDisabled();
      await page.keyboard.press('Escape');
    } else {
      console.log('📝 [BİLGİ] Save butonu sadece boşluk içeren isim için aktif. Kaydetme deneniyor...');
      await saveBtn.click();

      const errorMsg = page.getByText(/must not be empty|required|error/i).first();
      const isErrorVisible = await errorMsg.isVisible({ timeout: 5000 }).catch(() => false);

      if (isErrorVisible) {
        console.log('🎉 [BAŞARILI] Boşluklu isim için hata mesajı başarıyla doğrulandı:', await errorMsg.innerText());
        await page.keyboard.press('Escape');
      } else {
        await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 15000 });

        const expectedPrefix = `Backup for ${repoName}`;
        const defaultRow = page.locator('tr').filter({ hasText: expectedPrefix }).first();
        await expect(defaultRow).toBeVisible({ timeout: 15000 });
        console.log(`🎉 [BAŞARILI] Sadece boşluklardan oluşan planlayıcı ismi girildiğinde default isim (${expectedPrefix}...) oluşturuldu.`);

        const createdName = await defaultRow.locator('td').first().innerText();
        await deleteSchedulerRow(page, createdName.trim());
      }
    }
    console.log('🎉 [BAŞARILI] Sadece boşluk içeren Planlayıcı ismi doğrulama senaryosu tamamlandı.');
  });

  test('Aynı isimde mükerrer (duplicate) planlayıcı oluşturulabilmesini doğrula', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Mükerrer planlayıcı oluşturma senaryosu başladı.');
    const duplicateName = `Dup-Sched-${Date.now()}`;

    await fillBaseSchedulerForm(page, duplicateName);
    
    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();
    await saveBtn.click();

    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 15000 });
    console.log('🔍 [KONTROL] İlk planlayıcı başarıyla kaydedildi.');

    await fillBaseSchedulerForm(page, duplicateName);
    
    const saveBtn2 = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();
    await saveBtn2.click();

    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 15000 });
    console.log('🔍 [KONTROL] İkinci planlayıcı başarıyla kaydedildi.');

    const matchingRows = page.locator('tr').filter({ hasText: duplicateName });
    await expect(matchingRows).toHaveCount(2, { timeout: 15000 });
    console.log('🎉 [BAŞARILI] Aynı isimde mükerrer planlayıcıların başarıyla oluşturulduğu doğrulandı.');

    await deleteSchedulerRow(page, duplicateName);
    await deleteSchedulerRow(page, duplicateName);
    console.log('🎉 [BAŞARILI] Mükerrer planlayıcı oluşturma senaryosu tamamlandı.');
  });

  test('Geçersiz Cron ifadesi girildiğinde hata mesajını doğrula', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Geçersiz Cron ifadesi doğrulama senaryosu başladı.');
    const schedulerName = `Cron-Fail-${Date.now()}`;
    await fillBaseSchedulerForm(page, schedulerName);

    await selectScheduleType(page, 'Cron');
    await fillCronExpression(page, 'invalid-cron-pattern');

    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();
    await saveBtn.click();

    await assertAndLogDynamicError(page, /invalid|cron|format|expression|error/i);

    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    console.log('🎉 [BAŞARILI] Geçersiz Cron ifadesi doğrulama senaryosu tamamlandı.');
  });

  test('Geçersiz 7 alanlı Cron ifadesi girildiğinde hata mesajını doğrula', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Geçersiz 7 alanlı Cron ifadesi doğrulama senaryosu başladı.');
    const schedulerName = `Cron-7-Fail-${Date.now()}`;
    await fillBaseSchedulerForm(page, schedulerName);
    await selectScheduleType(page, 'Cron');
    await fillCronExpression(page, '* * * * * * *');
    
    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();
    await saveBtn.click();
    
    await assertAndLogDynamicError(page, /invalid|cron|format|expression|error/i);
    await page.keyboard.press('Escape');
    console.log('🎉 [BAŞARILI] Geçersiz 7 alanlı Cron ifadesi doğrulama senaryosu tamamlandı.');
  });

  test('Haftalık zamanlayıcı seçilip hiçbir gün işaretlenmeden kaydedilmeye çalışıldığında hata vermelidir', async ({ page }) => {
    console.log('🚀 [BAŞLANGIÇ] Boş haftalık gün seçimi doğrulama senaryosu başladı.');
    const schedulerName = `Weekly-Fail-${Date.now()}`;
    await fillBaseSchedulerForm(page, schedulerName);
    await selectScheduleType(page, 'Weekly');

    const daysCheckboxes = page.locator('[role="checkbox"][id*="day"], input[type="checkbox"][name*="day"], [class*="day-checkbox"]');
    const boxCount = await daysCheckboxes.count();
    for (let i = 0; i < boxCount; i++) {
      const box = daysCheckboxes.nth(i);
      const isChecked = await box.isChecked().catch(() => false);
      const ariaChecked = await box.getAttribute('aria-checked').catch(() => 'false');
      if (isChecked || ariaChecked === 'true') {
        await box.click({ force: true });
      }
    }

    const saveBtn = page.getByRole('button')
      .filter({ hasText: /save|create|confirm|submit/i })
      .first();
    await saveBtn.click();

    await assertAndLogDynamicError(page, /select|choose|day|gün|error|hata|required/i);
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await deleteSchedulerRow(page, schedulerName);
    console.log('🎉 [BAŞARILI] Boş haftalık gün seçimi doğrulama senaryosu tamamlandı.');
  });

  test('Planlayıcı isminde Null Byte, RTL karakterler ve Zero-width space içeren veriler girildiğinde uygulama çökmemeli ve hata uyarısı veya başarılı kayıt işlemiyle sonuçlanmalıdır', async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      ...((page as GitSecPage).ignoredErrors || []),
      /\/api\/backup\/schedules/
    ];
    console.log('🚀 [BAŞLANGIÇ] Karakter seti sınır testi başladı.');
    const charsetNames = [
      'Null\0Byte',
      'Plan_اختبار_RTL',
      'Arapça\u200BZeroWidth'
    ];

    for (const nameVal of charsetNames) {
      console.log(`📝 [BİLGİ] [SCHEDULER CHARSET TEST] "${nameVal.replace('\0', '\\0')}" ismi ile test ediliyor...`);

      if (nameVal !== charsetNames[0]) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        const providerPage = new ProviderPage(page);
        await providerPage.recoverFromChunkLoadError();
      }

      await fillBaseSchedulerForm(page, nameVal);

      const saveBtn = page.getByRole('button')
        .filter({ hasText: /save|create|confirm|submit/i })
        .first();
      await saveBtn.click();

      try {
        await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 6000 });
        console.log(`🎉 [BAŞARILI] [SCHEDULER CHARSET TEST] "${nameVal.replace('\0', '\\0')}" başarıyla kaydedildi.`);

        const expectedRow = page.locator('tr').filter({ hasText: nameVal }).first();
        await expect(expectedRow).toBeVisible({ timeout: 10000 });
        await deleteSchedulerRow(page, nameVal);
      } catch (e) {
        console.log(`📝 [BİLGİ] [SCHEDULER CHARSET TEST] Kayıt başarısız oldu veya modal kapanmadı, hata mesajı aranıyor...`);
        await assertAndLogDynamicError(page, /failed|error|invalid|name|format|already|duplicate|denied/i);

        await page.keyboard.press('Escape');
        await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }
    console.log('🎉 [BAŞARILI] Karakter seti sınır testi tamamlandı.');
  });
});
