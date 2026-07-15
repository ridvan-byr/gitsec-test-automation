import { test as base, expect, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { ProviderPage } from '../pages/ProviderPage';
import { StoragePage } from '../pages/StoragePage';
import { RestorePage } from '../pages/RestorePage';

// GitSec custom page interface to eliminate 'any' type castings
export interface GitSecPage extends Page {
  ignoredErrors?: (string | RegExp)[];
}

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
        const text = msg.text();
        if (text.includes('MISSING_MESSAGE')) return;

        const isIgnored = ((page as GitSecPage).ignoredErrors || []).some((pattern: string | RegExp) => {
          if (typeof pattern === 'string') return text.includes(pattern) || page.url().includes(pattern);
          return pattern.test(text) || pattern.test(page.url());
        });
        if (isIgnored) return;

        errors.push({
          type: 'ConsoleError',
          source: page.url(),
          message: text
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
        const isIgnored = ((page as GitSecPage).ignoredErrors || []).some((pattern: string | RegExp) => {
          if (typeof pattern === 'string') return url.includes(pattern) || errText.includes(pattern);
          return pattern.test(url) || pattern.test(errText);
        });
        if (isIgnored) return;

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
        const isIgnored = ((page as GitSecPage).ignoredErrors || []).some((pattern: string | RegExp) => {
          if (typeof pattern === 'string') return url.includes(pattern);
          return pattern.test(url);
        });
        if (isIgnored) return;

        errors.push({
          type: 'NetworkFailure',
          source: url,
          message: `HTTP Status ${status} - ${response.statusText()}`
        });
      }
    });

    // Test onboarding skip script'ini kur (Shadcn ve localStorage onboarding bypass) ve toast pointer-events engellemesini yap
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem(
          'gs-tour',
          JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
        );
      } catch {
        // ignore
      }

      try {
        const style = document.createElement('style');
        style.textContent = `
          [class*="toast"], [id*="toast"], div[role="status"], .toast {
            pointer-events: none !important;
          }
        `;
        document.documentElement.appendChild(style);

        const observer = new MutationObserver(() => {
          if (!document.head.contains(style) && document.documentElement) {
            document.documentElement.appendChild(style);
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch {
        // ignore
      }
    }).catch(() => {});

    try {
      // Testi koştur
      await use(page);
    } finally {
      // Test sonlandıktan sonra detaylı Raporlama yap (Log)
      const testInfo = test.info();
      const hasErrors = errors.length > 0;

      console.log(`\n======================================================================`);
      console.log(`🔍 [AUDIT] "${testInfo.title}" Testi Arka Plan Hata Denetimi:`);
      
      if (hasErrors) {
        console.log(`❌ DİKKAT: Test sürecinde ${errors.length} adet arka plan hatası/uyarısı yakalandı!\n`);
        errors.forEach((err, index) => {
          console.log(`   [${index + 1}] TİP: ${err.type}`);
          console.log(`       KAYNAK: ${err.source}`);
          console.log(`       MESAJ : ${err.message}`);
          console.log(`       --------------------------------------------------------------`);
        });
      } else {
        console.log(`✅ TEMİZ RAPOR: Harika! Test esnasında arayüzde hiçbir gizli JS hatası,`);
        console.log(`   konsol uyarısı veya çöken API isteği (Network/400-500) TESPİT EDİLMEDİ.`);
      }
      console.log(`======================================================================\n`);

      // Test başarısız/timeout olduysa ve arka planda hata varsa bilgilendirme yap
      if (testInfo.status === 'failed' || testInfo.status === 'timedOut') {
        if (hasErrors) {
          console.log(`🚨 [SİTE/SUNUCU HATASI TESPİT EDİLDİ] Test '${testInfo.title}' başarısız oldu. Arka planda web sitesi/sunucu kaynaklı hatalar tespit edildi. Sorun büyük olasılıkla test kodunda değil, SİTE veya SUNUCU (API) kaynaklıdır!\n`);
        } else {
          console.log(`ℹ️ [TEST/SENARYO İNCELEMESİ] Test '${testInfo.title}' başarısız oldu. Ancak arka planda web sitesi veya API kaynaklı herhangi bir JS/Network hatası tespit edilmedi. Sorun test adımları, element seçicileri veya beklenmeyen bir UI akışı kaynaklı olabilir.\n`);
        }
      } else if (hasErrors) {
        // Test başarılı bitse bile arka plan hatası varsa testi başarısız yap
        const errorSummary = errors.map((err, i) => `   [${i+1}] TİP: ${err.type} | KAYNAK: ${err.source} | MESAJ: ${err.message.substring(0, 150)}`).join('\n');
        expect(errors, `🚨 [SİTE/SUNUCU HATASI] "${testInfo.title}" test adımları başarıyla tamamlansa da arayüzde veya API isteklerinde arka plan hataları tespit edildi! Sorun web sitesi/sunucu kaynaklıdır.\n\nYakalanan Arka Plan Hataları:\n${errorSummary}\n\nDetaylar yukarıdaki console loglarındadır.`).toHaveLength(0);
      }
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

