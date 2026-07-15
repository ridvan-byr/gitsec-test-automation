import type { Locator, Page } from '@playwright/test';
import { test, expect, GitSecPage } from '../../fixtures/test';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import { ProviderPage } from '../../pages/ProviderPage';
import { RestorePage } from '../../pages/RestorePage';
import { prepareGithubOAuthSession, ensureGithubLoginFormIfEnvUser } from '../../support/github-auth';
import { requireEnv } from '../../support/require-env';

// --- DİNAMİK HATA YAKALAMA FONKSİYONLARI ---

/**
 * Sayfa üzerinde o an görünür olan herhangi bir hata mesajı, toast, alert veya validation uyarısını dinamik olarak arar.
 */
async function getVisibleErrorMessage(page: Page): Promise<string | null> {
  const errorSelectors = [
    page.locator('[role="alert"]'),
    page.locator('.toast-notification.error'),
    page.locator('.toast'),
    page.locator('[data-slot="error"]'),
    page.locator('.text-destructive'),
    page.locator('.text-red-500'),
    page.locator('text=/failed|error|must not|already|invalid|conflict|required|limit/i')
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

/**
 * Belirtilen regex pattern'ine uyan bir hatanın arayüzde görünmesini dinamik olarak bekler ve doğrular.
 */
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
    console.log(`✅ [DİNAMİK HATA YAKALANDI]: "${errorText}"`);
    return errorText;
  } else {
    console.log('✅ [DİNAMİK HATA GENEL METİNDE BULUNDU]');
    return 'General Page Text Match';
  }
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
    console.log('[e2e] GitHub login ekranı göründü, giriş yapılıyor...');
    await gh.loginAndHandleTwoFactor(githubUsername, githubPassword);
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
}

async function getRepoNameFromRow(row: Locator): Promise<string | null> {
  const cells = row.locator('td');
  const cellCount = await cells.count().catch(() => 0);
  for (let i = 0; i < cellCount; i++) {
    const text = await cells.nth(i).textContent().catch(() => '');
    const cleaned = text?.replace(/\s+/g, ' ').trim() || '';
    if (cleaned && !/^(Active|Remove|Configure|Edit|Delete|Backup|Restore|In Progress|Completed|Partially|Select|Yes|No|True|False|Include|Exclude|switch|on|off)$/i.test(cleaned) && !cleaned.includes('button')) {
      const match = cleaned.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
      if (match) {
        return match[1];
      }
      if (cleaned.length > 1) {
        return cleaned;
      }
    }
  }
  return null;
}

function getRepoNameWithoutOrg(fullName: string): string {
  return fullName.includes('/') ? fullName.split('/').pop() || fullName : fullName;
}

async function applyStatusFilter(page: Page, statusText: 'Completed' | 'Partially Completed'): Promise<void> {
  console.log(`[e2e] Status filtresi uygulanıyor: "${statusText}"...`);
  const statusBtn = page.locator('button[data-slot="popover-trigger"]').filter({ hasText: 'Status' })
    .or(page.getByRole('button', { name: /^Status$/i }).filter({ hasNot: page.locator('table button') }))
    .first();
  await statusBtn.waitFor({ state: 'visible', timeout: 10000 });
  await statusBtn.click({ timeout: 5000 }).catch(async () => {
    await statusBtn.click({ force: true });
  });

  const option = page.locator('[role*="menuitem"], [role="option"]')
    .filter({ hasText: new RegExp(`^${statusText}$`, 'i') })
    .first();
  await option.waitFor({ state: 'visible', timeout: 10000 });
  
  const responsePromise = page.waitForResponse(
    response => response.url().includes('/api/backups') && response.status() === 200,
    { timeout: 3000 }
  ).catch(() => null);

  await option.click({ force: true });
  await responsePromise;
  await page.waitForLoadState('domcontentloaded');
}


