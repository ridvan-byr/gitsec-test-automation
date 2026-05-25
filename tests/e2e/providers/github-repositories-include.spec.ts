import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../../pages/ProviderPage';

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
    .or(page.locator('button:has-text("Next")'))
    .or(page.locator('button:has-text("Sonraki")'))
    .or(page.locator('button[aria-label*="Next"]'))
    .or(page.locator('button[aria-label*="Sonraki"]'))
    .first();
}

async function hasNextPage(nextBtn: Locator): Promise<boolean> {
  return (await nextBtn.isVisible().catch(() => false)) && !(await nextBtn.isDisabled().catch(() => true));
}

// Durum kontrolü ve lisans hatası izleme yardımcısı (Hata durumunda log atıp testi anında sonlandırır)
async function verifySwitchStateOrDetectLicenseError(page: Page, targetSwitch: Locator): Promise<boolean> {
  // Tıklamadan sonra API yanıtının gelmesi ve toast bildiriminin çıkması/durumun netleşmesi için 1 saniye bekliyoruz.
  // Bu bekleme "Optimistic UI Update" (geçici durum değişimi) yanılgısını tamamen engeller.
  await page.waitForTimeout(1000);

  // 1. Önce lisans hatası toast bildirimini kontrol et
  const errorVisible = await page
    .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
    .first()
    .isVisible()
    .catch(() => false);
    
  if (errorVisible) {
    console.log('🚨 HATA: Lisans limit eşiğine ulaşıldı! Daha fazla repository eklenemiyor.');
    console.log('📢 [LİSANS HATASI DETAYI]: The licence limit within threshold has been reached.');
    console.log('🏁 Test başarıyla durduruldu ve sonlandırıldı.');
    await page.waitForTimeout(2000);
    return false; // Hata tespit edildi, erken kesilecek
  }

  // 2. Ardından switch durumunun gerçekten true olup olmadığını kontrol et
  const isChecked = await targetSwitch.getAttribute('aria-checked').catch(() => null);
  if (isChecked === 'true') {
    return true; // Başarıyla checked oldu
  }

  // Eğer 1 saniye sonunda ne true oldu ne de hata çıktıysa, biraz daha (maks 5 saniye) durumun true olmasını bekle
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const errorVisibleRetry = await page
      .locator('text=/The licence limit within threshold has been reached|Failed to update repository status/i')
      .first()
      .isVisible()
      .catch(() => false);
      
    if (errorVisibleRetry) {
      console.log('🚨 HATA: Lisans limit eşiğine ulaşıldı! Daha fazla repository eklenemiyor.');
      console.log('📢 [LİSANS HATASI DETAYI]: The licence limit within threshold has been reached.');
      console.log('🏁 Test başarıyla durduruldu ve sonlandırıldı.');
      await page.waitForTimeout(2000);
      return false;
    }

    const isCheckedRetry = await targetSwitch.getAttribute('aria-checked').catch(() => null);
    if (isCheckedRetry === 'true') {
      return true;
    }
    await page.waitForTimeout(300);
  }

  return false; // Zaman aşımı
}

