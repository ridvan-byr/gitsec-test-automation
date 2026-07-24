import { expect, Locator, Page } from '@playwright/test';
import { requireEnv } from '../support/require-env';

export class StoragePage {
  readonly page: Page;

  // AWS S3 Locators
  readonly awsConnectionNameInput: Locator;
  readonly awsBucketInput: Locator;
  readonly awsAccessKeyInput: Locator;
  readonly awsSecretKeyInput: Locator;
  readonly awsRegionCombobox: Locator;
  readonly awsRegionInput: Locator;

  // Azure Blob Storage Locators
  readonly azureConnectionNameInput: Locator;
  readonly azureFolderPathInput: Locator;
  readonly azureConnectionStringTextarea: Locator;

  // Huawei OBS Locators
  readonly huaweiConnectionNameInput: Locator;
  readonly huaweiBucketInput: Locator;
  readonly huaweiAccessKeyInput: Locator;
  readonly huaweiSecretKeyInput: Locator;

  // Common buttons & Modals
  readonly testConnectionBtn: Locator;
  readonly closeDialogBtn: Locator;
  readonly saveBtn: Locator;
  readonly dialog: Locator;
  readonly confirmDeleteBtn: Locator;
  readonly alertDialogOverlay: Locator;

  get workspaceId() {
    return requireEnv('WORKSPACE_ID');
  }

  get dashboardBaseUrl() {
    return requireEnv('DASHBOARD_BASE_URL');
  }

  constructor(page: Page) {
    this.page = page;

    // AWS S3
    this.awsConnectionNameInput = page.getByPlaceholder(/e.g., Compliance S3/i)
      .or(page.getByPlaceholder(/Compliance/i))
      .or(page.locator('input[name="name"]'))
      .first();

    this.awsBucketInput = page.getByPlaceholder(/gitsec-backups-prod/i)
      .or(page.getByPlaceholder(/backups-prod/i))
      .or(page.locator('input[name="bucket"]'))
      .or(page.locator('input[name*="bucket"]'))
      .first();

    this.awsAccessKeyInput = page.getByPlaceholder(/Enter access key ID/i)
      .or(page.getByPlaceholder(/access key/i))
      .or(page.locator('input[name="accessKey"]'))
      .or(page.locator('input[name*="accessKey"]'))
      .first();

    this.awsSecretKeyInput = page.getByPlaceholder(/Enter secret key/i)
      .or(page.getByPlaceholder(/secret key/i))
      .or(page.locator('input[name="secretKey"]'))
      .or(page.locator('input[name*="secretKey"]'))
      .first();

    this.awsRegionCombobox = page.locator('main main').getByRole('combobox')
      .or(page.getByRole('combobox', { name: /Region|Bölge/i }))
      .first();

    this.awsRegionInput = page.getByPlaceholder(/Region/i)
      .or(page.locator('input[name*="region"]'))
      .first();

    // Azure Blob Storage
    this.azureConnectionNameInput = page.locator('input[name="name"]').first();
    this.azureFolderPathInput = page.locator('input[name="folderPath"]').first();
    this.azureConnectionStringTextarea = page.locator('textarea[name="identifier"]').first();

    // Huawei OBS
    this.huaweiConnectionNameInput = page.locator('input[name="name"]').first();
    this.huaweiBucketInput = page.locator('input[name="containerName"]').first();
    this.huaweiAccessKeyInput = page.locator('input[name="identifier"]').first();
    this.huaweiSecretKeyInput = page.locator('input[name="credential"]').first();

    // Common
    this.testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
    this.closeDialogBtn = page.getByRole('button', { name: /Close|Kapat/i }).first();
    this.saveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    this.dialog = page.locator('[role="dialog"]').first();
    this.confirmDeleteBtn = page.getByRole('button', { name: /confirm|delete|yes|sure|sil/i })
      .or(page.locator('[role="dialog"] button, [role="alertdialog"] button, .modal button').filter({ hasText: /confirm|delete|yes|sure|sil/i }))
      .or(page.locator('button').filter({ hasText: /confirm|delete|yes|sure|sil/i }))
      .first();
    this.alertDialogOverlay = page.locator('[data-slot="alert-dialog-overlay"], [role="dialog"]').first();
  }

