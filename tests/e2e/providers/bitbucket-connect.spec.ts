import { test, expect, GitSecPage } from '../../fixtures/test';
import { ProviderPage } from '../../pages/ProviderPage';
import { GoogleLoginPage } from '../../pages/GoogleLoginPage';
import fs from 'fs';
import path from 'path';
import { requireEnv } from '../../support/require-env';
import { pollAtlassianEmailOtp } from '../../support/atlassian-email-otp';

import { handleBitbucketAuthPopup } from '../../support/bitbucket-auth-helper';

async function verifyDashboardBitbucketConnection(providerPage: ProviderPage, maxAttempts = 3): Promise<void> {
  console.log('🧭 [POM] GitSec "Add Provider" sayfasında Bitbucket entegrasyon durumu denetleniyor...');
  await providerPage.goToAddProviderPage().catch(() => {});

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isConnected = await providerPage.isBitbucketAlreadyConnectedOnAddProvider();
    if (isConnected) {
      console.log('✅ [PROVIDER CHECK] Bitbucket sağlayıcısının AKTİF (Active) durumda olduğu doğrulandı.');
      return;
    }

    if (attempt < maxAttempts) {
      console.log(`⏳ [BEKLEME] (Deneme ${attempt}/${maxAttempts}) Bitbucket sağlayıcısı henüz aktifleşmedi, sayfa yenileniyor...`);
      await providerPage.goToAddProviderPage().catch(() => {});
      if (!providerPage.page.isClosed()) {
        await providerPage.page.waitForTimeout(2000).catch(() => {});
      }
    }
  }

  throw new Error(`❌ Bitbucket sağlayıcısı ${maxAttempts} deneme sonrasında GitSec paneli üzerinde aktifleşmedi.`);
}

