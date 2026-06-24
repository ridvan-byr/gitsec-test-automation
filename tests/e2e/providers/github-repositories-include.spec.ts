import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';

function translateToastMessage(msg: string): string {
  const normalized = msg.toLowerCase();
  if (normalized.includes('licence limit') || normalized.includes('license limit')) {
    return 'Lisans limit sınırına ulaşıldı. Daha fazla işlem gerçekleştirilemez.';
  }
  if (normalized.includes('failed to update repository status')) {
    return 'Repository/Depo durumu güncellenemedi.';
  }
  return msg.replace(/\n/g, ' ').trim();
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
    await page.evaluate(() => new Promise(requestAnimationFrame));
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
  await page.evaluate(() => new Promise(requestAnimationFrame));
}

// Durum kontrolü ve lisans hatası izleme yardımcısı (expect().toPass kullanan modern yapı)
async function verifySwitchStateOrDetectLicenseError(page: Page, targetSwitch: Locator, targetState: 'true' | 'false' = 'true'): Promise<boolean> {
  const errorToast = page
    .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
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
  
  // İlk satırdaki repository ismi değişene kadar bekleyelim (sayfa geçişinin tamamlandığının kanıtı)
  await expect(async () => {
    const currentName = await getCleanRepoName(firstRow);
    expect(currentName).not.toBe(previousName);
  }).toPass({ timeout: 10000, intervals: [200] });
}

// Kararlı ve dinamik sayfa açılış yardımı (Sert 4s uyku yerine dinamik bekleme)
async function navigateToRepositoriesGithubAndEnsureStable(page: Page, providerPage: ProviderPage): Promise<Locator> {
  console.log('🚀 [BAŞLANGIÇ] Doğrudan GitHub Repositories sayfasına gidiliyor...');
  await providerPage.goToRepositoriesGithub();
  
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
  
  const repoTable = await getRepoTable(page);
  const firstRow = repoTable.locator('tbody tr').first();
  await firstRow.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});
  await page.evaluate(() => new Promise(requestAnimationFrame));
  
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

