import { test as base, expect } from '@playwright/test';
import * as path from 'path';

// Tespit edilen arka plan hatalarının veri yapısı
interface DetectedError {
  type: 'JSException' | 'ConsoleError' | 'ConsoleWarning' | 'NetworkFailure';
  source: string;
  message: string;
}

export const test = base.extend({
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

    // 2. Konsola düşen tüm Hata ve Uyarıları dinle
    page.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error') {
        errors.push({
          type: 'ConsoleError',
          source: page.url(),
          message: msg.text()
        });
      } else if (type === 'warning') {
        // Geliştirici uyarılarını ve deprecation uyarılarını da yakalayalım
        errors.push({
          type: 'ConsoleWarning',
          source: page.url(),
          message: msg.text()
        });
      }
    });

    // 3. Ağ (Network) isteklerinde oluşan hataları dinle (Sunucu kesintileri, timeout vb.)
    page.on('requestfailed', (request) => {
      // Chrome uzantıları veya dış analytics isteklerini raporu kirletmemesi için filtreleyebiliriz
      const url = request.url();
      if (!url.startsWith('chrome-extension://') && !url.includes('google-analytics')) {
        errors.push({
          type: 'NetworkFailure',
          source: url,
          message: request.failure()?.errorText || 'Network request failed'
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
      
      // Hataları daha belirgin kılmak adına testi başarısız da sayabiliriz. 
      // Ancak şu aşamada loglayıp raporlamak ve analiz etmek çok daha esnektir.
    } else {
      console.log(`✅ TEMİZ RAPOR: Harika! Test esnasında arayüzde hiçbir gizli JS hatası,`);
      console.log(`   konsol uyarısı veya çöken API isteği (Network/400-500) TESPİT EDİLMEDİ.`);
      console.log(`======================================================================\n`);
    }
  }
});

export { expect };

