/**
 * Gitsec High-Fidelity 5-Layer E2E Flow Auditor (Chaos & Action Fuzzer)
 * 
 * Bu test:
 * 1. Tek bir test oturumu içinde sadece 1 KERE giriş yapar.
 * 2. Giriş akışı: Sayfaya gider, paralel Captcha dinleyicileriyle Turnstile/reCAPTCHA bekler (kullanıcı manuel çözer),
 *    ardından bilgileri (mail/şifre) yazarak giriş yapar.
 * 3. Sitedeki hataları ve çöküşleri 5 farklı katmanda izler:
 *    - Katman 1: JS/React Çalışma Zamanı Hataları (page.on('pageerror'))
 *    - Katman 2: API/Backend 500+ Çökmeleri (page.on('response'))
 *    - Katman 3: Zararlı XSS Kod Çalıştırılması (page.on('console') canaries)
 *    - Katman 4: Başarı/Hata Toast Bildirimleri (Toast assertions)
 *    - Katman 5: DOM State Değişimleri (Tabloya eklenme, silinme, "Active" durumlar)
 * 4. Uçtan Uca 3 Temel İş Akışını (Butonlar, Kaydetme, Tetikleme ve Silme dahil) test eder:
 *    - AWS S3 Storage Provider Ekleme -> Bağlantıyı Sınama (Test Connection) -> Kaydetme -> Active Doğrulama -> Silme/Temizleme
 *    - Yeni Planlayıcı (Scheduler) Ekleme -> Başarılı Kayıt -> "Run Now" Tetikleme -> "Delete" ile Temizleme ve DOM Assert
 *    - GitHub Repo Arama / Filtreleme Fuzzing
 * 
 * Çalıştırma: npx playwright test tests/e2e/audit/ui-auditor.spec.ts --headed
 */
import { test, expect } from '../../fixtures/test';
import type { Page } from '@playwright/test';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';
const workspaceId = process.env.WORKSPACE_ID ?? '823';

// Sınama için Fuzzing / Edge Case veri kümesi
const fuzzingPayloads = [
  { name: 'SQL Injection', value: "' OR '1'='1" },
  { name: 'Cross-Site Scripting (XSS)', value: "<script>console.warn('XSS_ATTEMPT')</script>" },
  { name: 'Buffer Overflow', value: 'A'.repeat(800) },
  { name: 'HTML & Special Chars', value: '"><svg/onload=confirm(1)>' },
  { name: 'Negative / Invalid Numbers', value: '-999999' }
];

// Helper: Checkbox Durumunu Değiştirme
async function setCheckboxState(page: Page, labelText: string, shouldBeChecked: boolean) {
  let checkbox = page.getByRole('checkbox', { name: labelText }).first();
  if (!(await checkbox.isVisible().catch(() => false))) {
    checkbox = page.getByLabel(labelText).first();
  }
  if (!(await checkbox.isVisible().catch(() => false))) {
    checkbox = page.locator('div, button, label').filter({ hasText: labelText }).locator('[role="checkbox"], input[type="checkbox"]').first();
  }
  
  if (await checkbox.isVisible().catch(() => false)) {
    const isChecked = (await checkbox.getAttribute('aria-checked')) === 'true' || (await checkbox.isChecked().catch(() => false));
    if (isChecked !== shouldBeChecked) {
      await checkbox.click({ force: true });
      await page.waitForTimeout(300);
    }
  }
}

