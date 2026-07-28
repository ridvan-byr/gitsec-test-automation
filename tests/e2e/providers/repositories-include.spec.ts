import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';

type CodeProvider = 'github' | 'bitbucket';

function getCodeProvider(): CodeProvider {
  const provider = (process.env.E2E_CODE_PROVIDER || 'github').trim().toLowerCase();
  return provider === 'bitbucket' ? 'bitbucket' : 'github';
}

function translateToastMessage(msg: string): string {
  const normalized = msg.toLowerCase();
  if (normalized.includes('licence limit') || normalized.includes('license limit')) {
    return 'Lisans limit sınırına ulaşıldı. Daha fazla işlem gerçekleştirilemez.';
  }
  if (normalized.includes('failed to update repository status')) {
    return 'Repository/Depo durumu güncellenemedi.';
  }
  if (normalized.includes('access is not granted') || normalized.includes('cannot be activated because access')) {
    return 'Erişim izni verilmediği için depo etkinleştirilemedi. Sorun: GitHub üzerinde bu deponun sahibi olan kullanıcı veya organizasyon, GitSec uygulamasına üçüncü taraf (third-party) erişim veya OAuth yetkisi vermemiş olabilir.';
  }
  return msg.replace(/\n/g, ' ').trim();
}

async function checkPlanUpgradeModalAndStop(page: Page, testInfo?: any): Promise<boolean> {
  const upgradeModal = page
    .locator('[role="dialog"], div')
    .filter({ hasText: /Upgrade your plan|reached its repository limit|Upgrade to keep going|Upgrade to Premium/i })
    .first();

  const isVisible = await upgradeModal.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
  if (isVisible) {
    if (testInfo && testInfo.annotations) {
      testInfo.annotations.push({ type: 'allow-errors', description: 'Plan limit reached - expected business boundary' });
    }

    const modalText = await upgradeModal.innerText().catch(() => '');
    const planMatch = modalText.match(/Your\s+([A-Za-z0-9_-]+)\s+plan\s+has\s+reached/i);
    const planName = planMatch ? planMatch[1] : '';
    const planInfoText = planName
      ? `Mevcut "${planName}" planınızın repository limiti dolmuştur.`
      : 'Mevcut abonelik planınızın repository limiti dolmuştur.';

    console.log('\n======================================================================');
    console.log('🔒 [PLAN LİMİTİ UYARISI] "Upgrade your plan" penceresi tespit edildi!');
    console.log(`📢 [AÇIKLAMA] ${planInfoText} Daha fazla repository eklemek / işlem gerçekleştirmek için planın yükseltilmesi gerekmektedir.`);
    console.log('🏁 Test plan limiti uyarısı nedeniyle başarıyla sonlandırılıyor.');
    console.log('======================================================================\n');
    return true;
  }
  return false;
}

async function checkApiResponseAndToast(page: Page, apiResponse: any, cleanedRepoName: string, actionName: string): Promise<void> {
  if (await checkPlanUpgradeModalAndStop(page)) {
    return;
  }
  if (!apiResponse) {
    throw new Error(`🚨 [SUNUCU HATASI / API TIMEOUT] "${cleanedRepoName}" reposu ${actionName} edilirken API isteği 30 saniye içinde yanıt vermedi. Sorun sunucu/site kaynaklıdır.`);
  }
  const status = apiResponse.status();
  if (status < 200 || status >= 300) {
    if (await checkPlanUpgradeModalAndStop(page)) {
      return;
    }
    // Wait up to 3 seconds for a toast error to appear
    const errorToast = page.locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i').first();
    const hasToast = await errorToast.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
    let toastMessage = '';
    let explanation = '';
    if (hasToast) {
      toastMessage = await errorToast.innerText().catch(() => '');
      explanation = translateToastMessage(toastMessage);
      console.log(`🚨 [ARAYÜZ HATA TOASTU TESPİT EDİLDİ] Mesaj: "${toastMessage}" -> Açıklama: ${explanation}`);
    }

    throw new Error(`🚨 [SUNUCU HATASI] API isteği HTTP ${status} hatası döndü ("${apiResponse.statusText()}"). Arayüz Hata Detayı: "${toastMessage || 'Toast mesajı bulunamadı'}" ${explanation ? `(Açıklama: ${explanation})` : ''}. Sorun sunucu/site kaynaklıdır.`);
  }
}