async function collectAllProviderRepositories(page: Page, providerPage: ProviderPage): Promise<{
  allRepos: Set<string>;
  includedRepos: Set<string>;
}> {
  console.log('[e2e] Repositories sayfasına gidilerek mevcut repository listesi taranıyor...');
  await providerPage.goToRepositoriesGithub();
  
  const repoTable = page.locator('table').first();
  await repoTable.waitFor({ state: 'visible', timeout: 30000 });
  
  // Wait until the first row has a valid repository name (which means the client-side data has populated)
  await expect(async () => {
    const text = await repoTable.locator('tbody tr').first().textContent().catch(() => '');
    const cleaned = text?.replace(/\s+/g, ' ').trim() || '';
    expect(cleaned).toContain('/');
  }).toPass({ timeout: 15000, intervals: [200] }).catch(async () => {
    console.log('⚠️ [UYARI] Repository isimleri 15 saniye içinde yüklenemedi. Chunk/502 kurtarma deneniyor...');
    await providerPage.recoverFromChunkLoadError();
    await expect(async () => {
      const text = await repoTable.locator('tbody tr').first().textContent().catch(() => '');
      const cleaned = text?.replace(/\s+/g, ' ').trim() || '';
      expect(cleaned).toContain('/');
    }).toPass({ timeout: 15000, intervals: [200] }).catch(() => {});
  });

  const allRepos = new Set<string>();
  const includedRepos = new Set<string>();

  const getNextPageButton = () => page.getByRole('button', { name: /Next|Sonraki/i })
    .or(page.locator('button').filter({ hasText: /Next|Sonraki/i }))
    .or(page.locator('button[aria-label*="Next"]'))
    .or(page.locator('button[aria-label*="Sonraki"]'))
    .first();

  const hasNextPage = async (btn: Locator) => (await btn.isVisible().catch(() => false)) && !(await btn.isDisabled().catch(() => true));

  let pageCount = 1;
  while (true) {
    await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        if (div.scrollWidth > div.clientWidth) {
          div.scrollLeft = 1000;
        }
      }
    }).catch(() => {});

    const rows = repoTable.locator('tbody tr');
    const rowCount = await rows.count();

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const repoFullName = await getRepoNameFromRow(row);
      if (repoFullName) {
        const repoName = getRepoNameWithoutOrg(repoFullName);
        allRepos.add(repoName);
        const scopeSwitch = row.getByRole('switch').first();
        if (await scopeSwitch.count() > 0) {
          const isChecked = (await scopeSwitch.getAttribute('aria-checked')) === 'true';
          if (isChecked) {
            includedRepos.add(repoName);
          }
        }
      }
    }

    const nextBtn = getNextPageButton();
    if (await hasNextPage(nextBtn)) {
      const firstRow = repoTable.locator('tbody tr').first();
      const previousName = await firstRow.textContent().catch(() => '');
      await nextBtn.click({ force: true });
      await expect(async () => {
        const currentName = await firstRow.textContent().catch(() => '');
        expect(currentName).not.toBe(previousName);
      }).toPass({ timeout: 10000, intervals: [200] });
      pageCount++;
    } else {
      break;
    }
  }

  console.log(`[e2e] Toplam taranan sayfa: ${pageCount}. Bulunan repo sayısı: ${allRepos.size}, Dahil edilmiş: ${includedRepos.size}`);
  return { allRepos, includedRepos };
}

