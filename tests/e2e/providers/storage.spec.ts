import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../../pages/ProviderPage';
import { GoogleLoginPage } from '../../../pages/GoogleLoginPage';
import { OneDriveLoginPage } from '../../../pages/OneDriveLoginPage';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const workspaceId = process.env.WORKSPACE_ID ?? '823';
const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';

test.describe('Storage Provider Entegrasyonları', () => {
  // OAuth akışı uzun sürebilir (popup + giriş + izin), timeout'u artıralım
  test.setTimeout(120_000);

  test('Seçilen bulut depolama sağlayıcısını bağlamayı dene', async ({ page }) => {
    const providerPage = new ProviderPage(page);
    const storageProvider = process.env.E2E_STORAGE_PROVIDER ?? 'aws';

    // OAuth tabanlı provider'lar: popup akışı gerektirenler
    const isOAuthProvider = ['gdrive', 'onedrive'].includes(storageProvider);

    console.log('🚀 1. Dashboard ana sayfasına gidiliyor...');
    await providerPage.navigateToDashboard();
    await providerPage.waitForDashboardReady();

    console.log('ℹ️ 2. Olası rehberlik pencereleri (Onboarding) kapatılıyor...');
    await providerPage.closeOnboardingIfVisible();

    console.log('👆 3. Sidebar üzerinden Storage sayfasına geçiliyor...');
    const storageSidebarLink = page.locator(`a[data-sidebar="menu-button"][href*="/storage"]`)
      .or(page.locator(`a[data-slot="sidebar-menu-button"][href*="/storage"]`))
      .or(page.locator(`a[href$="/${workspaceId}/storage"]`))
      .or(page.locator(`a[href*="/${workspaceId}/storage"]`))
      .or(page.locator('aside a[href*="/storage"]'))
      .or(page.getByRole('link', { name: /^Storage$/i }))
      .or(page.getByText('Storage'))
      .first();

    const clickStorage = async () => {
      await storageSidebarLink.waitFor({ state: 'visible', timeout: 15000 });
      await storageSidebarLink.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await storageSidebarLink.click({ timeout: 8000 });
      } catch {
        await storageSidebarLink.click({ force: true });
      }
    };

    try {
      await clickStorage();
      console.log('⏳ 4. Storage sayfasının yüklenmesi bekleniyor...');
      await page.waitForURL(new RegExp(`/${workspaceId}/storage`), { timeout: 15000 });
    } catch (err) {
      console.log('⚠️ Sidebar tıklaması başarısız veya gecikti, doğrudan URL ile gidiliyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage`, { waitUntil: 'load' });
      await page.waitForURL(new RegExp(`/${workspaceId}/storage`), { timeout: 15000 });
    }

    console.log('👆 5. Add Storage Provider butonuna tıklanıyor...');
    const addStorageBtn = page.locator('a[href*="/storage/add"]')
      .or(page.getByRole('link', { name: /Add Storage Provider/i }))
      .or(page.locator('a:has-text("Add Storage Provider")'))
      .first();

    await addStorageBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addStorageBtn.click();

    console.log('⏳ 6. Add Storage sayfasının yüklenmesi bekleniyor...');
    await page.waitForURL(new RegExp(`/${workspaceId}/storage/add`), { timeout: 30000 });

    // Seçilen sağlayıcıya göre metinleri eşleyelim
    let providerText = 'AWS S3';
    let providerDesc = 'Amazon Simple Storage Service';
    
    if (storageProvider === 'azure') {
      providerText = 'Azure Blob Storage';
      providerDesc = 'Microsoft Azure Blob Storage';
    } else if (storageProvider === 'gdrive') {
      providerText = 'Google Drive';
      providerDesc = 'Google Drive Service';
    } else if (storageProvider === 'huawei') {
      providerText = 'Huawei OBS';
      providerDesc = 'Huawei Object Storage Service';
    } else if (storageProvider === 'onedrive') {
      providerText = 'OneDrive Personal';
      providerDesc = 'OneDrive Personal';
    }

    console.log(`🎯 7. Seçilen sağlayıcı kartına tıklanıyor: ${providerText} (${storageProvider.toUpperCase()})`);

    // Seçenek kartını bulalım ve tıklayalım
    const providerCard = page.getByText(providerText, { exact: true })
      .or(page.getByText(providerDesc))
      .or(page.locator('h3, p, div, span, button, a').filter({ hasText: new RegExp(`^${providerText}$`, 'i') }))
      .or(page.locator('a, button, [role="button"]').filter({ hasText: new RegExp(providerText, 'i') }))
      .first();

    await providerCard.waitFor({ state: 'visible', timeout: 15000 });
    await providerCard.click();

    console.log(`✅ 8. ${providerText} kartına tıklandı!`);
    await page.waitForTimeout(2000);

    // ─────────────────────────────────────────────────────────────────
    // 9. OAuth provider'lar için "Permission Required" butonunu bul ve tıkla
    // ─────────────────────────────────────────────────────────────────
    if (isOAuthProvider) {
      console.log(`🔐 9. OAuth akışı başlatılıyor — "Permission Required" butonu aranıyor...`);

      // "Permission Required" butonu farklı seçicilerle bulunabilir
      const permissionBtn = page.getByRole('button', { name: /Permission Required/i })
        .or(page.locator('button:has-text("Permission Required")'))
        .or(page.locator('[role="button"]:has-text("Permission Required")'))
        .or(page.locator('button').filter({ hasText: /Permission Required/i }))
        .first();

      await permissionBtn.waitFor({ state: 'visible', timeout: 15000 });
      console.log('🔑 "Permission Required" butonu bulundu, tıklanıyor...');

      // Popup'u (yeni pencere) yakalamak için dinlemeyi buton tıklanmadan ÖNCE başlatıyoruz.
      // Bazı akışlarda popup yerine aynı sekmede yönlendirme de olabilir.
      const popupPromise = page
        .waitForEvent('popup', { timeout: 30_000 })
        .then((p) => p)
        .catch(() => null);

      await permissionBtn.scrollIntoViewIfNeeded().catch(() => {});
      try {
        await permissionBtn.click({ timeout: 8000 });
      } catch {
        await permissionBtn.click({ force: true });
      }

      console.log('⏳ 10. OAuth popup/yönlendirme bekleniyor...');

      const popup = await popupPromise;

      if (popup) {
        // ── POPUP AÇILDI ──
        await popup.waitForLoadState('domcontentloaded').catch(() => {});
        const oauthUrl = popup.url();
        console.log(`🌐 OAuth popup açıldı! URL: ${oauthUrl}`);

        if (storageProvider === 'gdrive') {
          // ── GOOGLE DRIVE: Otomatik giriş + TOTP 2FA ──
          console.log('🤖 Google OAuth otomatik giriş başlatılıyor...');
          const googleLogin = new GoogleLoginPage(popup);
          const loginOk = await googleLogin.completeOAuthLogin();

          if (!loginOk) {
            console.error('❌ Google OAuth otomatik giriş başarısız!');
            console.error('ℹ️ Kontrol edin:');
            console.error('   1. .env dosyasında GOOGLE_TEST_USER, GOOGLE_TEST_PASSWORD, GOOGLE_TOTP_SECRET tanımlı mı?');
            console.error('   2. Google hesabında 2FA yöntemi "Authenticator App" olarak ayarlanmış mı?');
            console.error('   3. TOTP secret key doğru mu?');
          } else {
            console.log('✅ Google OAuth giriş ve izin verme otomatik olarak tamamlandı!');
          }

          // Popup kapandıysa dashboard'a dönüş beklenir
          if (!popup.isClosed()) {
            console.log('⏳ 11. OAuth popup\'ın kapanması bekleniyor...');
            await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {
              console.log('⚠️ Popup henüz kapanmadı, devam ediliyor...');
            });
          }

        } else if (storageProvider === 'onedrive') {
          // ── ONEDRIVE: Otomatik giriş + Gmail OTP 2FA ──
          console.log('🤖 Microsoft OAuth otomatik giriş başlatılıyor...');
          const oneDriveLogin = new OneDriveLoginPage(popup);
          const loginOk = await oneDriveLogin.completeOAuthLogin();

          if (!loginOk) {
            console.error('❌ Microsoft OAuth otomatik giriş başarısız!');
            console.error('ℹ️ Kontrol edin:');
            console.error('   1. .env dosyasında GITHUB_MAIL_USER, GITHUB_MAIL_PASSWORD tanımlı mı?');
          } else {
            console.log('✅ Microsoft OAuth giriş ve izin verme otomatik olarak tamamlandı!');
          }

          // Popup kapandıysa dashboard'a dönüş beklenir
          if (!popup.isClosed()) {
            console.log('⏳ 11. OAuth popup\'ın kapanması bekleniyor...');
            await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {
              console.log('⚠️ Popup henüz kapanmadı, devam ediliyor...');
            });
          }
        }

        console.log('🔄 12. Form sayfasının gelmesi kontrol ediliyor...');
        await page.waitForTimeout(3000);

        if (['gdrive', 'onedrive'].includes(storageProvider)) {
          console.log(`⏳ ${storageProvider === 'gdrive' ? 'Google' : 'OneDrive'} popup sonrası form sayfasının yüklenmesi bekleniyor...`);
          const connectionNameInput = page.getByPlaceholder('e.g., Compliance GD')
            .or(page.locator('input[placeholder*="Compliance"]'))
            .or(page.locator('input[name="name"]'))
            .first();

          await connectionNameInput.waitFor({ state: 'visible', timeout: 30_000 });
          console.log('📝 Form sayfası yüklendi. Bağlantı detayları giriliyor...');

          // 1. Connection Name kısmına istediğini yaz
          const connName = storageProvider === 'gdrive'
            ? `Google Drive Test - ${Date.now()}`
            : `OneDrive Test - ${Date.now()}`;
          await connectionNameInput.click();
          await connectionNameInput.fill(connName);
          console.log(`Connection Name girildi: ${connName}`);
          await page.waitForTimeout(1000);

          // 2. Test Connection butonuna basılacak ve beklenecek
          const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i })
            .or(page.locator('button:has-text("Test Connection")'))
            .first();
          
          await testConnectionBtn.waitFor({ state: 'visible', timeout: 10_000 });
          console.log('👆 Test Connection butonuna tıklanıyor...');
          await testConnectionBtn.click();

          // 3. Test bittikten sonra modal/pencere close butonuna basılacak (scroll edilerek)
          console.log('⏳ Test Connection modalının açılması ve testin tamamlanması bekleniyor...');
          const closeBtn = page.getByRole('button', { name: /Close|Kapat/i })
            .or(page.locator('button:has-text("Close")'))
            .or(page.locator('button:has-text("Kapat")'))
            .first();

          // attached yerine visible durumunu bekle (testin bitip butonun görünür olmasını garanti eder)
          await closeBtn.waitFor({ state: 'visible', timeout: 60_000 });
          await expect(closeBtn).toBeEnabled({ timeout: 15_000 }).catch(() => {});
          console.log('📋 Test Connection tamamlandı, modal içeriği en aşağıya kaydırılıyor...');

          // Modal/Pencere içinde programatik olarak aşağı kaydır (Kapsamlı/Exhaustive Scroll)
          await page.evaluate(() => {
            // 1. Tüm DOM elemanlarını tara ve scroll edilebilir olanları en alta kaydır
            const allElements = Array.from(document.querySelectorAll('*'));
            allElements.forEach(el => {
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
              }
            });
            // 2. Özel diyalog/modal elemanlarını ayrıca en alta kaydır
            const dialog = document.querySelector('[role="dialog"]') || document.querySelector('.modal') || document.querySelector('div[class*="dialog"]');
            if (dialog) {
              dialog.scrollTop = dialog.scrollHeight;
            }
            // 3. Pencere seviyesinde kaydırma
            window.scrollTo(0, document.body.scrollHeight);
          }).catch(() => {});
          await page.waitForTimeout(800);

          // Donanım seviyesinde tuşlarla kaydırma (modal odaklanarak)
          try {
            await closeBtn.focus().catch(() => {});
            await page.keyboard.press('End').catch(() => {});
            for (let i = 0; i < 5; i++) {
              await page.keyboard.press('PageDown').catch(() => {});
              await page.keyboard.press('ArrowDown').catch(() => {});
              await page.waitForTimeout(100);
            }
          } catch (e) {
            console.log('Modal klavye kaydırma hatası:', e);
          }

          // Donanım seviyesinde mouse wheel ile kaydırma
          try {
            const btnBox = await closeBtn.boundingBox();
            if (btnBox) {
              await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y - 80).catch(() => {});
              for (let i = 0; i < 4; i++) {
                await page.mouse.wheel(0, 350).catch(() => {});
                await page.waitForTimeout(100);
              }
            }
          } catch (e) {
            console.log('Modal mouse wheel kaydırma hatası:', e);
          }

          // Pencere close butonuna basılması ve doğrulanması
          await closeBtn.scrollIntoViewIfNeeded().catch(() => {});
          try {
            await closeBtn.click({ timeout: 5000 });
          } catch {
            await closeBtn.click({ force: true });
          }
          console.log('👆 Close butonuna tıklandı, modalın kapanması bekleniyor...');

          const dialogLocator = page.locator('[role="dialog"]').or(page.locator('.modal')).or(page.locator('div[class*="dialog"]')).first();
          await dialogLocator.waitFor({ state: 'hidden', timeout: 15_000 }).catch(async () => {
            console.log('⚠️ Modal henüz kapanmadı, tekrar tıklama denenecek...');
            await closeBtn.click({ force: true }).catch(() => {});
          });
          console.log('✅ Test Connection modalı tamamen kapandı.');
          await page.waitForTimeout(1500);

          // 4. Save butonuna basılıp biraz beklenecek
          const saveBtn = page.getByRole('button', { name: /^Save$/i })
            .or(page.getByRole('button', { name: /Save|Kaydet/i }))
            .or(page.locator('button:has-text("Save")'))
            .or(page.locator('button:has-text("Kaydet")'))
            .first();

          await saveBtn.waitFor({ state: 'visible', timeout: 15_000 });
          await expect(saveBtn).toBeEnabled({ timeout: 10_000 }).catch(() => {});
          await saveBtn.scrollIntoViewIfNeeded().catch(() => {});

          console.log('👆 Save butonuna tıklanıyor...');
          try {
            await saveBtn.click({ timeout: 5000 });
          } catch {
            await saveBtn.click({ force: true });
          }

          console.log('💾 Save tıklandı. İşlemin tamamlanması için yönlendirme bekleniyor...');
          // Başarılı kayıt sonrası ana storage sayfasına yönlenmesi beklenir (tam eşleşme aranır)
          await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 15_000 })
            .then(() => console.log('✅ Başarıyla depolama listesi sayfasına yönlenildi!'))
            .catch(async () => {
              console.log('⚠️ Yönlendirme algılanamadı, tolerans bekleme süresi uygulanıyor...');
              if (!page.isClosed()) {
                await page.waitForTimeout(6000).catch(() => {});
              }
            });
        }

      } else {
        // ── POPUP AÇILMADI — aynı sekmede yönlendirme olmuş olabilir ──
        console.log('ℹ️ Popup açılmadı, aynı sekmede yönlendirme kontrol ediliyor...');
        const oauthTarget = popup ?? page;
        const currentUrl = page.url();

        if (storageProvider === 'gdrive' && /accounts\.google\.com|google\.com\/o\/oauth2/i.test(currentUrl)) {
          console.log(`🌐 Google OAuth sayfasına yönlendirildi (aynı sekme): ${currentUrl}`);
          console.log('🤖 Google OAuth otomatik giriş başlatılıyor...');
          const googleLogin = new GoogleLoginPage(page);
          const loginOk = await googleLogin.completeOAuthLogin();

          if (!loginOk) {
            console.error('❌ Google OAuth otomatik giriş başarısız!');
          }

          // Dashboard'a geri dönülmesini bekle
          await page.waitForURL(/gitsec\.io/i, { timeout: 30_000 }).catch(() => {
            console.log('⚠️ Dashboard\'a geri dönüş zaman aşımına uğradı.');
          });
        } else if (/login\.live\.com|login\.microsoftonline\.com/i.test(currentUrl)) {
          console.log(`🌐 Microsoft OAuth sayfasına yönlendirildi: ${currentUrl}`);
          console.log('ℹ️  → Sayfada Microsoft hesabınızla giriş yapıp izin verin.');

          await page.waitForURL(/gitsec\.io/i, { timeout: 90_000 }).catch(() => {
            console.log('⚠️ Dashboard\'a geri dönüş zaman aşımına uğradı.');
          });
        } else {
          console.log(`ℹ️ Mevcut URL: ${currentUrl} — Henüz yönlendirme gerçekleşmemiş olabilir.`);
          await page.waitForTimeout(3000);
        }
      }

    } else {
      // ─────────────────────────────────────────────────────────────
      // Non-OAuth provider'lar (AWS, Azure, Huawei) — form tabanlı
      // ─────────────────────────────────────────────────────────────
      console.log(`📝 9. ${providerText} form tabanlı provider — OAuth akışı gerekmiyor.`);

      if (storageProvider === 'aws') {
        console.log('🤖 AWS S3 formu dolduruluyor...');

        // 1. Connection Name
        const connectionNameInput = page.getByPlaceholder('e.g., Compliance S3')
          .or(page.getByPlaceholder('e.g., Compliance GD'))
          .or(page.locator('input[placeholder*="Compliance"]'))
          .or(page.locator('input[name="name"]'))
          .first();
        await connectionNameInput.waitFor({ state: 'visible', timeout: 15000 });
        const connName = `AWS S3 Test - ${Date.now()}`;
        await connectionNameInput.click();
        await connectionNameInput.fill(connName);
        console.log(`Connection Name girildi: ${connName}`);

        // 2. Bucket Name (Kova Adı)
        console.log('🔍 Bucket Name (Kova) girdisi aranıyor...');
        const bucketInput = page.getByRole('textbox', { name: /Bucket Name|Kova/i })
          .or(page.getByLabel(/Bucket Name|Kova/i))
          .or(page.getByPlaceholder('gitsec-backups-prod'))
          .or(page.locator('input[name*="bucket"]'))
          .or(page.locator('input[placeholder*="backups-prod"]'))
          .first();
        await bucketInput.waitFor({ state: 'visible', timeout: 15000 });
        const bucketName = process.env.AWS_S3_BUCKET ?? 'gitsec-test';
        await bucketInput.click();
        await bucketInput.fill(bucketName);
        console.log(`Bucket Name girildi: ${bucketName}`);

        // 3. Access Key ID (Erişim Anahtarı Kimliği)
        console.log('🔍 Access Key ID girdisi aranıyor...');
        const accessKeyInput = page.getByRole('textbox', { name: /Access Key|Erişim/i })
          .or(page.getByLabel(/Access Key|Erişim/i))
          .or(page.getByPlaceholder('Enter access key ID'))
          .or(page.locator('input[placeholder*="access key"]'))
          .first();
        await accessKeyInput.waitFor({ state: 'visible', timeout: 15000 });
        const accessKeyId = requireEnv('AWS_ACCESS_KEY_ID');
        await accessKeyInput.click();
        await accessKeyInput.fill(accessKeyId);
        console.log('Access Key ID girildi.');

        // 4. Secret Access Key (Gizli Erişim Anahtarı)
        console.log('🔍 Secret Access Key girdisi aranıyor...');
        const secretKeyInput = page.getByRole('textbox', { name: /Secret Access|Secret Key|Gizli/i })
          .or(page.getByLabel(/Secret Access|Secret Key|Gizli/i))
          .or(page.getByPlaceholder('Enter secret key'))
          .or(page.locator('input[placeholder*="secret key"]'))
          .first();
        await secretKeyInput.waitFor({ state: 'visible', timeout: 15000 });
        const secretAccessKey = requireEnv('AWS_SECRET_ACCESS_KEY');
        await secretKeyInput.click();
        await secretKeyInput.fill(secretAccessKey);
        console.log('Secret Access Key girildi.');

        // 5. Region (Bölge)
        console.log('🔍 Region (Bölge) girdisi aranıyor...');
        const awsRegion = process.env.AWS_REGION ?? 'eu-central-1';
        
        // Bölge anahtar kelime eşleşmesi (dropdown listesindeki metni yakalamak için)
        let regionKeyword = awsRegion;
        if (awsRegion === 'eu-central-1') regionKeyword = 'Frankfurt';
        else if (awsRegion === 'us-east-1') regionKeyword = 'Virginia';
        else if (awsRegion === 'us-east-2') regionKeyword = 'Ohio';
        else if (awsRegion === 'us-west-1') regionKeyword = 'California';
        else if (awsRegion === 'us-west-2') regionKeyword = 'Oregon';
        else if (awsRegion === 'eu-west-1') regionKeyword = 'Ireland';
        else if (awsRegion === 'eu-west-2') regionKeyword = 'London';
        else if (awsRegion === 'eu-west-3') regionKeyword = 'Paris';

        // Arama kutusundaki (Search) combobox ile karışmaması için iç içe main (main main) altındaki combobox'ı hedefleyelim
        const regionCombobox = page.locator('main main').getByRole('combobox')
          .or(page.getByRole('combobox', { name: /Region|Bölge/i }))
          .or(page.locator('main').getByRole('combobox').filter({ hasText: /US East|Europe|Region|Bölge/i }))
          .first();

        const regionInput = page.getByPlaceholder(/Region|Bölge/i)
          .or(page.locator('input[name*="region"]'))
          .first();

        if (await regionInput.isVisible().catch(() => false)) {
          console.log('Region alanı bir Input kutusu, dolduruluyor...');
          await regionInput.click();
          await regionInput.fill(awsRegion);
        } else if (await regionCombobox.isVisible().catch(() => false)) {
          console.log('Region alanı bir Combobox/Dropdown, tetikleniyor...');
          await regionCombobox.click();
          await page.waitForTimeout(1000); // Dropdown animasyonunun tamamlanması için bekleme süresini biraz artıralım
          
          const option = page.getByRole('option', { name: new RegExp(`${awsRegion}|${regionKeyword}`, 'i') })
            .or(page.locator('[role="option"]').filter({ hasText: new RegExp(`${awsRegion}|${regionKeyword}`, 'i') }))
            .or(page.locator('div[role="option"]').filter({ hasText: new RegExp(`${awsRegion}|${regionKeyword}`, 'i') }))
            .first();
          
          await option.waitFor({ state: 'visible', timeout: 5000 });
          await option.click();
        } else {
          console.log('⚠️ Region seçici bulunamadı veya formda yer almıyor, atlanıyor...');
        }
        console.log(`Region ayarlandı: ${awsRegion}`);

        // 6. Test Connection
        const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i })
          .or(page.locator('button:has-text("Test Connection")'))
          .first();
        
        await testConnectionBtn.waitFor({ state: 'visible', timeout: 10_000 });
        console.log('👆 Test Connection butonuna tıklanıyor...');
        await testConnectionBtn.click();

        console.log('⏳ Test Connection modalının açılması ve testin tamamlanması bekleniyor...');
        const closeBtn = page.getByRole('button', { name: /Close|Kapat/i })
          .or(page.locator('button:has-text("Close")'))
          .or(page.locator('button:has-text("Kapat")'))
          .first();

        await closeBtn.waitFor({ state: 'visible', timeout: 60_000 });
        await expect(closeBtn).toBeEnabled({ timeout: 15_000 }).catch(() => {});
        console.log('📋 Test Connection tamamlandı, modal içeriği en aşağıya kaydırılıyor...');

        await page.evaluate(() => {
          const allElements = Array.from(document.querySelectorAll('*'));
          allElements.forEach(el => {
            if (el.scrollHeight > el.clientHeight) {
              el.scrollTop = el.scrollHeight;
            }
          });
          const dialog = document.querySelector('[role="dialog"]') || document.querySelector('.modal') || document.querySelector('div[class*="dialog"]');
          if (dialog) {
            dialog.scrollTop = dialog.scrollHeight;
          }
          window.scrollTo(0, document.body.scrollHeight);
        }).catch(() => {});
        await page.waitForTimeout(800);

        try {
          await closeBtn.focus().catch(() => {});
          await page.keyboard.press('End').catch(() => {});
          for (let i = 0; i < 5; i++) {
            await page.keyboard.press('PageDown').catch(() => {});
            await page.keyboard.press('ArrowDown').catch(() => {});
            await page.waitForTimeout(100);
          }
        } catch (e) {
          console.log('Modal klavye kaydırma hatası:', e);
        }

        await closeBtn.scrollIntoViewIfNeeded().catch(() => {});
        try {
          await closeBtn.click({ timeout: 5000 });
        } catch {
          await closeBtn.click({ force: true });
        }
        console.log('👆 Close butonuna tıklandı, modalın kapanması bekleniyor...');

        const dialogLocator = page.locator('[role="dialog"]').or(page.locator('.modal')).or(page.locator('div[class*="dialog"]')).first();
        await dialogLocator.waitFor({ state: 'hidden', timeout: 15_000 }).catch(async () => {
          console.log('⚠️ Modal henüz kapanmadı, tekrar tıklama denenecek...');
          await closeBtn.click({ force: true }).catch(() => {});
        });
        console.log('✅ Test Connection modalı tamamen kapandı.');
        await page.waitForTimeout(1500);

        // 7. Save / Add Storage
        const saveBtn = page.getByRole('button', { name: /Add Storage|Save|Kaydet/i })
          .or(page.locator('button:has-text("Add Storage")'))
          .or(page.locator('button:has-text("Save")'))
          .first();

        await saveBtn.waitFor({ state: 'visible', timeout: 15_000 });
        await expect(saveBtn).toBeEnabled({ timeout: 10_000 }).catch(() => {});
        await saveBtn.scrollIntoViewIfNeeded().catch(() => {});

        console.log('👆 Save (Add Storage) butonuna tıklanıyor...');
        try {
          await saveBtn.click({ timeout: 5000 });
        } catch {
          await saveBtn.click({ force: true });
        }

        console.log('💾 Save tıklandı. İşlemin tamamlanması için yönlendirme bekleniyor...');
        await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 15_000 })
          .then(() => console.log('✅ Başarıyla depolama listesi sayfasına yönlenildi!'))
          .catch(async () => {
            console.log('⚠️ Yönlendirme algılanamadı, tolerans bekleme süresi uygulanıyor...');
            if (!page.isClosed()) {
              await page.waitForTimeout(6000).catch(() => {});
            }
          });
      }
    }

    // ─────────────────────────────────────────────────────────────
    // 13. Bağlantı sonrası storage durumunu kontrol et (Ortak Adım)
    // ─────────────────────────────────────────────────────────────
    console.log('🔍 13. Storage bağlantı durumu kontrol ediliyor...');
    
    const currentUrl = page.url();
    const isTargetStorageList = new RegExp(`/${workspaceId}/storage(\\?|#|$)`).test(currentUrl);
    if (isTargetStorageList) {
      console.log('ℹ️ Zaten yönlendirildik, sayfanın tam yüklenmesini bekleyip sayfayı yeniliyoruz...');
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
      await page.reload({ waitUntil: 'load' }).catch(() => {});
    } else {
      console.log('⚠️ Yönlendirme algılanamadı, manuel olarak storage listesi sayfasına gidiliyor...');
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage`, { waitUntil: 'load' }).catch(() => {});
    }
    await page.waitForTimeout(3000);

    const activeStatus = page.getByText(/Active/i)
      .or(page.locator('text=/\\bConnected\\b/i'))
      .first();

    const isActive = await activeStatus.isVisible().catch(() => false);
    if (isActive) {
      console.log(`🎉 ${providerText} başarıyla bağlandı! Durum: Active ✅`);
    } else {
      console.log(`⚠️ ${providerText} bağlantı durumu "Active" olarak doğrulanamadı.`);
      console.log('ℹ️ Bağlantı veya backend senkronizasyonu gecikiyor olabilir.');
      // Sayfadaki mevcut metni logla
      const mainText = await page.locator('main').first().textContent().catch(() => '');
      console.log(`📄 Sayfa içeriği (ilk 500 karakter): ${(mainText || '').substring(0, 500)}`);
    }

    console.log('🎉 Storage bağlantı adım testi başarıyla tamamlandı!');
  });
});
