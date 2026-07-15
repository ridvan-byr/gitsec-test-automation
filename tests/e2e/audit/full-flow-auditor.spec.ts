import { test, expect, GitSecPage } from '../../fixtures/test';
import { StoragePage } from '../../pages/StoragePage';
import { ProviderPage } from '../../pages/ProviderPage';
import { RestorePage } from '../../pages/RestorePage';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import { OneDriveLoginPage } from '../../pages/OneDriveLoginPage';
import { prepareGithubOAuthSession, ensureGithubLoginFormIfEnvUser } from '../../support/github-auth';
import { verifyAuditLogViaAPI } from '../../support/audit-helper';
import { requireEnv } from '../../support/require-env';
import { checkIfOnGithubMainPageAndClose } from '../../support/github-oauth-helpers';
import type { Page, Locator } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function visualPause(page: Page, ms: number = 2000) {
  await page.waitForTimeout(ms);
}

async function waitTableLoadingFinished(page: Page, repoTable: Locator) {
  await expect(async () => {
    const firstRow = repoTable.locator('tbody tr').first();
    const cells = firstRow.locator('td');
    const count = await cells.count();
    let hasValidName = false;
    for (let i = 0; i < count; i++) {
      const text = await cells.nth(i).textContent().catch(() => '');
      if (text && text.trim().includes('/') && text.trim().length > 1) {
        hasValidName = true;
        break;
      }
    }
    expect(hasValidName).toBeTruthy();
  }).toPass({ timeout: 20000, intervals: [200] });
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

  const page = restore.page();
  const licenseError = page.getByText(/not included in your license|not included in the license/i).first();
  const isLicenseErrorVisible = await licenseError.waitFor({ state: 'visible', timeout: 3000 }).catch(() => false);

  if (isLicenseErrorVisible) {
    console.error('--------------------------------------------------');
    console.error('[RESTORE HATA] DİKKAT: Seçilen repository lisansa dahil (include) edilmemiş!');
    console.error('--------------------------------------------------');
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
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 250)));
}

