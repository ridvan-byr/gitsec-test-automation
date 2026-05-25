import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

async function saveGithubSession() {
  const authFile = path.join(process.cwd(), 'playwright', '.auth', 'github.json');
  
  // Create dir if not exists
  fs.mkdirSync(path.dirname(authFile), { recursive: true });

  console.log('GitHub Login sayfasina yonlendiriliyorsunuz...');
  console.log('Lutfen kullanici adi ve sifrenizle giris yapin.');
  console.log('Eger "Device Verification" (Cihaz Dogrulama) kodu istenirse, mailinize gelen kodu girin.');
  console.log('Giris islemi tamamlandiktan sonra, tarayici otomatik kapanacak ve session kaydedilecektir.');
  console.log('Lutfen tarayiciyi KENDINIZ KAPATMAYIN, giris yaptiktan sonra beklemeniz yeterlidir.');

  const browser = await chromium.launch({ headless: false }); // Headed mode
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://github.com/login');

  // Login isleminin bittigini anlamak icin GitHub anasayfasindaki (veya dashboard) belli bir URL'ye gecmesini bekliyoruz
  // Kullanici giris yapinca github.com'a yonlendirilir. Ekranda "dashboard" divi ya da user menusu cikar.
  try {
    // 3 dakika (180 saniye) sure verelim, mail gelmesi ve kodu girmek biraz vakit alabilir.
    await page.waitForURL('https://github.com/', { timeout: 180000 });
    
    // Emin olmak icin ufak bir bekleme (bazen yonlendirme tam bitmeden state kaydedilebiliyor)
    await page.waitForTimeout(3000);
    
    await context.storageState({ path: authFile });
    console.log(`\nBASARILI! GitHub session bilgileri basariyla kaydedildi: ${authFile}`);
    console.log('Artik testlerinizi calistirabilirsiniz. global-setup.ts otomatik olarak bu dosyayi kullanacaktir.');
  } catch (error) {
    console.error('\nHATA: Giris yapilamadi veya zaman asimina ugradi. Lutfen tekrar deneyin.', error);
  } finally {
    await browser.close();
  }
}

saveGithubSession().catch(console.error);
