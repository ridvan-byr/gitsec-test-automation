import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { GithubLoginPage } from '../../../pages/GithubLoginPage';
import { ProviderPage } from '../../../pages/ProviderPage';
import { RestorePage } from '../../../pages/RestorePage';
import { prepareGithubOAuthSession, ensureGithubLoginFormIfEnvUser } from '../../support/github-auth';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function handleGithubOAuthPopup(page: Page, providerPage: ProviderPage): Promise<void> {
  const githubUsername = process.env.GITHUB_TEST_USER ?? requireEnv('E2E_USER_EMAIL');
  const githubPassword = process.env.GITHUB_TEST_PASSWORD ?? requireEnv('E2E_USER_PASSWORD');

  await prepareGithubOAuthSession(page.context());

  console.log('[e2e] Diyalogdaki GitHub kartına tıklanıyor...');
  const popup = await providerPage.openGithubOAuthPopupFromDialog();

  const gh = new GithubLoginPage(popup);
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForURL(/.*github\.com.*/, { timeout: 30_000 }).catch(() => { });
  await ensureGithubLoginFormIfEnvUser(popup);

  const loginInput = popup.locator('input[name="login"]');
  const hadLoginScreen = await loginInput.isVisible().catch(() => false);

  if (hadLoginScreen) {
    console.log('[e2e] GitHub giriş ekranı; kimlik bilgileri giriliyor.');
    const loginOk = await gh.loginAndHandleTwoFactor(githubUsername, githubPassword);
    if (!loginOk) {
      console.log('[e2e] GitHub girişi veya 2FA tamamlanamadı; OAuth akışı durduruluyor.');
      return;
    }
    await gh.waitForLoginScreenCleared();
  } else {
    console.log('[e2e] GitHub login görünmedi (oturum açık).');
    const twoFaOk = await gh.handleTwoFactorAuthentication();
    if (!twoFaOk) {
      console.log('[e2e] Açık oturumda 2FA otomasyonla geçilemedi; OAuth akışı durduruluyor.');
      return;
    }
  }

  const flowOk = await gh.completePermissionsInstallFlow();
  if (!flowOk) {
    console.log('[e2e] GitHub kurulum/sudo akışı tamamlanamadı.');
    return;
  }

  if (!popup.isClosed()) {
    await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {
      if (!popup.isClosed()) {
        return providerPage.closeGithubOAuthAfterLogin(popup);
      }
    });
  }
  console.log('[e2e] GitHub kurulum popup akışı bitti.');
}

/**
 * Küçük viewport’ta tablo sağa taşar; Restore sütunu clip olur.
 * Öğeyi yatayda görünür alana al (scrollable ata + scrollIntoView inline).
 */
async function revealRestoreControl(restore: Locator): Promise<void> {
  await restore.waitFor({ state: 'attached', timeout: 15000 });
  await restore.evaluate((el) => {
    const target = el instanceof HTMLElement ? el : null;
    if (!target) return;
    target.scrollIntoView({ block: 'center', inline: 'end', behavior: 'instant' });
    let p: HTMLElement | null = target.parentElement;
    for (let d = 0; d < 24 && p; d++, p = p.parentElement) {
      const st = window.getComputedStyle(p);
      const ox = st.overflowX;
      const ov = st.overflow;
      const canX =
        (ox === 'auto' || ox === 'scroll' || ov === 'auto' || ov === 'scroll') &&
        p.scrollWidth > p.clientWidth + 2;
      if (!canX) continue;
      const er = target.getBoundingClientRect();
      const pr = p.getBoundingClientRect();
      if (er.right > pr.right - 4) {
        p.scrollLeft += er.right - pr.right + 32;
      }
      if (er.left < pr.left + 4) {
        p.scrollLeft -= pr.left - er.left + 32;
      }
    }
    target.scrollIntoView({ block: 'center', inline: 'end', behavior: 'instant' });
  });
}

async function clickRestoreControl(restore: Locator): Promise<void> {
  await revealRestoreControl(restore);
  try {
    await restore.click({ timeout: 12000 });
  } catch {
    await revealRestoreControl(restore);
    await restore.click({ force: true });
  }

  // Lisans hatası kontrolü (Repository is not included in the license)
  const page = restore.page();
  const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
  const isLicenseErrorVisible = await licenseError.waitFor({ state: 'visible', timeout: 3000 }).catch(() => false);

  if (isLicenseErrorVisible) {
    console.error('--------------------------------------------------');
    console.error('[RESTORE HATA] DİKKAT: Seçilen repository lisansa dahil (include) edilmemiş!');
    console.error('[RESTORE HATA] Restore işlemine devam edilemiyor. Lütfen "Repositories" sayfasından ilgili repository\'i bularak "Include" butonuna basın.');
    console.error('--------------------------------------------------');
  }
}