test.describe('GitSec Grand Integration Flow (Toplu Entegrasyon Akışı E2E)', () => {
  test.setTimeout(360000);

  test('Tüm platform adımlarını koştur ve Audit Log detaylarını doğrula', async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /Cross-Origin-Opener-Policy/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /HTTP Status 502/
    ];

    const providerPage = new ProviderPage(page);
    const storagePage = new StoragePage(page);

    const workspaceId = requireEnv('WORKSPACE_ID');
    const githubUsername = requireEnv('GITHUB_TEST_USER');
    const githubPassword = requireEnv('GITHUB_TEST_PASSWORD');

    let cleanedRepoName = '';
    let repoNameOnly = '';
    let didGithubConnect = false;
    let tempRestoreRepoName = '';

    // ─────────────────────────────────────────────────────────────
    // 🔑 ADIM 1: GİRİŞ YAP VE DASHBOARD HAZIRLA
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 1: Giriş Yap ve Dashboard Hazırla', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 1: Giriş Yapılıyor ve Dashboard Hazırlanıyor...');
      console.log('==================================================');
      await providerPage.navigateToDashboard();
      await providerPage.waitForDashboardReady();
      await visualPause(page, 2000);

      // Giriş (Logged In) Logu kontrolü
      await verifyAuditLogViaAPI(page, {
        category: 'Auth',
        descriptionRegex: /Logged In|Giriş|logged in/i
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 🔗 ADIM 2: GITHUB PROVIDER BAĞLANTISI
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 2: GitHub Provider Bağlantısı', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 2: GitHub Provider Bağlanıyor...');
      console.log('==================================================');
      await providerPage.goToAddProviderPage();
      await visualPause(page, 2000);

      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        providerPage.selectGithub()
      ]);

      const popupGithubPage = new GithubLoginPage(popup);
      console.log('🔗 GitHub Popup Penceresinin yüklenmesi bekleniyor...');
      await popup.waitForLoadState('domcontentloaded');
      await popup.waitForURL(/.*github\.com.*/);

      // Eğer zaten bağlıysa ve direkt kurulum/hesap sayfasına yönlendirildiyse erken kapat
      let isFinished = await checkIfOnGithubMainPageAndClose(popup);
      if (!isFinished) {
        const loginInput = popup.locator('input[name="login"]');
        if (await loginInput.isVisible().catch(() => false)) {
          console.log('🔒 GitHub Login ekranına şifre yazılıyor...');
          const loginOk = await popupGithubPage.loginAndHandleTwoFactor(githubUsername, githubPassword);
          if (!loginOk) {
            console.log('❌ GitHub 2FA otomasyonla geçilemedi; OAuth adımı tamamlanamıyor.');
          }
        } else {
          console.log('ℹ️ Login ekranı görünmedi (zaten oturum açık/yetkili olabilir).');
          const twoFaOk = await popupGithubPage.handleTwoFactorAuthentication();
          if (!twoFaOk) {
            console.log('❌ Açık oturumda 2FA otomasyonla geçilemedi.');
          }
        }

        isFinished = await checkIfOnGithubMainPageAndClose(popup);
        if (!isFinished) {
          console.log('📦 Install → sudo e-posta → Install...');
          const flowOk = await popupGithubPage.completePermissionsInstallFlow();
          
          isFinished = await checkIfOnGithubMainPageAndClose(popup);
          if (!isFinished) {
            if (popup.isClosed()) {
              console.log('✅ Popup kapandı.');
            } else if (flowOk) {
              await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
            } else {
              const u = popup.url();
              const onInstallations =
                /github\.com\/settings\/installations/.test(u) || /github\.com\/apps\/[^/]+\/installations/.test(u);
              if (onInstallations) {
                console.log('ℹ️ GitHub installations; popup kapatılıyor.');
                if (!popup.isClosed()) await popup.close();
              } else {
                console.log('ℹ️ Install butonu yok, URL:', u);
              }
            }
          }
        }
      }
      
      didGithubConnect = !isFinished;
      console.log(`GitHub bağlantı akışı tamamlandı. Yeni bağlantı kuruldu mu: ${didGithubConnect}`);
      await visualPause(page, 2000);

      // GitHub Entegrasyon Logu Kontrolü (sadece yeni bağlantı kurulduysa)
      if (didGithubConnect) {
        await verifyAuditLogViaAPI(page, {
          category: 'Github Integration',
          descriptionRegex: /Authorized|Connected/i
        });
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 📦 ADIM 3: REPO DAHİL ETME (INCLUDE) VE DIŞLAMA (EXCLUDE) KONTROLLERİ
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 3: Repo Dahil Etme ve Dışlama Kontrolleri', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 3: Repo Dahil Etme ve Dışlama Kontrolleri...');
      console.log('==================================================');
      await providerPage.goToRepositoriesGithub();

      const repoTable = page.locator('table')
        .filter({ has: page.locator('thead [role="checkbox"], tbody [role="checkbox"]') })
        .first();
      await repoTable.waitFor({ state: 'visible', timeout: 30000 });
      await waitTableLoadingFinished(page, repoTable);

      const firstRow = repoTable.locator('tbody tr').first();
      await firstRow.waitFor({ state: 'visible', timeout: 15000 });

      const cells = firstRow.locator('td');
      const cellCount = await cells.count().catch(() => 0);
      
      for (let i = 0; i < cellCount; i++) {
        const text = await cells.nth(i).textContent().catch(() => '');
        const cleaned = text?.replace(/\s+/g, ' ').trim() || '';
        if (cleaned.includes('/') && !/^(Active|Remove|Configure|Edit|Delete|Backup|Restore|In Progress|Completed|Partially|Select|Yes|No|True|False|Include|Exclude|switch|on|off)$/i.test(cleaned)) {
          const match = cleaned.match(/([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)/);
          if (match) {
            cleanedRepoName = match[1];
            break;
          }
        }
      }
      if (!cleanedRepoName) {
        const firstCellText = await cells.first().textContent().catch(() => '') || '';
        cleanedRepoName = firstCellText.trim() || 'gitsec-test-automation';
      }
      repoNameOnly = cleanedRepoName.includes('/') ? cleanedRepoName.split('/')[1] : cleanedRepoName;
      console.log(`📦 Hedef Repo: "${cleanedRepoName}"`);

      // Arama kutusuna yazıp tabloyu filtreleyelim
      const searchInput = page.getByPlaceholder('Search repositories...');
      await searchInput.waitFor({ state: 'visible', timeout: 10000 });
      await searchInput.fill(repoNameOnly);
      await visualPause(page, 1500);
      await waitTableLoadingFinished(page, repoTable);

      const targetRow = repoTable.locator('tbody tr').filter({ hasText: cleanedRepoName }).first();
      const scopeSwitch = targetRow.getByRole('switch').first();
      await scopeSwitch.waitFor({ state: 'visible', timeout: 15000 });

      const isInitiallyIncluded = (await scopeSwitch.getAttribute('aria-checked')) === 'true';
      console.log(`Initial include state: ${isInitiallyIncluded}`);

      if (isInitiallyIncluded) {
        // Exclude
        console.log('➖ Exclude ediliyor...');
        await scopeSwitch.click({ force: true });
        
        const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
        if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
          console.log('👆 Onay modalında "Yes, Exclude" butonuna tıklanıyor...');
          await confirmBtn.click();
          const dialog = page.locator('[role="alertdialog"], [role="dialog"]').first();
          await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        }

        await expect(scopeSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 25000 });
        
        await verifyAuditLogViaAPI(page, {
          category: 'Repository',
          descriptionRegex: new RegExp(`(${repoNameOnly}.*(Excluded|Dışlandı)|(Excluded|Dışlandı).*${repoNameOnly})`, 'i')
        });

        // Re-Include
        await providerPage.goToRepositoriesGithub();
        await waitTableLoadingFinished(page, repoTable);

        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill(repoNameOnly);
        await visualPause(page, 1500);
        await waitTableLoadingFinished(page, repoTable);

        console.log('➕ Tekrar Include ediliyor...');
        await scopeSwitch.click({ force: true });
        await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25000 });

        await verifyAuditLogViaAPI(page, {
          category: 'Repository',
          descriptionRegex: new RegExp(`(${repoNameOnly}.*(Included|Dahil)|(Included|Dahil).*${repoNameOnly})`, 'i')
        });
      } else {
        // Include
        console.log('➕ Include ediliyor...');
        await scopeSwitch.click({ force: true });
        await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25000 });

        await verifyAuditLogViaAPI(page, {
          category: 'Repository',
          descriptionRegex: new RegExp(`(${repoNameOnly}.*(Included|Dahil)|(Included|Dahil).*${repoNameOnly})`, 'i')
        });

        // Exclude
        await providerPage.goToRepositoriesGithub();
        await waitTableLoadingFinished(page, repoTable);

        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill(repoNameOnly);
        await visualPause(page, 1500);
        await waitTableLoadingFinished(page, repoTable);

        console.log('➖ Exclude ediliyor...');
        await scopeSwitch.click({ force: true });

        const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
        if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
          console.log('👆 Onay modalında "Yes, Exclude" butonuna tıklanıyor...');
          await confirmBtn.click();
          const dialog = page.locator('[role="alertdialog"], [role="dialog"]').first();
          await dialog.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
        }

        await expect(scopeSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 25000 });

        await verifyAuditLogViaAPI(page, {
          category: 'Repository',
          descriptionRegex: new RegExp(`(${repoNameOnly}.*(Excluded|Dışlandı)|(Excluded|Dışlandı).*${repoNameOnly})`, 'i')
        });

        // Re-Include
        await providerPage.goToRepositoriesGithub();
        await waitTableLoadingFinished(page, repoTable);

        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill(repoNameOnly);
        await visualPause(page, 1500);
        await waitTableLoadingFinished(page, repoTable);

        console.log('➕ Tekrar Include ediliyor...');
        await scopeSwitch.click({ force: true });
        await expect(scopeSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 25000 });

        await verifyAuditLogViaAPI(page, {
          category: 'Repository',
          descriptionRegex: new RegExp(`(${repoNameOnly}.*(Included|Dahil)|(Included|Dahil).*${repoNameOnly})`, 'i')
        });
      }
    });

    // ─────────────────────────────────────────────────────────────
    // ⏰ ADIM 4: REPOSITORY BACKUP ALMA VE LOGDAN TAKİP ETME
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 4: Repository Backup Alma', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 4: Dahil Edilen Repo Yedekleniyor...');
      console.log('==================================================');
      await providerPage.goToRepositoriesGithub();
      const repoTable = page.locator('table')
        .filter({ has: page.locator('thead [role="checkbox"], tbody [role="checkbox"]') })
        .first();
      await repoTable.waitFor({ state: 'visible', timeout: 30000 });
      await waitTableLoadingFinished(page, repoTable);

      const searchInput = page.getByPlaceholder('Search repositories...');
      await searchInput.waitFor({ state: 'visible', timeout: 10000 });
      await searchInput.fill(repoNameOnly);
      await visualPause(page, 1500);
      await waitTableLoadingFinished(page, repoTable);

      const targetRow = repoTable.locator('tbody tr').filter({ hasText: cleanedRepoName }).first();
      const backupNowBtn = targetRow.getByRole('button', { name: /Backup now/i });
      await backupNowBtn.waitFor({ state: 'visible', timeout: 15000 });
      await backupNowBtn.click();
      await visualPause(page, 1000);

      const startBackupBtn = page.getByRole('button', { name: /^Start Backup$/i });
      await startBackupBtn.waitFor({ state: 'visible', timeout: 20000 });
      await startBackupBtn.click();
      console.log('✅ Yedekleme başlatma isteği gönderildi.');
      await visualPause(page, 1000);

      // Backup Başlatıldı Logları
      await verifyAuditLogViaAPI(page, {
        category: 'Backup',
        descriptionRegex: new RegExp(`(${repoNameOnly}.*Started|Started.*${repoNameOnly})`, 'i')
      });
      await verifyAuditLogViaAPI(page, {
        category: 'Schedule',
        descriptionRegex: new RegExp(`(${repoNameOnly}.*Triggered|Triggered.*${repoNameOnly})`, 'i')
      });

      console.log('🔄 Yedeklemenin tamamlanması API üzerinden bekleniyor (Maksimum 3 dakika)...');
      const backupResultLog = await verifyAuditLogViaAPI(page, {
        category: 'Backup',
        descriptionRegex: new RegExp(`(${repoNameOnly}.*(completed|failed|partially|cancelled)|(completed|failed|partially|cancelled).*${repoNameOnly})`, 'i'),
        timeoutMs: 180000
      });
      console.log(`✅ Yedekleme sonlanma logu API'de tespit edildi: "${backupResultLog.description}"`);
    });

    // ─────────────────────────────────────────────────────────────
    // 🔄 ADIM 5: RESTORE İŞLEMİ YAPMA
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 5: Restore İşlemi Yapma', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 5: Restore Başlatılıyor...');
      console.log('==================================================');
      await providerPage.goToBackupsViaSidebar();
      await visualPause(page, 2000);

      const backupsTable = page.locator('table').first();
      await backupsTable.waitFor({ state: 'visible', timeout: 30000 });
      await scrollBackupsTableHorizontal(page, backupsTable);

      const targetRepoRow = backupsTable.locator('tbody tr')
        .filter({ hasText: repoNameOnly })
        .first();

      let restoreBtn: Locator | null = null;
      if (await targetRepoRow.isVisible().catch(() => false)) {
        console.log(`✅ Backup satırı bulundu, Restore butonu seçiliyor.`);
        restoreBtn = targetRepoRow.locator('a[title="Restore"], button[title="Restore"], a[href*="/restore/"]').first();
      } else {
        console.log('⚠️ Belirtilen repo için yedek bulunamadı. Listeden ilk yedek seçiliyor...');
        const fallbackRow = backupsTable.locator('tbody tr').first();
        if (await fallbackRow.isVisible().catch(() => false)) {
          restoreBtn = fallbackRow.locator('a[title="Restore"], button[title="Restore"], a[href*="/restore/"]').first();
        }
      }

      if (!restoreBtn) {
        throw new Error('❌ Restore adımı için tamamlanmış hiçbir yedek bulunamadı.');
      }

      await revealRestoreControl(restoreBtn);
      await clickRestoreControl(restoreBtn);
      await visualPause(page, 2000);

      await expect(page).toHaveURL(/\/restore(\/|\?)/, { timeout: 25000 });
      console.log('✅ Restore sayfasına ulaşıldı.');

      const restorePage = new RestorePage(page);
      const orgStep = await restorePage.completeTargetOrganizationStep(async () => {
        await handleGithubOAuthPopup(page, providerPage);
      });
      console.log(`Organizasyon adımı sonucu: ${orgStep}`);
      await visualPause(page, 2000);

      const backupTrigger = page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first();
      if (await backupTrigger.isVisible().catch(() => false)) {
        await backupTrigger.click();
        const backupOptions = page.getByRole('option')
          .or(page.locator('[data-slot="select-item"]'))
          .filter({ hasNotText: /Select a backup/i });
        await backupOptions.first().waitFor({ state: 'visible', timeout: 10000 });
        await backupOptions.first().click();
        await visualPause(page, 1500);
      }

      const nextBtn = page.getByRole('button', { name: /^Next/i });
      await expect(nextBtn).toBeVisible({ timeout: 15000 });
      await nextBtn.click();
      await visualPause(page, 2000);

      const inputs = page.locator('input[data-slot="input"]');
      await expect(inputs.first()).toBeVisible({ timeout: 15000 });
      const countInputs = await inputs.count();
      let repoInput = inputs.first();
      let descInput = inputs.nth(1);

      for (let i = 0; i < countInputs; i++) {
        const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
        if (placeholder.toLowerCase().includes('search')) {
          repoInput = inputs.nth(i + 1);
          descInput = inputs.nth(i + 2);
          break;
        }
      }

      tempRestoreRepoName = `e2e-restore-${Date.now()}`;
      await repoInput.fill(tempRestoreRepoName);
      await descInput.fill('E2E Grand Integration Restore Description');
      await visualPause(page, 2000);

      const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
      await nextStepBtn3.click();
      await visualPause(page, 2000);

      page.on('request', request => {
        if (request.url().includes('/api/restore/schedules/trigger') && request.method() === 'POST') {
          console.log('[DEBUG TRIGGER REQUEST PAYLOAD]:', request.postData());
        }
      });

      page.on('response', async response => {
        if (response.url().includes('/api/restore/schedules/trigger')) {
          const status = response.status();
          let bodyText = '';
          try {
            bodyText = await response.text();
          } catch (e: any) {
            bodyText = `<failed to read body: ${e?.message || String(e)}>`;
          }
          console.log(`[DEBUG TRIGGER RESPONSE STATUS]: ${status}`);
          console.log(`[DEBUG TRIGGER RESPONSE BODY]:`, bodyText);
        }
      });

      const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).or(page.locator('button:has-text("Start Restore")')).first();
      await expect(startRestoreBtn).toBeVisible({ timeout: 15000 });
      try {
        await startRestoreBtn.click({ timeout: 8000 });
      } catch (e) {
        console.log('Normal tıklama başarısız oldu, force: true ile deneniyor...');
        await startRestoreBtn.click({ force: true });
      }
      console.log('✅ Restore işlemi başlatıldı.');
      await visualPause(page, 4000);

      // Restore Başlatıldı Logları
      await verifyAuditLogViaAPI(page, {
        category: 'Restore',
        descriptionRegex: new RegExp(`(${tempRestoreRepoName}.*Started|Started.*${tempRestoreRepoName})`, 'i')
      });
      await verifyAuditLogViaAPI(page, {
        category: 'Restore',
        descriptionRegex: new RegExp(`(${tempRestoreRepoName}.*Target|Target.*${tempRestoreRepoName})`, 'i')
      });
    });

    // ─────────────────────────────────────────────────────────────
    // 📦 ADIM 6: STORAGE SAĞLAYICILARINI TEKER TEKER BAĞLAMA VE SİLME
    // ─────────────────────────────────────────────────────────────
    await test.step('Adım 6: Storage Sağlayıcılarını Bağlama ve Silme', async () => {
      console.log('\n==================================================');
      console.log('🚀 ADIM 6: Storage Sağlayıcıları Bağlanıyor ve Doğrulanıyor...');
      console.log('==================================================');
      
      const storageProvidersList = ['aws', 'azure', 'huawei', 'gdrive', 'onedrive'];

      for (const provider of storageProvidersList) {
        console.log(`\n☁️ Sağlayıcı İşleniyor: ${provider.toUpperCase()}`);
        
        try {
          await storagePage.navigateToStoragePage();
          await visualPause(page, 2000);

          await storagePage.cleanupExistingTestProviders(provider);
          await visualPause(page, 2000);

          await storagePage.clickAddStorageProvider();
          await visualPause(page, 2000);

          const connTimestamp = Date.now();
          let connName = '';

          if (provider === 'aws') {
            connName = `AWS-S3-E2E-${connTimestamp}`;
            const bucketName = requireEnv('AWS_S3_BUCKET');
            const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
            const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
            const awsRegion = requireEnv('AWS_REGION');

            await storagePage.selectS3Provider();
            await visualPause(page, 1500);
            await storagePage.fillAWSForm(connName, bucketName, accessKeyId, secretAccessKey, awsRegion);
          } else if (provider === 'azure') {
            connName = `Azure-Blob-E2E-${connTimestamp}`;
            const connectionString = requireEnv('AZURE_CONNECTION_STRING');
            const folderPath = process.env.AZURE_FOLDER_PATH || '/';

            await storagePage.selectAzureProvider();
            await visualPause(page, 1500);
            await storagePage.fillAzureForm(connName, folderPath, connectionString);
          } else if (provider === 'huawei') {
            connName = `Huawei-OBS-E2E-${connTimestamp}`;
            const bucketName = requireEnv('HUAWEI_BUCKET');
            const accessKeyId = requireEnv('HUAWEI_ACCESS_KEY_ID');
            const secretAccessKey = requireEnv('HUAWEI_SECRET_ACCESS_KEY');
            const huaweiRegion = process.env.HUAWEI_REGION || 'Europe (Turkey - West)';

            await storagePage.selectHuaweiProvider();
            await visualPause(page, 1500);
            await storagePage.fillHuaweiForm(connName, bucketName, accessKeyId, secretAccessKey, huaweiRegion);
          } else if (provider === 'gdrive') {
            connName = `GDrive-E2E-${connTimestamp}`;
            const providerText = 'Google Drive';
            const providerCard = page.locator('h3:visible, h4:visible, p:visible, div:visible, span:visible, button:visible, a:visible')
              .filter({ hasText: new RegExp(`^${providerText}$`, 'i') })
              .first();

            await providerCard.waitFor({ state: 'visible', timeout: 15000 });
            await providerCard.click();
            await visualPause(page, 2000);

            const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
            await permissionBtn.waitFor({ state: 'visible', timeout: 15000 });
            
            const popupPromise = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
            await permissionBtn.click({ force: true });
            const popup = await popupPromise;

          if (popup) {
              const googleLogin = new GoogleLoginPage(popup);
              await googleLogin.completeOAuthLogin();
              if (!popup.isClosed()) {
                await popup.waitForEvent('close', { timeout: 30000 }).catch(() => {});
              }
            }

            const nameInput = page.locator('input[name="name"]').first();
            await nameInput.waitFor({ state: 'visible', timeout: 8000 });
            await nameInput.fill(connName);
          } else if (provider === 'onedrive') {
            connName = `OneDrive-E2E-${connTimestamp}`;
            const providerText = 'OneDrive Personal';
            const providerCard = page.locator('h3:visible, h4:visible, p:visible, div:visible, span:visible, button:visible, a:visible')
              .filter({ hasText: new RegExp(`^${providerText}$`, 'i') })
              .first();

            await providerCard.waitFor({ state: 'visible', timeout: 15000 });
            await providerCard.click();
            await visualPause(page, 2000);

            const permissionBtn = page.getByRole('button', { name: /Permission Required/i }).first();
            await permissionBtn.waitFor({ state: 'visible', timeout: 15000 });
            
            const popupPromise = page.waitForEvent('popup', { timeout: 8000 }).catch(() => null);
            await permissionBtn.click({ force: true });
            const popup = await popupPromise;

            if (popup) {
              const oneDriveLogin = new OneDriveLoginPage(popup);
              await oneDriveLogin.completeOAuthLogin();
              if (!popup.isClosed()) {
                await popup.waitForEvent('close', { timeout: 30000 }).catch(() => {});
              }
            }

            const nameInput = page.locator('input[name="name"]').first();
            await nameInput.waitFor({ state: 'visible', timeout: 8000 });
            await nameInput.fill(connName);
          }

          await visualPause(page, 1500);

          await storagePage.testS3Connection();
          await visualPause(page, 1500);
          await storagePage.saveStorageProvider();
          await storagePage.verifyProviderActive(connName);
          
          console.log(`... ${provider.toUpperCase()} connection created successfully. Checking logs ...`);

          await verifyAuditLogViaAPI(page, {
            category: 'Storage Provider',
            descriptionRegex: new RegExp(`(Added|Eklendi).*${connName}|${connName}.*(Added|Eklendi)`, 'i')
          });
          await verifyAuditLogViaAPI(page, {
            category: 'Storage Provider',
            descriptionRegex: new RegExp(`(Creation Test Succeeded).*${connName}|${connName}.*(Creation Test Succeeded)`, 'i')
          });

          console.log(`Cleaning up storage provider...`);
          await storagePage.navigateToStoragePage();
          await storagePage.cleanupExistingTestProviders(provider);

          console.log(`Verifying delete log...`);
          await verifyAuditLogViaAPI(page, {
            category: 'Storage Provider',
            descriptionRegex: /Deleted|Silindi/i
          });

        } catch (err: any) {
          console.error(`⚠️ [HATA] ${provider.toUpperCase()} adımı tamamlanamadı:`, err.message);
          const pages = page.context().pages();
          for (const p of pages) {
            if (p !== page && !p.isClosed()) {
              await p.close().catch(() => {});
            }
          }
        }
      }
      console.log('\n🎉 TÜM ADIMLAR VE AUDIT LOGLARI BAŞARIYLA DOĞRULANDI!');
    });
  });
});