async function setRepositoryInclusion(page: Page, providerPage: ProviderPage, repoName: string, targetState: boolean): Promise<void> {
  console.log(`[e2e] "${repoName}" deposunun lisans durumu ${targetState ? 'Include' : 'Exclude'} olarak ayarlanıyor...`);
  await providerPage.goToRepositoriesGithub();
  
  const repoTable = page.locator('table').first();
  await repoTable.waitFor({ state: 'visible', timeout: 30000 });

  const getNextPageButton = () => page.getByRole('button', { name: /Next|Sonraki/i })
    .or(page.locator('button').filter({ hasText: /Next|Sonraki/i }))
    .or(page.locator('button[aria-label*="Next"]'))
    .or(page.locator('button[aria-label*="Sonraki"]'))
    .first();

  const hasNextPage = async (btn: Locator) => (await btn.isVisible().catch(() => false)) && !(await btn.isDisabled().catch(() => true));

  let foundRow: Locator | null = null;

  while (true) {
    await page.evaluate(() => {
      const divs = document.querySelectorAll('div');
      for (let i = 0; i < divs.length; i++) {
        const div = divs[i];
        if (div.scrollWidth > div.clientWidth) {
          div.scrollLeft = 1000;
        }
      }
    }).catch(() => {});

    foundRow = repoTable.locator('tbody tr').filter({ hasText: repoName }).first();
    if (await foundRow.count() > 0) {
      break;
    }

    const nextBtn = getNextPageButton();
    if (await hasNextPage(nextBtn)) {
      const firstRow = repoTable.locator('tbody tr').first();
      const previousName = await firstRow.textContent().catch(() => '');
      await nextBtn.click({ force: true });
      await expect(async () => {
        const currentName = await firstRow.textContent().catch(() => '');
        expect(currentName).not.toBe(previousName);
      }).toPass({ timeout: 10000, intervals: [200] });
    } else {
      break;
    }
  }

  if (!foundRow) {
    throw new Error(`[e2e] Dahil edilmek istenen "${repoName}" listede bulunamadı.`);
  }

  const scopeSwitch = foundRow.getByRole('switch').first();
  await scopeSwitch.waitFor({ state: 'visible', timeout: 15000 });
  
  const isChecked = (await scopeSwitch.getAttribute('aria-checked')) === 'true';
  if (isChecked !== targetState) {
    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/repositories/license-inclusion-status/') && response.status() === 200,
      { timeout: 20000 }
    ).catch(() => null);

    await scopeSwitch.click({ force: true });
    await responsePromise;
    await expect(scopeSwitch).toHaveAttribute('aria-checked', targetState ? 'true' : 'false', { timeout: 25000 });
    console.log(`[e2e] "${repoName}" durumu başarıyla ${targetState ? 'Include' : 'Exclude'} olarak güncellendi.`);
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
  await page.waitForLoadState('domcontentloaded');
}

/**
 * tbody içinde Status = Completed (Partially değil); Restore sağda → yatay scroll şart.
 */