test.describe('Bitbucket Provider Entegrasyon Testleri', () => {
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    (page as GitSecPage).ignoredErrors = [
      /Cross-Origin-Opener-Policy/,
      /Failed to load resource: the server responded with a status of (400|500|401|403|422|502)/,
      /HTTP Status 502/
    ];
  });

  test('Bitbucket provider entegrasyonu, OAuth popup ve repository listesinin uçtan uca doğrulanması', { tag: '@critical' }, async ({ page }) => {
    const providerPage = new ProviderPage(page);

    // 1. "Add Provider" sayfasına git
    console.log('🚀 [POM] Bitbucket entegrasyonu için "Add Provider" sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    // 2. Bitbucket Sağlayıcı Kartına tıkla
    console.log('👆 [TIKLAMA] "Bitbucket" sağlayıcı kartı tıklanıyor...');
    await providerPage.selectBitbucket();

    // 3. Modalı ve Install butonunu bekle
    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"], div[class*="modal"]').first();
    let isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket modalı açılmadı, kart tekrar tıklanıyor...');
      await providerPage.selectBitbucket().catch(() => {});
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"], div[class*="modal"]').first();
      await modal.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    }

    await expect(modal).toBeVisible({ timeout: 10000 });
    console.log('✅ Bitbucket kurulum modalı başarıyla görüntülendi.');

    // 4. Modaldaki "Install" / "Grant Access" / "Connect" butonunu bul
    const installBtn = modal.locator('button, a, [role="button"]')
      .filter({ hasText: /Install|Yükle|Configure|Grant|Connect|Ekle|Kur/i })
      .or(modal.locator('button:not(:has-text("Cancel")):not(:has-text("Close")):not(:has-text("İptal")):not(:has-text("Kapat"))'))
      .or(page.getByRole('button', { name: /Install|Yükle|Configure|Grant|Grant Access|Connect/i }))
      .first();

    console.log('👆 Modaldaki "Install" / "Grant Access" butonuna tıklanıyor ve Atlassian OAuth penceresi bekleniyor...');
    await installBtn.scrollIntoViewIfNeeded().catch(() => {});
    await expect(installBtn).toBeVisible({ timeout: 10000 });
    await expect(installBtn).toBeEnabled({ timeout: 10000 });

    // 5. OAuth Popup dinleyicisini başlat ve Install butonuna tıklamayı gerçekleştir
    const popupPromise = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null);

    await installBtn.click({ force: true }).catch(async (err) => {
      console.log(`⚡ [FALLBACK] Modaldaki Install butonuna JS click() ile tıklanıyor (${err?.message || err})...`);
      await installBtn.evaluate((el: any) => el.click()).catch(() => {});
    });

    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const popupUrl = popup.url();
      console.log(`ℹ️ Açılan OAuth Popup URL: ${popupUrl}`);
      expect(popupUrl).toMatch(/atlassian\.com|bitbucket\.org/i);
      console.log('✅ Atlassian/Bitbucket OAuth popup yönlendirmesi doğrulandı.');

      // Google SSO Oturumu, Atlassian Girişi ve "Grant Access" Buton Onayı
      await handleBitbucketAuthPopup(popup).catch(() => {});

      if (!popup.isClosed()) {
        await popup.close().catch(() => {});
      }
    } else {
      console.log('ℹ️ OAuth Popup tetiklenmedi veya doğrudan yetkilendirme akışı tamamlandı.');
    }

    // 6. Doğrudan "Add Provider" sayfasında Bitbucket'ın Active olduğunu doğrula
    await verifyDashboardBitbucketConnection(providerPage);

    // 7. Bitbucket Repositories sayfasına git ve repository listesini doğrula
    console.log('🧭 [POM] Bitbucket Repositories sayfasına gidiliyor...');
    await providerPage.goToRepositoriesBitbucket();

    const heading = page.getByRole('heading', { name: /Repositories/i }).first();
    await expect(heading).toBeVisible({ timeout: 15000 });

    const table = page.locator('table').first();
    await expect(table).toBeVisible({ timeout: 15000 });

    await expect(page.getByRole('columnheader', { name: /Full Name/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Connected/i })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /Licensed/i })).toBeVisible();
    console.log('✅ Tablo başlıkları (Full Name, Connected, Licensed) doğrulandı.');

    const repoRows = page.locator('tbody tr');
    await expect(repoRows.first()).toBeVisible({ timeout: 15000 });
    const rowCount = await repoRows.count();
    expect(rowCount).toBeGreaterThan(0);
    console.log(`✅ Bitbucket reposu bağlandı ve tabloda ${rowCount} adet repository listeleniyor.`);
  });

  test('Bitbucket kartına tıklandığında kurulum modalı açılmalı ve iptal edilebilmeli', { tag: ['@edge-cases', '@modal'] }, async ({ page }) => {
    const providerPage = new ProviderPage(page);

    console.log('🚀 [POM] Sağlayıcı ekleme sayfasına gidiliyor...');
    await providerPage.goToAddProviderPage();

    // 1. Bitbucket Kartını bul ve tıkla
    const bitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
    await expect(bitbucketCard).toBeVisible({ timeout: 15000 });
    await bitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
    await bitbucketCard.click();
    console.log('👆 Bitbucket sağlayıcı kartına tıklandı.');

    // 2. Bitbucket Kurulum Modalı açıldığını doğrula
    let modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    const isModalVisible = await modal
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!isModalVisible) {
      console.log('[bitbucket-modal] Bitbucket setup modal did not open. Reloading provider page via POM and retrying once.');
      await providerPage.goToAddProviderPage();
      const retryBitbucketCard = page.getByRole('button', { name: /Bitbucket/i }).first();
      await expect(retryBitbucketCard).toBeVisible({ timeout: 15000 });
      await retryBitbucketCard.scrollIntoViewIfNeeded().catch(() => {});
      await retryBitbucketCard.click();
      modal = page.locator('[role="dialog"], [data-slot="dialog-content"]').first();
    }

    await expect(modal).toBeVisible({ timeout: 10000 });
    await expect(modal.getByRole('heading', { name: /Bitbucket/i })).toBeVisible();
    console.log('✅ Bitbucket kurulum modalı başarıyla görüntülendi.');

    // 3. Vazgeç/Kapat butonu ile modalı kapat
    const cancelBtn = modal.getByRole('button', { name: /Cancel|Kapat|Vazgeç/i }).first();
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    await expect(cancelBtn).toBeEnabled();
    await cancelBtn.click({ force: true });

    // 4. Modalın gizlendiğini doğrula
    await expect(modal).toBeHidden({ timeout: 5000 });
    console.log('✅ Kapat butonuna basıldığında modal başarıyla kapandı.');
  });
});
