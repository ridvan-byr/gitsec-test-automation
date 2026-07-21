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
  type: 'JSException' | 'ConsoleError' | 'ConsoleWarning' | 'NetworkFailure' | 'UIErrorToast';
  source: string;
  message: string;
}

interface GitSecFixtures {
  page: GitSecPage;
  loginPage: LoginPage;
  registerPage: RegisterPage;
  providerPage: ProviderPage;
  storagePage: StoragePage;
  restorePage: RestorePage;
}

export const test = base.extend<GitSecFixtures>({
  page: async ({ page }, use) => {
    const gitSecPage = page as GitSecPage;
    const errors: DetectedError[] = [];
    const expectedErrors: DetectedError[] = [];
    const seenToastMessages = new Set<string>();
    const uiToasts: Array<{ source: string; message: string; isError: boolean }> = [];

    const isIgnoredError = (message: string, sourceUrl?: string): boolean => {
      const patterns = gitSecPage.ignoredErrors || [];
      const targetUrl = sourceUrl || page.url();
      return patterns.some((pattern: string | RegExp) => {
        if (typeof pattern === 'string') {
          return message.includes(pattern) || targetUrl.includes(pattern);
        }
        return pattern.test(message) || pattern.test(targetUrl);
      });
    };

    await page.exposeFunction('__recordAuditToast', (rawMessage: string, isError: boolean) => {
      const message = rawMessage.replace(/\s+/g, ' ').trim().slice(0, 1000);
      if (!message || seenToastMessages.has(message)) return;
      seenToastMessages.add(message);
      uiToasts.push({ source: page.url(), message, isError });

      if (!isError) return;

      const detectedToast: DetectedError = {
        type: 'UIErrorToast',
        source: page.url(),
        message
      };

      if (isIgnoredError(message)) {
        expectedErrors.push(detectedToast);
      } else {
        errors.push(detectedToast);
      }
    });

    const isThirdPartyTrackerOrCsp = (msg: string, sourceUrl: string = ''): boolean => {
      const trackerKeywords = [
        'doubleclick.net',
        'clarity.ms',
        'bing.com',
        'googleadservices.com',
        'google.com/rmkt',
        'googletagmanager.com',
        'google-analytics',
        'cloudflareinsights.com'
      ];
      const isTracker = trackerKeywords.some(kw => msg.includes(kw) || sourceUrl.includes(kw));
      const isCspViolation = /Content Security Policy/i.test(msg) || msg === 'csp';
      return isTracker || isCspViolation;
    };

    // 1. Sayfa üzerindeki tüm yakalanamayan JavaScript hatalarını (Exception) dinle
    page.on('pageerror', (exception) => {
      const msg = exception.stack || exception.message || String(exception);
      const errObj: DetectedError = {
        type: 'JSException',
        source: page.url(),
        message: msg
      };
      if (isIgnoredError(msg)) {
        expectedErrors.push(errObj);
      } else {
        errors.push(errObj);
      }
    });

    // 2. Konsola düşen tüm Hataları dinle (3. Parti tracker ve CSP gürültüleri filtrelenir)
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') {
        const text = msg.text();
        if (text.includes('MISSING_MESSAGE') || isThirdPartyTrackerOrCsp(text, page.url())) return;

        const errObj: DetectedError = {
          type: 'ConsoleError',
          source: page.url(),
          message: text
        };
        if (isIgnoredError(text)) {
          expectedErrors.push(errObj);
        } else {
          errors.push(errObj);
        }
      }
    });

    // 3. Ağ (Network) isteklerinde oluşan hataları dinle (3. parti takipçiler hariç)
    page.on('requestfailed', (request) => {
      const url = request.url();
      const errText = request.failure()?.errorText || '';
      if (
        !url.startsWith('chrome-extension://') &&
        errText !== 'net::ERR_ABORTED' &&
        !isThirdPartyTrackerOrCsp(errText, url)
      ) {
        const fullMsg = errText || 'Network request failed';
        const errObj: DetectedError = {
          type: 'NetworkFailure',
          source: url,
          message: fullMsg
        };
        if (isIgnoredError(fullMsg, url)) {
          expectedErrors.push(errObj);
        } else {
          errors.push(errObj);
        }
      }
    });

    // 4. Çöken API yanıtlarını dinle (HTTP Status >= 400 - 3. parti takipçiler hariç)
    page.on('response', (response) => {
      const status = response.status();
      const url = response.url();
      if (status >= 400 && !isThirdPartyTrackerOrCsp('', url)) {
        const statusMsg = `HTTP Status ${status} - ${response.statusText()}`;
        const errObj: DetectedError = {
          type: 'NetworkFailure',
          source: url,
          message: statusMsg
        };
        if (isIgnoredError(statusMsg, url)) {
          expectedErrors.push(errObj);
        } else {
          errors.push(errObj);
        }
      }
    });

    // Test onboarding skip script'ini kur (Shadcn ve localStorage onboarding bypass) ve toast pointer-events engellemesini yap
    const currentAppEmail = process.env.E2E_USER_EMAIL || 'gitsectest+1@gmail.com';
    await page.addInitScript((appEmail) => {
      try {
        window.localStorage.setItem(
          'gs-tour',
          JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
        );
        const gsAuthValue = JSON.stringify({
          state: {
            auth: {
              user: {
                userId: 797,
                tenantId: 720,
                name: "Gitsec",
                surName: "Test",
                email: appEmail,
                token: "",
                refreshToken: "",
                uniqueKey: null,
                otpAuthenticationType: null
              }
            }
          },
          version: 0
        });
        window.localStorage.setItem('gs-auth', gsAuthValue);
      } catch {
        // Audit gözlemcisi uygulama davranışını etkilememeli.
      }
    }, currentAppEmail).catch(() => { });

    try {
      // Testi koştur
      await use(gitSecPage);
    } finally {
      // Test sonlandıktan sonra detaylı Raporlama yap (Log)
      const testInfo = test.info();
      const hasErrors = errors.length > 0;
      const hasExpectedErrors = expectedErrors.length > 0;

      console.log(`\n======================================================================`);
      console.log(`🔍 [AUDIT] "${testInfo.title}" Testi Arka Plan ve UI Hata Denetimi:`);

      if (uiToasts.length > 0) {
        console.log(`📣 TEST SIRASINDA GÖRÜLEN TOAST MESAJLARI (${uiToasts.length}):`);
        uiToasts.forEach((toast, index) => {
          console.log(`   [${index + 1}] TİP: ${toast.isError ? 'HATA TOAST' : 'BİLGİ/BAŞARI TOAST'}`);
          console.log(`       KAYNAK: ${toast.source}`);
          console.log(`       MESAJ : ${toast.message}`);
        });
        console.log(`       --------------------------------------------------------------`);
      }

      if (hasErrors) {
        console.log(`❌ DİKKAT: Test sürecinde ${errors.length} adet arka plan hatası/uyarısı yakalandı!\n`);
        errors.forEach((err, index) => {
          console.log(`   [${index + 1}] TİP: ${err.type}`);
          console.log(`       KAYNAK: ${err.source}`);
          console.log(`       MESAJ : ${err.message}`);
          console.log(`       --------------------------------------------------------------`);
        });
      } else if (hasExpectedErrors) {
        console.log(`ℹ️ BEKLENEN HATA SENARYOSU: Test tarafından simüle edilen/yoksayılması tanımlanan ${expectedErrors.length} hata sinyali gözlendi.`);
        expectedErrors.forEach((err, index) => {
          console.log(`   [${index + 1}] TİP: ${err.type}`);
          console.log(`       KAYNAK: ${err.source}`);
          console.log(`       MESAJ : ${err.message}`);
          console.log(`       --------------------------------------------------------------`);
        });
        console.log(`✅ Test senaryosu tamamlandı; beklenmeyen ek bir JS/API hatası tespit edilmedi.`);
      } else {
        console.log(`✅ TEMİZ RAPOR: Harika! Test esnasında arayüzde hiçbir hata toast'ı, gizli JS hatası,`);
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
        // Hata bekleyen testlerde (başlığında hata kodları veya yetki geçen) arka plan hatalarını görmezden gel
        const shouldIgnoreErrors = testInfo.title.toLowerCase().includes('sahte') ||
          testInfo.title.toLowerCase().includes('simüle') ||
          testInfo.title.toLowerCase().includes('429') ||
          testInfo.title.toLowerCase().includes('500') ||
          testInfo.title.toLowerCase().includes('403') ||
          testInfo.title.toLowerCase().includes('401') ||
          testInfo.title.toLowerCase().includes('geçersiz') ||
          testInfo.title.toLowerCase().includes('yetkisiz') ||
          testInfo.annotations.some(ann => ann.type === 'allow-errors');

        if (!shouldIgnoreErrors) {
          // Test başarılı bitse bile arka plan hatası varsa testi başarısız yap
          const errorSummary = errors.map((err, i) => `   [${i + 1}] TİP: ${err.type} | KAYNAK: ${err.source} | MESAJ: ${err.message.substring(0, 150)}`).join('\n');
          expect(errors, `🚨 [SİTE/SUNUCU HATASI] "${testInfo.title}" test adımları başarıyla tamamlansa da arayüzde veya API isteklerinde arka plan hataları tespit edildi! Sorun web sitesi/sunucu kaynaklıdır.\n\nYakalanan Arka Plan Hataları:\n${errorSummary}\n\nDetaylar yukarıdaki console loglarındadır.`).toHaveLength(0);
        } else {
          console.log(`ℹ️ [MOCK/HATA TESTİ] "${testInfo.title}" bir hata/mock senaryosu olduğu için yakalanan ${errors.length} adet arka plan hatası göz ardı edildi.`);
        }
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
