import { expect, Locator, Page } from '@playwright/test';
import { requireEnv } from '../support/require-env';

// workspaceId and dashboardBaseUrl are defined as getters inside the class

export class ProviderPage {
  readonly page: Page;

  get workspaceId() {
    return requireEnv('WORKSPACE_ID');
  }

  get dashboardBaseUrl() {
    return requireEnv('DASHBOARD_BASE_URL');
  }

  constructor(page: Page) {
    this.page = page;
  }

  async navigateToDashboard(): Promise<void> {
    const wsId = await this.getActiveWorkspaceId();
    const dashboardUrl = `${this.dashboardBaseUrl}/${wsId}/dashboard`;
    await this.page.goto(dashboardUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await expect(this.page).toHaveURL(/\/(\d+)\/dashboard/i, { timeout: 15000 });
  }

  async waitForDashboardReady(): Promise<void> {
    await this.page.waitForURL(/\/(\d+)\/dashboard/i, { timeout: 30000 });
    await this.page.waitForLoadState('domcontentloaded');
    await expect(this.page.locator('main, aside, nav').first()).toBeVisible({ timeout: 20000 });
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

  async getActiveWorkspaceId(): Promise<string> {
    const currentUrl = this.page.url();
    const match = currentUrl.match(/\/(\d+)\//);
    if (match) {
      return match[1];
    }
    return this.workspaceId;
  }

  async goToAddProviderPage(): Promise<void> {
    if (this.page.isClosed()) return;
    const currentUrl = this.page.url();
    if (currentUrl === 'about:blank' || !currentUrl.includes(this.dashboardBaseUrl)) {
      console.log('🔄 [POM] Sayfa henüz yüklenmedi, önce Dashboard yükleniyor...');
      await this.navigateToDashboard().catch(() => {});
    }

    // 1. Önce tarayıcıdaki aktif Workspace ID'yi tespit et
    let wsId = await this.getActiveWorkspaceId();
    let addUrl = `${this.dashboardBaseUrl}/${wsId}/repositories/add`;

    await this.page.goto(addUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });

    // Sayfa doğrudan yüklendi mi kontrol et
    let isNavigated = await this.page.waitForURL(/\/repositories\/add/, { timeout: 5000 }).then(() => true).catch(() => false);

    if (!isNavigated) {
      // 2. Yönlendirme gerçekleştiyse güncel URL'den gerçek Workspace ID'yi al
      wsId = await this.getActiveWorkspaceId();
      addUrl = `${this.dashboardBaseUrl}/${wsId}/repositories/add`;

      console.log(`🔄 [POM] Aktif Workspace ID (${wsId}) ile /repositories/add sayfasına yönlendiriliyor...`);
      await this.page.goto(addUrl, { waitUntil: 'load' });
      isNavigated = await this.page.waitForURL(/\/repositories\/add/, { timeout: 10000 }).then(() => true).catch(() => false);
    }

    if (!isNavigated) {
      // 3. Arayüzdeki menü veya "Add" butonuna tıklayarak istemci yönlendirmesi tetikle
      const addRepoBtn = this.page.locator('a[href*="/repositories/add"], button:has-text("Add Provider"), button:has-text("Add Repository")').first();
      if (await addRepoBtn.isVisible().catch(() => false)) {
        await addRepoBtn.click({ force: true }).catch(() => { });
      }
      await expect(this.page).toHaveURL(/\/repositories\/add/, { timeout: 15000 });
    }

    await this.page.waitForLoadState('load').catch(() => { });
    await this.page.waitForTimeout(2000);
  }

  async isGithubAlreadyConnectedOnAddProvider(): Promise<boolean> {
    if (this.page.isClosed()) return false;
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    await this.page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' })).catch(() => { });
    await this.page.waitForTimeout(1000).catch(() => { });

    // 0. Önce GitHub kartında "Connected" veya "Active" / "Configure App" etiketi var mı kontrol et
    const githubCard = this.page.locator('div[class*="card"]').filter({ hasText: /GitHub/i });
    const cardCount = await githubCard.count().catch(() => 0);
    for (let i = 0; i < cardCount; i++) {
      const cardText = await githubCard.nth(i).innerText().catch(() => '');
      const cleanText = cardText.trim().replace(/\s+/g, ' ');
      if (/Bitbucket|GitLab|Azure/i.test(cleanText)) continue;
      if (/\bRemoved\b|\bPasif\b|\bSilindi\b/i.test(cleanText)) continue;
      if (/GitHub/i.test(cleanText) && /Connected|Active|Configure App|Bağlı|Aktif/i.test(cleanText) && !/Not Connected/i.test(cleanText)) {
        console.log(`✅ [PROVIDER CHECK] GitHub sağlayıcı kartında aktif etiket tespit edildi: "${cleanText}"`);
        return true;
      }
    }

    // Tablo satırlarının yüklenmesini bekle (5s)
    await this.page.locator('main table tbody tr, div[class*="table"] tr').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

    const checkElement = async (): Promise<boolean> => {
      const tableRows = this.page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]')
        .filter({ hasText: /GitHub/i });
      const count = await tableRows.count().catch(() => 0);

      for (let i = 0; i < count; i++) {
        const row = tableRows.nth(i);
        await row.scrollIntoViewIfNeeded().catch(() => { });

        const textContent = (await row.textContent().catch(() => '')) || '';
        const innerText = (await row.innerText().catch(() => '')) || '';
        const cleanLogText = (innerText || textContent).trim().replace(/\s+/g, ' ');

        if (/GitHub/i.test(cleanLogText)) {
          console.log(`🔍 [PROVIDER CHECK] GitHub Satırı Bulundu (Satır ${i + 1}): "${cleanLogText}"`);
          const isRemoved = /\bRemoved\b|\bPasif\b|\bSilindi\b/i.test(cleanLogText);
          const isActive = /\bActive\b|\bConnected\b|\bConfigure App\b|\bAktif\b|\bBağlı\b/i.test(cleanLogText);

          if (isActive && !isRemoved) {
            console.log('✅ [PROVIDER CHECK] GitHub sağlayıcısının AKTİF (Active) durumda olduğu doğrulandı.');
            return true;
          } else if (isRemoved) {
            console.log('ℹ️ [PROVIDER CHECK] Bu GitHub satırının durumu "Removed" (Pasif). Diğer satırlar kontrol ediliyor...');
          }
        }
      }
      return false;
    };

    // 1. Sayfa 1'de arama yap
    if (await checkElement()) return true;

    // 2. Filtrelemeden önce Sayfa 2, 3, 4 ve 5'e bak (Çünkü aktif sağlayıcı 2. veya 3. sayfada olabilir)
    const nextBtn = this.page.getByRole('button', { name: /Next|Sonraki/i })
      .or(this.page.locator('button[aria-label*="Next"]'))
      .or(this.page.locator('button[aria-label*="Sonraki"]'))
      .first();

    for (let pageNum = 2; pageNum <= 5; pageNum++) {
      const isNextEnabled = (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
      if (!isNextEnabled) break;

      console.log(`🔍 [PROVIDER CHECK] ${pageNum}. sayfaya geçilerek Aktif GitHub sağlayıcısı aranıyor...`);
      await nextBtn.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(1200);

      if (await checkElement()) return true;
    }

    // 3. Bulunamadıysa 1. sayfaya dönüp "Status -> Active" filtresini uygula
    console.log('🔄 [PROVIDER CHECK] GitHub ilk taramada bulunamadı. "Status -> Active" filtresi uygulanıyor...');
    await this.filterByActiveStatus();
    await this.page.waitForTimeout(2000);
    if (await checkElement()) return true;

    // 4. Filtrelenmiş sayfaları (2-5) tara
    for (let pageNum = 2; pageNum <= 5; pageNum++) {
      const isNextEnabled = (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
      if (!isNextEnabled) break;

      console.log(`🔍 [PROVIDER CHECK] (Filtreli) ${pageNum}. sayfaya geçilerek Aktif GitHub sağlayıcısı aranıyor...`);
      await nextBtn.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(1200);

      if (await checkElement()) return true;
    }

    console.log('❌ [PROVIDER CHECK] GitHub sağlayıcısının hiçbir sayfada AKTİF olmadığı kesinleştirildi.');
    return false;
  }

  /**
   * Status filtresini açıp "Active" seçeneğini işaretler.
   */
  async filterByActiveStatus(): Promise<boolean> {
    const statusBtn = this.page.getByRole('button', { name: /Status/i })
      .or(this.page.locator('button:has-text("Status")'))
      .first();

    const isBtnVisible = await statusBtn.isVisible().catch(() => false);
    if (!isBtnVisible) {
      console.log('ℹ️ [FILTER] "Status" filtre butonu bulunamadı.');
      return false;
    }

    await statusBtn.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(500);

    console.log('🔍 [FILTER] "Status" filtresine tıklanıyor...');
    await statusBtn.click({ force: true }).catch(() => { });

    const activeOption = this.page.getByRole('option', { name: /Active/i })
      .or(this.page.locator('[data-value="Active"]'))
      .or(this.page.locator('[data-slot="command-item"]:has-text("Active")'))
      .first();

    const isOptionVisible = await activeOption.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    if (isOptionVisible) {
      console.log('🎯 [FILTER] "Active" durum seçeneği işaretlendi.');
      await activeOption.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(1500);
      return true;
    }

    await this.page.keyboard.press('Escape').catch(() => { });
    return false;
  }

  async isBitbucketAlreadyConnectedOnAddProvider(): Promise<boolean> {
    if (this.page.isClosed()) return false;
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    await this.page.evaluate(() => window.scrollBy({ top: 350, behavior: 'smooth' })).catch(() => { });
    await this.page.waitForTimeout(1000).catch(() => { });

    // 0. Önce Bitbucket kartında "Connected" veya "Active" etiketi var mı kontrol et
    const bitbucketCard = this.page.locator('div[class*="card"]').filter({ hasText: /Bitbucket/i });
    const cardCount = await bitbucketCard.count().catch(() => 0);
    for (let i = 0; i < cardCount; i++) {
      const cardText = await bitbucketCard.nth(i).innerText().catch(() => '');
      const cleanText = cardText.trim().replace(/\s+/g, ' ');
      if (/GitHub|GitLab|Azure/i.test(cleanText)) continue;
      if (/\bRemoved\b|\bPasif\b|\bSilindi\b/i.test(cleanText)) continue;
      if (/Bitbucket/i.test(cleanText) && /Connected|Active|Configure App|Bağlı|Aktif/i.test(cleanText) && !/Not Connected/i.test(cleanText)) {
        console.log(`✅ [PROVIDER CHECK] Bitbucket sağlayıcı kartında aktif etiket tespit edildi: "${cleanText}"`);
        return true;
      }
    }

    // Tablo satırlarının yüklenmesini bekle
    await this.page.locator('main table tbody tr, div[class*="table"] tr').first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

    const checkElement = async (): Promise<boolean> => {
      const tableRows = this.page.locator('main table tbody tr, div[class*="table"] tr, [role="row"]')
        .filter({ hasText: /Bitbucket/i });

      const count = await tableRows.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const row = tableRows.nth(i);
        await row.scrollIntoViewIfNeeded().catch(() => { });
        const text = ((await row.innerText().catch(() => '')) || (await row.textContent().catch(() => '')) || '').trim().replace(/\s+/g, ' ');

        if (/Bitbucket/i.test(text)) {
          console.log(`🔍 [PROVIDER CHECK] Bitbucket arayüz satırı okundu: "${text}"`);
          const isRemoved = /\bRemoved\b|\bPasif\b|\bSilindi\b/i.test(text);
          const isActive = /\bActive\b|\bConnected\b|\bConfigure App\b|\bAktif\b|\bBağlı\b/i.test(text);

          if (isActive && !isRemoved) {
            console.log('✅ [PROVIDER CHECK] Bitbucket sağlayıcısının AKTİF durumda olduğu doğrulandı.');
            return true;
          } else if (isRemoved) {
            console.log('ℹ️ [PROVIDER CHECK] Bu Bitbucket satırının durumu "Removed" (Pasif). Diğer satırlar kontrol ediliyor...');
          }
        }
      }
      return false;
    };

    // 1. Sayfa 1'de arama yap
    if (await checkElement()) return true;

    // 2. Filtrelemeden önce Sayfa 2, 3, 4 ve 5'e bak
    const nextBtn = this.page.getByRole('button', { name: /Next|Sonraki/i })
      .or(this.page.locator('button[aria-label*="Next"]'))
      .or(this.page.locator('button[aria-label*="Sonraki"]'))
      .first();

    for (let pageNum = 2; pageNum <= 5; pageNum++) {
      const isNextEnabled = (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
      if (!isNextEnabled) break;

      console.log(`🔍 [PROVIDER CHECK] ${pageNum}. sayfaya geçilerek Aktif Bitbucket sağlayıcısı aranıyor...`);
      await nextBtn.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(1200);

      if (await checkElement()) return true;
    }

    // 3. Bulunamadıysa "Status -> Active" filtresini uygula
    console.log('🔄 [PROVIDER CHECK] Bitbucket ilk taramada bulunamadı. "Status -> Active" filtresi uygulanıyor...');
    await this.filterByActiveStatus();
    await this.page.waitForTimeout(2000);
    if (await checkElement()) return true;

    // 4. Filtrelenmiş sayfaları (2-5) tara
    for (let pageNum = 2; pageNum <= 5; pageNum++) {
      const isNextEnabled = (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
      if (!isNextEnabled) break;

      console.log(`🔍 [PROVIDER CHECK] (Filtreli) ${pageNum}. sayfaya geçilerek Aktif Bitbucket sağlayıcısı aranıyor...`);
      await nextBtn.click({ force: true }).catch(() => { });
      await this.page.waitForTimeout(1200);

      if (await checkElement()) return true;
    }

    console.log('❌ [PROVIDER CHECK] Bitbucket sağlayıcısının hiçbir sayfada AKTİF olmadığı kesinleştirildi.');
    return false;
  }

  async selectGithub(): Promise<void> {
    console.log('👆 [TIKLAMA] "GitHub" sağlayıcı kartı aranıyor ve tıklanıyor...');

    const cardNode = this.page
      .getByText(/Install the GitSec(?:\.io)? app and grant repository permissions/i)
      .or(this.page.locator('h1, h2, h3, h4, span, div, p').filter({ hasText: /^Github\s*>/i }))
      .first();

    const isVisible = await cardNode.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!isVisible) {
      console.log('⚠️ [TIKLAMA] GitHub kartı arayüzde görünür olmadı!');
      return;
    }

    await cardNode.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(200);
    await cardNode.click({ force: true }).catch(() => { });
  }

  async selectBitbucket(): Promise<void> {
    console.log('👆 [TIKLAMA] "Bitbucket" sağlayıcı kartı aranıyor ve tıklanıyor...');

    const bitbucketCard = this.page
      .getByText(/Setup your Bitbucket integration to backup your repositories/i)
      .or(this.page.locator('h1, h2, h3, h4, span, div, p').filter({ hasText: /^Bitbucket\s*>/i }))
      .or(this.page.locator('div[class*="card"]').filter({ hasText: /Bitbucket/i }))
      .first();

    const isVisible = await bitbucketCard.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
    if (!isVisible) {
      console.log('⚠️ [TIKLAMA] Bitbucket kartı ekranda bulunamadı!');
      return;
    }

    await bitbucketCard.scrollIntoViewIfNeeded().catch(() => { });
    await this.page.waitForTimeout(300);

    // Karta yalnızca bir kez tıkla
    await bitbucketCard.click({ force: true }).catch(() => { });
    await this.page.waitForTimeout(500);
  }

  async goToRepositoriesGithub(): Promise<void> {
    const wsId = await this.getActiveWorkspaceId();
    const targetUrl = `${this.dashboardBaseUrl}/${wsId}/repositories/github`;
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(err => {
      if (!err.message.includes('net::ERR_ABORTED')) throw err;
    });

    if (!this.page.url().includes('/repositories/github')) {
      console.warn('⚠️ [NAVİGASYON RECOVERY] Yönlendirme /dashboard üzerinde takıldı, GitHub depoları sayfasına tekrar gidiliyor...');
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
    }

    await expect(this.page).toHaveURL(/\/repositories\/github\b/, { timeout: 15000 });
    await expect(this.page.locator('table, main').first()).toBeVisible({ timeout: 30000 });
  }

  /** Check and handle Next.js ChunkLoadError / "Something went wrong" error boundary screen automatically. */
  async handleNextJsChunkErrorIfPresent(): Promise<boolean> {
    if (this.page.isClosed()) return false;
    const retryBtn = this.page.getByRole('button', { name: /Retry/i });
    const errorText = this.page.getByText(/Something went wrong|An unexpected error occurred/i).first();

    const isError = (await retryBtn.isVisible().catch(() => false)) || (await errorText.isVisible().catch(() => false));
    if (isError) {
      console.warn('⚠️ [NEXT.JS SUNUCU HATASI] Frontend "Something went wrong" (ChunkLoadError) verdi. "Retry" / Sayfa yenileme ile otomatik kurtarılıyor...');
      if (await retryBtn.isVisible().catch(() => false)) {
        await retryBtn.click().catch(() => { });
      } else {
        await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
      }
      await this.page.waitForLoadState('domcontentloaded').catch(() => { });
      return true;
    }
    return false;
  }

  /** Direct navigation to Bitbucket repositories. */
  async goToRepositoriesBitbucket(): Promise<void> {
    if (this.page.isClosed()) {
      console.warn('[ProviderPage] Main page is already closed. Skipping direct navigation to Bitbucket repositories.');
      return;
    }
    const wsId = await this.getActiveWorkspaceId();
    const targetUrl = `${this.dashboardBaseUrl}/${wsId}/repositories/bitbucket`;
    await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(err => {
      if (!err.message.includes('net::ERR_ABORTED')) throw err;
    });

    if (!this.page.url().includes('/repositories/bitbucket')) {
      console.warn('⚠️ [NAVİGASYON RECOVERY] Yönlendirme /dashboard üzerinde takıldı, Bitbucket depoları sayfasına tekrar gidiliyor...');
      await this.page.goto(targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => { });
    }

    await expect(this.page).toHaveURL(/\/repositories\/bitbucket\b/, { timeout: 15000 });

    await this.handleNextJsChunkErrorIfPresent();

    const tableLocator = this.page.locator('table, main').first();
    try {
      await expect(tableLocator).toBeVisible({ timeout: 10000 });
    } catch {
      if (await this.handleNextJsChunkErrorIfPresent()) {
        await expect(tableLocator).toBeVisible({ timeout: 20000 });
      } else {
        await expect(tableLocator).toBeVisible({ timeout: 20000 });
      }
    }
  }

  /** Kenar çubuğu üzerinden generic sağlayıcı sayfasına git. */
  async goToRepositoriesViaSidebar(provider: 'github' | 'bitbucket'): Promise<void> {
    if (provider === 'bitbucket') {
      await this.goToRepositoriesBitbucket();
    } else {
      await this.goToRepositoriesGithub();
    }
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
      'button:has-text("Install the GitSec.io app and grant repository permissions")',
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
    await githubCard.scrollIntoViewIfNeeded().catch(() => { });

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
    await githubPage.waitForLoadState('domcontentloaded').catch(() => { });
    console.log('[provider] GitHub OAuth sayfası:', githubPage.url());
    return githubPage;
  }

  bitbucketProviderCardLocator(): Locator {
    return this.page.locator([
      'button:has-text("Setup your Bitbucket integration")',
      'button:has-text("Bitbucket")',
      '[role="button"]:has-text("Bitbucket")'
    ].join(', ')).first();
  }

  async openBitbucketOAuthPopupFromDialog(): Promise<Page> {
    const bitbucketCard = this.bitbucketProviderCardLocator();
    await bitbucketCard.waitFor({ state: 'visible', timeout: 25_000 });
    await bitbucketCard.scrollIntoViewIfNeeded().catch(() => { });

    const [popup] = await Promise.all([
      this.page.waitForEvent('popup', { timeout: 30000 }).catch(() => null),
      bitbucketCard.click({ force: true }).catch(() => { })
    ]);

    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => { });
      return popup;
    }
    return this.page;
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
          await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => { });
        });
      return;
    }

    if (!oauthPage.isClosed()) {
      console.log('[provider] GitHub girişi tamam; popup kapatılıyor, ana akışa dönülüyor.');
      await oauthPage.close();
    }

    await this.page.bringToFront();
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
  }

  /** Kenar çubuğu: Backups. */
  async goToBackupsViaSidebar(): Promise<void> {
    await this.closeOnboardingIfVisible();

    // Önce workspace’e özgü href (metin/rol değişse bile çalışır).
    const byWorkspaceHref = this.page.locator(`a[href*="/${this.workspaceId}/backups"]`).first();
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
        await byWorkspaceHref.scrollIntoViewIfNeeded().catch(() => { });
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
      await backupsLink.scrollIntoViewIfNeeded().catch(() => { });
      try {
        await backupsLink.click({ timeout: 8000 });
      } catch {
        await backupsLink.click({ force: true });
      }
    };

    try {
      await clickBackups();
      await this.page.waitForURL(new RegExp(`/${this.workspaceId}/backups`), { timeout: 30000 });
    } catch {
      // Sidebar tıklaması overlay / layout değişiminde kırılırsa doğrudan rota.
      await this.page.goto(`${this.dashboardBaseUrl}/${this.workspaceId}/backups`, { waitUntil: 'load' });
      await expect(this.page).toHaveURL(new RegExp(`/${this.workspaceId}/backups`));
    }

    await expect(this.page.locator('main').first()).toBeVisible({ timeout: 20000 });
  }

  async recoverFromChunkLoadError(): Promise<void> {
    const errorSelector = this.page.getByText(/chunk|loading chunk/i);
    const hasError = await errorSelector.isVisible().catch(() => false);
    if (hasError) {
      console.log('🔄 [RECOVERY] Chunk load error detected! Reloading page...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await expect(this.page.locator('main').first()).toBeVisible({ timeout: 20000 }).catch(() => { });
    }
  }

  /**
   * GitSec Repositories sayfasındaki Sync/Refresh butonunu tetikler veya sayfayı yeniler.
   */
  async triggerRepoSync(): Promise<void> {
    console.log('🔄 [GITSEC UI] Repositories senkronizasyonu tetikleniyor...');
    const syncBtn = this.page.locator('button, a')
      .filter({ hasText: /sync|refresh|senkronize|yenile/i })
      .or(this.page.locator('button[title*="Refresh"], button[title*="Sync"], button[aria-label*="Refresh"], button[aria-label*="Sync"]'))
      .first();

    if (await syncBtn.isVisible().catch(() => false)) {
      await syncBtn.click({ force: true }).catch(() => { });
      console.log('✅ [GITSEC UI] Sync/Refresh butonuna tıklandı.');
      await this.page.waitForTimeout(2000);
    } else {
      console.log('ℹ️ [GITSEC UI] Sync/Refresh butonu bulunamadı, sayfa yenileniyor...');
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(1500);
    }
  }

  /**
   * GitSec Repositories listesinde repo adı ve opsiyonel status rozeti (Private/Public/Archived) kontrolü yapar.
   */
  async verifyRepoInList(
    repoName: string,
    expectedStatus?: { isPrivate?: boolean; isArchived?: boolean }
  ): Promise<boolean> {
    console.log(`🔍 [GITSEC UI] Repositories listesinde "${repoName}" aranıyor...`);

    const repoRow = this.page.locator('tr, div[class*="row"], div[class*="card"]')
      .filter({ hasText: new RegExp(`\\b${repoName}\\b|${repoName}`, 'i') })
      .first();

    const isVisible = await repoRow.isVisible({ timeout: 5000 }).catch(() => false);
    if (!isVisible) {
      console.log(`❌ [GITSEC UI] "${repoName}" adlı repo listede görünmüyor.`);
      return false;
    }

    console.log(`✅ [GITSEC UI] "${repoName}" repo satırı listede görünür.`);

    if (expectedStatus?.isPrivate !== undefined) {
      const expectedText = expectedStatus.isPrivate ? /Private/i : /Public/i;
      const badge = repoRow.locator('span, div, button, p').filter({ hasText: expectedText }).first();
      const hasBadge = await badge.isVisible().catch(() => false);
      console.log(`🔍 [GITSEC UI] Visibility rozeti (${expectedStatus.isPrivate ? 'Private' : 'Public'}): ${hasBadge ? '✅ Mevcut' : '⚠️ Bulunamadı'}`);
      if (!hasBadge) return false;
    }

    if (expectedStatus?.isArchived !== undefined) {
      const archiveBadge = repoRow.locator('span, div, button, p').filter({ hasText: /Archived|Arşivlendi/i }).first();
      const hasArchiveBadge = await archiveBadge.isVisible().catch(() => false);
      console.log(`🔍 [GITSEC UI] Archived rozeti: ${hasArchiveBadge ? '✅ Mevcut' : 'ℹ️ Yok (Unarchived)'}`);
      if (expectedStatus.isArchived !== hasArchiveBadge) return false;
    }

    return true;
  }
}

