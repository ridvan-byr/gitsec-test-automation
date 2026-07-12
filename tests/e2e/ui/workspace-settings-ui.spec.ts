import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Workspace Settings & Member Yönetimi — Arayüz ve Buton Durum Doğrulamaları', () => {
  let workspaceId: string;
  let dashboardBaseUrl: string;

  test.beforeEach(async ({ page }) => {
    (page as any).ignoredErrors = [
      /502/,
      /_next\/static\/chunks/i,
      /Failed to load resource/i,
      /ChunkLoadError/i
    ];
    workspaceId = requireEnv('WORKSPACE_ID');
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

    const targetUrl = `${dashboardBaseUrl}/${workspaceId}/dashboard`;
    console.log(`🌐 [UI TEST] Dashboard sayfasına yönleniliyor: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });

    // Oturum yüklenene kadar sidebar alanını bekle
    const sidebar = page.locator('aside, nav, [class*="sidebar"]').first();
    await sidebar.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForLoadState('networkidle').catch(() => {});
  });

  /**
   * Sidebar'daki workspace dropdown trigger'ını bulur ve tıklar.
   * Dropdown menünün açılmasını bekler.
   */
  async function openWorkspaceDropdown(page: import('@playwright/test').Page) {
    const wsTrigger = page.locator('[data-slot="dropdown-menu-trigger"]')
      .filter({ hasText: /Default Wor/i })
      .first();
    await expect(wsTrigger).toBeVisible({ timeout: 10000 });
    await wsTrigger.click();
    // Dropdown menüsünün görünür olmasını bekle
    await page.waitForTimeout(1500);
    return wsTrigger;
  }

  /**
   * Settings dialog'unu açar (workspace dropdown -> Settings).
   * Dialog'un yüklenmesini bekler ve dialog locator'ını döner.
   */
  async function openSettingsDialog(page: import('@playwright/test').Page) {
    await openWorkspaceDropdown(page);
    const settingsBtn = page.getByText('Settings', { exact: true }).first();
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await page.waitForTimeout(2000);
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    return dialog;
  }

  // ════════════════════════════════════════════════════════════════
  // TEST 1: Workspace Dropdown Menüsü Doğrulaması
  // ════════════════════════════════════════════════════════════════
  test('Kısım 1: Workspace Dropdown Menüsü Doğrulaması', async ({ page }) => {
    console.log('🔘 [UI TEST] Workspace dropdown menüsü açılıyor...');
    await openWorkspaceDropdown(page);

    // 1. "Settings" seçeneğinin varlığını doğrula
    const settingsOption = page.getByText('Settings', { exact: true }).first();
    await expect(settingsOption).toBeVisible({ timeout: 5000 });
    console.log('✅ "Settings" seçeneği dropdown menüde görünür.');

    // 2. "Invite Members" seçeneğinin varlığını doğrula
    const inviteMembersOption = page.getByText('Invite Members', { exact: true }).first();
    await expect(inviteMembersOption).toBeVisible();
    console.log('✅ "Invite Members" seçeneği dropdown menüde görünür.');

    // 3. Mevcut workspace adının listelendiğini doğrula
    const currentWorkspace = page.getByText(/Gitsec's Default Workspace/i).first();
    await expect(currentWorkspace).toBeVisible();
    console.log('✅ Mevcut workspace adı dropdown menüde listelendi.');

    // 4. "Add Workspace" seçeneğinin varlığını doğrula
    const addWorkspaceOption = page.getByText('Add Workspace', { exact: true }).first();
    await expect(addWorkspaceOption).toBeVisible();
    console.log('✅ "Add Workspace" seçeneği dropdown menüde görünür.');

    // Menüyü kapat
    await page.keyboard.press('Escape');
  });

  // ════════════════════════════════════════════════════════════════
  // TEST 2: Settings > General Sekmesi Doğrulaması
  // ════════════════════════════════════════════════════════════════
  test('Kısım 2: Settings > General Sekmesi Doğrulaması', async ({ page }) => {
    console.log('🔘 [UI TEST] Settings dialog açılıyor (General sekmesi)...');
    const dialog = await openSettingsDialog(page);

    // 1. Sol paneldeki sekme butonlarını doğrula
    const generalTab = dialog.getByRole('button', { name: 'General' }).first();
    const membersTab = dialog.getByRole('button', { name: 'Members' }).first();
    const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
    await expect(generalTab).toBeVisible();
    await expect(membersTab).toBeVisible();
    await expect(reposTab).toBeVisible();
    console.log('✅ Sidebar sekme butonları (General, Members, Repositories) doğrulandı.');

    // 2. Workspace başlık kartını doğrula (ad + "Default" badge)
    const wsTitle = dialog.getByText(/Gitsec's Default Workspace/i).first();
    await expect(wsTitle).toBeVisible();
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
    console.log('✅ Workspace Description alanı doğrulandı.');

    // 5. "Accent Color" bölümü
    const accentColorLabel = dialog.getByText('Accent Color', { exact: true });
    await expect(accentColorLabel).toBeVisible();
    console.log('✅ Accent Color bölümü doğrulandı.');

    // 6. "Save Changes" butonunun varlığı ve etkin durumu
    const saveBtn = dialog.getByRole('button', { name: /Save Changes/i });
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
    console.log('✅ Save Changes butonu görünür ve etkin.');

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
  test('Kısım 3: Settings > Members Sekmesi ve Davet Formu Doğrulaması', async ({ page }) => {
    console.log('🔘 [UI TEST] Settings > Members sekmesi açılıyor...');
    const dialog = await openSettingsDialog(page);

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
    const memberCard = dialog.getByText(/gitsectest/i).first();
    await expect(memberCard).toBeVisible();
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
  test('Kısım 4: Settings > Repositories Sekmesi Doğrulaması', async ({ page }) => {
    console.log('🔘 [UI TEST] Settings > Repositories sekmesi açılıyor...');
    const dialog = await openSettingsDialog(page);

    // Repositories sekmesine geçiş
    const reposTab = dialog.getByRole('button', { name: 'Repositories' }).first();
    await reposTab.click();
    await page.waitForTimeout(2000);

    // 1. "Repositories" başlığını doğrula
    const reposHeading = dialog.getByText('Repositories').first();
    await expect(reposHeading).toBeVisible();
    console.log('✅ Repositories başlığı doğrulandı.');

    // 2. Repository seçici dropdown (Select a repository)
    const repoSelect = dialog.getByRole('button', { name: /Select a repository/i })
      .or(dialog.locator('button').filter({ hasText: /Select a repository/i }))
      .first();
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
  test('Kısım 5: Add Workspace Wizard (Step 1 — Details) Arayüz Doğrulaması', async ({ page }) => {
    console.log('🔘 [UI TEST] Workspace dropdown -> Add Workspace tıklanıyor...');
    await openWorkspaceDropdown(page);

    const addWsOption = page.getByText('Add Workspace', { exact: true }).first();
    await expect(addWsOption).toBeVisible();
    await addWsOption.click();
    await page.waitForTimeout(3000);

    // 1. Wizard ana başlığı ("Create a New Workspace")
    const wizardTitle = page.getByText(/Create a New Workspace/i).first();
    await expect(wizardTitle).toBeVisible({ timeout: 15000 });
    console.log('✅ Wizard başlığı "Create a New Workspace" doğrulandı.');

    // 2. Adım göstergesi (Step 1 / 3)
    const stepIndicator = page.getByText(/Step 1/i).first()
      .or(page.getByText(/1 \/ 3/i).first());
    await expect(stepIndicator).toBeVisible();
    console.log('✅ Adım göstergesi (Step 1) doğrulandı.');

    // 3. 3 adım başlıkları (Details, Members, Repositories)
    const detailsStep = page.getByText('Details', { exact: true }).first();
    const membersStep = page.getByText('Members', { exact: true }).first();
    const reposStep = page.getByText('Repositories', { exact: true }).first();
    await expect(detailsStep).toBeVisible();
    await expect(membersStep).toBeVisible();
    await expect(reposStep).toBeVisible();
    console.log('✅ Adım başlıkları (Details, Members, Repositories) doğrulandı.');

    // 4. "Workspace Name *" zorunlu input alanı
    const wsNameLabel = page.getByText(/Workspace Name/i).first();
    await expect(wsNameLabel).toBeVisible();

    const wsNameInput = page.locator('input').filter({ hasText: '' })
      .or(page.getByPlaceholder(/Production Team/i))
      .first();
    await expect(wsNameInput).toBeVisible();
    await expect(wsNameInput).toBeEditable();
    console.log('✅ Workspace Name input (zorunlu) doğrulandı.');

    // 5. "Description (Optional)" textarea
    const descLabel = page.getByText(/Description/i).first();
    await expect(descLabel).toBeVisible();

    const descTextarea = page.getByPlaceholder(/Write a short description/i)
      .or(page.locator('textarea').first());
    await expect(descTextarea).toBeVisible();
    await expect(descTextarea).toBeEditable();
    console.log('✅ Description textarea (opsiyonel) doğrulandı.');

    // 6. "Accent Color" bölümü
    const accentColor = page.getByText('Accent Color', { exact: true });
    await expect(accentColor).toBeVisible();
    console.log('✅ Accent Color bölümü doğrulandı.');

    // 7. "Advanced options" genişletilebilir bölüm
    const advancedOptions = page.getByText(/Advanced options/i).first();
    await expect(advancedOptions).toBeVisible();
    console.log('✅ "Advanced options" genişletilebilir bölüm doğrulandı.');

    // Wizard'ı kapatmadan geri dön (sidebar'daki Dashboard'a tıkla)
    const dashboardLink = page.getByRole('link', { name: /Dashboard/i }).first();
    if (await dashboardLink.isVisible().catch(() => false)) {
      await dashboardLink.click();
    } else {
      await page.goBack();
    }
    console.log('✅ Wizard sayfasından geri dönüldü.');
  });
});