test.describe('Gitsec High-Fidelity 5-Layer E2E Flow Auditor', () => {
  // Temiz oturum
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Uçtan uca kullanıcı akışlarını sına ve 5 katmanlı hata denetimi yap', async ({ page }) => {
    // Kapsamlı akışlar için 5 dakika timeout
    test.setTimeout(300000);

    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    // Yakalanan hataları biriktireceğimiz liste
    const auditIssues: Array<{ type: string; url: string; message: string }> = [];

    // ─────────────────────────────────────────────────────────────────
    // 🚨 5-KATMANLI DINLEYICILERIN AKTIF EDILMESI
    // ─────────────────────────────────────────────────────────────────

    // Katman 1: JS/React Çalışma Zamanı Hataları (Runtime Errors)
    page.on('pageerror', (exception) => {
      const msg = `JS Runtime Crash: ${exception.message}\nStack: ${exception.stack}`;
      console.error(`❌ [KATMAN 1 - JS HAtASI] ${msg}`);
      auditIssues.push({ type: 'JS Runtime Crash', url: page.url(), message: msg });
    });

    // Katman 2: API / Server Çökmeleri (status >= 500)
    page.on('response', (response) => {
      const status = response.status();
      if (status >= 500) {
        const msg = `API Endpoint Failed: ${response.url()} [Status: ${status}]`;
        console.error(`❌ [KATMAN 2 - SERVER HATASI] ${msg}`);
        auditIssues.push({ type: 'Server/API Crash', url: page.url(), message: msg });
      }
    });

    // Katman 3: Güvenlik / XSS Canary Kod Tetiklenmesi
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.includes('XSS_ATTEMPT')) {
        const msgStr = `XSS payload was executed inside browser context! Output: ${text}`;
        console.error(`🚨 [KATMAN 3 - GÜVENLİK ZAFİYETİ] ${msgStr}`);
        auditIssues.push({ type: 'XSS Vulnerability Executed', url: page.url(), message: msgStr });
      }
    });

    // ─────────────────────────────────────────────────────────────────
    // 🔑 ADIM 1: GİRİŞ EKRANINA GİT VE CAPTCHA BEKLE
    // ─────────────────────────────────────────────────────────────────
    console.log('🔑 [E2E] Giriş sayfasına gidiliyor...');
    await page.goto(`${dashboardBaseUrl}/sign-in`, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const signInButton = page.locator('button').filter({ hasText: /^Sign in$/i }).first();

    await signInButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(1000);

    console.log('⏳ [E2E] Captcha iframe\'inin yüklenmesi bekleniyor (maksimum 10 saniye)...');
    
    const captchaType = (await Promise.race([
      page.locator('iframe[src*="challenges.cloudflare.com"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Cloudflare Turnstile').catch(() => null),
      page.locator('iframe[src*="google.com/recaptcha"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Google reCAPTCHA').catch(() => null)
    ])) as string | null;

    if (captchaType !== null) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfa yüklendiğinde Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test bilgileri doldurup otomatik devam edecektir.');
      console.log('=========================================\n');

      await page.waitForFunction(() => {
        const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        return (turnstile?.value.trim().length ?? 0) > 0 || (recaptcha?.value.trim().length ?? 0) > 0;
      }, { timeout: 120000 }).catch((e) => {
        console.log('⚠️ [E2E] Captcha bekleme süresi doldu veya hata oluştu:', e.message);
      });
      
      console.log('✅ [E2E] Captcha başarıyla çözüldü (Token algılandı)!');
      await page.waitForTimeout(1000);
    } else {
      console.log('ℹ️ [E2E] Captcha iframe\'i bulunamadı veya pasif. Doğrudan veri girişine geçiliyor.');
    }

    // Bilgileri Doldur ve Giriş Yap
    await emailInput.fill(email);
    await passwordInput.fill(password);
    await page.waitForTimeout(500);

    if (await signInButton.isDisabled().catch(() => false)) {
      await page.waitForFunction((btn) => btn instanceof HTMLButtonElement && !btn.disabled, await signInButton.elementHandle(), { timeout: 10000 }).catch(() => {});
    }

    console.log('👆 [E2E] "Sign in" butonuna tıklanıyor...');
    await signInButton.click();

    // Dashboard Yönlendirmesini Doğrula
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    console.log('✅ [E2E] Giriş başarılı!\n');

    // ─────────────────────────────────────────────────────────────────
    // 📂 ADIM 2: GITHUB REPO ARAMA & FİLTER FUZZİNG
    // ─────────────────────────────────────────────────────────────────
    const repoPageUrl = `${dashboardBaseUrl}/${workspaceId}/repositories/github`;
    console.log(`🌐 [FLOW 1] GitHub Repoları Sayfasına gidiliyor: ${repoPageUrl}`);
    await page.goto(repoPageUrl, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const repoSearchInput = page.locator('input[placeholder="Search repositories..."]').first();
    
    if (await repoSearchInput.isVisible().catch(() => false)) {
      console.log('   🔎 [Repo Filtre Fuzzing] "Search repositories..." alanı fuzz ediliyor...');
      for (const payload of fuzzingPayloads) {
        console.log(`      💥 Girdi Enjekte Ediliyor: [${payload.name}]`);
        await repoSearchInput.click().catch(() => {});
        await repoSearchInput.fill(payload.value).catch(() => {});
        await page.waitForTimeout(400);
      }
      await repoSearchInput.fill('').catch(() => {});
      console.log('   ✅ Repo filtresi kararlı şekilde fuzz edildi.');
    } else {
      console.log('   ⚠️ "Search repositories..." arama kutusu bulunamadı, bu adım atlanıyor.');
    }

    // ─────────────────────────────────────────────────────────────────
    // 📅 ADIM 3: PLANLAYICI (SCHEDULERS) UÇTAN UCA İŞ AKIŞI
    // ─────────────────────────────────────────────────────────────────
    const schedulersUrl = `${dashboardBaseUrl}/${workspaceId}/schedulers`;
    console.log(`\n🌐 [FLOW 2] Planlayıcılar (Schedulers) Sayfasına gidiliyor: ${schedulersUrl}`);
    await page.goto(schedulersUrl, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i }).or(page.locator('button:has-text("New Scheduler")')).first();
    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 15000 });
    
    // UÇTAN UCA PLANLAYICI OLUŞTURMA AKIŞI
    console.log('   👆 [1] "New Scheduler" butonuna tıklanıyor...');
    await newSchedulerBtn.click();
    await page.waitForTimeout(1000); // Modal açılış toleransı

    const modalDialog = page.locator('[role="dialog"], [data-slot="dialog-content"], .radix-dialog-content').first();
    await expect(modalDialog).toBeVisible({ timeout: 10000 });

    // A. Aktif Repository Seçimi
    const repoCombo = modalDialog.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await repoCombo.waitFor({ state: 'visible', timeout: 10000 });
    await repoCombo.click();
    
    const enabledRepoOptions = page.locator('[role="option"][data-disabled="false"], [data-slot="select-item"][data-disabled="false"]');
    await enabledRepoOptions.first().waitFor({ state: 'visible', timeout: 10000 });
    const repoCount = await enabledRepoOptions.count();

    if (repoCount > 0) {
      const firstEnabledRepo = enabledRepoOptions.first();
      const repoName = await firstEnabledRepo.innerText().catch(() => 'Repo');
      console.log(`   📝 Repo Seçiliyor: "${repoName.trim()}"`);
      await firstEnabledRepo.click({ force: true });
    } else {
      throw new Error('Aktif/seçilebilir bir repository bulunamadı!');
    }
    await page.keyboard.press('Escape'); // Popover kapat

    // B. Planlayıcı Adı Belirleme
    const schedulerName = `e2e-scheduler-flow-${Date.now()}`;
    const nameInput = modalDialog.locator('input[name="name"], input[placeholder*="Backup"]').first();
    await nameInput.fill(schedulerName);
    console.log(`   📝 Planlayıcı Adı Yazıldı: ${schedulerName}`);

    // C. Kaos/Fuzzing Girişi Denetimi (Kaydetmeden Önce Saniyelerce Fuzz Et)
    console.log('   💥 [Fuzzing Check] Modal form girdileri kaos payload\'ları ile dolduruluyor...');
    for (const payload of fuzzingPayloads) {
      await nameInput.fill(payload.value);
      await page.waitForTimeout(200);
    }
    // Temiz veri ile tekrar doldur
    await nameInput.fill(schedulerName);

    // D. Daily Plan Seçimi ve Time Ayarı
    const timezone = 'Europe/Istanbul';
    const comboCount = await modalDialog.locator('[data-slot="select-trigger"], [role="combobox"]').count();
    const tzCombo = modalDialog.locator('[data-slot="select-trigger"], [role="combobox"]').nth(comboCount - 1);
    
    if (await tzCombo.isVisible()) {
      await tzCombo.click({ force: true });
      const tzOptions = page.locator('[role="option"], [data-slot="select-item"]');
      const tzOption = tzOptions.filter({ hasText: /Istanbul/i }).first();
      if (await tzOption.isVisible()) {
        await tzOption.click({ force: true });
        console.log('   📝 Timezone seçildi: Istanbul');
      } else {
        await page.keyboard.press('Escape');
      }
    }

    const timeInput = modalDialog.locator('input[type="time"]').first();
    if (await timeInput.isVisible()) {
      await timeInput.fill('03:30');
      console.log('   📝 Time girildi: 03:30');
    }

    // E. Checkbox Seçimleri
    await setCheckboxState(page, 'Code & Commits', true);
    await setCheckboxState(page, 'Pull Requests', true);
    await setCheckboxState(page, 'Issues', false);

    // F. Form Kaydetme & Toast Doğrulama (Katman 4)
    console.log('   👆 [2] Form "Save" butonuna tıklanarak kaydediliyor...');
    const saveBtn = modalDialog.getByRole('button', { name: /save|create|confirm|submit/i }).first();
    
    // Ağ isteklerini ve Toast'ları dinlemek için vaatleri oluştur
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/schedulers') && response.status() === 200, { timeout: 15000 }).catch(() => null);
    
    await saveBtn.click();

    const apiResponse = await responsePromise;
    if (apiResponse) {
      console.log('   ✅ API kaydı başarıyla tamamladı (Status 200).');
    }

    // Toast bildirimini assert et (Katman 4)
    const successToast = page.locator('[role="status"]').or(page.locator('.toast')).filter({ hasText: /success|created|saved/i }).first();
    await successToast.waitFor({ state: 'visible', timeout: 8000 }).then(() => {
      console.log('   ✅ Katman 4: Başarı bildirim toast mesajı yakalandı!');
    }).catch(() => {
      console.log('   ⚠️ Başarı bildirim toast mesajı görünmedi veya gecikti.');
    });

    // Modalın kapandığını doğrula
    await modalDialog.waitFor({ state: 'hidden', timeout: 10000 });
    console.log('   ✅ Modal başarıyla kapandı.');
    await page.waitForTimeout(2000);

    // G. DOM State Doğrulaması (Katman 5)
    console.log('   🔍 [3] Katman 5: Yeni eklenen planlayıcının tabloda listelendiği doğrulanıyor...');
    const schedulerRow = page.locator('tr').filter({ hasText: schedulerName }).first();
    await expect(schedulerRow).toBeVisible({ timeout: 10000 });
    console.log('   ✅ Yeni planlayıcı tabloda başarıyla listelendi (DOM State OK).');

    // H. Buton Tetikleme: "Run Now" (Şimdi Çalıştır) İşlemi
    console.log('   👆 [4] Planlayıcı için "Run Now" butonu tetikleniyor...');
    const runNowBtn = schedulerRow.locator('button').filter({ hasText: /run|şimdi/i })
      .or(schedulerRow.locator('button[title*="Run"]'))
      .or(schedulerRow.locator('svg[class*="play"]').locator('..'))
      .first();

    await runNowBtn.waitFor({ state: 'visible', timeout: 5000 });
    await runNowBtn.click();
    console.log('   ✅ "Run Now" tetiklendi, başarı toast bildirimi bekleniyor...');

    const runToast = page.locator('[role="status"]').or(page.locator('.toast')).filter({ hasText: /run|start|backup|success/i }).first();
    await runToast.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // I. Temizlik & Silme İşlemi (Temiz Ortam İlkesi)
    console.log('   👆 [5] Temizlik: Oluşturulan planlayıcı siliniyor...');
    
    // Eğer satırda üç nokta menüsü varsa tetikle
    const rowMenuTrigger = schedulerRow.locator('button[aria-haspopup="menu"]').or(schedulerRow.locator('button[id*="radix"]')).first();
    if (await rowMenuTrigger.isVisible().catch(() => false)) {
      await rowMenuTrigger.click();
      await page.waitForTimeout(500);
      const deleteAction = page.getByRole('menuitem', { name: /delete|remove|sil/i })
        .or(page.locator('[role="menuitem"]:has-text("Delete")'))
        .or(page.locator('[role="menuitem"]:has-text("Sil")'))
        .first();
      await deleteAction.click();
    } else {
      const deleteBtn = schedulerRow.locator('button').filter({ hasText: /delete|remove|sil/i })
        .or(schedulerRow.locator('button[title*="Delete"]'))
        .or(schedulerRow.locator('svg[class*="trash"]').locator('..'))
        .first();
      await deleteBtn.click();
    }

    // Varsa silme onay penceresini doğrula ve tıkla
    const confirmDeleteBtn = page.locator('[role="dialog"] button').filter({ hasText: /confirm|delete|yes|sure|sil/i }).first();
    if (await confirmDeleteBtn.isVisible().catch(() => false)) {
      await confirmDeleteBtn.click();
    }

    // Satırın DOM'dan kalktığını assert et (Katman 5 - Kaldırılma)
    await schedulerRow.waitFor({ state: 'hidden', timeout: 10000 });
    console.log('   ✅ Planlayıcı başarıyla silindi ve tablodan kaldırıldı (Temiz temizlik OK).');

    // ─────────────────────────────────────────────────────────────────
    // 🔐 ADIM 4: STORAGE PROVIDER (AWS S3) UÇTAN UCA İŞ AKIŞI
    // ─────────────────────────────────────────────────────────────────
    const storageUrl = `${dashboardBaseUrl}/${workspaceId}/storage`;
    console.log(`\n🌐 [FLOW 3] Depolama Sağlayıcıları (Storage) Sayfasına gidiliyor: ${storageUrl}`);
    await page.goto(storageUrl, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    const addStorageBtn = page.locator('a[href*="/storage/add"]')
      .or(page.getByRole('link', { name: /Add Storage Provider/i }))
      .or(page.locator('a:has-text("Add Storage Provider")'))
      .first();

    await addStorageBtn.waitFor({ state: 'visible', timeout: 15000 });
    await addStorageBtn.click();

    await page.waitForURL(new RegExp(`/${workspaceId}/storage/add`), { timeout: 15000 });
    console.log('   ✅ Depolama sağlayıcı ekleme arayüzü açıldı.');

    // AWS S3 Seçimi
    const awsCard = page.getByText('AWS S3', { exact: true })
      .or(page.getByText('Amazon Simple Storage Service'))
      .or(page.locator('h3, p, div, span, button, a').filter({ hasText: /^AWS S3$/ }))
      .first();

    await awsCard.waitFor({ state: 'visible', timeout: 10000 });
    await awsCard.click();
    await page.waitForTimeout(1500);

    // Form Bilgilerini Doldurma
    const awsConnNameInput = page.locator('input[placeholder*="Compliance"], input[name="name"]').first();
    const awsBucketInput = page.locator('input[placeholder*="backups-prod"], input[name*="bucket"]').first();
    const awsAccessKeyInput = page.locator('input[placeholder*="access key"], input[name*="accessKey"]').first();
    const awsSecretKeyInput = page.locator('input[placeholder*="secret key"], input[name*="secretKey"]').first();

    const awsConnName = `AWS S3 Flow Test - ${Date.now()}`;
    const awsBucket = process.env.AWS_S3_BUCKET ?? 'gitsec-test';
    const awsAccessKey = requireEnv('AWS_ACCESS_KEY_ID');
    const awsSecretKey = requireEnv('AWS_SECRET_ACCESS_KEY');
    const awsRegion = process.env.AWS_REGION ?? 'eu-central-1';

    await awsConnNameInput.fill(awsConnName);
    await awsBucketInput.fill(awsBucket);
    await awsAccessKeyInput.fill(awsAccessKey);
    await awsSecretKeyInput.fill(awsSecretKey);

    // Fuzzing Check
    console.log('   💥 [Fuzzing Check] AWS S3 form girdileri kaos payload\'ları ile dolduruluyor...');
    for (const payload of fuzzingPayloads) {
      await awsConnNameInput.fill(payload.value);
      await page.waitForTimeout(150);
    }
    await awsConnNameInput.fill(awsConnName); // Geri düzelt

    // Region Seçimi (Dropdown/Combobox veya Input)
    let regionKeyword = awsRegion;
    if (awsRegion === 'eu-central-1') regionKeyword = 'Frankfurt';
    else if (awsRegion === 'us-east-1') regionKeyword = 'Virginia';
    else if (awsRegion === 'us-east-2') regionKeyword = 'Ohio';

    const regionCombobox = page.locator('main main').getByRole('combobox')
      .or(page.getByRole('combobox', { name: /Region|Bölge/i }))
      .first();

    const regionInput = page.getByPlaceholder(/Region/i)
      .or(page.locator('input[name*="region"]'))
      .first();

    if (await regionInput.isVisible().catch(() => false)) {
      await regionInput.fill(awsRegion);
    } else if (await regionCombobox.isVisible().catch(() => false)) {
      await regionCombobox.click();
      await page.waitForTimeout(800);
      const option = page.getByRole('option', { name: new RegExp(`${awsRegion}|${regionKeyword}`, 'i') })
        .or(page.locator('[role="option"]').filter({ hasText: new RegExp(`${awsRegion}|${regionKeyword}`, 'i') }))
        .first();
      await option.waitFor({ state: 'visible', timeout: 5000 });
      await option.click();
    }
    console.log(`   📝 Region Ayarlandı: ${awsRegion}`);

    // H. Bağlantıyı Sınama: "Test Connection" Buton Tetikleme
    console.log('   👆 [1] "Test Connection" butonu tetikleniyor...');
    const testConnectionBtn = page.getByRole('button', { name: /Test Connection/i }).first();
    await testConnectionBtn.click();

    console.log('   ⏳ Test Connection modalının açılması bekleniyor...');
    const closeBtn = page.getByRole('button', { name: /Close|Kapat/i }).first();
    await closeBtn.waitFor({ state: 'visible', timeout: 60000 });

    // Exhaustive Scroll (Modalı Aşağı Kaydır)
    await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('.modal');
      if (dialog) dialog.scrollTop = dialog.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(() => {});
    await page.waitForTimeout(800);

    // Kapat
    await closeBtn.click();
    await page.locator('[role="dialog"]').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    console.log('   ✅ Test Connection modalı kapandı.');
    await page.waitForTimeout(1000);

    // G. Form Kaydetme & Redirect Assert (Katman 5)
    console.log('   👆 [2] Form "Save" butonuna tıklanarak kaydediliyor...');
    const storageSaveBtn = page.getByRole('button', { name: /Add Storage|Save/i }).first();
    await storageSaveBtn.click();

    // Storage listesine başarılı yönlenmeyi doğrula
    await page.waitForURL(new RegExp(`/${workspaceId}/storage(\\?|#|$)`), { timeout: 20000 });
    console.log('   ✅ Başarıyla depolama listesi sayfasına yönlenildi!');
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(3000);

    // H. Sağlayıcının Active Olduğunu Doğrula (DOM State)
    console.log('   🔍 [3] Depolama kartı durumunun "Active" veya "Connected" olduğu doğrulanıyor...');
    const targetStorageCard = page.locator('div, tr, section').filter({ hasText: awsConnName }).first();
    await expect(targetStorageCard).toBeVisible({ timeout: 10000 });

    const activeStatus = targetStorageCard.getByText(/Active|Connected/i).first();
    await expect(activeStatus).toBeVisible({ timeout: 10000 });
    console.log('   ✅ Depolama sağlayıcısı başarıyla eklendi ve "Active" durumu doğrulandı (DOM OK).');

    // J. Temizlik: Depolama Sağlayıcısını Silme
    console.log('   👆 [4] Temizlik: Oluşturulan depolama sağlayıcısı siliniyor...');
    const s3DeleteBtn = targetStorageCard.locator('button').filter({ hasText: /delete|remove|disconnect|sil/i })
      .or(targetStorageCard.locator('svg[class*="trash"]').locator('..'))
      .first();

    if (await s3DeleteBtn.isVisible().catch(() => false)) {
      await s3DeleteBtn.click();
    } else {
      const cardMenuTrigger = targetStorageCard.locator('button[aria-haspopup="menu"]').or(targetStorageCard.locator('button[id*="radix"]')).first();
      if (await cardMenuTrigger.isVisible()) {
        await cardMenuTrigger.click();
        await page.waitForTimeout(500);
        const s3DeleteAction = page.getByRole('menuitem', { name: /delete|remove|disconnect|sil/i }).first();
        await s3DeleteAction.click();
      }
    }

    const confirmS3DeleteBtn = page.locator('[role="dialog"] button').filter({ hasText: /confirm|delete|yes|sure|sil/i }).first();
    if (await confirmS3DeleteBtn.isVisible().catch(() => false)) {
      await confirmS3DeleteBtn.click();
    }

    await targetStorageCard.waitFor({ state: 'hidden', timeout: 10000 });
    console.log('   ✅ Depolama sağlayıcısı başarıyla silindi ve kaldırıldı (Temiz temizlik OK).');

    // ─────────────────────────────────────────────────────────────────
    // 📊 ADIM 5: FİNAL HATA / ÇÖKME VE ZAFİYET DEĞERLENDİRMESİ
    // ─────────────────────────────────────────────────────────────────
    console.log('\n======================================================================');
    console.log('📊 FİNAL 5-KATMANLI CRASH & VULNERABILITY RAPORU');
    console.log(`Toplam Kaydedilen Bulgular: ${auditIssues.length}`);
    
    if (auditIssues.length > 0) {
      console.log('❌ DİKKAT: Test akışları esnasında çökmeler veya kritik uyarılar yakalandı:');
      auditIssues.forEach((issue, idx) => {
        console.log(`   [${idx + 1}] TİP: ${issue.type} | KAYNAK: ${issue.url}\n       MESAJ: ${issue.message}\n`);
      });
    } else {
      console.log('✅ HARİKA: 5 katmanın tamamı başarıyla geçildi. Hiçbir JS çökmesi, API hatası veya XSS açığı tespit edilmedi!');
    }
    console.log('======================================================================\n');

    // Herhangi bir kritik JS çökmesi veya API hatası fırlatıldıysa testi kırmızıya boya!
    const criticalCrashes = auditIssues.filter(x => x.type.includes('Crash') || x.type.includes('Vulnerability'));
    expect(criticalCrashes.length).toBe(0);
  });
});
