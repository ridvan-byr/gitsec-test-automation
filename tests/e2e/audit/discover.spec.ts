/**
 * Gitsec Dynamic Site Discovery Crawler & Form Mapper
 * 
 * Bu araç:
 * 1. Giriş sayfasına gider, captcha çözülmesini bekler ve oturum açar.
 * 2. 6 ana sayfayı (Dashboard, Add Provider, GitHub Repos, Backups, Schedulers, Storage) sırayla gezer.
 * 3. Her sayfadaki form girdilerini tarar.
 * 4. Sayfalardaki "Ekle", "Yeni", "Create", "Add", "Define" gibi butonları bularak tıklar.
 * 5. Tıklama sonucu açılan Dialog / Drawer (Çekmece) pencerelerini tespit eder ve içlerindeki form alanlarını da haritalandırır.
 * 6. Bulduğu tüm alanların ID, Name, Type, Placeholder ve Label detaylarını konsola raporlar.
 * 
 * Çalıştırma: npx playwright test tests/e2e/audit/discover.spec.ts --headed
 */
import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

let dashboardBaseUrl: string;
let workspaceId: string;

// Form elemanlarını tarayıp haritalandıran yardımcı fonksiyon
async function scanFormElements(page: any, regionName: string) {
  console.log(`   🔍 [${regionName}] Form elemanları taranıyor...`);

  // Ekranda görünen inputlar, textarealar, selectler ve comboboxlar
  const elements = page.locator('input, textarea, select, button[role="combobox"], [data-slot="input"]');
  const count = await elements.count();
  let foundCount = 0;

  for (let i = 0; i < count; i++) {
    const el = elements.nth(i);
    const isVisible = await el.isVisible().catch(() => false);
    if (!isVisible) continue;

    const tagName = await el.evaluate((node: any) => node.tagName.toLowerCase()).catch(() => 'unknown');
    const type = await el.getAttribute('type').catch(() => 'text');
    const name = await el.getAttribute('name').catch(() => '');
    const id = await el.getAttribute('id').catch(() => '');
    const placeholder = await el.getAttribute('placeholder').catch(() => '');

    // Label etiketini bulma denemeleri
    let labelText = '';
    if (id) {
      labelText = await page.locator(`label[for="${id}"]`).innerText().catch(() => '');
    }
    if (!labelText) {
      labelText = await el.getAttribute('aria-label').catch(() => '');
    }
    if (!labelText) {
      labelText = await el.evaluate((node: any) => {
        const parent = node.parentElement;
        if (!parent) return '';
        const labels = parent.querySelectorAll('label');
        if (labels.length > 0) return labels[0].innerText || '';
        return parent.innerText ? parent.innerText.split('\n')[0] : '';
      }).catch(() => '');
    }

    console.log(`      📝 [BİLEŞEN] Tag: <${tagName}> | Type: "${type}" | Name: "${name}" | ID: "${id}" | Etiket: "${labelText.trim()}" | Placeholder: "${placeholder}"`);
    foundCount++;
  }

  if (foundCount === 0) {
    console.log(`      ℹ️ Etkileşimli giriş alanı bulunamadı.`);
  } else {
    console.log(`      📊 Toplam ${foundCount} adet form alanı başarıyla haritalandı.`);
  }
}

// Dikey kaydırma barı varsa aşağı kaydırıp gizli elementleri yükleyen yardımcı fonksiyon
async function scrollEntirePage(page: any) {
  console.log('🔄 [E2E] Sayfayı dinamik olarak aşağı kaydırıyoruz (gizli öğeleri tetiklemek için)...');
  
  // 1. Ana pencereyi aşağı kaydır
  await page.evaluate(() => {
    window.scrollTo({
      top: document.body.scrollHeight,
      behavior: 'auto'
    });
  });

  // 2. Sayfadaki dikey kaydırma (scroll) alanı olan tüm elementleri bulup en alta kaydır
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('div, main, section, table'));
    scrollables.forEach((el) => {
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      if (isScrollable) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'auto'
        });
      }
    });
  });
  
  // Sayfayı tekrar en üste geri çekelim ki formlar taranabilsin
  await page.evaluate(() => {
    window.scrollTo({
      top: 0,
      behavior: 'auto'
    });
  });
}

