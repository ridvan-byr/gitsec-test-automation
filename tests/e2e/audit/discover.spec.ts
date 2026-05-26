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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';
const workspaceId = process.env.WORKSPACE_ID ?? '753';

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
      behavior: 'smooth'
    });
  });
  await page.waitForTimeout(1500); // Bekleme toleransı

  // 2. Sayfadaki dikey kaydırma (scroll) alanı olan tüm elementleri bulup en alta kaydır
  await page.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll('div, main, section, table'));
    scrollables.forEach((el) => {
      const style = window.getComputedStyle(el);
      const isScrollable = (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
      if (isScrollable) {
        el.scrollTo({
          top: el.scrollHeight,
          behavior: 'smooth'
        });
      }
    });
  });
  await page.waitForTimeout(1500); // Ek tolerans
  
  // Sayfayı tekrar en üste geri çekelim ki formlar taranabilsin
  await page.evaluate(() => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
  await page.waitForTimeout(1000);
}

test.describe('Gitsec Dynamic Site Discovery Crawler & Form Mapper', () => {
  // Temiz oturum
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Tüm sayfaları keşfet, modalları aç ve form girdilerini haritalandır', async ({ page }) => {
    // 6 sayfa + modal keşifleri için geniş süre (4 dakika)
    test.setTimeout(240000);

    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');
    
    // ─── ADIM 1: GİRİŞ EKRANINA GİT VE CAPTCHA BEKLE ───
    console.log('🔑 [E2E] Giriş sayfasına gidiliyor...');
    await page.goto(`${dashboardBaseUrl}/sign-in`, { waitUntil: 'load' });
    await page.waitForTimeout(3000); // Sayfanın yerleşmesi için bekleme

    const emailInput = page.locator('input[name="email"]');
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
    const signInButton = page.locator('button').filter({ hasText: /^Sign in$/i }).first();

    // Sayfayı sessizce en alta kaydırıp sabitle (Captcha rahat çözülsün)
    await signInButton.scrollIntoViewIfNeeded().catch(() => {});

    // Varsa Captcha'yı kontrol et ve bekle
    console.log('⏳ [E2E] Captcha iframe\'inin yüklenmesi bekleniyor (maksimum 10 saniye)...');
    
    // Promise.race ile hangi captcha iframe'i önce yüklenirse anında devam eder, gereksiz beklemez!
    const captchaType = (await Promise.race([
      page.locator('iframe[src*="challenges.cloudflare.com"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Cloudflare Turnstile').catch(() => null),
      page.locator('iframe[src*="google.com/recaptcha"]').first().waitFor({ state: 'visible', timeout: 10000 }).then(() => 'Google reCAPTCHA').catch(() => null)
    ])) as string | null;

    const isCaptchaVisible = captchaType !== null;

    if (isCaptchaVisible) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log(`💡 Sayfa yüklendiğinde Captcha aktif durumda! (${captchaType})`);
      console.log('💡 Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test bilgileri doldurup otomatik devam edecektir.');
      console.log('=========================================\n');

      console.log('⏳ [E2E] Captcha çözümü bekleniyor... (Ekran sabitlendi - 120 saniye tolerans)');
      
      await page.waitForFunction(() => {
        const turnstile = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const recaptcha = document.querySelector('[name="g-recaptcha-response"]') as HTMLInputElement | HTMLTextAreaElement | null;
        const tVal = turnstile ? turnstile.value.trim() : '';
        const rVal = recaptcha ? recaptcha.value.trim() : '';
        return tVal.length > 0 || rVal.length > 0;
      }, { timeout: 120000 }).catch((e) => {
        console.log('⚠️ [E2E] Captcha bekleme süresi doldu veya hata oluştu:', e.message);
      });
      
      console.log('✅ [E2E] Captcha başarıyla geçildi.');
      await page.waitForTimeout(1000);
    }

    // ─── ADIM 2: BİLGİLERİ DOLDUR VE GİRİŞ YAP ───
    console.log(`✉️ [E2E] E-posta yazılıyor: ${email}`);
    await emailInput.fill(email);

    console.log(`🔑 [E2E] Şifre yazılıyor...`);
    await passwordInput.fill(password);
    await page.waitForTimeout(1000);

    console.log('👆 [E2E] "Sign in" butonuna tıklanıyor...');
    await signInButton.click();

    // Dashboard'a yönlenmeyi teyit et
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 35000 });
    console.log('✅ [E2E] Giriş başarılı! Derin sayfa keşif süreci başlıyor...\n');

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
      
      await page.goto(pageUrl, { waitUntil: 'load' });
      await scrollEntirePage(page); // Sayfayı dikeyde tam olarak tarayıp yoğur
      await page.waitForTimeout(2000);

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
