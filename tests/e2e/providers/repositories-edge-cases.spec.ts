import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';

type CodeProvider = 'github' | 'bitbucket';

function getCodeProvider(): CodeProvider {
  const provider = (process.env.E2E_CODE_PROVIDER || 'github').trim().toLowerCase();
  return provider === 'bitbucket' ? 'bitbucket' : 'github';
}

function translateToastMessage(msg: string, provider: CodeProvider): string {
  const normalized = msg.toLowerCase();
  if (normalized.includes('licence limit') || normalized.includes('license limit')) {
    return 'Lisans limit sınırına ulaşıldı. Daha fazla işlem gerçekleştirilemez.';
  }
  if (normalized.includes('failed to update repository status')) {
    return 'Repository/Depo durumu güncellenemedi.';
  }
  if (normalized.includes('access is not granted') || normalized.includes('cannot be activated because access')) {
    const name = provider === 'github' ? 'GitHub' : 'Bitbucket';
    return `Erişim izni verilmediği için depo etkinleştirilemedi. Sorun: ${name} üzerinde bu deponun sahibi olan kullanıcı veya organizasyon, GitSec uygulamasına üçüncü taraf (third-party) erişim veya OAuth yetkisi vermemiş olabilir.`;
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

async function scrollTableToRight(page: Page): Promise<void> {
  console.log('↔️ [KAYDIRMA] Tablo sağa kaydırılıyor (Scroll to right)...');
  
  const container = page.locator('div.overflow-x-auto, div.overflow-auto, .overflow-x-scroll, [class*="overflow-x"]').first();
  const isVisible = await container.isVisible().catch(() => false);
  
  if (isVisible) {
    await container.evaluate(el => {
      el.scrollLeft = 1000;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    }).catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
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
  await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
}

async function waitTableLoadingFinished(repoTable: Locator): Promise<void> {
  await expect(async () => {
    const firstRow = repoTable.locator('tbody tr').first();
    const name = await getCleanRepoName(firstRow);
    expect(name.length).toBeGreaterThan(1);
  }).toPass({ timeout: 15000, intervals: [200] });
}

const provider = getCodeProvider();

async function navigateToRepositoriesAndEnsureStable(page: Page, providerPage: ProviderPage): Promise<Locator> {
  console.log(`🚀 [BAŞLANGIÇ] Doğrudan ${provider.toUpperCase()} Repositories sayfasına gidiliyor...`);
  await providerPage.goToRepositoriesViaSidebar(provider);
  
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('table').first()).toBeVisible({ timeout: 30000 });
  
  const repoTable = await getRepoTable(page);
  await waitTableLoadingFinished(repoTable);
  await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});
  
  return repoTable;
}

test.describe(`Repositories - ${provider.toUpperCase()} Include/Exclude Edge Cases & Chaos`, () => {
  
  // ─────────────────────────────────────────────────────────────────
  // 💥 INCLUDE CHAOS & RESILIENCE TESTS
  // ─────────────────────────────────────────────────────────────────

  test('Hata durumunda switch durumunun revert edildigini ve toast ciktigini dogrula (Chaos Test - Include)', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => url.href.includes('/api/repositories/license-inclusion-status'),
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

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage);

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
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Başarısız olması bekleniyor)...');
    await targetSwitch.click();

    console.log('⏳ [BEKLEME] Hata toast mesajı veya lisans uyarı kontrolü yapılıyor...');
    const toastError = page.locator('text=/Failed to update repository status|The licence limit within threshold has been reached/i').first();
    await expect(toastError).toBeVisible({ timeout: 10000 });
    const toastText = await toastError.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText, provider)}`);
    
    await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
    console.log('🎉 [BAŞARILI] Switch butonunun durumunun pasif (false) olarak korunduğu / revert edildiği başarıyla doğrulandı.');
  });

  test('Lisans limiti asildiginda sistemin hata verdigini ve islemi engelledigini doğrula (License Limit Test - Include)', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => url.href.includes('/api/repositories/license-inclusion-status'),
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

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage);

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
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Lisans limit aşımı testi)...');
    await targetSwitch.click();

    const licenseToast = page.locator('text=/The licence limit within threshold has been reached/i').first();
    await expect(licenseToast).toBeVisible({ timeout: 10000 });
    const toastText = await licenseToast.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText, provider)}`);

    await expect(targetSwitch).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
    console.log('🎉 [BAŞARILI] Switch butonunun aktifleşmeyip pasif kaldığı başarıyla doğrulandı.');
  });

  // ─────────────────────────────────────────────────────────────────
  // 💥 EXCLUDE CHAOS & RESILIENCE TESTS
  // ─────────────────────────────────────────────────────────────────

  test('Hata durumunda switch durumunun revert edildigini ve toast ciktigini dogrula (Chaos Test - Exclude)', async ({ page }) => {
    test.setTimeout(90000);
    const providerPage = new ProviderPage(page);

    await page.route(
      (url) => url.href.includes('/api/repositories/license-inclusion-status'),
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

    const repoTable = await navigateToRepositoriesAndEnsureStable(page, providerPage);

    await scrollTableToRight(page);

    const switches = repoTable.locator('button[role="switch"]');
    await switches.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const count = await switches.count();

    let targetSwitch: Locator | null = null;
    for (let i = 0; i < count; i++) {
      const sw = switches.nth(i);
      const isChecked = await sw.getAttribute('aria-checked');
      if (isChecked === 'true' || isChecked === 'checked') {
        targetSwitch = sw;
        console.log(`🎉 [BAŞARILI] Checked switch bulundu (Chaos Test): Satır = ${i}`);
        break;
      }
    }

    if (!targetSwitch) {
      console.log('🔍 [KONTROL] Checked switch bulunamadı, test sonlandırılıyor.');
      return;
    }

    await targetSwitch.scrollIntoViewIfNeeded().catch(() => {});
    await page.evaluate(() => new Promise(requestAnimationFrame)).catch(() => {});

    console.log('👆 [TIKLAMA] Switch butonuna tıklanıyor (Başarısız olması bekleniyor)...');
    await targetSwitch.click();

    // Onay modalını bekle ve tıkla
    const confirmBtn = page.getByRole('button', { name: /Yes,\s*Exclude|Confirm/i }).first();
    if (await confirmBtn.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      await confirmBtn.click();
      await expect(confirmBtn).toBeHidden({ timeout: 5000 });
    }

    console.log('⏳ [BEKLEME] Hata toast mesajı veya lisans uyarı kontrolü yapılıyor...');
    const toastError = page.locator('text=/Failed to update repository status|The licence limit within threshold has been reached/i').first();
    await expect(toastError).toBeVisible({ timeout: 10000 });
    const toastText = await toastError.innerText().catch(() => '');
    console.log(`🚨 [HATA NEDENİ] ${translateToastMessage(toastText, provider)}`);

    await expect(targetSwitch).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
    console.log('🎉 [BAŞARILI] Switch butonunun durumunun aktif (true) olarak korunduğu / revert edildiği başarıyla doğrulandı.');
  });
});