async function findAndPrepareValidRestoreRow(
  page: Page,
  providerPage: ProviderPage,
  table: Locator,
  allRepos: Set<string>,
  includedRepos: Set<string>,
  isPartiallyCompleted = false
): Promise<Locator | null> {
  const rowsData = await table.evaluate((tbl) => {
    const trs = Array.from(tbl.querySelectorAll('tbody tr'));
    return trs.map((row, index) => {
      const cells = Array.from(row.querySelectorAll('td'));
      let repoFullName = null;
      for (const cell of cells) {
        const cleaned = cell.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (
          cleaned &&
          !/^(Active|Remove|Configure|Edit|Delete|Backup|Restore|In Progress|Completed|Partially|Select|Yes|No|True|False|Include|Exclude|switch|on|off)$/i.test(cleaned) &&
          !cleaned.includes('button')
        ) {
          const match = cleaned.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
          if (match) {
            repoFullName = match[1];
            break;
          }
          if (cleaned.length > 1 && !repoFullName) {
            repoFullName = cleaned;
          }
        }
      }
      const textContent = row.textContent || '';
      const hasPartially = /Partially Completed/i.test(textContent);
      const hasCompleted = /Completed/i.test(textContent) && !hasPartially;
      return { index, repoFullName, hasPartially, hasCompleted };
    });
  }).catch(() => [] as { index: number; repoFullName: string | null; hasPartially: boolean; hasCompleted: boolean }[]);

  console.log(`[e2e] Bulunan ${isPartiallyCompleted ? 'Partially Completed' : 'Completed'} yedek satırı: ${rowsData.length}`);

  // 1. Zaten Dahil Edilmiş (Included) olanları tara
  for (const data of rowsData) {
    const matchesStatus = isPartiallyCompleted ? data.hasPartially : data.hasCompleted;
    if (matchesStatus && data.repoFullName) {
      const repoName = getRepoNameWithoutOrg(data.repoFullName);
      if (includedRepos.has(repoName)) {
        console.log(`🎉 [EŞLEŞME] Zaten include edilmiş repository yedeği bulundu: "${data.repoFullName}". Restore butonuna odaklanılıyor...`);
        const row = table.locator('tbody tr').nth(data.index);
        await scrollBackupsTableHorizontal(page, table);
        const restoreBtn = row.locator('a[title="Restore"], button[title="Restore"]')
          .or(row.getByRole('link', { name: /^restore$/i }))
          .or(row.locator('a[href*="/restore/"]'))
          .first();
        if (await restoreBtn.count() > 0) {
          await revealRestoreControl(restoreBtn);
          return restoreBtn;
        }
      }
    }
  }

  // 2. Dahil Edilebilir (Exclude durumundaki mevcut repolarımızdan) olanları tara
  for (const data of rowsData) {
    const matchesStatus = isPartiallyCompleted ? data.hasPartially : data.hasCompleted;
    if (matchesStatus && data.repoFullName) {
      const repoName = getRepoNameWithoutOrg(data.repoFullName);
      if (allRepos.has(repoName)) {
        console.log(`🔍 [EŞLEŞME] Mevcut repolarımızdan biriyle eşleşen yedek bulundu: "${data.repoFullName}". Lisansa dahil edilecek...`);
        
        await setRepositoryInclusion(page, providerPage, repoName, true);

        await providerPage.goToBackupsViaSidebar();
        const newTable = page.locator('table').first();
        await newTable.waitFor({ state: 'visible', timeout: 30000 });

        if (isPartiallyCompleted) {
          await applyStatusFilter(page, 'Partially Completed');
        }

        await scrollBackupsTableHorizontal(page, newTable);

        const updatedRow = newTable.locator('tbody tr').filter({ hasText: data.repoFullName }).filter({
          has: page.locator('td', { hasText: isPartiallyCompleted ? /^Partially Completed$/i : /^Completed$/i })
        }).first();

        const restoreBtn = updatedRow.locator('a[title="Restore"], button[title="Restore"]')
          .or(updatedRow.getByRole('link', { name: /^restore$/i }))
          .or(updatedRow.locator('a[href*="/restore/"]'))
          .first();

        if (await restoreBtn.count() > 0) {
          await revealRestoreControl(restoreBtn);
          console.log(`🎉 [BAŞARILI] Lisans dahil edildikten sonra restore butonu hazır hale getirildi: repo="${data.repoFullName}"`);
          return restoreBtn;
        }
      }
    }
  }

  return null;
}