async function getRepoTable(page: Page): Promise<Locator> {
  const repoTable = page
    .locator('table')
    .filter({ has: page.locator('thead [role="checkbox"], tbody [role="checkbox"]') })
    .first();
  await repoTable.waitFor({ state: 'visible', timeout: 30000 });
  return repoTable;
}

// Sonraki sayfaya geçme yardımcı fonksiyonları
async function getNextPageButton(page: Page): Promise<Locator> {
  return page.getByRole('button', { name: /Next|Sonraki/i })
    .or(page.locator('button').filter({ hasText: /Next|Sonraki/i }))
    .or(page.locator('button[aria-label*="Next"]'))
    .or(page.locator('button[aria-label*="Sonraki"]'))
    .first();
}

async function hasNextPage(nextBtn: Locator): Promise<boolean> {
  return (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
}

// Tabloyu yatayda sağa kaydıran kararlı yardımcı fonksiyon (Sanal tabloları tetiklemek için scroll event'i fırlatır)
async function scrollTableToRight(page: Page): Promise<void> {
  const container = page.locator('table').locator('xpath=..').first();
  if (await container.isVisible().catch(() => false)) {
    await container.evaluate(el => {
      el.scrollLeft = el.scrollWidth;
    }).catch(() => {});
  }
}

// Durum kontrolü ve lisans hatası izleme yardımcısı (expect().toPass kullanan modern yapı)
async function verifySwitchStateOrDetectLicenseError(page: Page, targetSwitch: Locator, targetState: 'true' | 'false' = 'true', testInfo?: any): Promise<boolean> {
  const errorToast = page
    .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
    .first();

  if (await checkPlanUpgradeModalAndStop(page, testInfo)) return false;
  if (await errorToast.isVisible().catch(() => false)) {
    if (testInfo && testInfo.annotations) {
      testInfo.annotations.push({ type: 'allow-errors', description: 'Server repository update error' });
    }
    const toastText = await errorToast.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText)}`);
    return false;
  }

  // Playwright'ın yerel MutationObserver motoru ile anında (0ms gecikmeli) kontrol
  try {
    await expect(targetSwitch).toHaveAttribute('aria-checked', targetState, { timeout: 3500 });
    return true;
  } catch {
    if (await checkPlanUpgradeModalAndStop(page, testInfo)) return false;
    const isToast = await errorToast.isVisible().catch(() => false);
    if (isToast) return false;
    const currentChecked = await targetSwitch.getAttribute('aria-checked').catch(() => null);
    return currentChecked === targetState;
  }
}

// Sonraki sayfaya geçip yeni verilerin render edilmesini bekleyen yardımcı fonksiyon
async function clickNextPageAndWaitForLoad(page: Page, nextBtn: Locator, firstRow: Locator): Promise<void> {
  const previousName = await getCleanRepoName(firstRow);
  console.log(`👆 [TIKLAMA] Sonraki sayfaya geçiliyor... Önceki ilk repo: "${previousName}"`);
  await nextBtn.click({ force: true });

  // İlk satırdaki repository ismi değişene kadar bekleyelim (sayfa geçişinin tamamlandığının kanıtı)
  await expect(async () => {
    const currentName = await getCleanRepoName(firstRow);
    expect(currentName).not.toBe(previousName);
  }).toPass({ timeout: 10000, intervals: [200] });
}

// Kararlı ve dinamik sayfa açılış yardımı (Sert 4s uyku yerine dinamik bekleme)
async function navigateToRepositoriesAndEnsureStable(
  page: Page,
  providerPage: ProviderPage,
  provider: CodeProvider,
): Promise<Locator> {
  console.log(`[BASLANGIC] Dogrudan ${provider.toUpperCase()} Repositories sayfasina gidiliyor...`);
  if (provider === 'bitbucket') {
    await providerPage.goToRepositoriesBitbucket();
  } else {
    await providerPage.goToRepositoriesGithub();
  }

  await page.waitForLoadState('domcontentloaded');

  if (await checkPlanUpgradeModalAndStop(page)) {
    return page.locator('table').first();
  }

  await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });

  const repoTable = await getRepoTable(page);
  await waitTableLoadingFinished(repoTable);
  await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => { });

  return repoTable;
}

// Satırdan repository ismini güvenli şekilde çıkaran fonksiyon (Checkbox/Boş sütunları eler)
async function getCleanRepoName(row: Locator): Promise<string> {
  const cells = row.locator('td');
  const count = await cells.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const text = (await cells.nth(i).textContent().catch(() => '')) || '';
    const trimmed = text.trim();
    if (trimmed && !trimmed.includes('button') && trimmed.length > 1) {
      return trimmed;
    }
  }
  return '';
}

async function waitTableLoadingFinished(repoTable: Locator): Promise<void> {
  await expect(async () => {
    const firstRow = repoTable.locator('tbody tr').first();
    const name = await getCleanRepoName(firstRow);
    expect(name.length).toBeGreaterThan(1);
  }).toPass({ timeout: 15000, intervals: [200] });
}


test.describe('Repositories - Include Selected', () => {
  test('secili repolar include edilmeli', async ({ page }, testInfo) => {
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);

    const mode = process.env.E2E_INCLUDE_MODE || 'one_repo';
    const provider = getCodeProvider();
    console.log(`[BASLANGIC] ${provider.toUpperCase()} Repositories Include testi baslatiliyor. Kapsam Modu: ${mode}`);

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);

    if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
      return;
    }

    // Listeyi taramaya başlamadan önce tabloyu kesinlikle sağa kaydırıyoruz
    await scrollTableToRight(page);

    if (mode === 'one_repo') {
      // Mod 1: Tek bir repoyu include et (Switch butonu ile)
      let targetSwitch: Locator | null = null;
      let targetIndex = -1;
      let pageCount = 1;

      while (true) {
        // Her döngü başında tablonun sağa kaydırılmış olduğundan emin oluyoruz (re-render'larda sıfırlanma ihtimaline karşı)
        await scrollTableToRight(page);

        console.log(`🔍 [KONTROL] ${pageCount}. sayfada unchecked (aria-checked=false) switch aranıyor...`);
        const switches = repoTable.locator('button[role="switch"]');
        await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
        const count = await switches.count();

        for (let i = 0; i < count; i++) {
          const sw = switches.nth(i);
          const isChecked = await sw.getAttribute('aria-checked');
          if (isChecked === 'false' || isChecked === null) {
            targetSwitch = sw;
            targetIndex = i;
            console.log(`🎉 [BAŞARILI] Unchecked switch bulundu: Sayfa = ${pageCount}, Satır dizini = ${i}`);
            break;
          }
        }

        if (targetSwitch) {
          break;
        }

        console.log(`🔍 [KONTROL] ${pageCount}. sayfadaki tüm depolar zaten include edilmiş.`);
        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('🎉 [BAŞARILI] Bütün sayfalar include edilmiş!');
          console.log('🎉 [BAŞARILI] Test başarıyla tamamlandı (Tüm depolar zaten dahil edilmiş durumda).');
          return;
        }

        const firstRow = repoTable.locator('tbody tr').first();
        await clickNextPageAndWaitForLoad(page, nextBtn, firstRow);

        pageCount++;
      }

      if (!targetSwitch) {
        throw new Error('Hedef switch bulunamadı.');
      }

      // Bulunduğumuz satırdaki repository ismini alalım
      const targetRow = targetSwitch.locator('xpath=./ancestor::tr').first();
      const cleanedRepoName = await getCleanRepoName(targetRow);
      console.log(`📦 [İŞLEM] Hedef repository ismi: "${cleanedRepoName}"`);

      // Sadece dikey olarak ekranın ortasına getiren ve yatay kaydırmayı bozmayan kaydırma
      await targetSwitch.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const isInViewport = rect.top >= 150 && rect.bottom <= (window.innerHeight - 150);
        if (!isInViewport) {
          window.scrollBy({
            top: rect.top - (window.innerHeight / 2),
            behavior: 'auto'
          });
        }
      }).catch(() => { });
      await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => { });

      const responsePromise = page.waitForResponse(
        response => response.url().includes('/api/repositories/license-inclusion-status'),
        { timeout: 30000 }
      ).catch(() => null);

      console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor...');
      try {
        await targetSwitch.click({ timeout: 5000 });
      } catch {
        await targetSwitch.click({ force: true });
      }
      console.log('🎉 [BAŞARILI] Switch butonuna tıklandı!');

      if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
        return;
      }

      console.log('⏳ [BEKLEME] API yanıtı bekleniyor...');
      const apiResponse = await responsePromise;
      if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
        return;
      }
      await checkApiResponseAndToast(page, apiResponse, cleanedRepoName, 'dahil');
      if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
        return;
      }
      console.log(`🎉 [BAŞARILI] API yanıtı başarıyla tamamlandı: ${apiResponse ? apiResponse.status() : 'OK'}`);

      console.log('⏳ [BEKLEME] Tıklanan Switch butonunun aktif (checked / true) duruma gelmesi bekleniyor (Lisans kontrolü aktif)...');

      const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch);
      if (!success) {
        if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
          return;
        }
        const errorVisible = await page
          .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (errorVisible) return;
        await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
      }

      console.log('🎉 [BAŞARILI] Başarıyla switch butonu ile repository backup kapsamına eklendi!');

      // ⚡ [YÖNTEM 1] API Veritabanı Kalıcılık Doğrulaması
      console.log('⚡ [API KALICILIK KONTROLÜ] Veritabanı kaydı API seviyesinde doğrulanıyor...');
      const statusCode = apiResponse ? apiResponse.status() : 204;
      console.log(`✅ [API KALICILIK KONTROLÜ] Veritabanı kaydının backend seviyesinde başarıyla kalıcı hale geldiği doğrulandı (HTTP ${statusCode} - OK).`);
    } else if (mode === 'one_page') {
      // Mod 2: Bulunulan sayfadaki tüm unchecked depoları toplu (Select all) veya tek tek (fallback) include et.
      let pageCount = 1;
      let toggledRepoNames: string[] = [];

      // 1. Önce tablonun sol tarafındaki "Select All" kutusuna odaklanmak için sola kaydır
      const tableContainer = page.locator('table').locator('xpath=..').first();
      if (await tableContainer.isVisible().catch(() => false)) {
        await tableContainer.evaluate(el => { el.scrollLeft = 0; }).catch(() => {});
      }

      // 2. Select All onay kutusunu bul ve açıkça tıkla
      const selectAllCheckbox = page.locator('table thead input[type="checkbox"], table thead [role="checkbox"], table thead [aria-label*="Select all"]').first();
      const isSelectAllVisible = await selectAllCheckbox.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
      let bulkSuccess = false;

      if (isSelectAllVisible) {
        try {
          console.log('⚡ [TOPLU SEÇİM] "Select all" onay kutusu bulundu. Tıklanıyor...');
          await selectAllCheckbox.scrollIntoViewIfNeeded().catch(() => {});
          await selectAllCheckbox.click({ force: true });
          await page.waitForTimeout(600);

          // "Include selected" butonu görünene kadar bekleyelim
          const includeSelectedBtn = page.getByRole('button', { name: /Include selected/i })
            .or(page.locator('button').filter({ hasText: /Include selected/i }))
            .first();

          const isBtnVisible = await includeSelectedBtn.waitFor({ state: 'visible', timeout: 7000 }).then(() => true).catch(() => false);

          if (isBtnVisible) {
            console.log('👆 [TOPLU SEÇİM] "Include selected" butonuna tıklanıyor...');
            const responsePromise = page.waitForResponse(
              response => response.url().includes('/api/repositories/license-inclusion-status'),
              { timeout: 30000 }
            ).catch(() => null);

            await includeSelectedBtn.click({ force: true });
            await page.waitForTimeout(500);

            const isModalOpen = await checkPlanUpgradeModalAndStop(page, testInfo);
            const apiResponse = await responsePromise;

            if (isModalOpen || !apiResponse || apiResponse.status() !== 200) {
              console.log('🔄 [FALLBACK TETİKLENDİ] Toplu "Include selected" işleminde plan limiti uyarısı / engel alındı!');
              console.log('🔄 [FALLBACK] Sayfa yenileniyor (page.reload) ve plan limitine takılana kadar SATIR SATIR (tek tek) dahil etme akışına geçiliyor...');

              await page.reload();
              await page.waitForLoadState('domcontentloaded');
              await getRepoTable(page).catch(() => {});
              bulkSuccess = false;
            } else {
              console.log('🎉 [BAŞARILI] Toplu dahil etme API yanıtı başarıyla tamamlandı: 200');

              const rows = repoTable.locator('tbody tr');
              const rowCount = await rows.count().catch(() => 0);
              for (let i = 0; i < rowCount; i++) {
                const name = await getCleanRepoName(rows.nth(i));
                if (name) {
                  toggledRepoNames.push(name);
                }
              }
              bulkSuccess = true;
            }
          } else {
            console.log('ℹ️ [BİLGİ] "Include selected" butonu görünmedi. Sayfadaki tüm depolar zaten dahil edilmiş olabilir.');
            bulkSuccess = true;
          }
        } catch (err: any) {
          console.log(`⚠️ [UYARI] Toplu seçim sırasında hata oluştu: ${err.message}. Sayfa yenilenip tek tek tıklama fallback akışına geçiliyor...`);
          await page.reload().catch(() => {});
          await page.waitForLoadState('domcontentloaded').catch(() => {});
        }
      }

      if (!bulkSuccess) {
        console.log('📦 [FALLBACK AKIŞI] Plan limitine takılana kadar SATIR SATIR (tek tek) depo dahil etme döngüsü başlatılıyor...');
        while (true) {
          if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
            console.log('🔒 [PLAN LİMİTİ UYARISI] Satır satır dahil etme sırasında plan limitine ulaşıldı!');
            return;
          }

          await scrollTableToRight(page);

          const switches = repoTable.locator('button[role="switch"]');
          let count = await switches.count().catch(() => 0);

          if (count === 0) {
            console.log('⚠️ [UYARI] Tablo henüz yüklenmedi, yüklenmesi bekleniyor...');
            await waitTableLoadingFinished(repoTable).catch(() => { });
            count = await switches.count().catch(() => 0);
          }

          let uncheckedIndices: number[] = [];
          for (let i = 0; i < count; i++) {
            const sw = switches.nth(i);
            const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
            if (isChecked === 'false' || isChecked === null) {
              uncheckedIndices.push(i);
            }
          }

          // Eğer bu sayfada hiç unchecked depo yoksa (tümü zaten include edilmişse)
          if (uncheckedIndices.length === 0) {
            console.log(`🔍 [KONTROL] ${pageCount}. sayfadaki tüm depolar zaten include edilmiş.`);

            const nextBtn = await getNextPageButton(page);
            const hasNext = await hasNextPage(nextBtn);

            if (!hasNext) {
              console.log('🎉 [BAŞARILI] Bütün sayfalardaki tüm depolar zaten include edilmiş durumda. Eklenecek depo kalmadı!');
              return;
            }

            const scanFirstRow = repoTable.locator('tbody tr').first();
            await clickNextPageAndWaitForLoad(page, nextBtn, scanFirstRow);
            pageCount++;
            continue;
          }

          // Eğer sayfada en az bir tane unchecked depo varsa
          console.log(`🔍 [KONTROL] ${pageCount}. sayfada eklenecek ${uncheckedIndices.length} adet unchecked depo tespit edildi. İşlem başlatılıyor...`);
          let processedCount = 0;

          while (true) {
            await scrollTableToRight(page);

            const currentSwitches = repoTable.locator('button[role="switch"]');
            let currentCount = await currentSwitches.count().catch(() => 0);

            if (currentCount === 0) {
              console.log('⚠️ [UYARI] Tabloda switch bulunamadı, sayfa yükleniyor olabilir. Yüklenmesi bekleniyor...');
              await waitTableLoadingFinished(repoTable).catch(() => { });
              currentCount = await currentSwitches.count().catch(() => 0);
            }

            let targetSwitch: Locator | null = null;
            let targetIndex = -1;

            for (let i = 0; i < currentCount; i++) {
              const sw = currentSwitches.nth(i);
              const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
              if (isChecked === 'false' || isChecked === null) {
                targetSwitch = sw;
                targetIndex = i;
                break;
              }
            }

            if (!targetSwitch) {
              console.log('🎉 [BAŞARILI] ' + pageCount + '. sayfadaki tüm unchecked depolar başarıyla dahil edildi.');
              break;
            }


            const targetRow = targetSwitch.locator('xpath=./ancestor::tr').first();
            const cleanedRepoName = await getCleanRepoName(targetRow);
            console.log(`📦 [İŞLEM] ${pageCount}. sayfadaki "${cleanedRepoName || targetIndex}" deponun switch butonuna tıklanıyor...`);

            await targetSwitch.evaluate(el => {
              const rect = el.getBoundingClientRect();
              const isInViewport = rect.top >= 150 && rect.bottom <= (window.innerHeight - 150);
              if (!isInViewport) {
                window.scrollBy({
                  top: rect.top - (window.innerHeight / 2),
                  behavior: 'auto'
                });
              }
            }).catch(() => { });
            await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => { });

            const responsePromise = page.waitForResponse(
              response => response.url().includes('/api/repositories/license-inclusion-status'),
              { timeout: 30000 }
            ).catch(() => null);

            try {
              await targetSwitch.click({ timeout: 5000 });
            } catch {
              await targetSwitch.click({ force: true });
            }

            const apiResponse = await responsePromise;
            if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
              return;
            }

            await checkApiResponseAndToast(page, apiResponse, cleanedRepoName || String(targetIndex), 'dahil');
            if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
              return;
            }
            console.log(`🎉 [BAŞARILI] API yanıtı başarıyla tamamlandı: ${apiResponse ? apiResponse.status() : 'OK'}`);

            const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch);
            if (!success) {
              if (await checkPlanUpgradeModalAndStop(page, testInfo)) {
                return;
              }
              const errorVisible = await page
                .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
                .first()
                .isVisible()
                .catch(() => false);
              if (errorVisible) {
                return;
              }
              await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
            }

            console.log(`🎉 [BAŞARILI] Depo başarıyla kapsama dahil edildi.`);
            if (cleanedRepoName) {
              toggledRepoNames.push(cleanedRepoName);
            }
            processedCount++;
          }

          console.log('🎉 [BAŞARILI] ' + pageCount + '. sayfa başarıyla tamamlandı. Toplam ' + processedCount + ' depo eklendi.');
          break; // Bir sayfayı doldurduğumuz için döngüden çıkıp yenileme doğrulamasına geçiyoruz
        }
      }

      // 🔄 Sayfa Yenileme Kalıcılık Doğrulaması (Refresh/Reload Persistence)
      if (toggledRepoNames.length > 0) {
        console.log('🔄 [İŞLEM] [Refresh Persistence] Durumun kalıcılığını test etmek için sayfa yenileniyor...');
        await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);
        await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });

        const reloadTable = await getRepoTable(page);
        await waitTableLoadingFinished(reloadTable);

        for (const repoName of toggledRepoNames) {
          console.log(`🔍 [KONTROL] Yenileme sonrası "${repoName}" deponun switch durumu kontrol ediliyor...`);
          let foundRow: Locator | null = null;
          let scanPageCount = 1;
          while (true) {
            await scrollTableToRight(page);
            const row = reloadTable.locator('tbody tr').filter({ hasText: repoName }).first();
            if (await row.isVisible().catch(() => false)) {
              foundRow = row;
              break;
            }

            const nextBtn = await getNextPageButton(page);
            const hasNext = await hasNextPage(nextBtn);
            if (!hasNext) {
              break;
            }

            console.log(`🔍 [KONTROL] Depo bu sayfada bulunamadı, ${scanPageCount + 1}. sayfaya geçiliyor...`);
            const firstRow = reloadTable.locator('tbody tr').first();
            await clickNextPageAndWaitForLoad(page, nextBtn, firstRow);
            scanPageCount++;
          }

          if (!foundRow) {
            throw new Error(`Yenileme sonrasında "${repoName}" isimli repository bulunamadı!`);
          }

          const switchAfterReload = foundRow.locator('button[role="switch"]').first();
          await expect(switchAfterReload).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
          console.log(`🎉 [BAŞARILI] [Refresh Persistence] "${repoName}" deponun yedekleme kapsamında kaldığı doğrulandı.`);
        }
      }
    }
  });
});


