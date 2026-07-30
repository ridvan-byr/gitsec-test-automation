import type { Locator, Page } from '@playwright/test';
import { test, expect, GitSecPage } from '../../fixtures/test';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import { ProviderPage } from '../../pages/ProviderPage';
import { RestorePage } from '../../pages/RestorePage';
import { prepareGithubOAuthSession, ensureGithubLoginFormIfEnvUser } from '../../support/github-auth';
import { handleBitbucketAuthPopup } from '../../support/bitbucket-auth-helper';
import { requireEnv } from '../../support/require-env';

type CodeProvider = 'github' | 'bitbucket';
type RestoreLogStatus = 'START' | 'ACTION' | 'WAIT' | 'PASS' | 'FAIL';

type RestoreRepository = {
  name: string;
  fullName: string;
  provider: CodeProvider;
};

function restoreLog(
  provider: CodeProvider,
  step: string,
  status: RestoreLogStatus,
  message: string
): void {
  const statusMap: Record<string, string> = {
    PASS: 'BAŞARILI',
    FAIL: 'BAŞARISIZ',
    START: 'BAŞLATILDI',
    ACTION: 'İŞLEM',
    WAIT: 'BEKLENİYOR'
  };
  const translatedStatus = statusMap[status] ?? status;
  console.log(`[${provider.toUpperCase()}] [${step}] [${translatedStatus}] ${message}`);
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
    await handleBitbucketAuthPopup(popup).catch(() => { });
  } else {
    console.log('[e2e] Bitbucket yetkilendirmesi aynı sayfada veya pencere açılmadan tamamlandı.');
  }
}