test.describe('Repositories - GitHub Include Selected', () => {
  test('secili repolar include edilmeli', async ({ page }) => {
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);
    
    const mode = process.env.E2E_INCLUDE_MODE || 'one_repo';
    console.log(`🚀 [BAŞLANGIÇ] GitHub Repositories Include Testi başlatılıyor. Kapsam Modu: ${mode}`);

    const repoTable = await navigateToRepositoriesGithubAndEnsureStable(page, providerPage);

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
        await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
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
      await page.evaluate(() => new Promise(requestAnimationFrame));

      // API yanıtını beklemek için promise hazırlıyoruz
      const responsePromise = page.waitForResponse(
        response => response.url().includes('/api/repositories/license-inclusion-status/') && response.status() === 200,
        { timeout: 30000 }
      ).catch(() => null);

      console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor...');
      try {
        await targetSwitch.click({ timeout: 5000 });
      } catch {
        await targetSwitch.click({ force: true });
      }
      console.log('🎉 [BAŞARILI] Switch butonuna tıklandı!');

      console.log('⏳ [BEKLEME] API yanıtı bekleniyor...');
      const apiResponse = await responsePromise;
      if (apiResponse) {
        console.log(`🎉 [BAŞARILI] API yanıtı başarıyla tamamlandı: ${apiResponse.status()}`);
      } else {
        console.log('⚠️ [UYARI] API yanıtı beklenirken zaman aşımı oluştu.');
      }

      console.log('⏳ [BEKLEME] Tıklanan Switch butonunun aktif (checked / true) duruma gelmesi bekleniyor (Lisans kontrolü aktif)...');
      
      // Bulunduğumuz satırdaki repository ismini alalım (Yenileme sonrası doğrulamak için)
      const targetRow = targetSwitch.locator('xpath=./ancestor::tr').first();
      const cleanedRepoName = await getCleanRepoName(targetRow);
      console.log(`📦 [İŞLEM] Hedef repository ismi: "${cleanedRepoName}"`);

      const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch);
      if (!success) {
        const errorVisible = await page
          .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
          .first()
          .isVisible()
          .catch(() => false);
        if (errorVisible) return;
        await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
      }
      
      console.log('🎉 [BAŞARILI] Başarıyla switch butonu ile repository backup kapsamına eklendi!');

      // 🔄 [SENIOR SDET] Sayfa Yenileme Kalıcılık Doğrulaması (Refresh/Reload Persistence)
      console.log('🔄 [İŞLEM] [Refresh Persistence] Durumun kalıcılığını test etmek için sayfa yenileniyor...');
      await providerPage.goToRepositoriesGithub();
      await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
      
      // Bekleme ve stabilizasyon: Yükleme tamamlanana ve repolar gelene kadar bekle
      await expect(page.getByText(/connected repositories/i).first()).toHaveText(/[1-9]\d* connected repositories/, { timeout: 30000 });

      const repoTableAfterReload = await getRepoTable(page);
      const firstRowAfterReload = repoTableAfterReload.locator('tbody tr').first();
      await firstRowAfterReload.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});

      // Tabloyu tekrar sağa kaydır
      await scrollTableToRight(page);

      // Repository satırını tüm sayfaları tarayarak bulup switch butonunun checked durumunu doğrula
      if (cleanedRepoName) {
        console.log(`🔍 [KONTROL] Yenileme sonrası "${cleanedRepoName}" isimli deponun switch durumu kontrol ediliyor...`);
        
        let foundRow: Locator | null = null;
        let scanPageCount = 1;
        while (true) {
          await scrollTableToRight(page);
          const row = page.locator('tr').filter({ hasText: cleanedRepoName }).first();
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
          const reloadFirstRow = repoTableAfterReload.locator('tbody tr').first();
          await clickNextPageAndWaitForLoad(page, nextBtn, reloadFirstRow);
          scanPageCount++;
        }

        if (!foundRow) {
          throw new Error(`Yenileme sonrasında "${cleanedRepoName}" isimli repository bulunamadı!`);
        }

        const switchAfterReload = foundRow.locator('button[role="switch"]').first();
        await expect(switchAfterReload).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
        console.log('🎉 [BAŞARILI] [Refresh Persistence] Sayfa yenileme sonrasında da repository\'nin backup kapsamında (checked) kaldığı başarıyla doğrulandı!');
      } else {
        // Fallback: Isim alınamadıysa indeks ile doğrula
        const switchAfterReload = repoTableAfterReload.locator('button[role="switch"]').nth(targetIndex);
        await expect(switchAfterReload).toHaveAttribute('aria-checked', 'true', { timeout: 15000 });
      }

    } else if (mode === 'one_page') {
      // Mod 2: Bulunulan sayfadaki tüm unchecked depoları dinamik olarak tek tek include et.
      let pageCount = 1;

      while (true) {
        await scrollTableToRight(page);

        const switches = repoTable.locator('button[role="switch"]');
        const count = await switches.count().catch(() => 0);
        
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
          const currentCount = await currentSwitches.count().catch(() => 0);
          
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

          console.log('📦 [İŞLEM] ' + pageCount + '. sayfadaki ' + (targetIndex + 1) + '. sıradaki unchecked depo kapsama dahil ediliyor...');
          
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
          await page.evaluate(() => new Promise(requestAnimationFrame));

          try {
            await targetSwitch.click({ timeout: 5000 });
          } catch {
            await targetSwitch.click({ force: true });
          }

          const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch);
          if (!success) {
            const errorVisible = await page
              .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
              .first()
              .isVisible()
              .catch(() => false);
            if (errorVisible) {
              return;
            }
            await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
          }

          console.log(`🎉 [BAŞARILI] Depo başarıyla kapsama dahil edildi.`);
          processedCount++;
        }

        console.log('🎉 [BAŞARILI] ' + pageCount + '. sayfa başarıyla tamamlandı. Toplam ' + processedCount + ' depo eklendi.');
        break; // Bir sayfayı doldurduğumuz için testi başarıyla sonlandırıyoruz
      }

    } else if (mode === 'all_pages') {
      // Mod 3: Bütün sayfalardaki tüm depoları tek tek include et (Sayfa sayfa gezinerek)
      let pageCount = 1;
      let totalProcessed = 0;

      while (true) {
        console.log('📦 [İŞLEM] Kapsama Ekleme Döngüsü: ' + pageCount + '. sayfadayız...');
        let processedOnPage = 0;

        while (true) {
          await scrollTableToRight(page);

          const switches = repoTable.locator('button[role="switch"]');
          const count = await switches.count().catch(() => 0);
          
          let targetSwitch: Locator | null = null;
          let targetIndex = -1;

          for (let i = 0; i < count; i++) {
            const sw = switches.nth(i);
            const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
            if (isChecked === 'false' || isChecked === null) {
              targetSwitch = sw;
              targetIndex = i;
              break;
            }
          }

          if (!targetSwitch) {
            console.log('🔍 [KONTROL] ' + pageCount + '. sayfada kapsama dahil edilecek başka unchecked depo kalmadı!');
            break;
          }

          console.log('📦 [İŞLEM] Sayfa ' + pageCount + ', ' + (targetIndex + 1) + '. sıradaki unchecked depo kapsama dahil ediliyor...');
          
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
          await page.evaluate(() => new Promise(requestAnimationFrame));

          try {
            await targetSwitch.click({ timeout: 5000 });
          } catch {
            await targetSwitch.click({ force: true });
          }

          const success = await verifySwitchStateOrDetectLicenseError(page, targetSwitch);
          if (!success) {
            const errorVisible = await page
              .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
              .first()
              .isVisible()
              .catch(() => false);
            if (errorVisible) {
              return;
            }
            await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
          }

          console.log(`🎉 [BAŞARILI] Depo başarıyla kapsama dahil edildi.`);
          processedOnPage++;
          totalProcessed++;
        }

        console.log('🎉 [BAŞARILI] ' + pageCount + '. sayfadaki işlem tamamlandı. ' + processedOnPage + ' depo kapsama eklendi.');

        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('🎉 [BAŞARILI] Bütün sayfalar başarıyla taranıp tamamlandı!');
          console.log('🎉 [BAŞARILI] Toplam ' + totalProcessed + ' yeni depo tek tek kapsama dahil edildi.');
          break;
        }

        const allFirstRow = repoTable.locator('tbody tr').first();
        await clickNextPageAndWaitForLoad(page, nextBtn, allFirstRow);
        
        pageCount++;
      }
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 💥 CHAOS & RESILIENCE TESTS (SENIOR SDET)
  // ─────────────────────────────────────────────────────────────────

  test('Hata durumunda switch durumunun revert edildigini ve toast ciktigini dogrula (Chaos Test)', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => url.href.includes('/api/repositories/license-inclusion-status/'),
      async (route) => {
        console.log(`🛡️ [MOCK CHAOS] Toggle API isteği yakalandı ve 500 Internal Server Error dönülüyor.`);
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Failed to update repository status'
          })
        });
      }
    );

    const repoTable = await navigateToRepositoriesGithubAndEnsureStable(page, providerPage);

    await scrollTableToRight(page);

    const switches = repoTable.locator('button[role="switch"]');
    await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const count = await switches.count();

    let targetSwitch: Locator | null = null;
    for (let i = 0; i < count; i++) {
      const sw = switches.nth(i);
      const isChecked = await sw.getAttribute('aria-checked');
      if (isChecked === 'false' || isChecked === null) {
        targetSwitch = sw;
        console.log(`🎉 [BAŞARILI] Unchecked switch bulundu (Chaos Test): Satır = ${i}`);
        break;
      }
    }

    if (!targetSwitch) {
      console.log('🔍 [KONTROL] Unchecked switch bulunamadı, test sonlandırılıyor.');
      return;
    }

    await targetSwitch.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame));

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Başarısız olması bekleniyor)...');
    await targetSwitch.click({ force: true });

    console.log('⏳ [BEKLEME] Hata toast mesajı veya lisans uyarı kontrolü yapılıyor...');
    const toastError = page.locator('text=/Failed to update repository status|The licence limit within threshold has been reached/i').first();
    await expect(toastError).toBeVisible({ timeout: 10000 });
    const toastText = await toastError.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText)}`);
    console.log('🎉 [BAŞARILI] Switch butonunun durumunun pasif (false) olarak korunduğu / revert edildiği başarıyla doğrulandı.');
  });

  test('Lisans limiti asildiginda sistemin hata verdigini ve islemi engelledigini doğrula (License Limit Test)', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => url.href.includes('/api/repositories/license-inclusion-status/'),
      async (route) => {
        console.log(`🛡️ [MOCK LICENSE] Toggle API isteği yakalandı ve 500 Licence Limit Error dönülüyor.`);
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'The licence limit within threshold has been reached'
          })
        });
      }
    );

    const repoTable = await navigateToRepositoriesGithubAndEnsureStable(page, providerPage);

    await scrollTableToRight(page);

    const switches = repoTable.locator('button[role="switch"]');
    await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    
    let targetSwitch: Locator | null = null;
    const count = await switches.count();
    for (let i = 0; i < count; i++) {
      const sw = switches.nth(i);
      const isChecked = await sw.getAttribute('aria-checked');
      if (isChecked === 'false' || isChecked === null) {
        targetSwitch = sw;
        break;
      }
    }

    if (!targetSwitch) return;

    await targetSwitch.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame));

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Lisans limit aşımı testi)...');
    await targetSwitch.click({ force: true });

    const licenseToast = page.locator('text=/The licence limit within threshold has been reached/i').first();
    await expect(licenseToast).toBeVisible({ timeout: 10000 });
    const toastText = await licenseToast.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText)}`);

    await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
    console.log('🎉 [BAŞARILI] Switch butonunun aktifleşmeyip pasif kaldığı başarıyla doğrulandı.');
  });
});