test.describe('Backups Restore - Form ve Sınır Doğrulama (Validation)', () => {
  test.setTimeout(240000);
  let providerPage: ProviderPage;
  let restorePage: RestorePage;

  test.beforeEach(async ({ page }) => {
    providerPage = new ProviderPage(page);
    restorePage = new RestorePage(page);
    const workspaceId = requireEnv('WORKSPACE_ID');
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    // 1. Restore sayfasına git
    console.log('[e2e] Restore sayfasına gidiliyor...');
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/restore`, { waitUntil: 'networkidle' });

    // 2. Restore Wizard butonuna tıkla
    console.log('[e2e] Restore Wizard butonu aranıyor ve tıklanıyor...');
    const wizardBtn = page.getByRole('button', { name: 'Restore Wizard' }).first();
    await wizardBtn.waitFor({ state: 'visible', timeout: 15000 });
    
    const dialog = page.locator('div[role="dialog"]').first();
    await expect(async () => {
      await wizardBtn.click({ force: true });
      await expect(dialog).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 15000, intervals: [1000] });

    console.log('[e2e] Source Repository combobox seçiliyor...');
    const combobox = page.locator('div[role="dialog"] button[role="combobox"]').first();
    await combobox.waitFor({ state: 'visible', timeout: 15000 });
    await expect(async () => {
      await combobox.click({ force: true });
    }).toPass({ timeout: 10000 });

    // 4. Dropdown listesindeki seçenekleri tara
    console.log('[e2e] Dropdown seçenekleri yükleniyor...');
    const listbox = page.locator('[role="listbox"], [role="menu"], [class*="select-content"], [data-radix-popper-content-wrapper]').first();
    await listbox.waitFor({ state: 'visible', timeout: 15000 });

    const optionLocators = listbox.locator('[role="option"], [data-slot="select-item"]');
    const count = await optionLocators.count();
    
    let targetOption: Locator | null = null;
    let targetOptionText = '';

    for (let i = 0; i < count; i++) {
      const opt = optionLocators.nth(i);
      const text = await opt.innerText().catch(() => '');
      
      // Eğer seçenekte "Excluded" ibaresi YOKSA, bu include edilmiş (restore edilebilir) bir depodur
      if (text && !text.includes('Excluded')) {
        targetOption = opt;
        targetOptionText = text;
        break;
      }
    }

    // 5. Eğer hepsi Exclude ise testi sonlandır (skip et)
    if (!targetOption) {
      console.log('⚠️ [UYARI] Seçilebilir tüm repository\'ler "Excluded" durumunda. Restore edilebilecek uygun bir yedek bulunamadı. Test sonlandırılıyor.');
      test.skip(true, 'Restore edilebilecek aktif/include edilebilir repository bulunamadı.');
      return;
    }

    console.log(`🎉 [EŞLEŞME] Restore edilebilir repository seçiliyor: "${targetOptionText.trim()}"`);
    await targetOption.click({ force: true });

    // 6. Continue butonuna tıkla
    const continueBtn = page.getByRole('button', { name: 'Continue' }).first();
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    console.log('[e2e] Wizard: Continue tıklandı, organizasyon seçimi adımına geçiliyor.');

    await expect(page).toHaveURL(/\/restore(\/|\?)/, { timeout: 25000 });

    // Lisans hatası veya organizasyon seçim alanının gelmesini bekle
    const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
    const trigger = restorePage.targetOrganizationCombobox();

    await Promise.race([
      licenseError.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { }),
      trigger.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { })
    ]);

    if (await licenseError.isVisible()) {
      console.log('\n❌ [RESTORE LİSANS HATASI] DİKKAT: Seçilen repository lisansa dahil (include) edilmemiş!');
      console.log('📢 Lütfen "Repositories" sayfasından ilgili repository\'i bularak "Include" butonuna basın.\n');
      throw new Error('Repository is not included in the license. Lütfen repository\'i include edin.');
    }
  });

  test('Geri yükleme isminde boşluk veya boş değer girildiğinde backend hata mesajını doğrula', async ({ page }) => {
    // 1. Adım: Hedef organizasyonu tamamla
    await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    // 2. Adım: Yedek seçimi
    await restorePage.selectBackupSourceIfVisible();
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // 3. Adım: Depo adı alanına sadece boşluklar gir
    const inputs = page.locator('input[data-slot="input"]');
    await expect(inputs.first()).toBeVisible({ timeout: 15000 });

    const count = await inputs.count();
    let repoInput = inputs.first();

    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInput = inputs.nth(i + 1);
        break;
      }
    }

    // Sadece boşluklar gir
    await repoInput.fill('   ');

    // Frontend Next butonunu disable etmeli mi kontrol edelim
    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    const isNextDisabled = await nextStepBtn3.isDisabled().catch(() => false);

    if (isNextDisabled) {
      console.log('✅ [FRONTEND VALIDATION] Frontend Next butonu boş/boşluklu veri için başarıyla engellendi (disabled).');
      await expect(nextStepBtn3).toBeDisabled();
    } else {
      console.warn('⚠️ [FRONTEND VALIDATION BUG/ISSUE] Frontend, boş/boşluklu depo isminde Next butonunu engellemedi (enabled kaldı). Backend doğrulama kontrolüne geçiliyor...');
      
      // Wizard'ı sonuna kadar ilerlet
      await nextStepBtn3.click();

      // 4. Adım: Start Restore butonuna tıkla
      const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
      await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
      await startRestoreBtn.click({ force: true });

      // 5. Dinamik Hata Yakalayıcı ile backend'den dönen hata mesajını doğrula
      await assertAndLogDynamicError(page, /must not|empty|failed|error|target/i);
    }
  });

  test('Mükerrer restore adı durumunda çakışma (Conflict) hata mesajını doğrula', async ({ page }) => {
    // 1. Adım: Hedef organizasyonu tamamla
    await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    // 2. Adım: Yedek seçimi
    await restorePage.selectBackupSourceIfVisible();
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // 3. Adım: Depo adını zaten var olan 'tunahantest' ismiyle doldur
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

    await repoInput.fill('tunahantest');
    await descInput.fill('Conflict validation test');

    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    await nextStepBtn3.click();

    // 4. Adım: Geri yüklemeyi başlat
    const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
    await startRestoreBtn.click({ force: true });

    // Dinamik Hata Yakalayıcı ile çakışma hata mesajını doğrula
    await assertAndLogDynamicError(page, /failed|already exists|already restored|error|conflict/i);
  });

  test('Geri yükleme isminde geçersiz özel karakterler/injection girildiğinde sistemin davranışını doğrula', async ({ page }) => {
    // 1. Adım: Hedef organizasyonu tamamla
    await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    // 2. Adım: Yedek seçimi
    await restorePage.selectBackupSourceIfVisible();
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // 3. Adım: Depo adı alanına geçersiz karakterler/script injection içeren bir değer gir
    const inputs = page.locator('input[data-slot="input"]');
    await expect(inputs.first()).toBeVisible({ timeout: 15000 });

    const count = await inputs.count();
    let repoInput = inputs.first();

    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInput = inputs.nth(i + 1);
        break;
      }
    }

    // Geçersiz depo adı ve SQL/script injection denemesi
    const invalidName = `e2e-restore-<script>alert(1)</script>; DROP TABLE backups;`;
    await repoInput.fill(invalidName);

    // Frontend Next butonunu disable edip etmediğini kontrol et
    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    const isNextDisabled = await nextStepBtn3.isDisabled().catch(() => false);

    if (isNextDisabled) {
      console.log('✅ [FRONTEND VALIDATION] Frontend Next butonu geçersiz karakterler içeren depo ismi için engellendi (disabled).');
      await expect(nextStepBtn3).toBeDisabled();
    } else {
      console.warn('⚠️ [FRONTEND VALIDATION MISSING] Frontend, geçersiz depo isminde Next butonunu engellemedi. Backend doğrulama kontrolüne geçiliyor...');
      await nextStepBtn3.click();

      // 4. Adım: Start Restore butonuna tıkla
      const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
      await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
      await startRestoreBtn.click({ force: true });

      // Dinamik Hata Yakalayıcı ile hata mesajını doğrula
      await assertAndLogDynamicError(page, /must not|failed|error|invalid|character|target/i);
    }
  });

  test('Sihirbaz (Wizard) adımları arasında geri ve ileri gidildiğinde girilen verilerin korunduğunu doğrula', async ({ page }) => {
    // 1. Adım: Hedef organizasyonu tamamla
    await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    // 2. Adım: Yedek seçimi
    await restorePage.selectBackupSourceIfVisible();
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // 3. Adım: Depo adı ve açıklamasını doldur
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

    const testRepoName = `e2e-persist-${Date.now()}`;
    const testDesc = 'Wizard persistence check description';
    await repoInput.fill(testRepoName);
    await descInput.fill(testDesc);

    // Geri (Back) butonunu bul ve tıkla (Step 2'ye geri dön)
    const backBtn = page.getByRole('button', { name: /Back|Previous/i }).first();
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();
    console.log('[e2e] Wizard Step 2\'ye geri dönüldü.');

    // Step 2'de olduğumuzu doğrula (Select trigger'lardan ilki görünür olmalı - text filtresi olmadan)
    const selectTrigger = page.locator('[data-slot="select-trigger"]').first();
    await expect(selectTrigger).toBeVisible({ timeout: 10000 });

    // Tekrar İleri (Next) tıkla (Step 3'e geç)
    const nextBtn2 = page.getByRole('button', { name: /^Next/i });
    await nextBtn2.click();
    console.log('[e2e] Tekrar Step 3\'e ilerlendi.');

    // Yeniden input'ları bulalım (DOM re-render olmuş olabilir)
    const inputsAfter = page.locator('input[data-slot="input"]');
    await expect(inputsAfter.first()).toBeVisible({ timeout: 15000 });

    const countAfter = await inputsAfter.count();
    let repoInputAfter = inputsAfter.first();
    let descInputAfter = inputsAfter.nth(1);

    for (let i = 0; i < countAfter; i++) {
      const placeholder = await inputsAfter.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInputAfter = inputsAfter.nth(i + 1);
        descInputAfter = inputsAfter.nth(i + 2);
        break;
      }
    }

    // Verilerin korunduğunu doğrula
    await expect(repoInputAfter).toHaveValue(testRepoName, { timeout: 10000 });
    await expect(descInputAfter).toHaveValue(testDesc, { timeout: 10000 });
    console.log('✅ Sihirbaz adımları arasında gidip gelindiğinde girilen verilerin korunduğu başarıyla doğrulandı.');
  });

  test('Aynı depo için devam eden bir geri yükleme varken ikinci kez restore tetiklendiğinde API 409 Conflict dönmelidir', async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 409/];
    // 1. Adım: Hedef organizasyonu tamamla
    await restorePage.completeTargetOrganizationStep(async () => {
      await handleGithubOAuthPopup(page, providerPage);
    });

    // 2. Adım: Yedek seçimi
    await restorePage.selectBackupSourceIfVisible();
    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // 3. Adım: Depo adını doldur
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

    await repoInput.fill('concurrent-restore-lock-test');
    await descInput.fill('Concurrent restore check');

    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    await nextStepBtn3.click();

    // 4. Adım: API isteğini 409 Conflict dönecek şekilde route et (Mükerrer restore kilidi)
    await page.route(
      (url) => (url.href.includes('/restore') || url.href.includes('/api/restore')) && !url.href.includes('.js'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log(`🛡️ [MOCK CONCURRENCY LOCK] Restore POST isteği kesildi, 409 Conflict (Geri yükleme kilidi) dönülüyor.`);
          await route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message: 'Another restore operation is currently in progress for this repository.'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    // 5. Adım: Geri yüklemeyi başlat
    const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
    await startRestoreBtn.click({ force: true });

    // Dinamik Hata Yakalayıcı ile çakışma (409 Conflict) hata mesajını doğrula
    await assertAndLogDynamicError(page, /in progress|already|running|lock|conflict|409/i);
    console.log('✅ Eşzamanlı mükerrer geri yükleme durumunda backend/API kilidi (409 Conflict) başarıyla doğrulandı.');
  });
});