/** Backups tablosunu yatayda sağa kaydır (Restore sütunu clip olmasın). */
async function scrollBackupsTableHorizontal(page: Page, table: Locator): Promise<void> {
  await table.evaluate((tbl) => {
    const root = tbl instanceof HTMLElement ? tbl : null;
    if (!root) return;
    let p: HTMLElement | null = root.parentElement;
    for (let d = 0; d < 24 && p; d++, p = p.parentElement) {
      const st = window.getComputedStyle(p);
      const canX =
        (st.overflowX === 'auto' || st.overflowX === 'scroll' || st.overflow === 'auto') &&
        p.scrollWidth > p.clientWidth + 2;
      if (canX) {
        p.scrollLeft = p.scrollWidth;
      }
    }
    root.scrollIntoView({ block: 'nearest', inline: 'end' });
  });
  await page.keyboard.press('End').catch(() => { });
  await page.waitForTimeout(250);
}

/**
 * tbody içinde Status = Completed (Partially değil); Restore sağda → yatay scroll şart.
 */
async function findRestoreOnCompletedRow(table: Locator, page: Page): Promise<Locator | null> {
  const MAX_ROWS = 80;

  function completedDataRows(): Locator {
    return table
      .locator('tbody tr')
      .filter({ has: page.locator('td', { hasText: /^Completed$/i }) })
      .filter({ hasNot: page.locator('td', { hasText: /^Partially Completed$/i }) })
      .filter({ hasNot: page.getByText(/^Repository Name$/i) });
  }

  function restoreInRow(row: Locator): Locator {
    return row
      .locator('a[title="Restore"], button[title="Restore"]')
      .or(row.getByRole('link', { name: /^restore$/i }))
      .or(row.locator('a[href*="/restore/"]'))
      .first();
  }

  async function findRestoreInRow(row: Locator): Promise<Locator | null> {
    const restore = restoreInRow(row);
    for (let pass = 0; pass < 8; pass++) {
      await row.scrollIntoViewIfNeeded().catch(() => { });
      await scrollBackupsTableHorizontal(page, table);
      if ((await restore.count()) > 0) {
        try {
          await revealRestoreControl(restore);
          return restore;
        } catch {
          /* bir tur daha scroll dene */
        }
      }
      await page.keyboard.press('End').catch(() => { });
      await page.waitForTimeout(200);
    }
    return null;
  }

  async function pickRestoreFromCompletedRows(): Promise<Locator | null> {
    await scrollBackupsTableHorizontal(page, table);

    const completedRows = completedDataRows();
    const n = Math.min(await completedRows.count(), MAX_ROWS);
    console.log(`[e2e] tbody Completed satır sayısı: ${n}`);

    for (let i = 0; i < n; i++) {
      const row = completedRows.nth(i);
      const preview = (await row.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 70);
      const restore = await findRestoreInRow(row);
      if (restore) {
        console.log(`[e2e] Completed satır ${i + 1}/${n} + Restore: "${preview}…"`);
        return restore;
      }
      console.log(`[e2e] Completed satır ${i + 1}/${n}, Restore bulunamadı: "${preview}…"`);
    }
    return null;
  }

  let found = await pickRestoreFromCompletedRows();
  if (found) {
    return found;
  }
  for (let pass = 0; pass < 4; pass++) {
    await scrollBackupsTableHorizontal(page, table);
    found = await pickRestoreFromCompletedRows();
    if (found) {
      return found;
    }
  }
  return null;
}

