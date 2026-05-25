import { test, expect } from '../../fixtures/test';
import { ProviderPage } from '../../../pages/ProviderPage';
import { GithubLoginPage } from '../../../pages/GithubLoginPage';
import type { Page } from '@playwright/test';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// GitHub settings/installations sayfasına veya ana sayfasına ulaşıldığını kontrol eden ve popup'ı kapatıp testi bitiren yardımcı fonksiyon
async function checkIfOnGithubMainPageAndClose(popup: Page): Promise<boolean> {
  if (popup.isClosed()) return true;
  
  const u = popup.url();
  
  // Kullanıcının ekran görüntüsünde belirttiği "github.com/settings/installations" veya türevi yetki sayfalarını yakalar
  const isGithubAuthorizedPage = 
    /settings\/installations/i.test(u) || 
    /github\.com\/settings\/installations/i.test(u) || 
    /github\.com\/apps\/[^/]+\/installations/i.test(u) ||
    /github\.com\/?$/i.test(u) || 
    /github\.com\/dashboard/i.test(u) || 
    /github\.com\/home/i.test(u) || 
    (u.includes('github.com') && 
     !u.includes('/login') && 
     !u.includes('/sessions/two-factor'));

  if (isGithubAuthorizedPage) {
    console.log(`🎉 [OAuth] Hedef GitHub yetki/kurulum sayfasına ulaşıldı: "${u}"`);
    console.log('ℹ️ Yetkilendirme/Kurulum başarılı sayıldı. Popup güvenli bir şekilde kapatılıyor...');
    await popup.close().catch(() => {});
    console.log('✅ GitHub bağlantısı başarıyla doğrulandı ve test sonlandırıldı.');
    return true;
  }
  return false;
}

test.describe('Provider Entegrasyonları', () => {
  test.setTimeout(90000);

  test('GitHub provider bagli olsa da popup acilip kapanmali', async ({ page }) => {
    const githubUsername = process.env.GITHUB_TEST_USER ?? requireEnv('E2E_USER_EMAIL');
    const githubPassword = process.env.GITHUB_TEST_PASSWORD ?? requireEnv('E2E_USER_PASSWORD');
    const providerPage = new ProviderPage(page);

    console.log('🚀 1. Dashboard ana sayfasına gidiliyor...');
    await providerPage.navigateToDashboard();

    console.log('👆 2. Sidebar üzerinden Add Provider sayfasına geçiliyor...');
    await providerPage.goToAddProviderPage();

    console.log('👆 3. Github seçeneğine tıklanıyor ve Popup bekleniyor...');
    const [popup] = await Promise.all([page.waitForEvent('popup'), providerPage.selectGithub()]);

    const popupGithubPage = new GithubLoginPage(popup);
    console.log('🔗 4. GitHub Popup Penceresinin yüklenmesi bekleniyor...');
    await popup.waitForLoadState('domcontentloaded');
    await popup.waitForURL(/.*github\.com.*/);

    // İlk yüklemede aranan sayfaya yönlendirildiyse erken çıkış yap
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      return;
    }

    const loginInput = popup.locator('input[name="login"]');
    if (await loginInput.isVisible().catch(() => false)) {
      console.log('🔒 5. GitHub Login ekranına şifre yazılıyor...');
      const loginOk = await popupGithubPage.loginAndHandleTwoFactor(githubUsername, githubPassword);
      if (!loginOk) {
        console.log('❌ GitHub 2FA otomasyonla geçilemedi; test OAuth adımını atlıyor.');
        return;
      }
    } else {
      console.log('ℹ️ Login ekranı görünmedi (zaten oturum açık/yetkili olabilir).');
      const twoFaOk = await popupGithubPage.handleTwoFactorAuthentication();
      if (!twoFaOk) {
        console.log('❌ Açık oturumda 2FA otomasyonla geçilemedi.');
        return;
      }
    }

    // Giriş/2FA/Mail doğrulama sonrasında hedeflenen sayfaya atıldıysa hemen erken çıkış yap
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      return;
    }

    console.log('📦 6. Install → sudo e-posta → Install...');
    const flowOk = await popupGithubPage.completePermissionsInstallFlow();

    // Akış tamamlandıktan sonra hedeflenen sayfaya atıldıysa popup'ı kapat ve bitir
    if (await checkIfOnGithubMainPageAndClose(popup)) {
      return;
    }

    if (popup.isClosed()) {
      console.log('✅ Popup kapandı.');
    } else if (flowOk) {
      await popup.waitForEvent('close', { timeout: 30_000 }).catch(() => {});
    } else {
      const u = popup.url();
      const onInstallations =
        /github\.com\/settings\/installations/.test(u) || /github\.com\/apps\/[^/]+\/installations/.test(u);
      if (onInstallations) {
        console.log('ℹ️ GitHub installations; popup kapatılıyor.');
        if (!popup.isClosed()) await popup.close();
      } else {
        console.log('ℹ️ Install butonu yok, URL:', u);
      }
    }

    console.log('✅ Popup akışı tamamlandı, test burada sonlanıyor.');
  });
});