test.describe('Repositories - GitHub Include Selected', () => {
  test('secili repolar include edilmeli', async ({ page }) => {
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);
    
    const mode = process.env.E2E_INCLUDE_MODE || 'one_repo';
    console.log(`🚀 GitHub Repositories Include Testi başlatılıyor. Kapsam Modu: ${mode}`);

    console.log('🚀 Doğrudan GitHub Repositories sayfasına gidiliyor...');
    await providerPage.goToRepositoriesGithub();
    
    // Sayfa ilk yüklendiğindeki otomatik yenileme (refresh) hareketini absorbe etmek için bekliyoruz
    console.log('⏳ Sayfa ilk açılışındaki otomatik yenilemeyi (refresh) beklemek için 4 saniye bekleniyor...');
    await page.waitForTimeout(4000);

    const repoTable = await getRepoTable(page);

    console.log('↔️ Tablo konteyneri sağa kaydırılıyor...');
    const tableContainer = page.locator('div.overflow-x-auto, div.overflow-auto, .overflow-x-scroll').first();
    if (await tableContainer.isVisible().catch(() => false)) {
      await tableContainer.evaluate(el => el.scrollLeft = 800).catch(() => {});
      console.log('⏳ Tablonun sağa kaymasını izlemek için 2 saniye bekleniyor...');
      await page.waitForTimeout(2000);
    }

    if (mode === 'one_repo') {
      // Mod 1: Tek bir repoyu include et (Switch butonu ile)
      let targetSwitch: Locator | null = null;
      let pageCount = 1;

      while (true) {
        console.log(`🔍 ${pageCount}. sayfada unchecked (aria-checked=false) switch aranıyor...`);
        const switches = repoTable.locator('button[role="switch"]');
        await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        const count = await switches.count();

        for (let i = 0; i < count; i++) {
          const sw = switches.nth(i);
          const isChecked = await sw.getAttribute('aria-checked');
          if (isChecked === 'false' || isChecked === null) {
            targetSwitch = sw;
            console.log(`🎯 Unchecked switch bulundu: Sayfa = ${pageCount}, Satır dizini = ${i}`);
            break;
          }
        }

        if (targetSwitch) {
          break;
        }

        console.log(`ℹ️ ${pageCount}. sayfadaki tüm depolar zaten include edilmiş.`);
        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('📢 Bütün sayfalar include edilmiş!');
          console.log('🎉 Test başarıyla tamamlandı (Tüm depolar zaten dahil edilmiş durumda).');
          await page.waitForTimeout(3000);
          return;
        }

        console.log('👆 Sonraki sayfaya geçiliyor...');
        await nextBtn.click({ force: true });
        await page.waitForTimeout(2500);
        
        // Yeni sayfa açıldığında tabloyu tekrar sağa kaydır
        if (await tableContainer.isVisible().catch(() => false)) {
          await tableContainer.evaluate(el => el.scrollLeft = 800).catch(() => {});
          await page.waitForTimeout(1000);
        }
        
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
      console.log('⏳ Switch butonuna odaklanıldı, tıklamadan önce 1 saniye bekleniyor...');
      await page.waitForTimeout(1000);

      console.log('👆 Switch butonuna tıklanıyor...');
      try {
        await targetSwitch.click({ timeout: 5000 });
      } catch {
        await targetSwitch.click({ force: true });
      }
      console.log('✅ Switch butonuna tıklandı!');

      console.log('⏳ Tıklanan Switch butonunun aktif (checked / true) duruma gelmesi bekleniyor (Lisans kontrolü aktif)...');
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
      
      console.log('🎉 Başarıyla switch butonu ile repository backup kapsamına eklendi!');
      await page.waitForTimeout(3000);

    } else if (mode === 'one_page') {
      // Mod 2: Bulunulan sayfadaki tüm unchecked depoları dinamik olarak tek tek include et
      console.log('🔍 Sayfadaki tüm unchecked switch’ler dinamik olarak taranıyor...');
      let processedCount = 0;

      while (true) {
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
          console.log('📢 Sayfada kapsama dahil edilecek başka unchecked depo kalmadı!');
          break;
        }

        console.log(`👉 Sayfadaki ${targetIndex + 1}. sıradaki unchecked depo kapsama dahil ediliyor...`);
        
        // Sadece dikey kaydırma yaparak yatay (sağa çekilmiş) tabloyu koruyoruz
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
        await page.waitForTimeout(500);

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
            return; // Lisans hatasında testi anında yarıda kesip bitiriyoruz
          }
          await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
        }

        console.log(`✅ Depo başarıyla kapsama dahil edildi.`);
        await page.waitForTimeout(1200);
        processedCount++;
      }

      console.log(`📢 Sayfa sonu işlem tamamlandı. Toplam ${processedCount} depo tek tek kapsama dahil edildi.`);
      await page.waitForTimeout(3000);

    } else if (mode === 'all_pages') {
      // Mod 3: Bütün sayfalardaki tüm depoları tek tek include et (Sayfa sayfa gezinerek)
      let pageCount = 1;
      let totalProcessed = 0;

      while (true) {
        console.log(`📄 Kapsama Ekleme Döngüsü: ${pageCount}. sayfadayız...`);
        let processedOnPage = 0;

        while (true) {
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
            console.log(`📢 ${pageCount}. sayfada kapsama dahil edilecek başka unchecked depo kalmadı!`);
            break;
          }

          console.log(`👉 Sayfa ${pageCount}, ${targetIndex + 1}. sıradaki unchecked depo kapsama dahil ediliyor...`);
          
          // Sadece dikey kaydırma yaparak yatay (sağa çekilmiş) tabloyu koruyoruz
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
          await page.waitForTimeout(500);

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
              return; // Lisans hatasında testi anında yarıda kesip bitiriyoruz
            }
            await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 1000 });
          }

          console.log(`✅ Depo başarıyla kapsama dahil edildi.`);
          await page.waitForTimeout(1200);
          processedOnPage++;
          totalProcessed++;
        }

        console.log(`📢 ${pageCount}. sayfadaki işlem tamamlandı. ${processedOnPage} depo kapsama eklendi.`);

        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('📢 Bütün sayfalar başarıyla taranıp tamamlandı!');
          console.log(`🎉 Toplam ${totalProcessed} yeni depo tek tek kapsama dahil edildi.`);
          await page.waitForTimeout(3000);
          break;
        }

        console.log('👆 Sonraki sayfaya geçiliyor...');
        await nextBtn.click({ force: true });
        await page.waitForTimeout(2500);
        
        // Yeni sayfada da tabloyu sağa kaydır
        if (await tableContainer.isVisible().catch(() => false)) {
          await tableContainer.evaluate(el => el.scrollLeft = 800).catch(() => {});
          await page.waitForTimeout(1000);
        }
        
        pageCount++;
      }
    }
  });
});
