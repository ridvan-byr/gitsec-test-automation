import { test as base, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ProviderPage } from '../pages/ProviderPage';
import { StoragePage } from '../pages/StoragePage';
import { RestorePage } from '../pages/RestorePage';

// Tespit edilen arka plan hatalarının veri yapısı
interface DetectedError {
  type: 'JSException' | 'ConsoleError' | 'ConsoleWarning' | 'NetworkFailure';
  source: string;
  message: string;
}

interface GitSecFixtures {
  loginPage: LoginPage;
  registerPage: RegisterPage;
  providerPage: ProviderPage;
  storagePage: StoragePage;
  restorePage: RestorePage;
}

export const test = base.extend<GitSecFixtures>({
  page: async ({ page }, use) => {
    const errors: DetectedError[] = [];

    // 1. Sayfa üzerindeki tüm yakalanamayan JavaScript hatalarını (Exception) dinle
    page.on('pageerror', (exception) => {
      errors.push({
        type: 'JSException',
        source: page.url(),
        message: exception.stack || exception.message || String(exception)
      });
    });

    // 2. Konsola düşen tüm Hataları dinle (Uyarılar bilerek atlandı)
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') {
        errors.push({
          type: 'ConsoleError',
          source: page.url(),
          message: msg.text()
        });
      }
    });

    // 3. Ağ (Network) isteklerinde oluşan hataları dinle (Sunucu kesintileri, timeout vb. - İptal edilen Next.js istekleri hariç)
    page.on('requestfailed', (request) => {
      const url = request.url();
      const errText = request.failure()?.errorText || '';
      if (
        !url.startsWith('chrome-extension://') &&
        !url.includes('google-analytics') &&
        errText !== 'net::ERR_ABORTED'
      ) {
        errors.push({
          type: 'NetworkFailure',
          source: url,
          message: errText || 'Network request failed'
        });
      }
    });

    // 4. Çöken API yanıtlarını dinle (HTTP Status >= 400)
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !url.includes('google-analytics')) {
        errors.push({
          type: 'NetworkFailure',
          source: url,
          message: `HTTP Status ${status} - ${response.statusText()}`
        });
      }
    });

    // Test onboarding skip script'ini kur (Shadcn ve localStorage onboarding bypass)
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          'gs-tour',
          JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
        );
      } catch {
        // ignore
      }
    }).catch(() => {});

    // Testi koştur
    await use(page);

    // Test sonlandıktan sonra detaylı Raporlama yap (Log)
    const testInfo = test.info();
    console.log(`\n======================================================================`);
    console.log(`🔍 [AUDIT] "${testInfo.title}" Testi Arka Plan Hata Denetimi:`);
    
    if (errors.length > 0) {
      console.log(`❌ DİKKAT: Test başarıyla hedefine ulaşsa da ${errors.length} adet gizli hata/uyarı yakalandı!\n`);
      errors.forEach((err, index) => {
        console.log(`   [${index + 1}] TİP: ${err.type}`);
        console.log(`       KAYNAK: ${err.source}`);
        console.log(`       MESAJ : ${err.message}`);
        console.log(`       --------------------------------------------------------------`);
      });
      console.log(`======================================================================\n`);
      // Gizli hataları görünmez bırakmamak için testi fail et.
      expect(errors, 'Background JS/console/network errors were detected during test execution').toHaveLength(0);
    } else {
      console.log(`✅ TEMİZ RAPOR: Harika! Test esnasında arayüzde hiçbir gizli JS hatası,`);
      console.log(`   konsol uyarısı veya çöken API isteği (Network/400-500) TESPİT EDİLMEDİ.`);
      console.log(`======================================================================\n`);
    }
  },
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  registerPage: async ({ page }, use) => {
    await use(new RegisterPage(page));
  },
  providerPage: async ({ page }, use) => {
    await use(new ProviderPage(page));
  },
  storagePage: async ({ page }, use) => {
    await use(new StoragePage(page));
  },
  restorePage: async ({ page }, use) => {
    await use(new RestorePage(page));
  }
});

export { expect };