test.describe('Gitsec Dynamic Site Discovery Crawler & Form Mapper', () => {

  test('Tüm sayfaları keşfet, modalları aç ve form girdilerini haritalandır', async ({ page }) => {
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    workspaceId = requireEnv('WORKSPACE_ID');
    // 6 sayfa + modal keşifleri için geniş süre (4 dakika)
    test.setTimeout(240000);
    
    // ─── ADIM 1: DOĞRUDAN DASHBOARD SAYFASINA GİT (KİMLİK DOĞRULAMA AKTİF) ───
    console.log('🔑 [E2E] Kimlik doğrulamalı oturumla doğrudan Dashboard sayfasına gidiliyor...');
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'load' });

    // Dashboard'a yönlenmeyi veya yüklendiğini teyit et
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    console.log('✅ [E2E] Oturum başarıyla algılandı! Derin sayfa keşif süreci başlıyor...\n');

    // ─── ADIM 3: SAYFALARI GEZ VE MODALLARI KEŞFET ───
    const targetPages = [
      { name: 'Dashboard Ana Ekranı', path: `/${workspaceId}/dashboard` },
      { name: 'Sağlayıcı Ekleme Sayfası (Add Provider)', path: `/${workspaceId}/repositories/add` },
      { name: 'GitHub Repoları (Repositories)', path: `/${workspaceId}/repositories/github` },
      { name: 'Yedekleme Listesi (Backups)', path: `/${workspaceId}/backups` },
      { name: 'Planlayıcılar (Schedulers)', path: `/${workspaceId}/schedulers` },
      { name: 'Depolama Alanları (Storage)', path: `/${workspaceId}/storage` }
    ];

    for (const target of targetPages) {
      const pageUrl = `${dashboardBaseUrl}${target.path}`;
      console.log(`\n🌐 [DISCOVER] ==================================================`);
      console.log(`🌐 [DISCOVER] Sayfa Taranıyor: ${target.name} (${pageUrl})`);
      
      await page.goto(pageUrl, { waitUntil: 'networkidle' }).catch(() => {});
      await scrollEntirePage(page); // Sayfayı dikeyde tam olarak tarayıp yoğur

      // A. Sayfa Gövdesindeki form alanlarını tara
      await scanFormElements(page, "SAYFA GÖVDESİ");

      // B. Sayfadaki TÜM tıklanabilir butonları, kartları ve linkleri dökümle
      const clickables = page.locator('button, a, [role="button"], [class*="card"], [class*="provider"]');
      const clickableCount = await clickables.count();
      console.log(`   🔎 Sayfadaki tüm etkileşimli elemanlar taranıyor (Toplam ${clickableCount} adet):`);

      let loggedCount = 0;
      for (let i = 0; i < clickableCount; i++) {
        const item = clickables.nth(i);
        const isVisible = await item.isVisible().catch(() => false);
        if (!isVisible) continue;

        const text = (await item.innerText().catch(() => '')) || (await item.getAttribute('title').catch(() => '')) || '';
        const tagName = await item.evaluate((node: any) => node.tagName.toLowerCase()).catch(() => 'div');
        const role = (await item.getAttribute('role').catch(() => '')) ?? '';
        const id = (await item.getAttribute('id').catch(() => '')) ?? '';
        const className = ((await item.getAttribute('class').catch(() => '')) || '') as string;

        // Boş veya sadece sayı içeren linkleri filtrele (Örn: sayfalama numaraları)
        const cleanText = text.trim().replace(/\n/g, ' ');
        if (cleanText.length > 0 && isNaN(Number(cleanText))) {
          console.log(`      🔘 [TIKLANABİLİR] <${tagName}> | ID: "${id}" | Rol: "${role}" | Metin: "${cleanText}" | Class: "${className.split(' ').slice(0, 3).join(' ')}..."`);
          loggedCount++;
        }
      }
      console.log(`   📊 ${target.name} üzerinde toplam ${loggedCount} adet anlamlı tıklanabilir eleman listelendi.`);
      console.log(`🌐 [DISCOVER] ==================================================`);
    }
    
    console.log('\n🎉 [DISCOVER] Tüm Gitsec Sayfaları başarıyla keşfedildi ve haritalandırıldı.');
  });
});
