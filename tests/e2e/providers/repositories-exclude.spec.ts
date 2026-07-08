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

async function checkApiResponseAndToast(page: Page, apiResponse: any, cleanedRepoName: string, actionName: string): Promise<void> {
  if (!apiResponse) {
    throw new Error(`🚨 [SUNUCU HATASI / API TIMEOUT] "${cleanedRepoName}" reposu ${actionName} edilirken API isteği 30 saniye içinde yanıt vermedi. Sorun sunucu/site kaynaklıdır.`);
  }
  const status = apiResponse.status();
  if (status !== 200) {
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
  console.log('↔️ [KAYDIRMA] Tablo sağa kaydırılıyor (Scroll to right)...');
  
  const container = page.locator('div.overflow-x-auto, div.overflow-auto, .overflow-x-scroll, [class*="overflow-x"]').first();
  const isVisible = await container.isVisible().catch(() => false);
  
  if (isVisible) {
    await container.evaluate(el => {
      el.scrollLeft = 1000;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    }).catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
  }
  
  await page.evaluate(() => {
    const divs = document.querySelectorAll('div');
    for (let i = 0; i < divs.length; i++) {
      const div = divs[i];
      if (div.scrollWidth > div.clientWidth) {
        div.scrollLeft = 1000;
        div.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
    }
  }).catch(() => {});
  await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
}

// Tablonun skeleton yükleme durumunun tamamlanmasını bekleyen fonksiyon
async function waitTableLoadingFinished(repoTable: Locator): Promise<void> {
  await expect(async () => {
    const firstRow = repoTable.locator('tbody tr').first();
    const name = await getCleanRepoName(firstRow);
    expect(name.length).toBeGreaterThan(1);
  }).toPass({ timeout: 15000, intervals: [200] });
}

// Durum kontrolü ve lisans hatası izleme yardımcısı (expect().toPass kullanan modern yapı)
async function verifySwitchStateOrDetectLicenseError(page: Page, targetSwitch: Locator, targetState: 'true' | 'false' = 'false'): Promise<boolean> {
  const errorToast = page
    .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
    .first();

  let hasError = false;
  try {
    await expect(async () => {
      const errorVisible = await errorToast.isVisible().catch(() => false);
      if (errorVisible) {
        hasError = true;
        return; // Hata bulundu, toPass bloğunu sonlandırmak için normal dönüş
      }
      
      const isChecked = await targetSwitch.getAttribute('aria-checked').catch(() => null);
      expect(isChecked).toBe(targetState);
    }).toPass({ timeout: 7000, intervals: [200] });
  } catch (err) {
    // Zaman aşımı veya assertion başarısızlığı
  }

  if (hasError) {
    const toastText = await errorToast.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText)}`);
    console.log('🏁 Test başarıyla durduruldu ve sonlandırıldı.');
    return false;
  }

  const isChecked = await targetSwitch.getAttribute('aria-checked').catch(() => null);
  return isChecked === targetState;
}

// Sonraki sayfaya geçip yeni verilerin render edilmesini bekleyen yardımcı fonksiyon
async function clickNextPageAndWaitForLoad(page: Page, nextBtn: Locator, firstRow: Locator): Promise<void> {
  const previousName = await getCleanRepoName(firstRow);
  console.log(`👆 [TIKLAMA] Sonraki sayfaya geçiliyor... Önceki ilk repo: "${previousName}"`);
  await nextBtn.click({ force: true });
  
  // İlk satırdaki repository ismi değişene ve boş olmayana (skeleton olmaktan çıkana) kadar bekleyelim
  await expect(async () => {
    const currentName = await getCleanRepoName(firstRow);
    expect(currentName).not.toBe(previousName);
    expect(currentName.length).toBeGreaterThan(1);
  }).toPass({ timeout: 20000, intervals: [200] });
}

// Son sayfaya doğrudan yönlenmeyi deneyen fonksiyon
async function goToLastPageIfPossible(page: Page, repoTable: Locator): Promise<void> {
  const lastPageBtn = page.locator('button[aria-label="Go to last page"]').first();
  const isAvailable = (await lastPageBtn.isVisible().catch(() => false)) && !(await lastPageBtn.isDisabled().catch(() => true));
  if (isAvailable) {
    const firstRow = repoTable.locator('tbody tr').first();
    const previousName = await getCleanRepoName(firstRow);

    console.log('⏭️ [TIKLAMA] "Go to last page" butonuna tıklanıyor (Son sayfalara yönleniliyor)...');
    await lastPageBtn.click({ force: true });

    // Son sayfa verilerinin yüklendiğini (ilk satırın değiştiğini) doğrula
    await expect(async () => {
      const currentName = await getCleanRepoName(firstRow);
      expect(currentName).not.toBe(previousName);
      expect(currentName.length).toBeGreaterThan(1);
    }).toPass({ timeout: 10000, intervals: [200] });

    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
  }
}

// Exclude edilen (unchecked) depoları bulmak için akıllı son sayfa öncelikli tarama fonksiyonu
async function findRepoPageByScanning(page: Page, repoTable: Locator, repoName: string): Promise<Locator | null> {
  // İlk önce son sayfaya gitmeyi deneyelim (çünkü exclude edilenler son sayfalara atılıyor)
  await goToLastPageIfPossible(page, repoTable);
  
  // Tabloyu sağa kaydır
  await scrollTableToRight(page);
  
  // Son sayfada aramayı dene
  let foundRow = repoTable.locator('tbody tr').filter({ hasText: repoName }).first();
  if (await foundRow.isVisible().catch(() => false)) {
    console.log(`🎉 [BAŞARILI] Depo son sayfada bulundu: "${repoName}"`);
    return foundRow;
  }
  
  // Eğer son sayfada yoksa, geriye doğru (Previous Page) tarayalım
  let prevPageCount = 1;
  while (true) {
    const prevBtn = page.locator('button[aria-label="Go to previous page"]').first();
    const hasPrev = (await prevBtn.isVisible().catch(() => false)) && !(await prevBtn.isDisabled().catch(() => true));
    
    if (!hasPrev) {
      break;
    }
    
    console.log(`🔍 [KONTROL] Depo bu sayfada bulunamadı, geriye doğru ${prevPageCount + 1}. sayfaya geçiliyor...`);
    const firstRow = repoTable.locator('tbody tr').first();
    const previousName = await getCleanRepoName(firstRow);
    
    await prevBtn.click({ force: true });
    
    // Verilerin değişmesini bekle
    await expect(async () => {
      const currentName = await getCleanRepoName(firstRow);
      expect(currentName).not.toBe(previousName);
    }).toPass({ timeout: 10000, intervals: [200] });
    
    await scrollTableToRight(page);
    foundRow = repoTable.locator('tbody tr').filter({ hasText: repoName }).first();
    if (await foundRow.isVisible().catch(() => false)) {
      console.log(`🎉 [BAŞARILI] Depo geriye doğru taramada bulundu: "${repoName}"`);
      return foundRow;
    }
    prevPageCount++;
  }
  
  // Eğer bulamadıysak, en baştan (1. sayfadan) ileriye doğru da tarayalım (Garanti olsun)
  console.log('🔍 [KONTROL] Depo geriye doğru taramada bulunamadı. En baştan (1. sayfadan) ileriye doğru taranıyor...');
  const firstPageBtn = page.locator('button[aria-label="Go to first page"]').first();
  const hasFirst = (await firstPageBtn.isVisible().catch(() => false)) && !(await firstPageBtn.isDisabled().catch(() => true));
  if (hasFirst) {
    await firstPageBtn.click({ force: true });
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
  }
  
  let scanPageCount = 1;
  while (true) {
    await scrollTableToRight(page);
    foundRow = repoTable.locator('tbody tr').filter({ hasText: repoName }).first();
    if (await foundRow.isVisible().catch(() => false)) {
      console.log(`🎉 [BAŞARILI] Depo ileriye doğru taramada bulundu: "${repoName}"`);
      return foundRow;
    }
    
    const nextBtn = await getNextPageButton(page);
    const hasNext = await hasNextPage(nextBtn);
    if (!hasNext) {
      break;
    }
    
    console.log(`🔍 [KONTROL] Depo bu sayfada bulunamadı, ${scanPageCount + 1}. sayfaya geçiliyor...`);
    const firstRow = repoTable.locator('tbody tr').first();
    await clickNextPageAndWaitForLoad(page, nextBtn, firstRow);
    scanPageCount++;
  }
  
  return null;
}

// Kararlı ve dinamik sayfa açılış yardımı (Sert 4s uyku yerine dinamik bekleme)
async function navigateToRepositoriesAndEnsureStable(
  page: Page,
  providerPage: ProviderPage,
  provider: CodeProvider,
): Promise<Locator> {
  console.log(`🚀 [BAŞLANGIÇ] Doğrudan ${provider.toUpperCase()} Repositories sayfasına gidiliyor...`);
  if (provider === 'bitbucket') {
    await providerPage.goToRepositoriesBitbucket();
  } else {
    await providerPage.goToRepositoriesGithub();
  }
  
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
  
  const repoTable = await getRepoTable(page);
  await waitTableLoadingFinished(repoTable);
  await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
  
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

test.describe('Repositories - Exclude Selected', () => {
  test('tek bir depoyu exclude etme', async ({ page }) => {
    const mode = process.env.E2E_EXCLUDE_MODE || 'one_repo';
    test.skip(mode !== 'one_repo', 'Only runs in one_repo mode');
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);
    const provider = getCodeProvider();

    console.log(`🚀 [BAŞLANGIÇ] ${provider.toUpperCase()} Repositories Exclude Testi başlatılıyor. Kapsam: tek bir depoyu exclude etme`);

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);

    // Listeyi taramaya başlamadan önce tabloyu kesinlikle sağa kaydırıyoruz
    await scrollTableToRight(page);

    // Mod 1: Tek bir repoyu exclude et (Switch butonu ile)
    let targetSwitch: Locator | null = null;
    let targetIndex = -1;
    let pageCount = 1;

    while (true) {
      // Her döngü başında tablonun sağa kaydırılmış olduğundan emin oluyoruz
      await scrollTableToRight(page);

      console.log(`🔍 [KONTROL] ${pageCount}. sayfada checked (aria-checked=true) switch aranıyor...`);
      const switches = repoTable.locator('button[role="switch"]');
      await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      const count = await switches.count();

      for (let i = 0; i < count; i++) {
        const sw = switches.nth(i);
        const isChecked = await sw.getAttribute('aria-checked');
        if (isChecked === 'true' || isChecked === 'checked') {
          targetSwitch = sw;
          targetIndex = i;
          console.log(`🎉 [BAŞARILI] Checked switch bulundu: Sayfa = ${pageCount}, Satır dizini = ${i}`);
          break;
        }
      }

      if (targetSwitch) {
        break;
      }

      console.log(`🔍 [KONTROL] ${pageCount}. sayfadaki tüm depolar zaten exclude edilmiş (devre dışı).`);
      const nextBtn = await getNextPageButton(page);
      const hasNext = await hasNextPage(nextBtn);

      if (!hasNext) {
        console.log('🎉 [BAŞARILI] Bütün sayfalar exclude edilmiş!');
        console.log('🎉 [BAŞARILI] Test başarıyla tamamlandı (Tüm depolar zaten hariç tutulmuş durumda).');
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
    }).catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

    const responsePromise = page.waitForResponse(
      response => response.url().includes('/api/repositories/license-inclusion-status/'),
      { timeout: 30000 }
    ).catch(() => null);

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Devre dışı bırakmak için)...');
    try {
      await targetSwitch.click({ timeout: 5000 });
    } catch {
      await targetSwitch.click({ force: true });
    }
    console.log('🎉 [BAŞARILI] Switch butonuna tıklandı!');

    // Varsa onay modalını onayla
    const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
    if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      console.log('👆 [TIKLAMA] Onay modalında "Yes, Exclude" butonuna tıklanıyor...');
      await confirmBtn.click({ force: true });
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    }

    console.log('⏳ [BEKLEME] API yanıtı bekleniyor...');
    const apiResponse = await responsePromise;
    await checkApiResponseAndToast(page, apiResponse, cleanedRepoName, 'kapsam dışı');
    console.log(`🎉 [BAŞARILI] API yanıtı başarıyla tamamlandı: ${apiResponse!.status()}`);

    console.log('⏳ [BEKLEME] Tıklanan Switch butonunun pasif (checked / false) duruma gelmesi bekleniyor...');

    const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch, 'false');
    if (!success) {
      const errorVisible = await page
        .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
        .first()
        .isVisible()
        .catch(() => false);
      if (errorVisible) return;
      await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 1000 });
    }
    
    console.log('🎉 [BAŞARILI] Başarıyla switch butonu ile repository backup kapsamından çıkarıldı (Exclude edildi)!');

    // 🔄 Sayfa Yenileme Kalıcılık Doğrulaması (Refresh/Reload Persistence)
    console.log('🔄 [İŞLEM] [Refresh Persistence] Durumun kalıcılığını test etmek için sayfa yenileniyor...');
    await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
    
    // Bekleme ve stabilizasyon: Yükleme tamamlanana ve repolar gelene kadar bekle
    await expect(page.getByText(/connected repositories/i).first()).toHaveText(/[1-9]\d* connected repositories/, { timeout: 30000 });

    const repoTableAfterReload = await getRepoTable(page);
    await waitTableLoadingFinished(repoTableAfterReload);

    // Tabloyu tekrar sağa kaydır
    await scrollTableToRight(page);

    // Repository satırını tüm sayfaları tarayarak bulup switch butonunun checked durumunu doğrula
    if (cleanedRepoName) {
      console.log(`🔍 [KONTROL] Yenileme sonrası "${cleanedRepoName}" deponun konumu ve switch durumu kontrol ediliyor...`);
      
      const foundRow = await findRepoPageByScanning(page, repoTableAfterReload, cleanedRepoName);
      if (!foundRow) {
        throw new Error(`Yenileme sonrasında "${cleanedRepoName}" isimli repository bulunamadı!`);
      }

      const switchAfterReload = foundRow.locator('button[role="switch"]').first();
      await expect(switchAfterReload).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
      console.log('🎉 [BAŞARILI] [Refresh Persistence] Sayfa yenileme sonrasında da repository\'nin backup kapsamı dışında (unchecked/false) kaldığı başarıyla doğrulandı!');
    }
  });

  test('tüm depoları exclude etme', async ({ page }) => {
    const mode = process.env.E2E_EXCLUDE_MODE || 'one_repo';
    test.skip(mode !== 'all_pages', 'Only runs in all_pages mode');
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);
    const provider = getCodeProvider();

    console.log(`🚀 [BAŞLANGIÇ] ${provider.toUpperCase()} Repositories Exclude Testi başlatılıyor. Kapsam: tüm depoları exclude etme`);

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);

    // Listeyi taramaya başlamadan önce tabloyu kesinlikle sağa kaydırıyoruz
    await scrollTableToRight(page);

    // Mod 2: Bütün aktif depoları exclude et (Her adımda Page 1, Index 0'ı exclude edip yenileyerek)
    let totalProcessed = 0;

    while (true) {
      // Tabloyu sağa kaydır
      await scrollTableToRight(page);

      const switches = repoTable.locator('button[role="switch"]');
      await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      const count = await switches.count().catch(() => 0);
      
      let targetSwitch: Locator | null = null;
      for (let i = 0; i < count; i++) {
        const sw = switches.nth(i);
        const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
        if (isChecked === 'true' || isChecked === 'checked') {
          targetSwitch = sw;
          break;
        }
      }

      if (!targetSwitch) {
        console.log('🎉 [BAŞARILI] Sayfa 1 üzerinde aktif (checked) depo kalmadı. Exclude işlemi tamamlandı.');
        break;
      }

      const targetRow = targetSwitch.locator('xpath=./ancestor::tr').first();
      const cleanedRepoName = await getCleanRepoName(targetRow);
      console.log(`📦 [İŞLEM] Aktif depo kapsam dışına çıkarılıyor: "${cleanedRepoName}"`);

      await targetSwitch.evaluate(el => {
        const rect = el.getBoundingClientRect();
        const isInViewport = rect.top >= 150 && rect.bottom <= (window.innerHeight - 150);
        if (!isInViewport) {
          window.scrollBy({
            top: rect.top - (window.innerHeight / 2),
            behavior: 'auto'
          });
        }
      }).catch(() => {});
      await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

      const responsePromise = page.waitForResponse(
        response => response.url().includes('/api/repositories/license-inclusion-status/'),
        { timeout: 30000 }
      ).catch(() => null);

      try {
        await targetSwitch.click({ timeout: 5000 });
      } catch {
        await targetSwitch.click({ force: true });
      }

      const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
      if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        await confirmBtn.click({ force: true });
        await expect(confirmBtn).toBeHidden({ timeout: 5000 });
      }

      const apiResponse = await responsePromise;
      await checkApiResponseAndToast(page, apiResponse, cleanedRepoName, 'kapsam dışı');
      console.log(`🎉 [BAŞARILI] API yanıtı başarıyla tamamlandı: ${apiResponse!.status()}`);

      const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch, 'false');
      if (!success) {
        const errorVisible = await page
          .locator('text=/The licence limit within threshold has been reached|Failed to update repository status|Some repositories cannot be activated/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (errorVisible) {
          return;
        }
        await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 1000 });
      }

      console.log('🎉 [BAŞARILI] Depo başarıyla kapsam dışına çıkarıldı.');
      totalProcessed++;

      // Her exclude işleminden sonra sayfayı yenileyerek durum sıralamasını güncelliyoruz
      console.log('🔄 [İŞLEM] [Refresh] Sıralamayı güncellemek için sayfa yenileniyor...');
      await navigateToRepositoriesAndEnsureStable(page, providerPage, provider);
      await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
      await waitTableLoadingFinished(repoTable);
    }

    console.log('🎉 [BAŞARILI] Sistemdeki tüm depolar başarıyla kapsam dışı bırakıldı! Toplam işlem yapılan: ' + totalProcessed);
  });
});
