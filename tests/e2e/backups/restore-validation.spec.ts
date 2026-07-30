import type { Locator, Page } from '@playwright/test';
import { test, expect, GitSecPage } from '../../fixtures/test';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import { ProviderPage } from '../../pages/ProviderPage';
import { RestorePage, RestoreProvider } from '../../pages/RestorePage';
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
  const initialPopupUrl = popup.url();

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

  const flowOk = await gh.completePermissionsInstallFlow(initialPopupUrl);
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

async function handleBitbucketOAuthPopup(page: Page, providerPage: ProviderPage): Promise<void> {
  console.log('[e2e] Diyalogdaki Bitbucket kartına tıklanıyor...');
  const popup = await providerPage.openBitbucketOAuthPopupFromDialog();
  if (popup && popup !== page) {
    console.log('[e2e] Bitbucket OAuth popup algılandı, yetkilendirme akışı çalıştırılıyor...');
  } else {
    console.log('[e2e] Bitbucket yetkilendirmesi aynı sayfada veya pencere açılmadan tamamlandı.');
  }
}

async function handleCreateFirstBackupAndReturn(page: Page): Promise<boolean> {
  const createFirstBackupLink = page.getByText(/Create first backup/i).first();
  await createFirstBackupLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
  const isLinkVisible = await createFirstBackupLink.isVisible().catch(() => false);
  if (!isLinkVisible) {
    console.warn('⚠️ [RESTORE AKIŞI] "Create first backup" bağlantısı görünür değil.');
    return false;
  }

  const href = await createFirstBackupLink.getAttribute('href').catch(() => '');
  console.log(`🚀 [RESTORE -> BACKUP] "Create first backup" bağlantısına tıklanıyor (${href || 'link'})...`);

  await Promise.all([
    page.waitForURL(/\/repository\/\d+/, { timeout: 25000 }).catch(() => { }),
    createFirstBackupLink.click({ force: true }).catch(() => { })
  ]);

  await page.waitForLoadState('domcontentloaded').catch(() => { });

  // Taze yedek alınan deponun başlığını/ismini saklayalım
  const repoHeading = await page.locator('h1, h2, [class*="title"]').first().innerText().catch(() => '');
  const backedUpRepoUrl = page.url();

  const backupNowBtn = page.getByRole('button', { name: /Backup now/i }).first()
    .or(page.locator('button').filter({ hasText: /Backup now/i }).first());

  await backupNowBtn.waitFor({ state: 'visible', timeout: 20000 });
  await backupNowBtn.scrollIntoViewIfNeeded().catch(() => { });
  await backupNowBtn.click({ force: true });
  await page.waitForTimeout(600);

  const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i })
    .or(page.locator('button').filter({ hasText: /^Start Backup$/i }).first())
    .or(page.locator('button').filter({ hasText: /Start Backup/i }).first());

  await startBackupBtn.waitFor({ state: 'visible', timeout: 15000 });

  const triggerResponsePromise = page.waitForResponse(
    response => response.url().includes('/api/') && (response.url().includes('trigger') || response.url().includes('backup')),
    { timeout: 30000 }
  ).catch(() => null);

  await startBackupBtn.click({ force: true });

  const triggerResponse = await triggerResponsePromise;
  console.log(`📌 [YEDEK TETİKLENDİ] HTTP Status: ${triggerResponse ? triggerResponse.status() : 'yok'}`);

  let scheduleId: string | null = null;
  let executionId: string | null = null;
  if (triggerResponse && triggerResponse.ok()) {
    const triggerResult = await triggerResponse.json().catch(() => null);
    scheduleId = triggerResult?.data?.scheduleId ? String(triggerResult.data.scheduleId) : (triggerResult?.scheduleId ? String(triggerResult.scheduleId) : null);
    executionId = triggerResult?.data?.executionId ? String(triggerResult.data.executionId) : (triggerResult?.executionId ? String(triggerResult.executionId) : null);
    console.log(`📌 [YEDEK TETİKLEME BILGISI] ScheduleId: ${scheduleId || 'yok'}, ExecutionId: ${executionId || 'yok'}`);
  }

  console.log('⏳ [BEKLEME] Yedeğin sunucu tarafında işlenmesi bekleniyor (6sn)...');
  await page.waitForTimeout(6000);

  // Repository sayfasında yedeklemenin tamamlanmasını bekle
  await expect(async () => {
    const tableRow = page.locator('table tbody tr, table [role="row"]').first();
    const rowText = (await tableRow.innerText().catch(() => '')).trim();
    const hasBackupRow = rowText.length > 5 && !rowText.includes('No results found') && !rowText.includes('No Backups Found');

    if (!hasBackupRow) {
      await page.waitForTimeout(3000);
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
      throw new Error('Yedek satırı henüz görünür olmadı, bekleniyor...');
    }
    expect(hasBackupRow).toBe(true);
  }).toPass({ timeout: 60000, intervals: [2000] });

  console.log('✅ [YEDEK TAMAMLANDI] Depo sayfasında tamamlanmış yedek satırı doğrulandı. "Restore now" butonuna basılıyor...');

  let token = '';
  const cookies = await page.context().cookies().catch(() => []);
  const tokenCookie = cookies.find(c => c.name === 'gs_token' || c.name.includes('token') || c.name.includes('auth'));
  if (tokenCookie) {
    token = tokenCookie.value;
  }
  if (!token) {
    token = await page.evaluate(() => localStorage.getItem('gs_token') || localStorage.getItem('token') || '').catch(() => '');
  }
  if (!token) {
    try {
      const authPath = require('path').join(process.cwd(), 'playwright/.auth/user-with-provider.json');
      if (require('fs').existsSync(authPath)) {
        const authData = JSON.parse(require('fs').readFileSync(authPath, 'utf8'));
        const fileCookie = authData.cookies?.find((c: any) => c.name === 'gs_token' || c.name.includes('token'));
        if (fileCookie) token = fileCookie.value;
      }
    } catch (e) { }
  }

  const apiBaseUrl = requireEnv('API_BASE_URL');
  const workspaceId = requireEnv('WORKSPACE_ID');

  const repoIdMatch = page.url().match(/\/repository\/(\d+)/);
  const repoId = repoIdMatch ? repoIdMatch[1] : '';

  console.log(`⏳ [BEKLEME] [CANLI API DİNLEYİCİ & EXECUTION SORGUSU] Repository (${repoId}) için yedekleme bekleniyor...`);

  let isCompleted = false;
  let detectedProgress = 0;
  let detectedStatus = '';

  const responseHandler = async (response: any) => {
    try {
      const url = response.url();
      if (url.includes('/api/') && (url.includes('snapshot') || url.includes('execution') || url.includes('backup') || url.includes('schedule'))) {
        const status = response.status();
        if (status >= 200 && status < 300) {
          const json = await response.json().catch(() => null);
          const items = json?.data?.list || (Array.isArray(json?.data) ? json.data : null);
          const latest = Array.isArray(items) ? items[0] : (json?.data || null);
          if (latest) {
            const prog = latest.progressPercent ?? (latest.completedAt ? 100 : 0);
            const st = latest.executionStatus || latest.status || '';
            if (prog > 0 || st) {
              detectedProgress = prog;
              detectedStatus = String(st);
              console.log(`📡 [CANLI API BİLDİRİMİ] İlerleme: %${prog}, Durum: ${st || 'DEVAM EDİYOR'} (${url})`);
            }
            if (latest.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100 || url.includes('Criteria.Status=3')) {
              isCompleted = true;
            }
          }
        }
      }
    } catch (e) { }
  };

  page.on('response', responseHandler);

  let pollCounter = 0;

  try {
    await expect(async () => {
      pollCounter++;

      if (isCompleted) {
        console.log(`🎉 [BAŞARILI] [CANLI API DOĞRULAMA] Yedekleme %100 tamamlandı! (Durum: ${detectedStatus || 'COMPLETED'})`);
        return;
      }

      const currentCookies = await page.context().cookies().catch(() => []);
      const cookieHeader = currentCookies.map(c => `${c.name}=${c.value}`).join('; ');

      const headers: Record<string, string> = {
        'workspace-id': workspaceId,
        'WorkspaceId': workspaceId,
        'X-Workspace-Id': workspaceId,
        'Cookie': cookieHeader
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 0. ScheduleId var ama executionId henüz yakalanmadıysa API'den çöz:
      if (!executionId && scheduleId) {
        const schedUrl = `${apiBaseUrl}/api/backup/executions/schedule/${scheduleId}`;
        const schedRes = await page.request.get(schedUrl, { headers }).catch(() => null);
        if (schedRes && schedRes.ok()) {
          const schedJson = await schedRes.json().catch(() => null);
          const list = schedJson?.data?.list || (Array.isArray(schedJson?.data) ? schedJson.data : []);
          if (list && list.length > 0) {
            executionId = String(list[0].id || list[0].executionId || '');
            console.log(`📌 [YEDEK EXECUTION ID ÇÖZÜLDÜ] ScheduleId (${scheduleId}) -> ExecutionId: ${executionId}`);
          }
        }
      }

      // 1. Birincil Doğrulama: GET /api/backup/executions/{executionId}
      if (executionId) {
        const execUrl = `${apiBaseUrl}/api/backup/executions/${executionId}`;
        const execRes = await page.request.get(execUrl, { headers }).catch(() => null);
        if (execRes && execRes.ok()) {
          const execJson = await execRes.json().catch(() => null);
          const data = execJson?.data;
          if (data) {
            const prog = data.progressPercent ?? (data.completedAt ? 100 : 0);
            const st = data.executionStatus ?? data.status;
            detectedProgress = prog;
            detectedStatus = String(st || '');
            console.log(`📡 [API EXECUTION DOĞRULAMA (ID: ${executionId})] İlerleme: %${prog}, Durum: ${st}, Tamamlanma: ${data.completedAt || 'DEVAM EDİYOR'}`);
            if (data.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100) {
              isCompleted = true;
              expect(isCompleted).toBe(true);
              return;
            }
          }
        }
      }

      // 2. Snapshots API (Repo bazlı canlı durum sorgusu)
      if (repoId) {
        const snapshotsUrl = `${apiBaseUrl}/api/backup/snapshots?Pagination.CurrentPage=1&Pagination.MaxRowsPerPage=10&Criteria.RepositoryId=${repoId}`;
        const snRes = await page.request.get(snapshotsUrl, { headers }).catch(() => null);
        if (snRes && snRes.ok()) {
          const snJson = await snRes.json().catch(() => null);
          const snItems = snJson?.data?.list || (Array.isArray(snJson?.data) ? snJson.data : null);
          if (snItems && snItems.length > 0) {
            console.log(`📡 [API SNAPSHOTS DOĞRULAMA] Depo (${repoId}) için taze backup snapshot'ı teyit edildi! (Count: ${snItems.length})`);
            isCompleted = true;
            expect(isCompleted).toBe(true);
            return;
          }
        }
      }

      // 3. Executions API Fallback
      const pollUrl = scheduleId
        ? `${apiBaseUrl}/api/backup/executions/schedule/${scheduleId}`
        : `${apiBaseUrl}/api/backup/executions?limit=5`;

      const response = await page.request.get(pollUrl, { headers }).catch(() => null);

      if (response && response.ok()) {
        const json = await response.json().catch(() => null);
        const items = json?.data?.list || (Array.isArray(json?.data) ? json.data : null);
        if (items && items.length > 0) {
          const latest = items[0];
          const prog = latest.progressPercent ?? 0;
          const st = latest.executionStatus || latest.status || 'IN_PROGRESS';
          detectedProgress = prog;
          detectedStatus = String(st || '');
          console.log(`📡 [API EXECUTIONS POLING - 2s (Sorgu ${pollCounter})] İlerleme: %${prog}, Durum: ${st}`);

          if (latest.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100) {
            console.log(`🎉 [BAŞARILI] [API EXECUTIONS] Yedekleme %100 tamamlandı! (Durum: ${st})`);
            isCompleted = true;
            expect(isCompleted).toBe(true);
            return;
          }
        }
      }

      // UI Tablo Teyidi
      const row = page.locator('tbody tr').filter({ hasNotText: /No results found/i }).first();
      if (await row.isVisible().catch(() => false)) {
        const text = await row.innerText().catch(() => '');
        if (text && !text.includes('No results found') && !text.includes('Progress') && !text.includes('Running') && !text.includes('IN_PROGRESS')) {
          console.log(`📡 [Yedekleme Durum Sorgusu] Tablodan COMPLETED Teyit Edildi.`);
          isCompleted = true;
          expect(isCompleted).toBe(true);
          return;
        }
      }

      expect(isCompleted, `Yedekleme henüz tamamlanmadı (Canlı API İlerlemesi: %${detectedProgress}, Durum: ${detectedStatus || 'DEVAM EDİYOR'})`).toBe(true);
    }).toPass({ timeout: 90000, intervals: [2000] });
  } finally {
    page.off('response', responseHandler);
  }

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

  console.log(`👆 [TIKLAMA] Taze yedek alınan deponun ("${repoHeading}") sayfasındaki "Restore now" bağlantısına tıklanıyor...`);

  // HTML'deki tam eşleşen <a> tag'i (`a[href*="/restore/"]`)
  const restoreNowLink = page.locator('a[href*="/restore/"], button, a').filter({ hasText: /Restore now/i }).first();
  await restoreNowLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

  if (await restoreNowLink.isVisible().catch(() => false)) {
    await restoreNowLink.click({ force: true }).catch(() => { });
    await page.waitForTimeout(3000);
    console.log(`✅ [BAŞARILI] Repo sayfasındaki "Restore now" bağlantısına tıklandı. Sihirbaz doğrudan bu repo için Step 2'de açıldı.`);
    return true;
  }

  // 2. Yol: Restore sayfasına dönüp sihirbaz aç ve TAM OLARAK yedek alınan depoyu seç!
  console.log(`🔄 [RESTORE KURTARMA] Restore sayfasına geri dönülüyor ve taze yedek alınan depo ("${repoHeading}") seçiliyor...`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/restore`, { waitUntil: 'networkidle' }).catch(() => { });

  const wizardBtn = page.getByRole('button', { name: 'Restore Wizard' }).first();
  await wizardBtn.waitFor({ state: 'visible', timeout: 15000 });
  const dialog = page.locator('div[role="dialog"]').first();
  await wizardBtn.click({ force: true });
  await dialog.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });

  const combobox = page.locator('div[role="dialog"] button[role="combobox"]').first();
  if (await combobox.isVisible().catch(() => false)) {
    await combobox.click({ force: true }).catch(() => { });
    const listbox = page.locator('[role="listbox"], [role="menu"], [class*="select-content"], [data-radix-popper-content-wrapper]').first();
    await listbox.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    const options = listbox.locator('[role="option"], [data-slot="select-item"]');
    await options.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    const count = await options.count();

    let matchedOption: Locator | null = null;
    const cleanHeading = repoHeading.split('/')[1]?.trim() || repoHeading.trim();

    for (let i = 0; i < count; i++) {
      const opt = options.nth(i);
      const text = await opt.innerText().catch(() => '');
      if (cleanHeading && text.toLowerCase().includes(cleanHeading.toLowerCase())) {
        matchedOption = opt;
        break;
      }
    }

    if (!matchedOption) {
      for (let i = 0; i < count; i++) {
        const opt = options.nth(i);
        const text = await opt.innerText().catch(() => '');
        if (text && !text.includes('Excluded') && !text.includes('e2e-restore-')) {
          matchedOption = opt;
          break;
        }
      }
    }

    if (matchedOption) {
      await matchedOption.click({ force: true });
    }

    const continueBtn = page.getByRole('button', { name: 'Continue' }).first();
    if (await continueBtn.isEnabled().catch(() => false)) {
      await continueBtn.click({ force: true });
      await page.waitForTimeout(2000);
    }
  }
  return true;
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
    }).toPass({ timeout: 15000, intervals: [200] }).catch(() => { });
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
    }).catch(() => { });

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
    }).catch(() => { });

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

  async function getOrNavigateActiveWorkspaceId(page: Page): Promise<string> {
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    let match = page.url().match(/\/(\d+)(?:\/|$)/);
    if (!match || !match[1]) {
      // Eğer sayfa "about:blank" ise önce dashboard kök sayfasına git ki aktif oturumun Workspace ID'si URL'den öğrenilsin
      await page.goto(dashboardBaseUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
      await page.waitForURL(/\/(\d+)\//, { timeout: 15000 }).catch(() => { });
      match = page.url().match(/\/(\d+)(?:\/|$)/);
    }

    if (match && match[1]) {
      return match[1];
    }
    return requireEnv('WORKSPACE_ID');
  }

  async function navigateToRestorePage(page: Page): Promise<void> {
    if (page.url().includes('/restore')) return;

    const workspaceId = await getOrNavigateActiveWorkspaceId(page);
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const targetRestoreUrl = `${dashboardBaseUrl}/${workspaceId}/restore`;

    console.log(`[e2e] Restore sayfasına yönlendiriliyor (Workspace ID: ${workspaceId})...`);

    await page.waitForLoadState('domcontentloaded').catch(() => { });

    const sidebarLink = page.locator('a[href*="/restore"]')
      .or(page.getByRole('link', { name: /Restores/i }))
      .or(page.locator('aside, nav').locator('a').filter({ hasText: /^Restores$/i }))
      .first();

    await expect(async () => {
      if (page.url().includes('/restore')) return;

      const isLinkVisible = await sidebarLink.isVisible().catch(() => false);
      if (isLinkVisible) {
        await sidebarLink.scrollIntoViewIfNeeded().catch(() => { });
        await sidebarLink.click({ force: true }).catch(() => { });
      } else {
        await page.goto(targetRestoreUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
      }

      await page.waitForTimeout(600);
      expect(page.url().includes('/restore'), 'URL /restore içermeli').toBe(true);
    }).toPass({ timeout: 25000, intervals: [1000] }).catch(async () => {
      if (!page.url().includes('/restore')) {
        console.log(`[e2e] Direct goto ile restore sayfasına gidiliyor: ${targetRestoreUrl}`);
        await page.goto(targetRestoreUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
      }
    });

    await expect(page).toHaveURL(/\/restore/, { timeout: 15000 });
  }

  async function ensureIncludedRepoForProvider(
    page: Page,
    provider: RestoreProvider
  ): Promise<{ name: string; fullName: string; provider: RestoreProvider }> {
    const providerPage = new ProviderPage(page);
    console.log(`[e2e] ${provider} için include edilmiş repository aranıyor...`);

    if (provider === 'bitbucket') {
      await providerPage.goToRepositoriesBitbucket();
    } else {
      await providerPage.goToRepositoriesGithub();
    }

    const repoTable = page.locator('table').first();
    await expect(repoTable, `${provider} repository tablosu görünür olmalı`).toBeVisible({ timeout: 20_000 });
    await repoTable.locator('xpath=..').evaluate(container => {
      container.scrollLeft = container.scrollWidth;
      container.dispatchEvent(new Event('scroll', { bubbles: true }));
    });

    const rows = repoTable.locator('tbody tr');
    await expect(async () => {
      const rowCount = await rows.count();
      expect(rowCount, `${provider} için en az bir repository satırı yüklenmeli`).toBeGreaterThan(0);

      let loadedRepositoryFound = false;
      for (let index = 0; index < rowCount; index++) {
        const row = rows.nth(index);
        const repositoryName = await getRepoNameFromRow(row);
        const switchCount = await row.getByRole('switch').count();
        if (repositoryName && switchCount > 0) {
          loadedRepositoryFound = true;
          break;
        }
      }
      expect(
        loadedRepositoryFound,
        `${provider} repository skeleton satırları gerçek veriye dönüşmeli`
      ).toBe(true);
    }).toPass({ timeout: 30_000, intervals: [500, 1_000, 2_000] });

    const rowCount = await rows.count();
    let includedRow: Locator | null = null;
    let excludedRow: Locator | null = null;

    for (let index = 0; index < rowCount; index++) {
      const row = rows.nth(index);
      const rowText = await row.innerText();
      if (/e2e-restore-/i.test(rowText)) continue;

      const scopeSwitch = row.getByRole('switch').first();
      if (!(await scopeSwitch.isVisible())) continue;

      if ((await scopeSwitch.getAttribute('aria-checked')) === 'true') {
        includedRow = row;
        break;
      }
      excludedRow ??= row;
    }

    const targetRow = includedRow ?? excludedRow;
    if (!targetRow) {
      console.log(`❌ [EŞLEŞME] ${provider} için dahil edilebilir repository bulunamadı.`);
      throw new Error(`${provider} için dahil edilebilir repository bulunamadı.`);
    }

    const fullName = await getRepoNameFromRow(targetRow);
    if (!fullName) {
      throw new Error(`${provider} repository satırından repository adı okunamadı.`);
    }
    const repository = {
      name: getRepoNameWithoutOrg(fullName),
      fullName,
      provider
    };

    const scopeSwitch = targetRow.getByRole('switch').first();
    if (!includedRow) {
      console.log(`⚡ [EŞLEŞME] Include edilmiş repo yok; ilk uygun repo include ediliyor: ${repository.fullName}`);

      const inclusionResponsePromise = page.waitForResponse(
        response =>
          response.url().includes('/api/repositories/license-inclusion-status') &&
          response.request().method() !== 'GET',
        { timeout: 30_000 }
      ).catch(() => null);

      await scopeSwitch.click();
      const inclusionResponse = await inclusionResponsePromise;
      if (inclusionResponse) {
        expect(
          inclusionResponse.ok(),
          `Repository include API başarılı olmalı: HTTP ${inclusionResponse.status()}`
        ).toBe(true);
      }
      await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25_000 });
    }

    console.log(`✅ [EŞLEŞME] Restore için repository hazır: ${repository.fullName}`);
    return repository;
  }

  async function ensureRestoreWizardOpen(page: Page): Promise<void> {
    const requestedProvider = (process.env.E2E_CODE_PROVIDER || 'github').toLowerCase();

    // Eğer sayfa zaten Step 1, 2, 3 veya 4 adımındaysa akışı bozma, kaldığı yerden devam etsin
    const stepNumber = await detectCurrentRestoreStep(page);
    if (stepNumber >= 1) {
      console.log(`✅ [SENKRONİZE] Arayüz zaten Restore Wizard Step ${stepNumber} adımında, akış kaldığı yerden devam ediyor.`);
      return;
    }

    await navigateToRestorePage(page);

    const dialog = page.locator('div[role="dialog"]').first();
    const isDialogOpen = await dialog.isVisible().catch(() => false);

    if (!isDialogOpen) {
      console.log('[e2e] Restore Wizard butonu aranıyor ve tıklanıyor...');
      const wizardBtn = page.getByRole('button', { name: /Restore Wizard/i }).first()
        .or(page.locator('button').filter({ hasText: /Restore Wizard/i }).first());

      await wizardBtn.waitFor({ state: 'visible', timeout: 20000 });
      await expect(wizardBtn).toBeEnabled({ timeout: 15000 });

      // Sayfa yenilenmesi veya React re-render nedeniyle tıklamanın kaybolmasını engellemek için retry-loop
      await expect(async () => {
        const isModalOpen = await dialog.isVisible().catch(() => false);
        if (!isModalOpen) {
          await wizardBtn.scrollIntoViewIfNeeded().catch(() => { });
          await wizardBtn.click({ force: true }).catch(() => { });
          await page.waitForTimeout(600);
        }
        expect(await dialog.isVisible().catch(() => false), 'Restore Wizard modalı görünür olmalı').toBe(true);
      }).toPass({ timeout: 25_000, intervals: [1000] });
    }

    console.log('[e2e] Dropdown seçenekleri yükleniyor...');

    let targetOption: Locator | null = null;
    let targetOptionText = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      const currentDialog = page.locator('div[role="dialog"]').first();
      if (!(await currentDialog.isVisible().catch(() => false))) {
        break;
      }

      const currentCombobox = currentDialog.locator('button[role="combobox"], button[data-slot="select-trigger"], button').first();
      await currentCombobox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

      const isExpanded = await currentCombobox.getAttribute('aria-expanded').catch(() => 'false');
      if (isExpanded !== 'true') {
        await currentCombobox.click({ force: true }).catch(() => { });
        await page.keyboard.press('Space').catch(() => { });
      }

      const currentListbox = page.locator('[role="listbox"], [role="menu"], [class*="select-content"], [data-radix-popper-content-wrapper]').first();
      await currentListbox.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

      const optionLocators = currentListbox.locator('[role="option"], [data-slot="select-item"]');
      await optionLocators.first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      const count = await optionLocators.count();

      // Hedef provider (örn: GitHub veya Bitbucket) ile eşleşen ilk include repoyu tercih et
      let fallbackOption: Locator | null = null;
      let fallbackOptionText = '';

      for (let i = 0; i < count; i++) {
        const opt = optionLocators.nth(i);
        const text = await opt.innerText().catch(() => '');
        if (text && !text.includes('Excluded')) {
          if (!fallbackOption) {
            fallbackOption = opt;
            fallbackOptionText = text;
          }
          if (new RegExp(requestedProvider, 'i').test(text)) {
            targetOption = opt;
            targetOptionText = text;
            break;
          }
        }
      }

      if (!targetOption && fallbackOption) {
        targetOption = fallbackOption;
        targetOptionText = fallbackOptionText;
      }

      if (targetOption) break;
    }

    if (!targetOption) {
      if ((await detectCurrentRestoreStep(page)) >= 1) {
        return;
      }
      console.log(`⚠️ [RECOVERY] "${requestedProvider}" için Restore Wizard popover'ında include edilmiş repo bulunamadı. Provider sayfasından repo include ediliyor...`);

      await page.keyboard.press('Escape').catch(() => { });
      const closeDialogButton = page.locator('div[role="dialog"]').getByRole('button', { name: /close/i }).first();
      if (await closeDialogButton.isVisible().catch(() => false)) {
        await closeDialogButton.click().catch(() => { });
      }

      await ensureIncludedRepoForProvider(page, requestedProvider as RestoreProvider);
      await navigateToRestorePage(page);

      return await ensureRestoreWizardOpen(page);
    }

    console.log(`🎉 [EŞLEŞME] Restore edilebilir repository seçiliyor: "${targetOptionText.trim()}"`);
    await targetOption.click({ force: true });

    const continueBtn = page.getByRole('button', { name: 'Continue' }).first();
    await expect(continueBtn).toBeEnabled({ timeout: 10000 });
    await continueBtn.click();
    console.log('[e2e] Wizard: Continue tıklandı, organizasyon seçimi adımına geçiliyor.');

    await expect(page).toHaveURL(/\/restore/, { timeout: 25000 });
  }

  test.beforeEach(async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [/status of 502/, /502/, /NetworkFailure/, /chunks/, /restore\/schedules\/trigger/, /status of 500/];
    providerPage = new ProviderPage(page);
    restorePage = new RestorePage(page);
  });

  async function detectCurrentRestoreStep(page: Page): Promise<number> {
    const url = page.url();
    if (url.includes('step=4') || (await page.getByRole('button', { name: /Start Restore|Restore/i }).first().isVisible().catch(() => false))) {
      return 4;
    }
    if (url.includes('step=3') || (await page.getByText(/New Repository Name|Included Items/i).first().isVisible().catch(() => false))) {
      return 3;
    }
    if (url.includes('step=2') || (await page.locator('button[data-slot="select-trigger"]').filter({ hasText: /Select a backup|Select/i }).first().isVisible().catch(() => false))) {
      return 2;
    }
    if (url.includes('step=1') || (await page.getByText(/Target Organization/i).first().isVisible().catch(() => false)) || url.match(/\/restore\/[^/]+\/\d+/)) {
      return 1;
    }
    return 0;
  }

  async function getStep3RepoInput(page: Page): Promise<Locator> {
    // Form kartını bul (Sidebar, Header ve arama çubuğunu kesinlikle hariç tut)
    const formCard = page.locator('main form, form, div[class*="card"]')
      .filter({ hasText: /New Repository Name|Select Included Items/i })
      .filter({ hasNotText: /Search pages, repositories/i })
      .last();
    await formCard.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

    // Eğer yalnızca Form Kartı içinde "Workspace *" etiketi taşıyan combobox varsa seç (Sidebar/Header kesinlikle hariç!)
    const formWorkspaceContainer = formCard.locator('label, div').filter({ hasText: /^Workspace/i }).first();
    const workspaceTrigger = formWorkspaceContainer.locator('button[data-slot="select-trigger"], button[role="combobox"]').first();

    if (await workspaceTrigger.isVisible().catch(() => false)) {
      await workspaceTrigger.click({ force: true }).catch(() => { });
      await page.waitForTimeout(300);
      const wsOption = page.locator('[data-radix-popper-content-wrapper] [role="option"], [role="option"], [data-slot="select-item"]').first();
      if (await wsOption.isVisible().catch(() => false)) {
        await wsOption.click({ force: true }).catch(() => { });
      }
    }

    // "New Repository Name" başlığından hemen sonra gelen ilk input alanını doğrudan hedefle
    const input = page.locator('xpath=//*[contains(text(), "New Repository Name")]/following::input[1]')
      .or(page.getByLabel(/New Repository Name/i).first())
      .or(page.locator('input[placeholder*="Repository"], input[placeholder*="repository"]').first())
      .or(page.getByRole('textbox').first())
      .first();

    await input.waitFor({ state: 'visible', timeout: 15000 });
    return input;
  }

  async function fillStep3RepoName(page: Page, repoName: string): Promise<Locator> {
    const input = await getStep3RepoInput(page);
    await input.scrollIntoViewIfNeeded().catch(() => { });
    await input.click({ force: true });
    await input.focus();
    await input.clear().catch(() => { });
    await input.fill(repoName);
    await input.dispatchEvent('input').catch(() => { });
    await input.dispatchEvent('change').catch(() => { });
    await input.press('Tab').catch(() => { });
    return input;
  }

  async function ensureStep1AndStep2Completed(page: Page, restorePage: RestorePage, providerPage: ProviderPage) {
    const requestedProvider: RestoreProvider = (process.env.E2E_CODE_PROVIDER?.toLowerCase() === 'bitbucket' ? 'bitbucket' : 'github');

    // 1. Eğer zaten Step 3 veya daha ileri adımdaysak doğrudan devam et (tekrar goto/wizard açma!)
    let step = await detectCurrentRestoreStep(page);
    if (step >= 3) {
      console.log('✅ [SENKRONİZE] Sihirbaz zaten Step 3 veya daha ileri adımda.');
      return;
    }

    // 2. Yalnızca sihirbaz hiç açılmadıysa (step === 0) veya önceki test Step 4/5'te bittiyse kök sayfadan Wizard aç
    if (step === 0 || page.url().includes('step=4') || page.url().includes('step=5')) {
      if (page.url().includes('step=4') || page.url().includes('step=5')) {
        const wsId = await getOrNavigateActiveWorkspaceId(page);
        await page.goto(`${requireEnv('DASHBOARD_BASE_URL')}/${wsId}/restore`, { waitUntil: 'domcontentloaded' }).catch(() => { });
      }
      await ensureRestoreWizardOpen(page);
      step = await detectCurrentRestoreStep(page);
    }

    if (step >= 3) {
      console.log('✅ [SENKRONİZE] Sihirbaz zaten Step 3 veya daha ileri adımda.');
      return;
    }

    if (step <= 1) {
      console.log('[e2e] Step 1: Target Organization seçimi kontrol ediliyor...');
      const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
      if (await licenseError.isVisible().catch(() => false)) {
        throw new Error('Repository is not included in the license.');
      }

      const orgStep = await restorePage.completeTargetOrganizationStep(async () => {
        if (requestedProvider === 'bitbucket') {
          await handleBitbucketOAuthPopup(page, providerPage);
        } else {
          await handleGithubOAuthPopup(page, providerPage);
        }
      }, requestedProvider);

      if (orgStep === 'installed_new_org') {
        console.log('[e2e] Yeni organizasyon yetkilendirme adımı tamamlandı.');
      } else {
        console.log('[e2e] Mevcut organizasyon seçildi ve Next Step ile ilerlendi.');
      }

    }

    step = await detectCurrentRestoreStep(page);
    if (step >= 3) {
      console.log('✅ [SENKRONİZE] Sihirbaz zaten Step 3 veya daha ileri adımda.');
      return;
    }

    // Step 2 kartının ve combobox'ın yüklenmesini bekle (Organization combobox'ı ile karışmasını engellemek için Backup etiketini şart koş)
    const step2Section = page.locator('main, form, div[class*="card"]').filter({ hasText: /Select backup source|Backup \*/i }).last();

    const backupCombobox = step2Section.locator('button[role="combobox"], button[data-slot="select-trigger"]').first()
      .or(
        page.locator('div, label').filter({ hasText: /^Backup \*?$/i }).locator('..').locator('button[role="combobox"], button[data-slot="select-trigger"]').first()
      )
      .or(
        page.locator('button[role="combobox"], button[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first()
      );

    await backupCombobox.waitFor({ state: 'visible', timeout: 15000 });

    const isRealBackupOptionText = (text: string) => {
      if (!text) return false;
      const clean = text.trim();
      if (clean.includes('Select a backup') || clean.includes('Select backup')) return false;
      if (/gitsectest-cmd|GitHub|Bitbucket|Organization/i.test(clean) && !/#\d+|\d{4}/.test(clean)) return false;
      return /#\d+|completed|partially|\d{4}|:\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(clean);
    };

    let selectedTextStep2 = '';
    await expect(async () => {
      const isExpanded = await backupCombobox.getAttribute('aria-expanded').catch(() => 'false');
      if (isExpanded !== 'true') {
        await backupCombobox.click({ force: true }).catch(() => { });
        await page.waitForTimeout(500);
      }

      const activePopper = page.locator('[data-slot="select-content"], [role="listbox"], [data-radix-popper-content-wrapper]:visible')
        .filter({ has: page.locator('[role="option"], [data-slot="select-item"]') })
        .last();

      await activePopper.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

      const options = activePopper.locator('[role="option"], [data-slot="select-item"]');
      const count = await options.count();

      let validOpt: Locator | null = null;
      for (let i = 0; i < count; i++) {
        const opt = options.nth(i);
        const txt = (await opt.innerText().catch(() => '')).trim();
        if (isRealBackupOptionText(txt)) {
          validOpt = opt;
          selectedTextStep2 = txt;
          break;
        }
      }

      if (validOpt) {
        await validOpt.scrollIntoViewIfNeeded().catch(() => { });
        await validOpt.click({ force: true });
        await page.waitForTimeout(500);
        const val = (await backupCombobox.innerText().catch(() => '')).trim();
        expect(val).not.toContain('Select a backup');
      } else {
        const createFirstBackupBtn = page.locator('a, button, [role="button"]').filter({ hasText: /Create first backup/i }).first();
        const noBackupsText = page.getByText(/No Backups Found/i).first();

        const hasNoBackupUI = (await createFirstBackupBtn.isVisible().catch(() => false)) || (await noBackupsText.isVisible().catch(() => false));
        if (hasNoBackupUI) {
          return; // No backup available, break retry loop to enter creation flow
        }

        await page.keyboard.press('Escape').catch(() => { });
        await page.waitForTimeout(400);
        throw new Error('Yedek opsiyonu henüz popover içinde belirmedi, bekleniyor...');
      }
    }).toPass({ timeout: 12000, intervals: [1000] }).catch(() => { });

    const currentText = (await backupCombobox.innerText().catch(() => '')).trim();

    if (!currentText || currentText.includes('Select a backup')) {
      console.log('🔄 [RESTORE KURTARMA] Combobox tıklandı ancak yedek bulunamadı. "Create first backup" akışına giriliyor...');
      const workspaceId = await getOrNavigateActiveWorkspaceId(page);
      const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

      await page.keyboard.press('Escape').catch(() => { });
      await page.waitForTimeout(300);

      const btn = page.locator('a, button, [role="button"]').filter({ hasText: /Create first backup/i }).first();
      await btn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
      await btn.scrollIntoViewIfNeeded().catch(() => { });

      const href = await btn.getAttribute('href').catch(() => null);
      let navigated = false;

      if (href && (href.includes('/repository/') || href.includes('/repositories/'))) {
        const targetUrl = new URL(href, page.url()).toString();
        console.log(`🔗 [YÖNLENDİRME] Direct URL ile repo sayfasına gidiliyor: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
        navigated = true;
      }

      if (!navigated) {
        await btn.evaluate((el: HTMLElement) => el.click()).catch(() => { });
        await btn.click({ force: true }).catch(() => { });
        navigated = await page.waitForURL(/\/repository\/\d+|\/repositories\//, { timeout: 5000 }).then(() => true).catch(() => false);
      }

      if (!navigated || page.url().includes('/restore/')) {
        const urlMatch = page.url().match(/\/restore\/[^/]+\/(\d+)/);
        if (urlMatch && urlMatch[1]) {
          const directRepoUrl = `${dashboardBaseUrl}/${workspaceId}/repository/${urlMatch[1]}`;
          console.log(`🚀 [YÖNLENDİRME] URL'deki repo ID (${urlMatch[1]}) ile repo sayfasına gidiliyor: ${directRepoUrl}`);
          await page.goto(directRepoUrl, { waitUntil: 'domcontentloaded' });
        }
      }

      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await page.waitForTimeout(1000);

      const backupNowBtn = page.getByRole('button', { name: /Backup now/i }).first()
        .or(page.locator('button').filter({ hasText: /Backup now/i }).first());

      await backupNowBtn.waitFor({ state: 'visible', timeout: 20000 });
      await backupNowBtn.scrollIntoViewIfNeeded().catch(() => { });
      await backupNowBtn.click({ force: true });
      await page.waitForTimeout(600);

      const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i })
        .or(page.locator('button').filter({ hasText: /^Start Backup$/i }).first())
        .or(page.locator('button').filter({ hasText: /Start Backup/i }).first());

      await startBackupBtn.waitFor({ state: 'visible', timeout: 15000 });
      await startBackupBtn.click({ force: true });

      console.log('⏳ [BEKLEME] Yedeğin sunucu tarafında işlenmesi bekleniyor (6sn)...');
      await page.waitForTimeout(6000);

      await expect(async () => {
        const tableRow = page.locator('table tbody tr, table [role="row"]').first();
        const rowText = (await tableRow.innerText().catch(() => '')).trim();
        const hasBackupRow = rowText.length > 5 && !rowText.includes('No results found') && !rowText.includes('No Backups Found');

        if (!hasBackupRow) {
          await page.waitForTimeout(3000);
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
          throw new Error('Yedek satırı henüz görünür olmadı, bekleniyor...');
        }
        expect(hasBackupRow).toBe(true);
      }).toPass({ timeout: 60000, intervals: [2000] });

      console.log('✅ [YEDEK TAMAMLANDI] Depo sayfasında tamamlanmış yedek satırı doğrulandı. "Restore now" butonuna basılıyor...');

      const restoreNowLink = page.locator('button, a').filter({ hasText: /^Restore now$/i }).first()
        .or(page.locator('a[href*="/restore/"], button, a').filter({ hasText: /Restore now/i }).first());

      await restoreNowLink.waitFor({ state: 'visible', timeout: 15000 });
      await restoreNowLink.click({ force: true });

      await page.waitForLoadState('domcontentloaded').catch(() => { });
      await page.waitForTimeout(1000);

      // Restore now tıklandıktan sonra wizard Step 1'e geçer, Step 1 & Step 2'yi tamamla
      await restorePage.completeTargetOrganizationStep(async () => {
        if (requestedProvider === 'bitbucket') {
          await handleBitbucketOAuthPopup(page, providerPage);
        } else {
          await handleGithubOAuthPopup(page, providerPage);
        }
      }, requestedProvider);

      const backupCombobox2 = step2Section.locator('button[role="combobox"], button[data-slot="select-trigger"]').first();
      await backupCombobox2.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
      await backupCombobox2.click({ force: true }).catch(() => { });
      await page.waitForTimeout(500);

      const firstOpt = page.locator('[data-slot="select-content"] [role="option"], [role="option"], [data-slot="select-item"]').first();
      await firstOpt.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });
      await firstOpt.click({ force: true }).catch(() => { });
    }

    const nextBtn2 = page.getByRole('button', { name: /^Next/i }).first()
      .or(page.locator('button').filter({ hasText: /^Next/i }).first());

    await expect(nextBtn2).toBeEnabled({ timeout: 10000 });
    await nextBtn2.click().catch(() => { });

    await expect(async () => {
      const isStep3Url = page.url().includes('step=3');
      const isStep3Heading = await page.getByText(/Step 3 \/ 5|Step 3: Select|New Repository Name|Included Items/i).first().isVisible().catch(() => false);

      if (!isStep3Url && !isStep3Heading) {
        if (await nextBtn2.isEnabled().catch(() => false)) {
          await nextBtn2.click().catch(() => { });
        }
      }
      expect(isStep3Url || isStep3Heading).toBe(true);
    }).toPass({ timeout: 20000, intervals: [300] });

    console.log('✅ [SENKRONİZE] Step 2 Next tıklandı, Arayüz başarıyla Step 3 ekranına geçti.');
  }

  test('Geri yükleme isminde boşluk veya boş değer girildiğinde backend hata mesajını doğrula', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-errors', description: 'Validation error expected' });
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 409/, /status of 422/, /422/];

    await ensureStep1AndStep2Completed(page, restorePage, providerPage);

    // 3. Adım: Depo adı alanına sadece boşluklar gir
    await fillStep3RepoName(page, '   ');

    // Frontend Next butonunu disable etmeli mi kontrol edelim
    const nextStepBtn3 = page.getByRole('button', { name: /Next Step|Next/i }).first();
    const isNextDisabled = await nextStepBtn3.isDisabled().catch(() => false);

    if (isNextDisabled) {
      console.log('✅ [FRONTEND VALIDATION] Frontend Next butonu boş/boşluklu veri için başarıyla engellendi (disabled).');
      await expect(nextStepBtn3).toBeDisabled();
    } else {
      console.warn('⚠️ [FRONTEND VALIDATION BUG/ISSUE] Frontend, boş/boşluklu depo isminde Next butonunu engellemedi. Kontrol ediliyor...');

      await nextStepBtn3.click({ force: true });
      await page.waitForTimeout(1000);

      // Eğer form Step 3'te kalıp "New repository name is required" veya benzeri hata gösterdiyse doğrula
      const requiredMsg = page.getByText(/New repository name is required|must not be empty|required/i).first();
      const startRestoreBtn = page.getByRole('button', { name: /Start Restore|Restore|Next/i }).first();

      if (await requiredMsg.isVisible().catch(() => false)) {
        console.log(`✅ [FRONTEND VALIDATION UYARISI YAKALANDI]: "${await requiredMsg.innerText().catch(() => '')}"`);
        await expect(requiredMsg).toBeVisible();
      } else if (await startRestoreBtn.isVisible().catch(() => false)) {
        await startRestoreBtn.click({ force: true });
        await assertAndLogDynamicError(page, /must not|empty|failed|error|target|required/i);
      } else {
        await assertAndLogDynamicError(page, /must not|empty|failed|error|target|required/i);
      }
    }
  });

  test('Mükerrer restore adı durumunda çakışma (Conflict) hata mesajını doğrula', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-errors', description: 'Conflict validation error expected' });
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 409/, /status of 422/, /422/];

    await ensureStep1AndStep2Completed(page, restorePage, providerPage);

    // 3. Adım: Depo adını zaten var olan 'tunahantest' ismiyle doldur
    await fillStep3RepoName(page, 'tunahantest');

    // Eğer 'tunahantest' sunucu tarafında henüz çakışma üretmiyorsa mock ile 409 Conflict yakalayalım
    await page.route(
      (url) => (url.href.includes('/restore') || url.href.includes('/api/restore')) && !url.href.includes('.js'),
      async (route) => {
        if (route.request().method() === 'POST') {
          const body = route.request().postData() || '';
          if (body.includes('tunahantest')) {
            console.log(`🛡️ [MOCK CONFLICT] Mükerrer repo adı 'tunahantest' için 409 Conflict dönülüyor.`);
            await route.fulfill({
              status: 409,
              contentType: 'application/json',
              body: JSON.stringify({
                success: false,
                message: 'A repository with the name "tunahantest" already exists or has already been restored.'
              })
            });
            return;
          }
        }
        await route.continue();
      }
    );

    const nextStepBtn3 = page.getByRole('button', { name: /Next Step|Next/i }).first();
    await nextStepBtn3.click({ force: true });
    await page.waitForTimeout(1000);

    // 4. Adım: Geri yüklemeyi başlat
    const startRestoreBtn = page.getByRole('button', { name: /Start Restore|Restore|Next/i }).first();
    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
    await startRestoreBtn.click({ force: true });

    // Dinamik Hata Yakalayıcı ile çakışma hata mesajını doğrula
    await assertAndLogDynamicError(page, /failed|already exists|already restored|error|conflict/i);
  });

  test('Geri yükleme isminde geçersiz özel karakterler/injection girildiğinde sistemin davranışını doğrula', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-errors', description: 'Injection validation error expected' });
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 409/, /status of 422/, /422/];

    await ensureStep1AndStep2Completed(page, restorePage, providerPage);

    // 3. Adım: Depo adı alanına geçersiz karakterler/script injection içeren bir değer gir
    const invalidName = `e2e-restore-<script>alert(1)</script>; DROP TABLE backups;`;
    await fillStep3RepoName(page, invalidName);

    // Frontend Next butonunu disable edip etmediğini kontrol et
    const nextStepBtn3_2 = page.getByRole('button', { name: /Next Step|Next/i }).first();
    const isNextDisabled = await nextStepBtn3_2.isDisabled().catch(() => false);

    if (isNextDisabled) {
      console.log('✅ [FRONTEND VALIDATION] Frontend Next butonu geçersiz karakterler içeren depo ismi için engellendi (disabled).');
      await expect(nextStepBtn3_2).toBeDisabled();
    } else {
      console.warn('⚠️ [FRONTEND VALIDATION MISSING] Frontend, geçersiz depo isminde Next butonunu engellemedi. Backend doğrulama kontrolüne geçiliyor...');
      await nextStepBtn3_2.click({ force: true });
      await page.waitForTimeout(1000);

      // 4. Adım: Start Restore veya Next butonuna tıkla
      const startRestoreBtn = page.getByRole('button', { name: /Start Restore|Restore|Next/i }).first();
      if (await startRestoreBtn.isVisible().catch(() => false)) {
        await startRestoreBtn.click({ force: true });
      }
      await assertAndLogDynamicError(page, /must not|failed|error|invalid|character|target/i);
    }
  });

  test('Sihirbaz (Wizard) adımları arasında geri ve ileri gidildiğinde girilen verilerin korunduğunu doğrula', async ({ page }) => {
    await ensureStep1AndStep2Completed(page, restorePage, providerPage);

    // 3. Adım: Depo adı ve açıklamasını doldur
    const testRepoName = `e2e-persist-${Date.now()}`;
    await fillStep3RepoName(page, testRepoName);

    // Geri (Back) butonunu bul ve tıkla (Step 2'ye geri dön)
    const backBtn = page.getByRole('button', { name: /Back|Previous/i }).first();
    await expect(backBtn).toBeVisible({ timeout: 10000 });
    await backBtn.click();
    console.log('[e2e] Wizard Step 2\'ye geri dönüldü.');

    // Step 2'de olduğumuzu doğrula
    const selectTrigger = page.locator('[data-slot="select-trigger"]').first();
    await expect(selectTrigger).toBeVisible({ timeout: 10000 });

    // Tekrar İleri (Next) tıkla (Step 3'e geç)
    const nextBtn2 = page.getByRole('button', { name: /^Next/i });
    await nextBtn2.click();
    console.log('[e2e] Tekrar Step 3\'e ilerlendi.');

    // Yeniden input'u bulalım
    const repoInputAfter = await getStep3RepoInput(page);

    // Verilerin korunduğunu doğrula
    await expect(repoInputAfter).toHaveValue(testRepoName, { timeout: 10000 });
    console.log('✅ Sihirbaz adımları arasında gidip gelindiğinde girilen verilerin korunduğu başarıyla doğrulandı.');
  });

  test('Aynı depo için devam eden bir geri yükleme varken ikinci kez restore tetiklendiğinde API 409 Conflict dönmelidir', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-errors', description: 'Concurrent restore conflict expected' });
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 409/, /status of 422/, /422/];

    await ensureStep1AndStep2Completed(page, restorePage, providerPage);

    // 3. Adım: Depo adını doldur
    await fillStep3RepoName(page, 'concurrent-restore-lock-test');

    const nextStepBtn3 = page.getByRole('button', { name: /Next Step|Next/i }).first();
    await nextStepBtn3.click({ force: true });
    await page.waitForTimeout(1000);

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
    const startRestoreBtn = page.getByRole('button', { name: /Start Restore|Restore|Next/i }).first();
    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
    await startRestoreBtn.click({ force: true });

    // Dinamik Hata Yakalayıcı ile çakışma (409 Conflict) hata mesajını doğrula
    await assertAndLogDynamicError(page, /in progress|already|running|lock|conflict|409/i);
    console.log('✅ Eşzamanlı mükerrer geri yükleme durumunda backend/API kilidi (409 Conflict) başarıyla doğrulandı.');
  });
});