  async getActiveWorkspaceId(): Promise<string> {
    const currentUrl = this.page.url();
    const match = currentUrl.match(/\/(\d+)\//);
    if (match) {
      return match[1];
    }
    return requireEnv('WORKSPACE_ID');
  }

  async navigateToStoragePage(): Promise<void> {
    console.log('[POM] Storage listeleme sayfasına gidiliyor...');

    const currentUrl = this.page.url();
    if (currentUrl.includes('/storage') && !currentUrl.includes('/storage/add')) {
      console.log('[POM] Zaten Storage listeleme sayfasındayız.');
      return;
    }

    // 1. Tarayıcı henüz boş sayfadaysa veya dashboard ortamı dışında ise önce Dashboard'u yükle
    if (currentUrl === 'about:blank' || !currentUrl.includes(this.dashboardBaseUrl)) {
      console.log('[POM] Sayfa henüz yüklenmedi. Önce Dashboard yükleniyor...');
      const defaultWsId = requireEnv('WORKSPACE_ID');
      await this.page.goto(`${this.dashboardBaseUrl}/${defaultWsId}/dashboard`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      await expect(this.page.locator('main, nav, aside').first()).toBeVisible({ timeout: 10000 }).catch(() => {});
    }

    const wsId = await this.getActiveWorkspaceId();

    // 2. Sidebar Storage linkini kontrol et (Tüm workspace ID çeşitleriyle uyumlu)
    const storageLink = this.page.getByRole('link', { name: /Storage|Depolama/i })
      .or(this.page.locator('a[href*="/storage"]'))
      .first();

    await storageLink.waitFor({ state: 'attached', timeout: 8000 }).catch(() => {});

    if (await storageLink.isVisible().catch(() => false)) {
      console.log('[POM] Sidebar Storage linki bulundu, tıklanıyor...');
      await storageLink.click();
      const navigated = await this.page.waitForURL(/\/storage(\?|#|$)/, { timeout: 4000 }).then(() => true).catch(() => false);
      if (!navigated) {
        console.log('[POM] Sidebar tıklaması yönlendirmedi. Doğrudan URL ile gidiliyor...');
        await this.page.goto(`${this.dashboardBaseUrl}/${wsId}/storage`, { waitUntil: 'domcontentloaded' }).catch(() => {});
      }
    } else {
      console.log('[POM] Doğrudan URL ile Storage sayfasına gidiliyor...');
      await this.page.goto(`${this.dashboardBaseUrl}/${wsId}/storage`, { waitUntil: 'domcontentloaded' }).catch(err => {
        if (!err.message.includes('net::ERR_ABORTED')) throw err;
      });
    }

    await this.page.waitForURL(/\/storage(\?|#|$)/, { timeout: 20000 });
    await expect(this.page.locator('main').first()).toBeVisible({ timeout: 10000 });

    // BYOS (Bring Your Own Storage) plan kilit ekranı denetimi
    await this.checkByosUpgradeRequired();
  }

  /**
   * BYOS (Bring Your Own Storage) kilitli ekran uyarısını (Upgrade Plan kilit kartı) kontrol eder.
   * BYOS özelliği SADECE Premium+ ve Enterprise planlarında mevcuttur.
   * Freemium, Startup ve Premium planlarında ekranda "BYOS (Bring Your Own Storage)" kilit kartı çıkar.
   */
  async checkByosUpgradeRequired(): Promise<boolean> {
    await this.page.waitForTimeout(600);

    const byosCard = this.page.locator('div, section, main')
      .filter({ hasText: /BYOS \(Bring Your Own Storage\)/i })
      .filter({ hasText: /Upgrade Plan/i })
      .first();

    const upgradeBtn = this.page.locator('button, a')
      .filter({ hasText: /Upgrade Plan/i })
      .first();

    const isByosLocked = (await byosCard.isVisible().catch(() => false)) || (await upgradeBtn.isVisible().catch(() => false));

    if (isByosLocked) {
      console.log('\n🔒 ========================================================');
      console.log('🔒 [STORAGE BYOS LOG] BYOS (Bring Your Own Storage) kilit ekranı tespit edildi!');
      console.log('🔒 [LICENSE WARNING] BYOS (Bring Your Own Storage) entegrasyonu SADECE Premium+ ve Enterprise planlarında mevcuttur.');
      console.log('🔒 [LICENSE WARNING] Mevcut abonelik planınız (Freemium, Startup veya Premium) BYOS özelliğini kapsamamaktadır.');
      console.log('🔒 [LICENSE WARNING] Test, plan yetersizliği nedeniyle güvenli ve başarılı şekilde sonlandırılıyor.');
      console.log('🔒 ========================================================\n');
      return true;
    }

    return false;
  }

  async clickAddStorageProvider(): Promise<void> {
    console.log('[POM] Doğrudan URL ile "Add Storage Provider" sayfasına gidiliyor...');
    const wsId = await this.getActiveWorkspaceId();
    await this.page.goto(`${this.dashboardBaseUrl}/${wsId}/storage/add`, { waitUntil: 'domcontentloaded' }).catch(err => {
      if (!err.message.includes('net::ERR_ABORTED')) throw err;
      console.log('⚠️ [POM] page.goto aborted, but continuing to wait for target URL...');
    });
    await this.page.waitForURL(/\/storage\/add/, { timeout: 30000 });
    
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(this.page.locator('main').first()).toBeVisible({ timeout: 10000 });
  }

  async selectS3Provider(): Promise<void> {
    console.log('[POM] AWS S3 sağlayıcı kartı seçiliyor...');
    const awsCard = this.page.locator('h3:visible, h4:visible, p:visible, div:visible, span:visible, button:visible, a:visible')
      .filter({ hasText: /^AWS S3$/ })
      .or(this.page.getByText('Amazon Simple Storage Service').filter({ visible: true }))
      .first();

    await awsCard.waitFor({ state: 'visible', timeout: 15000 });

    let clickSuccess = false;
    for (let i = 0; i < 3; i++) {
      console.log(`[POM] AWS S3 sağlayıcı kartına tıklanıyor (Deneme #${i + 1})...`);
      await awsCard.click();
      try {
        await this.page.waitForURL(new RegExp(/provider=AWS/i), { timeout: 3500 });
        clickSuccess = true;
        break;
      } catch (e) {
        console.log(`⚠️ [POM] Tıklama Next.js hydration engeline takılmış olabilir. Tekrar deneniyor...`);
      }
    }

    if (!clickSuccess) {
      console.log(`⚠️ [POM] Form URL'i değişmedi, son çare olarak tekrar normal click tetikleniyor...`);
      await awsCard.click();
    }
    
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(this.page.locator('form, main').first()).toBeVisible({ timeout: 10000 });
  }

  async selectAzureProvider(): Promise<void> {
    console.log('[POM] Azure Blob Storage sağlayıcı kartı seçiliyor...');
    const azureCard = this.page.locator('h3:visible, h4:visible, p:visible, div:visible, span:visible, button:visible, a:visible')
      .filter({ hasText: /^Azure Blob Storage$/ })
      .or(this.page.getByText('Microsoft Azure Blob Storage').filter({ visible: true }))
      .first();

    await azureCard.waitFor({ state: 'visible', timeout: 15000 });

    let clickSuccess = false;
    for (let i = 0; i < 3; i++) {
      console.log(`[POM] Azure Blob Storage sağlayıcı kartına tıklanıyor (Deneme #${i + 1})...`);
      await azureCard.click();
      try {
        await this.page.waitForURL(new RegExp(/provider=Azure/i), { timeout: 3500 });
        clickSuccess = true;
        break;
      } catch (e) {
        console.log(`⚠️ [POM] Tıklama Next.js hydration engeline takılmış olabilir. Tekrar deneniyor...`);
      }
    }

    if (!clickSuccess) {
      console.log(`⚠️ [POM] Form URL'i değişmedi, son çare olarak tekrar normal click tetikleniyor...`);
      await azureCard.click();
    }
    
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(this.page.locator('form, main').first()).toBeVisible({ timeout: 10000 });
  }

  async selectHuaweiProvider(): Promise<void> {
    console.log('[POM] Huawei OBS sağlayıcı kartı seçiliyor...');
    const huaweiCard = this.page.locator('h3:visible, h4:visible, p:visible, div:visible, span:visible, button:visible, a:visible')
      .filter({ hasText: /^Huawei OBS$/ })
      .or(this.page.getByText('Huawei Object Storage Service').filter({ visible: true }))
      .first();

    await huaweiCard.waitFor({ state: 'visible', timeout: 15000 });

    let clickSuccess = false;
    for (let i = 0; i < 3; i++) {
      console.log(`[POM] Huawei OBS sağlayıcı kartına tıklanıyor (Deneme #${i + 1})...`);
      await huaweiCard.click();
      try {
        await this.page.waitForURL(new RegExp(/provider=Huawei/i), { timeout: 3500 });
        clickSuccess = true;
        break;
      } catch (e) {
        console.log(`⚠️ [POM] Tıklama Next.js hydration engeline takılmış olabilir. Tekrar deneniyor...`);
      }
    }

    if (!clickSuccess) {
      console.log(`⚠️ [POM] Form URL'i değişmedi, son çare olarak tekrar normal click tetikleniyor...`);
      await huaweiCard.click();
    }
    
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(this.page.locator('form, main').first()).toBeVisible({ timeout: 10000 });
  }

  async selectOAuthProvider(providerText: string, providerDesc: string): Promise<void> {
    console.log(`[POM] Seçilen sağlayıcı kartına tıklanıyor: ${providerText}`);
    const providerCard = this.page.getByText(providerText, { exact: true })
      .or(this.page.getByText(providerDesc))
      .or(this.page.locator('h3, p, div, span, button, a').filter({ hasText: new RegExp(`^${providerText}$`, 'i') }))
      .first();

    await providerCard.waitFor({ state: 'visible', timeout: 15000 });

    let clickSuccess = false;
    const providerQueryRegex = /provider=/i;

    for (let i = 0; i < 3; i++) {
      console.log(`[POM] ${providerText} sağlayıcı kartına tıklanıyor (Deneme #${i + 1})...`);
      await providerCard.click();
      try {
        await this.page.waitForURL(providerQueryRegex, { timeout: 3500 });
        clickSuccess = true;
        break;
      } catch (e) {
        console.log(`⚠️ [POM] Tıklama Next.js hydration engeline takılmış olabilir. Tekrar deneniyor...`);
      }
    }

    if (!clickSuccess) {
      console.log(`⚠️ [POM] Form URL'i değişmedi, son çare olarak tekrar normal click tetikleniyor...`);
      await providerCard.click();
    }
    
    await this.page.waitForLoadState('load').catch(() => {});
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await expect(this.page.locator('form, main').first()).toBeVisible({ timeout: 10000 });
  }

  async startOAuthFlow(onHandlePopup: (targetPage: Page) => Promise<void>): Promise<void> {
    console.log(`[POM] OAuth akışı başlatılıyor — "Permission Required" butonu aranıyor...`);
    const permissionBtn = this.page.getByRole('button', { name: /Permission Required/i })
      .or(this.page.getByRole('button', { name: /Connect|Bağla|Authorize/i }))
      .first();

    await permissionBtn.waitFor({ state: 'visible', timeout: 20000 });
    console.log('[POM] "Permission Required" butonu bulundu.');
    await expect(permissionBtn).toBeEnabled({ timeout: 10000 });
    await this.page.waitForTimeout(1000);

    console.log('[POM] "Permission Required" butonuna tıklanıyor ve OAuth popup açılması bekleniyor...');

    // Playwright recommended pattern: Eşzamanlı popup dinleme ve tıklama (40sn cömert zaman aşımı)
    const [popup] = await Promise.all([
      this.page.waitForEvent('popup', { timeout: 40000 }),
      permissionBtn.click(),
    ]);

    console.log(`[POM] OAuth pop-up penceresi açıldı! URL: ${popup.url()}`);
    await onHandlePopup(popup);
  }

  async fillOAuthFormAndSave(connName: string, storageProvider: string): Promise<void> {
    console.log('[POM] Form sayfasının gelmesi kontrol ediliyor...');
    
    // Üst menüdeki arama çubuğunu (header search) kesinlikle hariç tutan form içi hassas seçici
    const formScope = this.page.locator('form, [role="form"], div[class*="form"], div[class*="card"], main').first();
    const connectionNameInput = formScope.locator('input[name="name"], input[name="connectionName"], input[id*="name"]')
      .or(this.page.getByLabel(/connection name|bağlantı adı/i))
      .or(this.page.getByPlaceholder(/compliance|connection name|e\.g\./i))
      .or(this.page.locator('input[name="name"]'))
      .or(formScope.locator('input[type="text"]:not([placeholder*="Search"]):not([placeholder*="ara"]):not([aria-label*="search"])'))
      .first();

    await expect(connectionNameInput).toBeVisible({ timeout: 20_000 });
    console.log(`[POM] Form sayfası yüklendi. Bağlantı adı giriliyor: "${connName}"`);
    await connectionNameInput.click();
    await connectionNameInput.fill(connName);

    // Değer doğru yazıldı mı kontrol et; yazılmadıysa pressSequentially ile garantiye al
    let val = await connectionNameInput.inputValue().catch(() => '');
    if (val !== connName) {
      console.log(`[POM] fill ile değer tam yazılamadı ("${val}"), pressSequentially ile yazılıyor...`);
      await connectionNameInput.fill('');
      await connectionNameInput.pressSequentially(connName, { delay: 50 });
    }
    await expect(connectionNameInput).toHaveValue(connName, { timeout: 5000 });
    console.log(`[POM] ✅ Bağlantı adı alana başarıyla yazıldı: "${connName}"`);

    // Test Connection
    if (await this.testConnectionBtn.isVisible().catch(() => false)) {
      console.log('[POM] "Test Connection" butonu tetikleniyor...');
      await this.testConnectionBtn.click();

      console.log('[POM] Test Connection modalının açılması ve kapanması bekleniyor...');
      await this.closeDialogBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => { });
      if (await this.closeDialogBtn.isVisible().catch(() => false)) {
        await this.closeDialogBtn.click();
      }
      await this.dialog.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => { });
    }

    if (await this.saveBtn.isVisible().catch(() => false)) {
      console.log('[POM] "Save" butonuna tıklanıyor...');
      await this.saveBtn.click();
    }

    await this.page.waitForURL(/\/storage(\?|#|$)/, { timeout: 20_000 }).catch(() => {});
  }

  async fillAWSForm(connectionName: string, bucketName: string, accessKey: string, secretKey: string, region: string): Promise<void> {
    console.log('[POM] AWS S3 form alanları dolduruluyor...');

    await this.awsConnectionNameInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.awsConnectionNameInput.fill(connectionName);
    await this.awsBucketInput.fill(bucketName);
    await this.awsAccessKeyInput.fill(accessKey);
    await this.awsSecretKeyInput.fill(secretKey);

    let regionKeyword = region;
    if (region === 'eu-central-1') regionKeyword = 'Frankfurt';
    else if (region === 'us-east-1') regionKeyword = 'Virginia';
    else if (region === 'us-east-2') regionKeyword = 'Ohio';

    if (await this.awsRegionInput.isVisible().catch(() => false)) {
      await this.awsRegionInput.fill(region);
    } else if (await this.awsRegionCombobox.isVisible().catch(() => false)) {
      await this.awsRegionCombobox.click();
      const listbox = this.page.locator('[role="listbox"], [role="menu"], [class*="select-content"], [data-radix-popper-content-wrapper]').first();
      await listbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
      
      const option = listbox.getByRole('option', { name: new RegExp(`^(${region}|${regionKeyword})$`, 'i') })
        .or(listbox.getByRole('option', { name: new RegExp(`${regionKeyword}`, 'i') }))
        .or(listbox.locator('[role="option"]').filter({ hasText: new RegExp(`^(${region}|${regionKeyword})$`, 'i') }))
        .or(listbox.locator('[role="option"]').filter({ hasText: new RegExp(`${regionKeyword}`, 'i') }))
        .or(listbox.getByText(regionKeyword, { exact: true }))
        .or(listbox.getByText(region, { exact: true }))
        .first();
      await option.waitFor({ state: 'visible', timeout: 8000 });
      await option.click({ force: true });
      
      await this.page.keyboard.press('Escape').catch(() => {});
      await listbox.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      console.log('[POM] Bölge (Region) seçimi tamamlandı ve listbox kapandı.');
    }
  }

  async fillAzureForm(connectionName: string, folderPath: string, connectionString: string): Promise<void> {
    console.log('[POM] Azure Blob Storage form alanları dolduruluyor...');

    await this.azureConnectionNameInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.azureConnectionNameInput.fill(connectionName);
    await this.azureFolderPathInput.fill(folderPath || '/');
    await this.azureConnectionStringTextarea.fill(connectionString);
  }

  async fillHuaweiForm(connectionName: string, bucketName: string, accessKeyId: string, secretAccessKey: string, region: string): Promise<void> {
    console.log('[POM] Huawei OBS form alanları dolduruluyor...');

    await this.huaweiConnectionNameInput.waitFor({ state: 'visible', timeout: 15000 });
    await this.huaweiConnectionNameInput.fill(connectionName);
    await this.huaweiBucketInput.fill(bucketName);

    if (region) {
      console.log(`[POM] Huawei OBS bölge seçimi başlatılıyor: ${region}`);
      const regionCombobox = this.page.locator('main main').getByRole('combobox')
        .or(this.page.getByRole('combobox', { name: /Region|Bölge/i }))
        .first();

      if (await regionCombobox.isVisible().catch(() => false)) {
        await regionCombobox.click();
        const listbox = this.page.locator('[role="listbox"], [role="menu"], [class*="select-content"], [data-radix-popper-content-wrapper]').first();
        await listbox.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        
        let regionKeyword = region;
        if (region.toLowerCase().includes('turkey') || region.toLowerCase().includes('türkiye') || region.toLowerCase().includes('tr-west-1')) {
          regionKeyword = 'Türk|Turkey';
        }

        const option = listbox.getByRole('option', { name: new RegExp(`(${regionKeyword}|${region})`, 'i') })
          .or(listbox.locator('[role="option"]').filter({ hasText: new RegExp(`(${regionKeyword}|${region})`, 'i') }))
          .or(listbox.getByText(new RegExp(`(${regionKeyword})`, 'i')))
          .first();
        await option.waitFor({ state: 'visible', timeout: 8000 });
        await option.click({ force: true });
        
        await this.page.keyboard.press('Escape').catch(() => {});
        await listbox.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
        console.log('[POM] Huawei OBS bölge seçimi tamamlandı.');
      }
    }

    await this.huaweiAccessKeyInput.fill(accessKeyId);
    await this.huaweiSecretKeyInput.fill(secretAccessKey);
  }

  async testS3Connection(): Promise<void> {
    console.log('[POM] "Test Connection" butonu tetikleniyor...');
    await this.testConnectionBtn.click();

    console.log('[POM] Test Connection modalının açılması ve kapanması bekleniyor...');
    await this.closeDialogBtn.waitFor({ state: 'visible', timeout: 60000 });

    await this.page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('.modal');
      if (dialog) dialog.scrollTop = dialog.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});

    await this.closeDialogBtn.click().catch(() => {});
    await this.dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    console.log('[POM] Test Connection modalı tamamen kapandı.');
  }

  async saveStorageProvider(): Promise<void> {
    console.log('[POM] "Save" butonuna tıklanıyor...');
    await this.saveBtn.click();
    await this.page.waitForURL(/\/storage(\?|#|$)/, { timeout: 20000 });
    console.log('[POM] Başarıyla depolama listesi sayfasına yönlenildi!');
  }

  async verifyProviderActive(connectionName: string): Promise<void> {
    console.log(`[POM] Depolama sağlayıcısının active/connected olduğu doğrulanıyor: ${connectionName}`);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    // Strict mode ihlalini ve gereksiz yenilemeleri önleyen tekil kart/satır seçicisi
    const targetStorageCard = this.page.locator('tbody tr, [role="row"], [data-slot="card"], .card')
      .filter({ hasText: connectionName })
      .first()
      .or(this.page.getByRole('cell', { name: connectionName }).first())
      .or(this.page.getByText(connectionName).first())
      .first();

    const isVisible = await targetStorageCard.isVisible().catch(() => false);
    if (!isVisible) {
      console.log('[POM] Depolama listesi henüz güncellenmedi. 2 saniye beklenip sayfa yenileniyor...');
      await this.page.waitForTimeout(2000);
      await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    }

    await expect(targetStorageCard).toBeVisible({ timeout: 25_000 });
    console.log(`[POM] ${connectionName} sağlayıcısı başarıyla listede görüntülendi ve doğrulandı.`);
  }

  async deleteProvider(connectionName: string): Promise<void> {
    console.log(`[POM] Temizlik: Depolama sağlayıcısı siliniyor: ${connectionName}`);
    
    const currentUrl = this.page.url();
    if (!currentUrl.includes('/storage') || currentUrl.includes(`/storage/add`)) {
      console.log('[POM] Silme işlemi öncesinde depolama sayfasına yönlendiriliyor...');
      await this.navigateToStoragePage();
    }

    const targetStorageCard = this.page.locator('tbody tr, [role="row"], [data-slot="card"], .card')
      .filter({ hasText: connectionName })
      .first()
      .or(this.page.getByText(connectionName).first())
      .first();
    if (!(await targetStorageCard.isVisible().catch(() => false))) {
      console.log('[POM] Depolama sağlayıcısı zaten görünür değil veya silinmiş.');
      return;
    }

    const s3DeleteBtn = targetStorageCard.locator('button').filter({ hasText: /delete|remove|disconnect|sil/i })
      .or(targetStorageCard.locator('svg[class*="trash"]').locator('..'))
      .first();

    if (await s3DeleteBtn.isVisible().catch(() => false)) {
      await s3DeleteBtn.click();
    } else {
      const cardMenuTrigger = targetStorageCard.locator('button[aria-haspopup="menu"]')
        .or(targetStorageCard.locator('button[id*="radix"]'))
        .or(targetStorageCard.getByRole('button', { name: /Open menu|actions/i }))
        .first();
      
      if (await cardMenuTrigger.isVisible().catch(() => false)) {
        await cardMenuTrigger.click();
        const s3DeleteAction = this.page.getByRole('menuitem', { name: /delete|remove|disconnect|sil/i }).first();
        await s3DeleteAction.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        await s3DeleteAction.click();
      }
    }

    await this.confirmDeleteBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await this.confirmDeleteBtn.isVisible().catch(() => false)) {
      await this.confirmDeleteBtn.click();
    }

    await expect(targetStorageCard).toBeHidden({ timeout: 15000 });
    await this.alertDialogOverlay.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    console.log('[POM] Depolama sağlayıcısı başarıyla silindi ve kaldırıldı.');
  }

  async cleanupExistingTestProviders(provider: string = 'aws'): Promise<void> {
    console.log(`[POM] Arka plan temizliği: Eski E2E test sağlayıcıları (${provider.toUpperCase()}) temizleniyor...`);
    
    const currentUrl = this.page.url();
    if (!currentUrl.includes(`/${this.workspaceId}/storage`) || currentUrl.includes(`/storage/add`)) {
      await this.navigateToStoragePage();
    }

    await expect(this.page.locator('table, [role="table"]').first()).toBeVisible({ timeout: 10000 }).catch(() => {});
    await this.page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

    let typePattern = /gitsec-test/i;
    if (provider === 'aws') {
      typePattern = /AWS S3/i;
    } else if (provider === 'gdrive') {
      typePattern = /Google Drive/i;
    } else if (provider === 'onedrive') {
      typePattern = /OneDrive/i;
    } else if (provider === 'azure') {
      typePattern = /Azure Blob|Azure/i;
    } else if (provider === 'huawei') {
      typePattern = /Huawei/i;
    }

    const cards = this.page.locator('tr')
      .filter({
        has: this.page.locator('td').filter({ hasText: typePattern })
      });
    const count = await cards.count().catch(() => 0);
    console.log(`[POM] Toplam ${count} adet çelişen E2E sağlayıcı kartı tespit edildi.`);
    
    for (let i = 0; i < count; i++) {
      const card = cards.first();
      if (await card.isVisible().catch(() => false)) {
        console.log(`[POM] Eski test kartı siliniyor...`);
        await this.deleteFirstCardFromLocator(card).catch(() => {});
        await expect(card).toBeHidden({ timeout: 10000 }).catch(() => {});
      }
    }
  }

  async deleteFirstCardFromLocator(card: Locator): Promise<void> {
    const s3DeleteBtn = card.locator('button').filter({ hasText: /delete|remove|disconnect|sil/i })
      .or(card.locator('svg[class*="trash"]').locator('..'))
      .first();

    if (await s3DeleteBtn.isVisible().catch(() => false)) {
      await s3DeleteBtn.click();
    } else {
      const cardMenuTrigger = card.locator('button[aria-haspopup="menu"]').or(card.locator('button[id*="radix"]')).first();
      if (await cardMenuTrigger.isVisible().catch(() => false)) {
        await cardMenuTrigger.click();
        await this.page.evaluate(() => new Promise(requestAnimationFrame));
        const s3DeleteAction = this.page.getByRole('menuitem', { name: /delete|remove|disconnect|sil/i }).first();
        await s3DeleteAction.click();
      }
    }

    await this.confirmDeleteBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await this.confirmDeleteBtn.isVisible().catch(() => false)) {
      await this.confirmDeleteBtn.click();
    }
    await expect(card).toBeHidden({ timeout: 15000 }).catch(() => {});
    await this.alertDialogOverlay.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    console.log('[POM] Çelişen sağlayıcı kartı başarıyla temizlendi.');
  }
}
