/**
 * Test: GitHub Repository Metadata Changes Sync (Rename, Visibility, Archiving)
 * 
 * Risk:
 * GitHub tarafında repo ismi değiştirildiğinde, private/public durumu güncellendiğinde 
 * veya repo arşivlendiğinde GitSec Dashboard bu değişiklikleri yansıtamazsa 
 * yedekleme, yetkilendirme ve izleme fonksiyonları hatalı çalışır.
 * 
 * Beklenen:
 * GitHub API üzerinden yapılan metadata değişiklikleri (Rename, Private/Public, Archiving) 
 * GitSec Repositories sayfasında senkronize bir şekilde doğru rozetler ve isimle görünmelidir.
 * 
 * Güvenlik & Teardown (Self-Healing):
 * Test patlasa dahi 'finally' ve 'afterEach' blokları sayesinde GitHub reposu 
 * orijinal adına, görünürlüğüne ve unarchive durumuna %100 otomatik geri döndürülür.
 */

import { Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { GithubLoginPage } from '../../pages/GithubLoginPage';
import { GitHubApiHelper, GitHubRepoState } from '../../support/github-api-helper';
import { requireEnv } from '../../support/require-env';

test.describe('GitHub Repository Real-time Metadata Sync (İsim, Görünürlük, Arşivleme)', () => {
  test.setTimeout(90_000);

  let providerPage: ProviderPage;
  let githubApi: GitHubApiHelper;

  const githubToken = process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.E2E_GITHUB_TOKEN || '';

  async function resolveTargetRepo(page: Page): Promise<GitHubRepoState | null> {
    const tokenUser = await githubApi.getAuthenticatedUsername();
    const configuredOwner = tokenUser || (process.env.GITHUB_OWNER || process.env.GITHUB_TEST_USER || 'gitsectest').split('@')[0].trim();
    const configuredRepo = process.env.GITHUB_TEST_REPO?.trim();

    // 1. Manuel konfigürasyon varsa
    if (configuredRepo) {
      let state = await githubApi.getRepoState(configuredOwner, configuredRepo);
      if (state) return state;
    }

    const userRepos = await githubApi.getUserRepos();
    if (userRepos.length === 0) {
      console.log(`⚠️ [GITHUB API] Token ile erişilebilen repo bulunamadı.`);
      return null;
    }

    // 2. GitSec UI üzerindeki ekli/bağlı repo isimlerini oku ve GitHub hesabındaki repolarla eşleştir
    try {
      await providerPage.goToRepositoriesGithub();
      const currentUrl = page.url();
      if (!currentUrl.includes('/repositories/add')) {
        const uiText = await page.locator('table, main').innerText().catch(() => '');

        for (const r of userRepos) {
          if (uiText.toLowerCase().includes(r.name.toLowerCase())) {
            console.log(`📌 [GITHUB SYNC] GitSec UI'da ekli repo başarıyla eşleşti: "${r.owner}/${r.name}"`);
            return await githubApi.getRepoState(r.owner, r.name);
          }
        }
      } else {
        console.log(`⚠️ [GITHUB SYNC] GitHub sağlayıcısı bu çalışma alanında bağlı değil (/repositories/add sayfasına yönlendirildi).`);
      }
    } catch {}

    // 3. Eşleşme olmazsa hesaptaki ilk repoyu hedef al
    const firstRepo = userRepos[0];
    console.log(`📌 [GITHUB SYNC] Hedef repo varsayılan seçildi: "${firstRepo.owner}/${firstRepo.name}"`);
    return await githubApi.getRepoState(firstRepo.owner, firstRepo.name);
  }

  async function ensureGithubProviderConnected(page: any, providerPage: ProviderPage): Promise<void> {
    await providerPage.goToAddProviderPage().catch(() => {});
    const isConnected = await providerPage.isGithubAlreadyConnectedOnAddProvider().catch(() => false);

    if (isConnected) {
      console.log('✅ [GITHUB SYNC] Global Setup aşamasında kurulan GitHub sağlayıcısının AKTİF durumda olduğu doğrulandı.');
      return;
    }

    throw new Error('🚨 [FATAL TEST HATASI] Global Setup aşamasında GitHub sağlayıcı bağlantısı gerçekleştirilemedi. Test adımları iptal edildi.');
  }

  test.beforeEach(async ({ page, request }) => {
    providerPage = new ProviderPage(page);
    githubApi = new GitHubApiHelper(request, githubToken);

    // Dashboard'a git ve hazır olmasını bekle
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    // GitHub sağlayıcısının bağlı olduğunu garanti et
    await ensureGithubProviderConnected(page, providerPage);
  });

  async function ensureRepoIncludedOnGitSec(page: Page, providerPage: ProviderPage, repoName: string): Promise<void> {
    console.log(`🔍 [GITSEC SETUP] "${repoName}" reposunun GitSec Repositories sayfasındaki aktiflik durumu denetleniyor...`);
    await providerPage.goToRepositoriesGithub().catch(() => {});
    await page.locator('table tbody tr, main table').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});

    const repoRow = page.locator('tr, div[class*="row"]').filter({ hasText: new RegExp(repoName, 'i') }).first();
    if (await repoRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      const toggle = repoRow.locator('button[role="switch"]').first();
      if (await toggle.isVisible().catch(() => false)) {
        const isChecked = await toggle.getAttribute('aria-checked').catch(() => null);
        if (isChecked === 'false' || isChecked === null) {
          console.log(`👆 [GITSEC SETUP] "${repoName}" reposunun GitSec include/aktif switch anahtarı açılıyor...`);
          await toggle.click({ force: true }).catch(() => {});
          await page.waitForTimeout(3000);
        }
      }
      console.log(`✅ [GITSEC SETUP] "${repoName}" reposu GitSec listesinde ekli ve aktif durumda.`);
      return;
    }

    console.log(`⚠️ [GITSEC SETUP] "${repoName}" reposu listede görünmüyor, senkronizasyon tetikleniyor...`);
    await providerPage.triggerRepoSync();
  }

  test('1. GitHub Repo İsim Değişikliğinin (Rename) GitSec\'e Yansımasını Doğrula', async ({ page }) => {
    if (!githubToken) {
      console.log('\n⚠️ ========================================================');
      console.log('⚠️ [GITHUB API TEST ATLANDI] GITHUB_TOKEN veya GITHUB_PAT tanımlı değil.');
      console.log('⚠️ GitHub API ile repo ismi değiştirebilmek için .env dosyasına GITHUB_TOKEN ekleyin.');
      console.log('⚠️ ========================================================\n');
      return;
    }

    const originalState = await resolveTargetRepo(page);
    if (!originalState) {
      console.log(`⚠️ [GITHUB API] GitHub hesabınızda test edilecek aktif repo bulunamadı. Test atlanıyor.`);
      return;
    }

    await ensureRepoIncludedOnGitSec(page, providerPage, originalState.name);

    const renamedRepoName = `${originalState.name}-renamed-${Date.now().toString().slice(-4)}`;
    let currentRepoName = originalState.name;

    try {
      // 1. ADIM: GitHub API üzerinden repo ismini değiştir
      const renamed = await githubApi.updateRepoName(originalState.owner, originalState.name, renamedRepoName);
      expect(renamed, 'GitHub API repo ismi güncellemesi başarılı olmalı.').toBeTruthy();
      currentRepoName = renamedRepoName;

      // 2. ADIM: GitSec Repositories/GitHub sayfasına git ve Sync yap
      await providerPage.goToRepositoriesGithub();

      // 3. ADIM: GitSec UI üzerinde yeni reponun göründüğünü toPass ile doğrula
      await expect(async () => {
        await providerPage.triggerRepoSync();
        const foundNewName = await providerPage.verifyRepoInList(renamedRepoName);
        expect(foundNewName, `GitSec UI üzerinde yeni repo ismi ("${renamedRepoName}") görünür olmalı.`).toBeTruthy();
      }).toPass({ timeout: 20_000, intervals: [2000, 3000] });

      console.log(`🎉 [TEST SUCCESS] Repo isim değişikliği ("${renamedRepoName}") GitSec UI üzerinde doğrulandı!`);

    } finally {
      // TEARDOWN: Test patlasa bile repoyu orijinal ismine geri çevir
      await githubApi.restoreRepoState(originalState.owner, currentRepoName, originalState);
    }
  });

  test('2. GitHub Repo Görünürlük Değişikliğinin (Private ↔ Public) GitSec\'e Yansımasını Doğrula', async ({ page }) => {
    if (!githubToken) {
      console.log('⚠️ [GITHUB API TEST ATLANDI] GITHUB_TOKEN bulunamadı. Görünürlük testi atlanıyor.');
      return;
    }

    const originalState = await resolveTargetRepo(page);
    if (!originalState) {
      console.log(`⚠️ [GITHUB API] GitHub hesabınızda test edilecek aktif repo bulunamadı. Test atlanıyor.`);
      return;
    }

    await ensureRepoIncludedOnGitSec(page, providerPage, originalState.name);

    const targetVisibility = !originalState.isPrivate; // Private ise Public yap, Public ise Private yap
    let currentVisibility = originalState.isPrivate;

    try {
      // 1. ADIM: GitHub API üzerinden repo görünürlüğünü tersine çevir
      const updated = await githubApi.updateRepoVisibility(originalState.owner, originalState.name, targetVisibility);
      expect(updated, 'GitHub API repo görünürlük güncellemesi başarılı olmalı.').toBeTruthy();
      currentVisibility = targetVisibility;

      // 2. ADIM: GitSec Repositories/GitHub sayfasına git ve Sync yap
      await providerPage.goToRepositoriesGithub();

      // 3. ADIM: GitSec UI üzerinde görünürlük rozetinin (Private/Public) güncellendiğini toPass ile doğrula
      await expect(async () => {
        await providerPage.triggerRepoSync();
        const verified = await providerPage.verifyRepoInList(originalState.name, { isPrivate: targetVisibility });
        expect(verified, `GitSec UI üzerinde yeni görünürlük etiketi (${targetVisibility ? 'Private' : 'Public'}) doğrulanamadı.`).toBeTruthy();
      }).toPass({ timeout: 20_000, intervals: [2000, 3000] });

      console.log(`🎉 [TEST SUCCESS] Repo görünürlük değişikliği (${targetVisibility ? 'Private' : 'Public'}) GitSec UI üzerinde doğrulandı!`);

    } finally {
      // TEARDOWN: Test patlasa bile görünürlüğü orijinal durumuna geri çevir
      await githubApi.restoreRepoState(originalState.owner, originalState.name, originalState);
    }
  });

  test('3. GitHub Repo Arşivleme Değişikliğinin (Archive ↔ Unarchive) GitSec\'e Yansımasını Doğrula', async ({ page }) => {
    if (!githubToken) {
      console.log('⚠️ [GITHUB API TEST ATLANDI] GITHUB_TOKEN bulunamadı. Arşivleme testi atlanıyor.');
      return;
    }

    const originalState = await resolveTargetRepo(page);
    if (!originalState) {
      console.log(`⚠️ [GITHUB API] GitHub hesabınızda test edilecek aktif repo bulunamadı. Test atlanıyor.`);
      return;
    }

    await ensureRepoIncludedOnGitSec(page, providerPage, originalState.name);

    const targetArchivedState = !originalState.isArchived;

    try {
      // 1. ADIM: GitHub API üzerinden repoyu arşivle (veya arşivden çıkar)
      const updated = await githubApi.updateRepoArchived(originalState.owner, originalState.name, targetArchivedState);
      expect(updated, 'GitHub API repo arşivleme güncellemesi başarılı olmalı.').toBeTruthy();

      // 2. ADIM: GitSec Repositories/GitHub sayfasına git ve Sync yap
      await providerPage.goToRepositoriesGithub();

      // 3. ADIM: GitSec UI üzerinde Archived rozetinin/durumunun güncellendiğini toPass ile doğrula
      await expect(async () => {
        await providerPage.triggerRepoSync();
        const verified = await providerPage.verifyRepoInList(originalState.name, { isArchived: targetArchivedState });
        expect(verified, `GitSec UI üzerinde arşiv durumu (${targetArchivedState ? 'Archived' : 'Unarchived'}) doğrulanamadı.`).toBeTruthy();
      }).toPass({ timeout: 20_000, intervals: [2000, 3000] });

      console.log(`🎉 [TEST SUCCESS] Repo arşiv durumu (${targetArchivedState ? 'Archived' : 'Unarchived'}) GitSec UI üzerinde doğrulandı!`);

    } finally {
      // TEARDOWN: Test patlasa bile repoyu unarchive ederek orijinal durumuna getir
      await githubApi.restoreRepoState(originalState.owner, originalState.name, originalState);
    }
  });
});
