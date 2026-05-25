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

test.describe('Repositories - GitHub Exclude Selected', () => {
  test('secili repolar exclude edilmeli', async ({ page }) => {
    test.setTimeout(180000); // 3 dakikalık geniş zaman aşımı
    const providerPage = new ProviderPage(page);

    const mode = process.env.E2E_EXCLUDE_MODE || 'one_repo';
    console.log(`🚀 GitHub Repositories Exclude Testi başlatılıyor. Kapsam Modu: ${mode}`);

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
      // Mod 1: Tek bir repoyu exclude et (Switch butonu ile)
      let targetSwitch: Locator | null = null;
      let pageCount = 1;

      while (true) {
        console.log(`🔍 ${pageCount}. sayfada checked (aria-checked=true) switch aranıyor...`);
        const switches = repoTable.locator('button[role="switch"]');
        await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        const count = await switches.count();

        for (let i = 0; i < count; i++) {
          const sw = switches.nth(i);
          const isChecked = await sw.getAttribute('aria-checked');
          if (isChecked === 'true' || isChecked === 'checked') {
            targetSwitch = sw;
            console.log(`🎯 Checked switch bulundu: Sayfa = ${pageCount}, Satır dizini = ${i}`);
            break;
          }
        }

        if (targetSwitch) {
          break;
        }

        console.log(`ℹ️ ${pageCount}. sayfadaki tüm depolar zaten exclude edilmiş (devre dışı).`);
        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('📢 Bütün sayfalar exclude edilmiş!');
          console.log('🎉 Test başarıyla tamamlandı (Tüm depolar zaten hariç tutulmuş durumda).');
          await page.waitForTimeout(3000);
          return;
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

      console.log('👆 Switch butonuna tıklanıyor (Devre dışı bırakmak için)...');
      try {
        await targetSwitch.click({ timeout: 5000 });
      } catch {
        await targetSwitch.click({ force: true });
      }
      console.log('✅ Switch butonuna tıklandı!');

      // Varsa onay modalını onayla
      const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
      if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
        console.log('👆 Onay modalında "Yes, Exclude" butonuna tıklanıyor...');
        await confirmBtn.click({ force: true });
      }

      console.log('⏳ Tıklanan Switch butonunun pasif (checked / false) duruma gelmesi bekleniyor...');
      await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
      
      console.log('🎉 Başarıyla switch butonu ile repository backup kapsamından çıkarıldı (Exclude edildi)!');
      await page.waitForTimeout(3000);

    } else if (mode === 'one_page') {
      // Mod 2: Bulunulan sayfadaki tüm checked depoları dinamik olarak tek tek exclude et
      console.log('🔍 Sayfadaki tüm checked switch’ler dinamik olarak taranıyor...');
      let processedCount = 0;

      while (true) {
        const switches = repoTable.locator('button[role="switch"]');
        const count = await switches.count().catch(() => 0);
        
        let targetSwitch: Locator | null = null;
        let targetIndex = -1;

        for (let i = 0; i < count; i++) {
          const sw = switches.nth(i);
          const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
          if (isChecked === 'true' || isChecked === 'checked') {
            targetSwitch = sw;
            targetIndex = i;
            break;
          }
        }

        if (!targetSwitch) {
          console.log('📢 Sayfada kapsam dışı bırakılacak başka checked depo kalmadı!');
          break;
        }

        console.log(`👉 Sayfadaki ${targetIndex + 1}. sıradaki checked depo kapsam dışına çıkarılıyor...`);
        
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

        // Onay modalını bekle ve tıkla
        const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
        if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
          console.log('👆 Onay modalında "Yes, Exclude" butonuna tıklanıyor...');
          await confirmBtn.click({ force: true });
        }

        // Durumun pasifleşmesini (checked = false) bekliyoruz
        await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
        console.log(`✅ Depo başarıyla kapsam dışına çıkarıldı.`);
        await page.waitForTimeout(1200);
        processedCount++;
      }

      console.log(`📢 Sayfa sonu işlem tamamlandı. Toplam ${processedCount} depo tek tek kapsam dışına çıkarıldı.`);
      await page.waitForTimeout(3000);

    } else if (mode === 'all_pages') {
      // Mod 3: Bütün sayfalardaki tüm depoları tek tek exclude et (Sayfa sayfa gezinerek)
      let pageCount = 1;
      let totalProcessed = 0;

      while (true) {
        console.log(`📄 Kapsam Dışı Bırakma Döngüsü: ${pageCount}. sayfadayız...`);
        let processedOnPage = 0;

        while (true) {
          const switches = repoTable.locator('button[role="switch"]');
          const count = await switches.count().catch(() => 0);
          
          let targetSwitch: Locator | null = null;
          let targetIndex = -1;

          for (let i = 0; i < count; i++) {
            const sw = switches.nth(i);
            const isChecked = await sw.getAttribute('aria-checked').catch(() => null);
            if (isChecked === 'true' || isChecked === 'checked') {
              targetSwitch = sw;
              targetIndex = i;
              break;
            }
          }

          if (!targetSwitch) {
            console.log(`📢 ${pageCount}. sayfada kapsam dışı bırakılacak başka checked depo kalmadı!`);
            break;
          }

          console.log(`👉 Sayfa ${pageCount}, ${targetIndex + 1}. sıradaki checked depo kapsam dışına çıkarılıyor...`);
          
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

          const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
          if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
            await confirmBtn.click({ force: true });
          }

          await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 15000 });
          console.log(`✅ Depo başarıyla kapsam dışına çıkarıldı.`);
          await page.waitForTimeout(1200);
          processedOnPage++;
          totalProcessed++;
        }

        console.log(`📢 ${pageCount}. sayfadaki işlem tamamlandı. ${processedOnPage} depo kapsam dışına çıkarıldı.`);

        const nextBtn = await getNextPageButton(page);
        const hasNext = await hasNextPage(nextBtn);

        if (!hasNext) {
          console.log('📢 Bütün sayfalar başarıyla taranıp tamamlandı!');
          console.log(`🎉 Toplam ${totalProcessed} depo tek tek kapsam dışına çıkarıldı.`);
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
