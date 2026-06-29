import { expect, Locator, Page } from '@playwright/test';
import { requireEnv } from '../support/require-env';

const workspaceId = requireEnv('WORKSPACE_ID');
const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

export class ProviderPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigateToDashboard(): Promise<void> {
    const dashboardUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
    await this.page.goto(dashboardUrl, { waitUntil: 'load' });
    await expect(this.page).toHaveURL(new RegExp(`/${workspaceId}/dashboard`));
  }

  async waitForDashboardReady(): Promise<void> {
    await this.page.waitForURL(new RegExp(`/${workspaceId}/dashboard`), { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.page.locator('main').first()).toBeVisible({ timeout: 20000 });
  }

  async closeOnboardingIfVisible(): Promise<void> {
    const overviewTitle = this.page.getByText(/Dashboard Overview/i).first();
    const isVisible = await overviewTitle.isVisible().catch(() => false);
    if (!isVisible) return;

    for (let i = 0; i < 4; i++) {
      await this.page.keyboard.press('Escape');
      const isHidden = await overviewTitle.waitFor({ state: 'hidden', timeout: 400 }).then(() => true).catch(() => false);
      if (isHidden) break;
    }
  }

  async goToAddProviderPage(): Promise<void> {
    await this.page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/add`, { waitUntil: 'load' });
    await expect(this.page).toHaveURL(/\/repositories\/add/);
  }

  async isGithubAlreadyConnectedOnAddProvider(): Promise<boolean> {
    const githubRow = this.page.getByRole('row', { name: /GitHub/i }).first();
    await githubRow.waitFor({ state: 'attached', timeout: 15000 }).catch(() => { });
    return githubRow.getByText(/\bActive\b/i).first().isVisible().catch(() => false);
  }

  async selectGithub(): Promise<void> {
    const githubActionButton = this.page
      .getByRole('button')
      .filter({
        hasText: /Install the GitSec app and grant repository permissions|Configure App/i,
      })
      .first();

    await githubActionButton.waitFor({ state: 'visible', timeout: 20000 });
    await githubActionButton.scrollIntoViewIfNeeded().catch(() => {});
    await githubActionButton.click();
  }

  async goToRepositoriesGithub(): Promise<void> {
    // Metin/çeviriye bağlı kalmamak için doğrudan rota (workspace zaten sabit).
    await this.page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/github`, { waitUntil: 'load' });
    await expect(this.page).toHaveURL(/\/repositories\/github\b/);
    await expect(this.page.locator('table').first()).toBeVisible({ timeout: 30000 });
  }

  /** Kenar çubuğu: Repositories → GitHub (UI üzerinden, diğer akışlarla aynı hedef URL). */
  async goToRepositoriesGithubViaSidebar(): Promise<void> {
    const githubLink = this.page.getByRole('link', { name: /^GitHub$/i });
    const repositoriesToggle = this.page.getByRole('button', { name: /Repositories/i });

    await repositoriesToggle.waitFor({ state: 'visible', timeout: 15000 });
    if (!(await githubLink.isVisible().catch(() => false))) {
      await repositoriesToggle.click();
    }

    await githubLink.waitFor({ state: 'visible', timeout: 15000 });
    await githubLink.click();

    await this.page.waitForURL(/\/repositories\/github\b/, { timeout: 30000 });
    await expect(this.page.locator('table').first()).toBeVisible({ timeout: 30000 });
  }

  /** Restore / provider seçimindeki GitHub kartı (dialog şart değil — sayfada veya sheet içinde olabilir). */
  githubProviderCardLocator(): Locator {
    return this.page.locator([
      'button:has-text("Install the GitSec app and grant repository permissions")',
      'button:has-text("Configure App")',
      '[role="button"]:has-text("Configure App")',
      'button:has-text("GitHub")',
      'button:has-text("Github")'
    ].join(', ')).first();
  }

  /**
   * GitHub sağlayıcı kartına tıklayıp OAuth sayfasını döner (popup / yeni sekme / aynı sekme).
   */
  async openGithubOAuthPopupFromDialog(): Promise<Page> {
    const githubCard = this.githubProviderCardLocator();
    await githubCard.waitFor({ state: 'visible', timeout: 25_000 });
    await githubCard.scrollIntoViewIfNeeded().catch(() => {});

    const context = this.page.context();
    const pagesBefore = new Set(context.pages());

    const waitForGithubPage = (): Promise<Page> => {
      const viaPopup = this.page.waitForEvent('popup', { timeout: 60_000 });

      const viaSameTab = this.page
        .waitForURL(/github\.com/i, { timeout: 60_000 })
        .then(() => this.page);

      const viaNewTab = (async (): Promise<Page> => {
        const deadline = Date.now() + 60_000;
        while (Date.now() < deadline) {
          for (const p of context.pages()) {
            if (pagesBefore.has(p) || p.isClosed()) continue;
            if (/github\.com/i.test(p.url())) {
              return p;
            }
          }
          await this.page.waitForTimeout(500);
        }
        throw new Error('GitHub sekmesi zaman aşımı');
      })();

      return Promise.race([viaPopup, viaSameTab, viaNewTab]);
    };

    const clickCard = async (): Promise<void> => {
      await this.page.waitForTimeout(1500); // Animasyon ve hydration'ın oturması için bekle
      
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          await githubCard.click({ force: true, timeout: 3000 });
        } catch (e) {
          // Geçici tıklama hatalarını yoksay
        }
        
        await this.page.waitForTimeout(1000);
        
        // Popup veya yönlendirme başladıysa tıklama döngüsünden çık
        const anyGithubPage = this.page.context().pages().some(p => /github\.com/i.test(p.url()));
        const mainNavigating = /github\.com/i.test(this.page.url());
        if (anyGithubPage || mainNavigating) {
          break;
        }
      }
    };

    const githubPage = await Promise.all([waitForGithubPage(), clickCard()]).then(([p]) => p);
    await githubPage.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('[provider] GitHub OAuth sayfası:', githubPage.url());
    return githubPage;
  }

  /**
   * GitHub girişi tamamlandıktan sonra OAuth penceresini kapatır; ana sekmede teste devam edilir.
   * Aynı sekmede github.com açıldıysa gitsec sayfasına dönülür.
   */
  async closeGithubOAuthAfterLogin(oauthPage: Page): Promise<void> {
    if (oauthPage === this.page) {
      console.log('[provider] GitHub aynı sekmede; dashboard’a dönülüyor.');
      await this.page
        .waitForURL(/gitsec\.io/i, { timeout: 20_000 })
        .catch(async () => {
          await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        });
      return;
    }

    if (!oauthPage.isClosed()) {
      console.log('[provider] GitHub girişi tamam; popup kapatılıyor, ana akışa dönülüyor.');
      await oauthPage.close();
    }

    await this.page.bringToFront();
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  /** Kenar çubuğu: Backups. */
  async goToBackupsViaSidebar(): Promise<void> {
    await this.closeOnboardingIfVisible();

    // Önce workspace’e özgü href (metin/rol değişse bile çalışır).
    const byWorkspaceHref = this.page.locator(`a[href*="/${workspaceId}/backups"]`).first();
    const backupsLink = this.page
      .getByRole('link', { name: /^Backups$/i })
      .or(this.page.getByRole('link', { name: /Backups/i }))
      .first();

    const clickBackups = async (): Promise<void> => {
      const hrefOk = await byWorkspaceHref
        .waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (hrefOk) {
        await byWorkspaceHref.scrollIntoViewIfNeeded().catch(() => {});
        await byWorkspaceHref.click();
        return;
      }

      const sectionToggle = this.page
        .getByRole('button', { name: /^Backups$/i })
        .or(this.page.getByRole('button', { name: /Backups/i }))
        .first();
      if (await sectionToggle.isVisible().catch(() => false)) {
        await sectionToggle.click();
      }

      await backupsLink.waitFor({ state: 'visible', timeout: 15000 });
      await backupsLink.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await backupsLink.click({ timeout: 8000 });
      } catch {
        await backupsLink.click({ force: true });
      }
    };

    try {
      await clickBackups();
      await this.page.waitForURL(new RegExp(`/${workspaceId}/backups`), { timeout: 30000 });
    } catch {
      // Sidebar tıklaması overlay / layout değişiminde kırılırsa doğrudan rota.
      await this.page.goto(`${dashboardBaseUrl}/${workspaceId}/backups`, { waitUntil: 'load' });
      await expect(this.page).toHaveURL(new RegExp(`/${workspaceId}/backups`));
    }

    await expect(this.page.locator('main').first()).toBeVisible({ timeout: 20000 });
  }

  async recoverFromChunkLoadError(): Promise<void> {
    const errorSelector = this.page.getByText(/chunk|loading chunk/i);
    const hasError = await errorSelector.isVisible().catch(() => false);
    if (hasError) {
      console.log('🔄 [RECOVERY] Chunk load error detected! Reloading page...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(this.page.locator('main').first()).toBeVisible({ timeout: 20000 }).catch(() => {});
    }
  }
}
