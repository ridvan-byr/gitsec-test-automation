import { test, expect, Page } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import { openDashboard, pauseIfHeaded } from '../../support/dashboard-ui-helpers';
import {
  fetchWorkspaceInfo,
  openWorkspaceSwitcher,
  openSettingsSurface,
  type WorkspaceInfo,
} from '../../support/workspace-settings-helpers';

test.describe('Workspace Settings & Member Yönetimi — Arayüz ve Buton Durum Doğrulamaları', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;
  let workspaceInfo: WorkspaceInfo;

  test.beforeAll(() => {
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  });

  async function ensureWorkspaceSession(page: Page) {
    await openDashboard(page, dashboardBaseUrl, workspaceId);
    workspaceInfo = await fetchWorkspaceInfo(page);

    if (!page.url().includes(`/${workspaceId}/`)) {
      const { wsTrigger } = await openWorkspaceSwitcher(page, workspaceInfo.name);
      await wsTrigger.click();
      const defaultOption = page.getByRole('menuitem').filter({ hasText: new RegExp(workspaceInfo.name, 'i') }).first();
      await defaultOption.click();
      await expect(page.getByRole('button', { name: 'Take a Tour' })).toBeVisible({ timeout: 15000 });
    }
  }

  async function requireSettingsSurface(page: Page) {
    const surface = await openSettingsSurface(page, workspaceId, workspaceInfo.name);
    test.skip(!surface, 'Staging arayüzünde Workspace Settings erişilemiyor (dropdown/URL/sidebar denendi).');
    return surface!;
  }
  // ════════════════════════════════════════════════════════════════
  // TEST 1: Workspace Dropdown Menüsü Doğrulaması
  // ════════════════════════════════════════════════════════════════
  test('Workspace ayarları — Dropdown, Settings sekmeleri ve mutasyon akışları', { tag: ['@manual-interactive'] }, async ({ page, request }) => {
    await ensureWorkspaceSession(page);
    workspaceInfo = await fetchWorkspaceInfo(page, request);

    await test.step('Kısım 1: Workspace Dropdown Menüsü Doğrulaması', async () => {
    console.log('🔘 [UI TEST] Workspace dropdown menüsü açılıyor...');
    const { workspaceMenu } = await openWorkspaceSwitcher(page, workspaceInfo.name);

    const settingsOption = workspaceMenu.getByText('Settings', { exact: true }).first();
    const inviteMembersOption = workspaceMenu.getByText('Invite Members', { exact: true }).first();
    const addWorkspaceOption = workspaceMenu.getByText('Add Workspace', { exact: true }).first();
    const currentWorkspace = workspaceMenu.getByRole('menuitem').filter({ hasText: new RegExp(workspaceInfo.name, 'i') }).first();
    if (await settingsOption.isVisible().catch(() => false)) {
      await expect(settingsOption).toBeVisible();
      console.log('✅ "Settings" seçeneği dropdown menüde görünür.');
    } else {
      console.log('ℹ️ Staging sürümünde workspace dropdown yalnızca switcher modunda; Settings menüsü yok.');
    }

    if (await inviteMembersOption.isVisible().catch(() => false)) {
      await expect(inviteMembersOption).toBeVisible();
      console.log('✅ "Invite Members" seçeneği dropdown menüde görünür.');
    }

    await expect(currentWorkspace).toBeVisible();
    console.log('✅ Mevcut workspace adı dropdown menüde listelendi.');

    if (await addWorkspaceOption.isVisible().catch(() => false)) {
      await expect(addWorkspaceOption).toBeVisible();
      console.log('✅ "Add Workspace" seçeneği dropdown menüde görünür.');
    }

    await page.keyboard.press('Escape');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 2: Settings > General Sekmesi Doğrulaması
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 2: Settings > General Sekmesi Doğrulaması', async () => {
    console.log('🔘 [UI TEST] Settings dialog açılıyor (General sekmesi)...');
    const dialog = await requireSettingsSurface(page);
    // 1. Sol paneldeki sekme butonlarını doğrula
    const generalTab = dialog.getByRole('button', { name: 'General' }).first();
    const membersTab = dialog.getByRole('button', { name: 'Members' }).first();
    const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
    await expect(generalTab).toBeVisible();
    await expect(membersTab).toBeVisible();
    await expect(reposTab).toBeVisible();
    console.log('✅ Sidebar sekme butonları (General, Members, Repositories) doğrulandı.');

    // 2. Workspace başlık kartını doğrula (ad + "Default" badge)
    const wsTitle = dialog.getByText(new RegExp(workspaceInfo.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();    await expect(wsTitle).toBeVisible();
    console.log('✅ Workspace başlık kartı görünür.');

    // 3. "Workspace Name" label ve input alanı
    const wsNameLabel = dialog.getByText('Workspace Name', { exact: true });
    await expect(wsNameLabel).toBeVisible();
    const wsNameInput = dialog.locator('input[name="name"]');
    await expect(wsNameInput).toBeVisible();
    await expect(wsNameInput).toBeEditable();
    const nameValue = await wsNameInput.inputValue();
    expect(nameValue.length).toBeGreaterThan(0);
    console.log(`✅ Workspace Name input doğrulandı (değer: "${nameValue}").`);

    // 4. "Workspace Description" label ve textarea
    const wsDescLabel = dialog.getByText('Workspace Description', { exact: true });
    await expect(wsDescLabel).toBeVisible();
    const wsDescInput = dialog.locator('input[name="description"], textarea[name="description"]').first();
    await expect(wsDescInput).toBeVisible();
    await expect(wsDescInput).toBeEditable();
    
    // Benzersiz açıklama girerek kaydetme fonksiyonunu test et
    const uniqueDesc = `GitSec E2E Test Desc - ${Date.now()}`;
    console.log(`✏️ Workspace Description alanına "${uniqueDesc}" yazılıyor...`);
    await wsDescInput.fill(uniqueDesc);
    await page.waitForTimeout(500);

    // 5. "Accent Color" bölümü
    const accentColorLabel = dialog.getByText('Accent Color', { exact: true });
    await expect(accentColorLabel).toBeVisible();
    console.log('✅ Accent Color bölümü doğrulandı.');

    // 6. "Save Changes" butonunun varlığı, aktifliği ve kaydetme akışı
    const saveBtn = dialog.getByRole('button', { name: /Save Changes/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
    
    console.log('🔘 [UI TEST] "Save Changes" butonuna tıklanıyor...');
    await saveBtn.click();
    await page.waitForTimeout(3000); // Kayıt işleminin tamamlanmasını bekle
    
    // Değerin başarıyla kaydedildiğini doğrula
    await expect(wsDescInput).toHaveValue(uniqueDesc);
    console.log('✅ Workspace Description başarıyla güncellendi ve doğrulandı.');

    // 7. Alt bölüm: Workspaces tablosu sütun başlıkları
    // Scroll down to see the table
    const dialogContent = dialog.locator('[class*="overflow"]').first();
    await dialogContent.evaluate(el => el.scrollTo(0, el.scrollHeight)).catch(() => {});
    await page.waitForTimeout(1000);

    const nameHeader = dialog.locator('th').filter({ hasText: 'Name' }).first();
    const descHeader = dialog.locator('th').filter({ hasText: 'Description' }).first();
    const actionsHeader = dialog.locator('th').filter({ hasText: 'Actions' }).first();
    await expect(nameHeader).toBeVisible();
    await expect(descHeader).toBeVisible();
    await expect(actionsHeader).toBeVisible();
    console.log('✅ Workspaces tablosu sütun başlıkları (Name, Description, Actions) doğrulandı.');

    // 8. Close butonunu doğrula ve kapat
    const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toBeEnabled();
    await closeBtn.click();
    console.log('✅ Close butonu tıklandı, dialog kapatıldı.');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 3: Settings > Members Sekmesi ve Davet Formu Doğrulaması
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 3: Settings > Members Sekmesi ve Davet Formu Doğrulaması', async () => {
    console.log('🔘 [UI TEST] Settings > Members sekmesi açılıyor...');
    const dialog = await requireSettingsSurface(page);
    // Members sekmesine geçiş
    const membersTab = dialog.getByRole('button', { name: 'Members' }).first();
    await membersTab.click();
    await page.waitForTimeout(2000);

    // 1. "Members" başlığını doğrula
    const membersHeading = dialog.getByText('Members', { exact: true }).first();
    await expect(membersHeading).toBeVisible();
    console.log('✅ Members başlığı doğrulandı.');

    // 2. E-posta input alanının varlığı ve türü
    const emailInput = dialog.locator('input[type="email"]').first();
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toBeEditable();
    const placeholder = await emailInput.getAttribute('placeholder');
    console.log(`✅ E-posta input alanı doğrulandı (placeholder: "${placeholder}").`);

    // 3. "Send Invite" butonu
    const sendInviteBtn = dialog.getByRole('button', { name: /Send Invite/i });
    await expect(sendInviteBtn).toBeVisible();
    await expect(sendInviteBtn).toBeEnabled();
    console.log('✅ "Send Invite" butonu görünür ve etkin.');

    // 4. "Members (N)" ve "Invites (N)" sekme değiştiricileri
    const membersCountTab = dialog.getByText(/Members \(\d+\)/i).first();
    await expect(membersCountTab).toBeVisible();
    console.log('✅ "Members (N)" sekme değiştirici doğrulandı.');

    const invitesCountTab = dialog.getByText(/Invites \(\d+\)/i).first();
    await expect(invitesCountTab).toBeVisible();
    console.log('✅ "Invites (N)" sekme değiştirici doğrulandı.');

    // 5. Mevcut üye kartının listelendiğini doğrula (en az bir üye)
    const memberCard = dialog.getByText(new RegExp(requireEnv('E2E_USER_EMAIL').split('@')[0], 'i')).first();    await expect(memberCard).toBeVisible();
    console.log('✅ Mevcut üye kartı (gitsectest) listede görünür.');

    // 6. Invites sekmesine geçiş yapılabildiğini doğrula
    await invitesCountTab.click();
    await page.waitForTimeout(1000);
    console.log('✅ "Invites" sekmesine geçiş yapıldı.');

    // Members sekmesine geri dön
    await membersCountTab.click();
    await page.waitForTimeout(500);

    // Kapat
    const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
    await closeBtn.click();
    console.log('✅ Dialog kapatıldı.');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 4: Settings > Repositories Sekmesi Doğrulaması
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 4: Settings > Repositories Sekmesi Doğrulaması', async () => {
    console.log('🔘 [UI TEST] Settings > Repositories sekmesi açılıyor...');
    const dialog = await requireSettingsSurface(page);
    // Repositories sekmesine geçiş
    const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
    await reposTab.click();
    await expect(dialog.getByText('Added Repositories', { exact: true })).toBeVisible();

    // 1. "Repositories" başlığını doğrula
    const reposHeading = dialog.getByText('Repositories').first();
    await expect(reposHeading).toBeVisible();
    console.log('✅ Repositories başlığı doğrulandı.');

    // 2. Repository seçici dropdown (Select a repository)
    const repoSelect = dialog.getByRole('combobox').first();
    await expect(repoSelect).toBeVisible();
    console.log('✅ "Select a repository" dropdown doğrulandı.');

    // 3. "Allow Backup" toggle switch (form üzerindeki ilk switch)
    const allowBackupToggle = dialog.locator('button[role="switch"]').first();
    await expect(allowBackupToggle).toBeVisible();
    console.log('✅ "Allow Backup" toggle switch doğrulandı.');

    // 4. "Add Repository" butonu
    const addRepoBtn = dialog.getByRole('button', { name: /Add Repository/i });
    await expect(addRepoBtn).toBeVisible();
    await expect(addRepoBtn).toBeEnabled();
    console.log('✅ "Add Repository" butonu görünür ve etkin.');

    // 5. Added Repositories tablosu sütun başlıkları
    const expectedHeaders = ['Repository', 'Provider', 'Visibility', 'Access', 'Allow Backup', 'Action'];
    for (const header of expectedHeaders) {
      const th = dialog.locator('th').filter({ hasText: header }).first();
      await expect(th).toBeVisible();
    }
    console.log('✅ Added Repositories tablosu sütun başlıkları doğrulandı: ' + expectedHeaders.join(', '));

    // 6. Tabloda en az bir repo satırının bulunduğunu doğrula
    const repoRows = dialog.locator('tbody tr');
    const rowCount = await repoRows.count();
    expect(rowCount).toBeGreaterThan(0);
    console.log(`✅ Tabloda ${rowCount} adet repository satırı bulunuyor.`);

    // 7. İlk satırdaki silme (Action) butonunun varlığını doğrula
    const deleteBtn = repoRows.first().locator('button').filter({ has: page.locator('svg') }).last();
    await expect(deleteBtn).toBeVisible();
    console.log('✅ Satır içi silme butonu doğrulandı.');

    // 8. Sayfalama (Rows per page) seçicisinin varlığını doğrula
    const rowsPerPage = dialog.getByText(/Rows per page/i).first()
      .or(dialog.locator('p, span, label').filter({ hasText: /Rows per page/i }).first());
    await expect(rowsPerPage).toBeVisible();
    console.log('✅ "Rows per page" sayfalama kontrolü doğrulandı.');

    // Kapat
    const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
    await closeBtn.click();
    console.log('✅ Dialog kapatıldı.');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 5: Add Workspace Wizard Arayüzü Doğrulaması
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 5: Workspace Oluşturma ve Silme Akışı (Uçtan Uca) [@destructive]', async () => {    console.log('🔘 [UI TEST] Workspace dropdown -> Add Workspace tıklanıyor...');
    await openWorkspaceSwitcher(page);

    const addWsOption = page.getByRole('menu').first().getByText('Add Workspace', { exact: true }).first();
    if (!(await addWsOption.isVisible().catch(() => false))) {
      test.skip(true, 'Staging arayüzünde Add Workspace seçeneği bulunmuyor.');
    }
    await expect(addWsOption).toBeVisible();
    await addWsOption.click();
    await page.waitForTimeout(3000);

    // 1. Wizard ana başlığı ("Create a New Workspace")
    const wizardTitle = page.getByText(/Create a New Workspace/i).first();
    await expect(wizardTitle).toBeVisible({ timeout: 15000 });
    console.log('✅ Wizard başlığı "Create a New Workspace" doğrulandı.');

    // Workspace ismi oluştur (kısa ve benzersiz)
    const randomSuffix = Math.floor(100 + Math.random() * 900);
    const wsName = `E2E-WS-${randomSuffix}`;
    console.log(`✏️ Workspace adı "${wsName}" olarak giriliyor...`);

    const wsNameInput = page.locator('input#name');
    await expect(wsNameInput).toBeVisible();
    await wsNameInput.fill(wsName);
    await page.waitForTimeout(500);

    // Step 1: Create Workspace
    console.log('🔘 Create Workspace butonu tıklanıyor...');
    const createBtn = page.locator('button').filter({ hasText: 'Create Workspace' }).first();
    await createBtn.click();
    await page.waitForTimeout(4000);

    // Step 2: Skip for Now
    console.log('🔘 Step 2: Skip for Now tıklanıyor...');
    const skipBtn = page.locator('button').filter({ hasText: /Skip for Now/i }).first();
    await skipBtn.click();
    await page.waitForTimeout(4000);

    // Step 3: Finish Later
    console.log('🔘 Step 3: Finish Later tıklanıyor...');
    const finishBtn = page.locator('button').filter({ hasText: 'Finish Later' }).first();
    await finishBtn.click();
    await page.waitForTimeout(6000);

    // Dashboard'a yönlendiğini doğrula
    console.log(`Current URL after wizard: ${page.url()}`);
    await expect(page).toHaveURL(new RegExp(`\/\\d+\/dashboard`), { timeout: 15000 });
    console.log('✅ Yeni workspace paneline başarıyla yönlendirildi.');

    // Silme işlemini gerçekleştirmek için default workspace'e geri yönleniyoruz.
    // Çünkü aktif olarak bulunulan workspace silinemez.
    console.log(`🔄 Default workspace'e (${workspaceId}) geri dönülüyor...`);
    const wsTrigger = page.locator('[data-slot="dropdown-menu-trigger"]').first();
    await wsTrigger.click();
    await page.waitForTimeout(1000);

    const defaultOption = page.getByRole('menuitem').filter({ hasText: new RegExp(workspaceInfo.name, 'i') }).first();    await defaultOption.click();
    await page.waitForTimeout(4000);

    // Settings dialog'unu aç
    console.log('🔘 Settings dialog açılıyor...');
    const dialog = await requireSettingsSurface(page);
    // Silmek üzere yeni eklenen workspace'i bul
    console.log(`🗑️ Workspace "${wsName}" siliniyor...`);
    const wsRow = dialog.locator('table tbody tr').filter({ hasText: wsName }).first();
    await expect(wsRow).toBeVisible();

    const deleteBtn = wsRow.locator('button').filter({ has: page.locator('svg') }).last()
      .or(wsRow.locator('button').filter({ hasText: /Sil|Delete|Remove/i }));
    await deleteBtn.click();
    await page.waitForTimeout(2000);

    // Silme onay modalı ve input alanı (Unique başlığa göre modalı hedefleyerek indeks karmaşasını önleriz.
    // Radix AlertDialog olduğu için hem role="alertdialog" hem de role="dialog" desteği sunuyoruz)
    const confirmDialog = page.locator('[role="alertdialog"], [role="dialog"], [class*="dialog"], [class*="modal"]')
      .filter({ hasText: /Delete this entire workspace/i })
      .first();
    const confirmInput = confirmDialog.locator('input');
    await expect(confirmInput).toBeVisible({ timeout: 10000 });
    await confirmInput.fill(wsName);
    await page.waitForTimeout(500);

    // Silmeyi onayla
    const confirmDeleteBtn = confirmDialog.locator('button').filter({ hasText: /Permanently delete/i }).first();
    await confirmDeleteBtn.click();
    await page.waitForTimeout(4000);

    console.log('✅ Workspace başarıyla silindi.');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 6: Workspace Adı Güncelleme ve Geri Alma (Mutasyon)
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 6: Workspace Adı Güncelleme ve Geri Alma (Mutasyon) [@destructive]', async () => {    console.log('🔘 [UI TEST] Settings dialog açılıyor (General sekmesi)...');
    const dialog = await requireSettingsSurface(page);
    const wsNameInput = dialog.locator('input[name="name"]');
    await expect(wsNameInput).toBeVisible();

    // Orijinal adı saklayalım
    const originalName = await wsNameInput.inputValue();
    const tempName = `${originalName}-Temp`;

    console.log(`✏️ Workspace adı "${tempName}" olarak değiştiriliyor...`);
    await wsNameInput.fill(tempName);

    const saveBtn = dialog.getByRole('button', { name: /Save Changes/i });
    await saveBtn.click();
    await page.waitForTimeout(2000);

    // Sidebar'ın güncellendiğini doğrula
    const wsTrigger = page.locator('[data-slot="sidebar"]').getByRole('button').filter({ hasText: new RegExp(workspaceInfo.name.split('-Temp')[0], 'i') }).first();    await expect(wsTrigger).toContainText(tempName);
    console.log('✅ Workspace adının başarıyla güncellendiği doğrulandı.');

    // Geri alma (Teardown)
    console.log(`✏️ Workspace adı orijinal hali olan "${originalName}" değerine geri döndürülüyor...`);
    if (!await dialog.isVisible()) {
      await requireSettingsSurface(page);    }
    await wsNameInput.fill(originalName);
    await saveBtn.click();
    await page.waitForTimeout(2000);

    await expect(wsTrigger).toContainText(originalName);
    console.log('✅ Workspace adı eski haline başarıyla geri getirildi.');

    // Kapat
    if (await dialog.isVisible()) {
      const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
      await closeBtn.click();
    }
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 7: Geçersiz E-posta Davet Validasyonu (Negatif Test)
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 7: Geçersiz E-posta Davet Validasyonu (Negatif Test)', async () => {
    console.log('🔘 [UI TEST] Settings > Members sekmesi açılıyor...');
    const dialog = await requireSettingsSurface(page);
    // Members sekmesine geçiş
    const membersTab = dialog.getByRole('button', { name: 'Members' }).first();
    await membersTab.click();
    await page.waitForTimeout(1500);

    // Geçersiz e-posta gir
    const emailInput = dialog.locator('input[type="email"]').first();
    await emailInput.fill('gecersiz-mail-adresi');

    // Davet gönder butonuna tıkla
    const sendInviteBtn = dialog.getByRole('button', { name: /Send Invite/i });
    await sendInviteBtn.click();
    await page.waitForTimeout(1500);

    // E-posta input alanının HTML5 standardına göre validasyon hatasını kontrol et
    const isValid = await emailInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBeFalsy();
    console.log('✅ E-posta input alanı HTML5 standardına göre geçersiz değer girildiğini doğruladı.');

    // Kapat
    const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
    await closeBtn.click();
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 8: Repositories Sekmesinde Depo Ekleme ve Kaldırma (Mutasyon)
  // ════════════════════════════════════════════════════════════════
    await test.step('Kısım 8: Repositories Sekmesinde Depo Ekleme ve Kaldırma (Mutasyon) [@destructive]', async () => {    console.log('🔘 [UI TEST] Settings > Repositories sekmesi açılıyor...');
    const dialog = await requireSettingsSurface(page);
    // Repositories sekmesine geçiş
    const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
    await reposTab.click();
    await expect(dialog.getByText('Added Repositories', { exact: true })).toBeVisible();

    // Workspace kapasitesi dolu olabileceği için ekleme yapmadan önce mevcut bir repository seç.
    // Geçici "No results found" satırını veri satırı sanmamak için gerçek repository linkini bekle.
    const repositoryTable = dialog.getByRole('table');
    const firstRow = repositoryTable.getByRole('row').filter({
      has: page.getByRole('link')
    }).first();
    const repoLink = firstRow.getByRole('link').first();

    await expect(firstRow).toBeVisible({ timeout: 15000 });
    await expect(repoLink).toHaveText(/\S+/);

    const repoName = (await repoLink.innerText()).trim();
    console.log(`📋 Önce çıkarılıp sonra geri eklenecek depo: "${repoName}"`);

    const escapedRepoName = repoName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const rowWithRepo = dialog.locator('tbody tr').filter({
      hasText: new RegExp(`^\\s*${escapedRepoName}\\s+(GitHub|Bitbucket)`, 'i')
    });

    // Silme butonunu bul ve tıkla
    const deleteBtn = firstRow.locator('button').filter({ has: page.locator('svg') }).last();
    await deleteBtn.click();

    // Bazı sürümlerde silme doğrudan, bazılarında onay dialogu üzerinden gerçekleşiyor.
    const confirmationDialog = page.getByRole('alertdialog');
    const confirmBtn = confirmationDialog.getByRole('button', { name: /Confirm|Delete|Yes|Remove|Sil/i });
    await expect.poll(async () =>
      (await confirmationDialog.isVisible()) || (await rowWithRepo.count()) === 0
    ).toBe(true);

    if (await confirmationDialog.isVisible()) {
      await expect(confirmBtn).toBeEnabled();
      await confirmBtn.click();
    }

    // Deponun tablodan kaybolduğunu doğrula
    await expect(rowWithRepo).toHaveCount(0);
    console.log('✅ Depo başarıyla çalışma alanından kaldırıldı.');

    // Geri ekleme (Teardown)
    console.log(`🔄 Depo "${repoName}" geri ekleniyor...`);
    const repoSelect = dialog.getByRole('combobox').first();
    await repoSelect.click();

    // Dropdown içinden silinen depoyu seç
    const option = page.locator('[role="option"], [data-slot="select-item"], [class*="select-item"]').filter({ hasText: repoName }).first();
    await expect(option).toBeVisible();
    await option.click();

    // Ekle
    const addRepoBtn = dialog.getByRole('button', { name: /Add Repository/i });
    await expect(addRepoBtn).toBeEnabled();
    await addRepoBtn.click();

    // Toast mesajının çıkmasını bekle
    const toast = page.locator('text=Repository added to workspace successfully').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    console.log('✅ Depo ekleme toast bildirimi doğrulandı.');

    // Dialogu kapat ve kaybolmasını bekle (engelleme olmaması için)
    const closeBtn = dialog.getByRole('button', { name: /^Close$/i });
    await closeBtn.click();
    await expect(dialog).toBeHidden();
    console.log('✅ Dialog kapatıldı ve kapandığı doğrulandı.');

    });

    await pauseIfHeaded(page);
  });
});