async function handleCreateFirstBackupAndReturn(page: Page): Promise<boolean> {
  const createFirstBackupLink = page
    .getByRole('link', { name: /Create first backup/i })
    .or(page.getByRole('button', { name: /Create first backup/i }))
    .first();
  await expect(
    createFirstBackupLink,
    '"No Backups Found" durumunda Create first backup kontrolü görünür olmalı'
  ).toBeVisible({ timeout: 15_000 });

  const href = await createFirstBackupLink.getAttribute('href').catch(() => '');
  console.log(`🚀 [RESTORE -> BACKUP] "Create first backup" bağlantısına tıklanıyor (${href || 'link'})...`);

  await Promise.all([
    page.waitForURL(/\/repository\/\d+/, { timeout: 25_000 }),
    createFirstBackupLink.click()
  ]);

  // Taze yedek alınan deponun başlığını/ismini saklayalım
  const repoHeading = await page.locator('h1, h2, [class*="title"]').first().innerText().catch(() => '');
  const backedUpRepoUrl = page.url();
  console.log(`📌 [YEDEK TAKİBİ] Taze yedek alınan depo: "${repoHeading}" (${backedUpRepoUrl})`);

  const backupNowBtn = page.getByRole('button', { name: /Backup now/i }).first();
  await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });

  const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i }).first();
  await backupNowBtn.click();
  await startBackupBtn.waitFor({ state: 'visible', timeout: 15000 });

  const triggerResponsePromise = page.waitForResponse(
    response => response.url().includes('/api/backup/schedules/trigger') || response.url().includes('/trigger'),
    { timeout: 30000 }
  );

  await startBackupBtn.click();

  const triggerResponse = await triggerResponsePromise;
  let scheduleId: string | null = null;
  let executionId: string | null = null;
  expect(
    triggerResponse.ok(),
    `Backup trigger API başarılı olmalı: HTTP ${triggerResponse.status()}`
  ).toBe(true);
  const triggerResult = await triggerResponse.json().catch(() => null);
  scheduleId = triggerResult?.data?.scheduleId ? String(triggerResult.data.scheduleId) : (triggerResult?.scheduleId ? String(triggerResult.scheduleId) : null);
  executionId = triggerResult?.data?.executionId ? String(triggerResult.data.executionId) : (triggerResult?.executionId ? String(triggerResult.executionId) : null);
  console.log(`📌 [YEDEK TETİKLEME] ScheduleId: ${scheduleId || 'yok'}, ExecutionId: ${executionId || 'yok'}`);

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

  console.log(`⏳ [BEKLEME] [CANLI API EXECUTION İLERLEME DİNLEYİCİ] Repository (${repoId}) için yedekleme bekleniyor...`);

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
            }
            if (latest.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100) {
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

      // 1. ScheduleId var ama executionId henüz yakalanmadıysa API'den çöz:
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

      // 2. Birincil Doğrulama & Canlı Loglama: GET /api/backup/executions/{executionId}
      if (executionId) {
        const execUrl = `${apiBaseUrl}/api/backup/executions/${executionId}`;
        const execRes = await page.request.get(execUrl, { headers }).catch(() => null);
        if (execRes && execRes.ok()) {
          const execJson = await execRes.json().catch(() => null);
          const data = execJson?.data;
          if (data) {
            const prog = data.progressPercent ?? (data.completedAt ? 100 : 0);
            const st = data.executionStatus ?? data.status;
            const total = data.totalJobCount ?? '?';
            const completed = data.completedJobCount ?? '?';
            console.log(`📡 [CANLI YEDEK İLERLEMESİ] Execution ID: ${executionId} | Yüzde: %${prog} | Tamamlanan İş: ${completed}/${total} | Durum: ${st}`);
            if (data.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100) {
              console.log(`🎉 [YEDEK TAMAMLANDI] Execution ID: ${executionId} | Yüzde: %100 | Tamamlanan İş: ${completed}/${total} | Durum: COMPLETED`);
              isCompleted = true;
              return;
            }
          }
        }
      }

      // 3. Snapshots API (Repo bazlı canlı durum sorgusu)
      if (repoId) {
        const snapshotsUrl = `${apiBaseUrl}/api/backup/snapshots?Pagination.CurrentPage=1&Pagination.MaxRowsPerPage=10&Criteria.RepositoryId=${repoId}`;
        const snRes = await page.request.get(snapshotsUrl, { headers }).catch(() => null);
        if (snRes && snRes.ok()) {
          const snJson = await snRes.json().catch(() => null);
          const snItems = snJson?.data?.list || (Array.isArray(snJson?.data) ? snJson.data : null);
          if (snItems && snItems.length > 0) {
            console.log(`📡 [API SNAPSHOTS DOĞRULAMA] Depo (${repoId}) için taze backup snapshot'ı teyit edildi! (Count: ${snItems.length})`);
            isCompleted = true;
            return;
          }
        }
      }

      // 4. Executions API Fallback (Schedule bazlı)
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
          console.log(`📡 [API EXECUTIONS POLING - 2s (Sorgu ${pollCounter})] İlerleme: %${prog}, Durum: ${st}`);

          if (latest.completedAt || st === 'COMPLETED' || st === 'SUCCESS' || st === 3 || st === '3' || prog === 100) {
            console.log(`🎉 [BAŞARILI] [API EXECUTIONS] Yedekleme %100 tamamlandı! (Durum: ${st})`);
            isCompleted = true;
            return;
          }
        }
      }

      throw new Error(`Yedekleme henüz tamamlanmadı (Canlı API İlerlemesi: %${detectedProgress}, Durum: ${detectedStatus || 'DEVAM EDİYOR'})`);
    }).toPass({ timeout: 90000, intervals: [2000] });
  } finally {
    page.off('response', responseHandler);
  }

  await page.waitForLoadState('domcontentloaded').catch(() => { });

  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

  console.log(`👆 [TIKLAMA] Taze yedek alınan deponun ("${repoHeading}") sayfasındaki "Restore now" bağlantısına tıklanıyor...`);

  // HTML'deki tam eşleşen <a> tag'i (`a[href*="/restore/"]`)
  const restoreNowLink = page.locator('a[href*="/restore/"], button, a').filter({ hasText: /Restore now/i }).first();
  await restoreNowLink.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

  if (await restoreNowLink.isVisible().catch(() => false)) {
    const snapshotsResponsePromise = page.waitForResponse(
      res => res.url().includes('/api/backup/snapshots') && res.status() === 200,
      { timeout: 15000 }
    ).catch(() => null);

    await restoreNowLink.click({ force: true }).catch(() => { });
    await snapshotsResponsePromise;
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ [BAŞARILI] Repo sayfasındaki "Restore now" bağlantısına tıklandı. Sihirbaz doğrudan bu repo için Step 2'de açıldı.`);
    return true;
  }

  // Fallback: Eğer repo sayfasında Restore now butonu yoksa (nadir durum)
  console.log(`🔄 [RESTORE KURTARMA] Restore sayfasına geri dönülüyor ve taze yedek alınan depo ("${repoHeading}") seçiliyor...`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/restore`, { waitUntil: 'networkidle' }).catch(() => { });

  const wizardBtn = page
    .locator('button[data-slot="dialog-trigger"][aria-haspopup="dialog"]')
    .filter({ hasText: /^Restore Wizard$/i })
    .first();
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
      await page.waitForLoadState('domcontentloaded').catch(() => { });
    }
  }

  await page.waitForLoadState('domcontentloaded').catch(() => { });
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
      // Eğer '/' içermiyorsa (Repositories sayfasındaki gibi) direkt temiz ismi dön
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

    const row = repoTable.locator('tbody tr').filter({ hasText: repoName }).first();
    if (await row.count() > 0) {
      foundRow = row;
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

async function ensureIncludedRepoForProvider(
  page: Page,
  provider: CodeProvider
): Promise<RestoreRepository> {
  const providerPage = new ProviderPage(page);
  restoreLog(provider, 'REPOSITORY', 'START', 'Include edilmiş repository aranıyor.');

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
    restoreLog(provider, 'REPOSITORY', 'FAIL', 'Dahil edilebilir repository bulunamadı.');
    throw new Error(`${provider} için dahil edilebilir repository bulunamadı.`);
  }

  const fullName = await getRepoNameFromRow(targetRow);
  if (!fullName) {
    throw new Error(`${provider} repository satırından repository adı okunamadı.`);
  }
  const repository: RestoreRepository = {
    name: getRepoNameWithoutOrg(fullName),
    fullName,
    provider
  };

  const scopeSwitch = targetRow.getByRole('switch').first();
  if (!includedRow) {
    restoreLog(
      provider,
      'REPOSITORY',
      'ACTION',
      `Include edilmiş repo yok; ilk uygun repo include ediliyor: ${repository.fullName}`
    );

    const inclusionResponsePromise = page.waitForResponse(
      response =>
        response.url().includes('/api/repositories/license-inclusion-status') &&
        response.request().method() !== 'GET',
      { timeout: 30_000 }
    );

    await scopeSwitch.click();
    const inclusionResponse = await inclusionResponsePromise;
    expect(
      inclusionResponse.ok(),
      `Repository include API başarılı olmalı: HTTP ${inclusionResponse.status()}`
    ).toBe(true);
    await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25_000 });
  }

  restoreLog(
    provider,
    'REPOSITORY',
    'PASS',
    `Restore için repository hazır: ${repository.fullName}`
  );
  return repository;
}

async function detectCurrentRestoreStep(page: Page): Promise<number> {
  const url = page.url();

  if (url.includes('step=4') || (await page.getByRole('button', { name: 'Start Restore', exact: true }).first().isVisible().catch(() => false))) {
    return 4;
  }

  if (url.includes('step=3') || (await page.getByRole('heading', { name: /Restore Details|Select Target/i }).first().isVisible().catch(() => false))) {
    return 3;
  }

  if (url.includes('step=2') || (await page.getByRole('heading', { name: /Select backup source/i }).first().isVisible().catch(() => false)) || (await page.locator('a[href*="/repository/"]').filter({ hasText: /Create first backup/i }).first().isVisible().catch(() => false))) {
    return 2;
  }

  if (url.includes('step=1') || (await page.getByRole('heading', { name: /Target Organization/i }).first().isVisible().catch(() => false)) || (await page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select target organization/i }).first().isVisible().catch(() => false))) {
    return 1;
  }

  return 0;
}

test.describe('Backups — restore sayfasına yönlendirme', () => {
  test('Completed satırı veya Partially Completed filtresi ile restore', async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [/status of 502/, /502/, /NetworkFailure/, /chunks/];
    test.setTimeout(300000);
    (page as GitSecPage).ignoredErrors = [/restore\/schedules\/trigger/, /status of 500/];
    const providerPage = new ProviderPage(page);
    const restorePage = new RestorePage(page);
    const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const getOrNavigateActiveWorkspaceId = async (p: Page): Promise<string> => {
      let m = p.url().match(/\/(\d+)(?:\/|$)/);
      if (!m || !m[1]) {
        await p.goto(dashboardBaseUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
        await p.waitForURL(/\/(\d+)\//, { timeout: 15000 }).catch(() => { });
        m = p.url().match(/\/(\d+)(?:\/|$)/);
      }
      return m && m[1] ? m[1] : (process.env.WORKSPACE_ID || '345');
    };
    const workspaceId = await getOrNavigateActiveWorkspaceId(page);
    const requestedProvider: CodeProvider =
      (process.env.E2E_CODE_PROVIDER || 'github').trim().toLowerCase() === 'bitbucket'
        ? 'bitbucket'
        : 'github';

    const navigateToRestorePage = async (p: Page): Promise<void> => {
      if (p.url().includes('/restore')) return;
      const wsId = await getOrNavigateActiveWorkspaceId(p);
      const targetRestoreUrl = `${dashboardBaseUrl}/${wsId}/restore`;

      console.log(`[e2e] Restore sayfasına yönlendiriliyor (Workspace ID: ${wsId})...`);

      await p.waitForLoadState('domcontentloaded').catch(() => { });

      const sidebarLink = p.locator('a[href*="/restore"]')
        .or(p.getByRole('link', { name: /Restores/i }))
        .or(p.locator('aside, nav').locator('a').filter({ hasText: /^Restores$/i }))
        .first();

      await expect(async () => {
        if (p.url().includes('/restore')) return;

        const isLinkVisible = await sidebarLink.isVisible().catch(() => false);
        if (isLinkVisible) {
          await sidebarLink.scrollIntoViewIfNeeded().catch(() => { });
          await sidebarLink.click({ force: true }).catch(() => { });
        } else {
          await p.goto(targetRestoreUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
        }

        await p.waitForTimeout(600);
        expect(p.url().includes('/restore'), 'URL /restore içermeli').toBe(true);
      }).toPass({ timeout: 25000, intervals: [1000] }).catch(async () => {
        if (!p.url().includes('/restore')) {
          console.log(`[e2e] Direct goto ile restore sayfasına gidiliyor: ${targetRestoreUrl}`);
          await p.goto(targetRestoreUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
        }
      });

      await expect(p).toHaveURL(/\/restore/, { timeout: 15000 });
    };

    restoreLog(requestedProvider, 'TEST', 'START', 'Restore happy path başlatıldı.');

    let currentStep = 0;
    let sourceRepository: RestoreRepository | null = null;
    if (currentStep === 0) {
      await navigateToRestorePage(page);

      const wizardBtn = page.getByRole('button', { name: 'Restore Wizard' }).first()
        .or(page.locator('button').filter({ hasText: /Restore Wizard/i }).first());
      const dialog = page.locator('div[role="dialog"]').first();

      const openWizardRepositoryOptions = async (): Promise<Locator> => {
        restoreLog(requestedProvider, 'SOURCE_REPOSITORY', 'ACTION', 'Restore Wizard açılıyor.');
        await wizardBtn.waitFor({ state: 'visible', timeout: 20_000 });

        await expect(async () => {
          const isDialogOpen = await dialog.isVisible().catch(() => false);
          if (!isDialogOpen) {
            await wizardBtn.scrollIntoViewIfNeeded().catch(() => { });
            await wizardBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(600);
          }
          expect(await dialog.isVisible().catch(() => false), 'Restore Wizard dialog görünür olmalı').toBe(true);
        }).toPass({ timeout: 25_000, intervals: [1000] });

        const options = page.locator('[data-radix-popper-content-wrapper] [role="option"], [role="option"], [data-slot="select-item"]');

        await expect(async () => {
          const isDialogOpen = await dialog.isVisible().catch(() => false);
          if (!isDialogOpen) {
            await wizardBtn.click({ force: true }).catch(() => { });
            await page.waitForTimeout(500);
          }

          const repositoryCombobox = dialog
            .getByRole('combobox')
            .or(dialog.locator('button[data-slot="select-trigger"]'))
            .first();
          await repositoryCombobox.waitFor({ state: 'visible', timeout: 5000 });

          const isExpanded = await repositoryCombobox.getAttribute('aria-expanded').catch(() => 'false');
          if (isExpanded !== 'true') {
            await repositoryCombobox.click({ force: true }).catch(() => { });
            await page.keyboard.press('Space').catch(() => { });
            await page.waitForTimeout(500);
          }

          const count = await options.count();
          expect(count, 'Wizard dropdown opsiyonları görünür olmalı').toBeGreaterThan(0);
        }).toPass({ timeout: 25_000, intervals: [1000] });

        return options;
      };

      let targetOption: Locator | null = null;
      let targetOptionText = '';
      let optionLocators = await openWizardRepositoryOptions();
      let count = await optionLocators.count();

      // Happy path: Restore Wizard içinde görünen ilk include repository doğrudan kullanılır.
      for (let i = 0; i < count; i++) {
        const option = optionLocators.nth(i);
        const text = (await option.innerText()).replace(/\s+/g, ' ').trim();
        if (text && !/excluded/i.test(text)) {
          targetOption = option;
          targetOptionText = text;
          const fullNameMatch = text.match(/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/);
          const fullName = fullNameMatch?.[0] ?? text;
          sourceRepository = {
            name: getRepoNameWithoutOrg(fullName),
            fullName,
            provider: requestedProvider
          };
          restoreLog(
            requestedProvider,
            'SOURCE_REPOSITORY',
            'PASS',
            `Wizard içinde include repository bulundu: ${fullName}`
          );
          break;
        }
      }

      // Edge case: Wizard'daki bütün repository'ler excluded ise provider sayfasında bir tane include edilir.
      if (!targetOption) {
        restoreLog(
          requestedProvider,
          'SOURCE_REPOSITORY',
          'WAIT',
          'Wizard içinde include repository yok; provider sayfasında bir repository include edilecek.'
        );
        await page.keyboard.press('Escape');
        const closeDialogButton = dialog.getByRole('button', { name: /close/i }).first();
        if (await closeDialogButton.isVisible()) {
          await closeDialogButton.click();
        } else {
          await page.keyboard.press('Escape');
        }

        sourceRepository = await test.step(
          `${requestedProvider}: ilk uygun repository'yi include et`,
          () => ensureIncludedRepoForProvider(page, requestedProvider)
        );

        await page.goto(`${dashboardBaseUrl}/${workspaceId}/restore`, { waitUntil: 'networkidle' }).catch(() => {
          return page.waitForLoadState('domcontentloaded');
        });
        optionLocators = await openWizardRepositoryOptions();
        count = await optionLocators.count();

        for (let i = 0; i < count; i++) {
          const option = optionLocators.nth(i);
          const text = (await option.innerText()).replace(/\s+/g, ' ').trim();
          const normalizedText = text.toLowerCase();
          if (
            !/excluded/i.test(text) &&
            (normalizedText.includes(sourceRepository.fullName.toLowerCase()) ||
              normalizedText.includes(sourceRepository.name.toLowerCase()))
          ) {
            targetOption = option;
            targetOptionText = text;
            break;
          }
        }
      }

      if (!targetOption || !sourceRepository) {
        throw new Error(
          `Restore Wizard içinde kullanılabilir ${requestedProvider} repository bulunamadı.`
        );
      }

      console.log(`🎉 [EŞLEŞME] Restore edilebilir repository seçiliyor: "${targetOptionText.trim()}"`);
      await targetOption.click({ force: true });

      const continueBtn = page.getByRole('button', { name: 'Continue' }).first();
      await expect(continueBtn).toBeEnabled({ timeout: 10000 });
      await continueBtn.click();
      await expect(page).toHaveURL(/\/restore\/.+/, { timeout: 25_000 });
      await expect(restorePage.targetOrganizationCombobox()).toBeVisible({ timeout: 20_000 });
      restoreLog(
        requestedProvider,
        'SOURCE_REPOSITORY',
        'PASS',
        `Source repository seçildi: ${sourceRepository.fullName}`
      );
      currentStep = 1;
    }

    if (!sourceRepository) {
      throw new Error('Restore source repository seçimi tamamlanmadı.');
    }

    // Step 1: Target Organization
    if (currentStep <= 1) {
      console.log('[e2e] Step 1: Target Organization seçimi kontrol ediliyor...');
      const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
      if (await licenseError.isVisible().catch(() => false)) {
        throw new Error('Repository is not included in the license.');
      }

      const orgStep = await test.step(
        `${requestedProvider}: target organization seç veya bağla`,
        () => restorePage.completeTargetOrganizationStep(async () => {
          if (requestedProvider === 'bitbucket') {
            await handleBitbucketOAuthPopup(page, providerPage);
          } else {
            await handleGithubOAuthPopup(page, providerPage);
          }
        }, requestedProvider)
      );

      if (orgStep === 'installed_new_org') {
        console.log('[e2e] Yeni organizasyon yetkilendirme adımı tamamlandı.');
      } else {
        console.log('[e2e] Mevcut organizasyon seçildi ve Next Step ile ilerlendi.');
      }
      currentStep = 2;
    }

    // Step 2: Backup Source Selection (veya Step 1'den geçiş)
    if (currentStep <= 2) {
      console.log('[e2e] Step 2: Backup Source (Yedek kaynağı) seçimi kontrol ediliyor...');

      // Eğer hala Step 1'de ise "Next Step" butonuna basarak Step 2'ye geç
      const step1NextBtn = page.locator('button').filter({ hasText: /Next Step/i }).first()
        .or(page.getByRole('button', { name: /Next Step/i }).first());

      if (await step1NextBtn.isVisible().catch(() => false)) {
        console.log('[e2e] Sihirbaz Step 1 (Target Organization) olarak açık. "Next Step" butonuna tıklanarak Step 2\'ye geçiliyor...');
        await step1NextBtn.click({ force: true });
        await page.waitForLoadState('domcontentloaded').catch(() => { });
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

        restoreLog(
          requestedProvider,
          'BACKUP',
          'START',
          `"${sourceRepository.fullName}" için yedek bulunamadı; ilk yedek oluşturuluyor.`
        );

        // Combobox backdrop'ını kapat ki Create first backup tıklamasını engellemesin
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

        const triggerResponsePromise = page.waitForResponse(
          response => response.url().includes('/api/') && (response.url().includes('trigger') || response.url().includes('backup')),
          { timeout: 30000 }
        ).catch(() => null);

        await startBackupBtn.click({ force: true });

        const triggerResponse = await triggerResponsePromise;
        console.log(`📌 [YEDEK TETİKLENDİ] HTTP Status: ${triggerResponse ? triggerResponse.status() : 'yok'}`);

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

        const restoreNowLink = page.locator('button, a').filter({ hasText: /^Restore now$/i }).first()
          .or(page.locator('a[href*="/restore/"], button, a').filter({ hasText: /Restore now/i }).first());

        await restoreNowLink.waitFor({ state: 'visible', timeout: 30000 });
        await restoreNowLink.click({ force: true });
        await page.waitForLoadState('domcontentloaded').catch(() => { });
        await page.waitForTimeout(1500);

        console.log('🔄 [RESTORE KURTARMA] Taze yedek oluşturuldu. Sihirbazda organizasyon ve yeni yedek seçiliyor...');

        // Eğer Sihirbaz Step 1 (Target Organization) olarak açıldıysa organizasyon seçimini yap ve Step 2'ye geç
        const isStep1UI = await page.locator('label, div, p').filter({ hasText: /Select target organization|Target Organization/i }).first().isVisible().catch(() => false);
        if (isStep1UI) {
          console.log('[restore kurtarma] Sihirbaz yeniden Step 1\'de açıldı. Target Organization tamamlanıyor...');
          await restorePage.completeTargetOrganizationStep(async () => {
            if (requestedProvider === 'bitbucket') {
              await handleBitbucketOAuthPopup(page, providerPage);
            } else {
              await handleGithubOAuthPopup(page, providerPage);
            }
          }, requestedProvider);
        }

        const freshStep2Section = page.locator('main, form, div[class*="card"]').filter({ hasText: /Select backup source|Backup \*/i }).last();

        const freshCombobox = freshStep2Section.locator('button[role="combobox"], button[data-slot="select-trigger"]').first()
          .or(
            page.locator('div, label').filter({ hasText: /^Backup \*?$/i }).locator('..').locator('button[role="combobox"], button[data-slot="select-trigger"]').first()
          )
          .or(
            page.locator('button[role="combobox"], button[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first()
          );

        await freshCombobox.waitFor({ state: 'visible', timeout: 15000 });

        let freshSelectedText = '';
        await expect(async () => {
          const isExpandedFresh = await freshCombobox.getAttribute('aria-expanded').catch(() => 'false');
          if (isExpandedFresh !== 'true') {
            await freshCombobox.click({ force: true }).catch(() => { });
            await page.waitForTimeout(400);
          }

          const selectPopper = page.locator('[data-slot="select-content"], [role="listbox"], [data-radix-popper-content-wrapper]:visible')
            .filter({ has: page.locator('[role="option"], [data-slot="select-item"]') })
            .last();

          await selectPopper.waitFor({ state: 'visible', timeout: 5000 });

          const options = selectPopper.locator('[role="option"], [data-slot="select-item"]');
          const count = await options.count();

          let targetOpt: Locator | null = null;
          for (let i = 0; i < count; i++) {
            const opt = options.nth(i);
            const text = (await opt.innerText().catch(() => '')).trim();
            if (isRealBackupOptionText(text)) {
              targetOpt = opt;
              freshSelectedText = text;
              break;
            }
          }

          if (!targetOpt) {
            await page.keyboard.press('Escape').catch(() => { });
            await page.waitForTimeout(400);
            throw new Error('Yedek opsiyonu henüz popover içinde belirmedi, API bekleniyor...');
          }

          await targetOpt.click({ force: true });
          await page.waitForTimeout(500);

          const currentVal = (await freshCombobox.innerText().catch(() => '')).trim();
          expect(currentVal).not.toContain('Select a backup');
        }).toPass({ timeout: 30000, intervals: [1200] });

        console.log(`🎉 [YEDEK SEÇİLDİ] Taze oluşturulan yedek seçildi: "${freshSelectedText.trim()}"`);

        const nextBtn2After = page.getByRole('button', { name: /^Next/i }).first()
          .or(page.locator('button').filter({ hasText: /^Next/i }).first());
        await expect(nextBtn2After).toBeEnabled({ timeout: 20000 });
        await nextBtn2After.click({ force: true }).catch(() => { });

        restoreLog(
          requestedProvider,
          'BACKUP',
          'PASS',
          `"${sourceRepository.fullName}" için tamamlanmış yedek oluşturuldu ve seçildi.`
        );
        currentStep = 3;
      } else {
        console.log(`🎉 [BAŞARILI SEÇİM] Step 2: Mevcut yedek seçildi: "${selectedTextStep2.trim()}"`);
        const nextBtn2 = page.getByRole('button', { name: /^Next/i }).first()
          .or(page.locator('button').filter({ hasText: /^Next/i }).first());
        await expect(nextBtn2).toBeEnabled({ timeout: 15000 });
        await nextBtn2.click({ force: true }).catch(() => { });
        currentStep = 3;
      }

      // 4. ADIM: "Next ->" Butonuna tıklayıp Step 3'e geç
      const nextBtn2 = page.locator('main form, form, div[class*="card"]').locator('button').filter({ hasText: /^Next/i }).first()
        .or(page.getByRole('button', { name: /^Next/i }).first());

      await expect(nextBtn2).toBeEnabled({ timeout: 10000 });
      currentStep = 3;
    }

    // Step 3: Select Included Items & Workspace Details
    if (currentStep <= 3) {
      console.log('[e2e] Step 3: Detaylar ve Depo Adı dolduruluyor...');

      // Form kartını bul (Arama çubuğunu kesinlikle hariç tut)
      const formCard = page.locator('main form, form, div[class*="card"]')
        .filter({ hasText: /New Repository Name|Select Included Items/i })
        .filter({ hasNotText: /Search pages, repositories/i })
        .last();
      await formCard.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });

      // Eğer yalnızca Form Kartı içinde "Workspace *" etiketi taşıyan combobox varsa seç (Sidebar/Header kesinlikle hariç!)
      const formWorkspaceContainer = formCard.locator('label, div').filter({ hasText: /^Workspace/i }).first();
      const workspaceTrigger = formWorkspaceContainer.locator('button[data-slot="select-trigger"], button[role="combobox"]').first();

      if (await workspaceTrigger.isVisible().catch(() => false)) {
        console.log('[e2e] Step 3: Form içi "Workspace *" combobox bulundu, tıklanıp workspace seçiliyor...');
        await workspaceTrigger.click({ force: true }).catch(() => { });
        await page.waitForTimeout(300);
        const wsOption = page.locator('[data-radix-popper-content-wrapper] [role="option"], [role="option"], [data-slot="select-item"]').first();
        if (await wsOption.isVisible().catch(() => false)) {
          await wsOption.click({ force: true }).catch(() => { });
        }
      }

      const tempRepoName = `e2e-restore-${requestedProvider}-${Date.now()}-${test.info().workerIndex}`;

      // "New Repository Name" başlığından hemen sonra gelen ilk input alanını doğrudan hedefle
      const repositoryNameInput = page.locator('xpath=//*[contains(text(), "New Repository Name")]/following::input[1]')
        .or(page.getByLabel(/New Repository Name/i).first())
        .or(page.locator('input[placeholder*="Repository"], input[placeholder*="repository"]').first())
        .or(page.getByRole('textbox').first())
        .first();

      await expect(repositoryNameInput, 'New Repository Name alanı görünür olmalı').toBeVisible({ timeout: 15_000 });
      await repositoryNameInput.scrollIntoViewIfNeeded().catch(() => { });
      await repositoryNameInput.click({ force: true });
      await repositoryNameInput.focus();
      await repositoryNameInput.clear().catch(() => { });
      await repositoryNameInput.fill(tempRepoName);
      await repositoryNameInput.dispatchEvent('input').catch(() => { });
      await repositoryNameInput.dispatchEvent('change').catch(() => { });
      await repositoryNameInput.press('Tab').catch(() => { });

      await expect(repositoryNameInput).toHaveValue(tempRepoName);

      restoreLog(
        requestedProvider,
        'RESTORE_DETAILS',
        'PASS',
        `Benzersiz target repository adı girildi: ${tempRepoName}`
      );

      // Step 3 submit: New Repository Name doldurulduktan sonra Next Step butonuna tıkla
      const nextStepBtn3 = page.getByRole('button', { name: /Next Step|Next|Continue/i }).first()
        .or(page.locator('button').filter({ hasText: /Next Step|Next Step/i }).first());

      const startRestoreBtnLocator = page.getByRole('button', { name: /Start Restore/i }).first()
        .or(page.locator('button').filter({ hasText: /Start Restore/i }).filter({ hasNotText: /Startup/i }).first());

      await expect(nextStepBtn3).toBeEnabled({ timeout: 15_000 });
      console.log('[e2e] Step 3 "Next step" butonuna tıklanıyor...');
      await nextStepBtn3.click({ force: true });
      await expect(startRestoreBtnLocator).toBeVisible({ timeout: 25_000 });

      console.log('✅ [SENKRONİZE] Arayüz başarıyla Step 4 (Start Restore onay) adımına geçti.');
      currentStep = 4;
    }

    // Step 4: Start Restore
    console.log('[e2e] Step 4: Start Restore onay adımı çalıştırılıyor...');

    const startRestoreBtn = page.getByRole('button', { name: /Start Restore/i }).first()
      .or(page.locator('button').filter({ hasText: /Start Restore/i }).filter({ hasNotText: /Startup/i }).first());

    await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });

    const [triggerRestoreRes] = await Promise.all([
      page.waitForResponse(
        res => res.url().includes('/api/') && (res.url().includes('restore') || res.url().includes('schedules/trigger')),
        { timeout: 25000 }
      ),
      startRestoreBtn.click({ force: true })
    ]);

    console.log(`📡 [RESTORE API YANITI] HTTP Status: ${triggerRestoreRes.status()} (${triggerRestoreRes.url()})`);

    if (triggerRestoreRes.status() >= 400) {
      const errBody = await triggerRestoreRes.text().catch(() => '');
      throw new Error(`Restore API sunucusu hata döndü (HTTP ${triggerRestoreRes.status()}): ${errBody}`);
    }

    const restoreOutcome = page
      .getByText(/restore (started|created|scheduled|in progress|completed)|successfully/i)
      .or(page.getByRole('status'))
      .first();
    await expect(
      restoreOutcome,
      'Restore isteğinden sonra kullanıcıya görünür bir sonuç gösterilmeli'
    ).toBeVisible({ timeout: 25_000 });
    restoreLog(
      requestedProvider,
      'RESTORE',
      'PASS',
      `Restore isteği kabul edildi ve UI sonucu doğrulandı: HTTP ${triggerRestoreRes.status()}`
    );
  });
});