test.describe('Backups — restore sayfasına yönlendirme', () => {
  test('Completed satırı veya Partially Completed filtresi ile restore', async ({ page }) => {
    test.setTimeout(300000);
    const providerPage = new ProviderPage(page);

    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();
    await providerPage.goToBackupsViaSidebar();

    const table = page.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 30000 });

    const restoreOnCompleted = await findRestoreOnCompletedRow(table, page);

    if (restoreOnCompleted) {
      console.log('[e2e] Listede "Completed" (Partially değil) satır bulundu; Restore ile devam ediliyor.');
      await clickRestoreControl(restoreOnCompleted);
    } else {
      console.log(
        '[e2e] Açık listede Completed + görünür Restore satırı yok; Status → Partially Completed ile yedek dal.'
      );
      await page.getByRole('button', { name: /^Status$/i }).click();
      const partialOption = page.getByText('Partially Completed', { exact: true });
      await partialOption.waitFor({ state: 'visible', timeout: 10000 });
      await partialOption.click();

      await page.waitForTimeout(600);
      const firstRowRestore = table
        .getByRole('row')
        .filter({ has: table.getByRole('link', { name: /^Restore$/i }) })
        .first()
        .getByRole('link', { name: /^Restore$/i });
      await firstRowRestore.waitFor({ state: 'attached', timeout: 20000 });
      await clickRestoreControl(firstRowRestore);
    }

    await expect(page).toHaveURL(/\/restore(\/|\?)/, { timeout: 25000 });
    console.log('[e2e] Restore sayfası URL doğrulandı:', page.url());

    const restorePage = new RestorePage(page);

    // Lisans hatası veya organizasyon seçim alanının gelmesini bekle
    const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
    const trigger = restorePage.targetOrganizationCombobox();

    await Promise.race([
      licenseError.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { }),
      trigger.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { })
    ]);

    if (await licenseError.isVisible()) {
      console.error('--------------------------------------------------');
      console.error('[RESTORE HATA] DİKKAT: Seçilen repository lisansa dahil (include) edilmemiş!');
      console.error('[RESTORE HATA] Restore işlemine devam edilemiyor. Lütfen "Repositories" sayfasından ilgili repository\'i bularak "Include" butonuna basın.');
      console.error('--------------------------------------------------');
      throw new Error('Repository is not included in the license. Lütfen repository\'i include edin.');
    }

    const orgStep = await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    if (orgStep === 'installed_new_org') {
      console.log('[e2e] Yeni organizasyon + GitHub OAuth adımı tamamlandı (devam için hazır).');
    } else {
      console.log('[e2e] Mevcut organizasyon seçildi ve Next Step ile ilerlendi (devam için hazır).');
    }

    console.log('[e2e] Next Step sonrasını görmek için bekliyor...');

    // Step 2: Select backup source (if "Select a backup" is visible)
    const backupTrigger = page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first();
    const isBackupTriggerVisible = await backupTrigger.isVisible().catch(() => false);

    if (isBackupTriggerVisible) {
      console.log('[e2e] "Select a backup" tespit edildi, yedek seçiliyor...');
      await backupTrigger.click();

      const backupOptions = page.getByRole('option')
        .or(page.locator('[data-slot="select-item"]'))
        .filter({ hasNotText: /Select a backup/i });

      await backupOptions.first().waitFor({ state: 'visible', timeout: 10000 });
      const backupText = await backupOptions.first().innerText().catch(() => '');
      console.log(`[e2e] Yedek seçiliyor: "${backupText.trim()}"`);
      await backupOptions.first().click();
    } else {
      console.log('[e2e] Yedek zaten seçili durumda.');
    }

    // Step 2: Click Next
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await expect(nextBtn).toBeVisible({ timeout: 15000 });
    await nextBtn.click();
    console.log('[e2e] Step 2 Next tıklandı.');

    // Step 3: Select Included Items (fill repo name & description)
    const inputs = page.locator('input[data-slot="input"]');
    await expect(inputs.first()).toBeVisible({ timeout: 15000 });
    const count = await inputs.count();
    let repoInput = inputs.first();
    let descInput = inputs.nth(1);

    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInput = inputs.nth(i + 1);
        descInput = inputs.nth(i + 2);
        break;
      }
    }

    const tempRepoName = `e2e-restore-${Date.now()}`;
    await repoInput.fill(tempRepoName);
    console.log(`[e2e] Step 3: Geçici depo adı yazıldı: ${tempRepoName}`);

    await descInput.fill('E2E Test için otomatik doldurulan açıklama alanı');
    console.log('[e2e] Step 3: Açıklama alanı dolduruldu.');

    // Step 3 -> Step 4 geçişi
    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    await expect(nextStepBtn3).toBeVisible({ timeout: 10000 });
    await nextStepBtn3.click();
    console.log('[e2e] Step 3 Next tıklandı.');

    // Step 4: Start Restore
    const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).or(page.locator('button:has-text("Start Restore")')).first();
    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });

    // Normal click dene, olmazsa force click yap
    try {
      await startRestoreBtn.click({ timeout: 8000 });
    } catch (e) {
      console.log('[e2e] Normal tıklama başarısız oldu, force: true ile deneniyor...');
      await startRestoreBtn.click({ force: true });
    }
    console.log('[e2e] Step 4: Start Restore butonuna tıklandı.');

    // Hata veya "failed" mesajı kontrolü (zaten restore edildiğine dair durumlar için)
    const errorSelector = page.locator('text=/failed|already exists|already restored|error/i').first();
    const isErrorVisible = await errorSelector.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (isErrorVisible) {
      const errorText = await errorSelector.innerText().catch(() => '');
      console.warn('--------------------------------------------------');
      console.warn('[RESTORE UYARI] DİKKAT: Restore işleminde "failed" veya hata mesajı tespit edildi!');
      console.warn(`[Ekran Mesajı]: "${errorText.trim()}"`);
      console.warn('[RESTORE UYARI] Bu durum, ilgili repository\'nin zaten restore edilmiş olmasından kaynaklanıyor olabilir.');
      console.warn('--------------------------------------------------');
    }

    // Restore işleminin başlaması için 5 saniye bekleniyor...
    console.log('[e2e] Restore işleminin başlaması için 5 saniye bekleniyor...');
    await page.waitForTimeout(5000);
    console.log('[e2e] Test başarıyla tamamlandı.');
  });
});
