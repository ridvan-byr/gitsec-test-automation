import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import fs from 'fs';
import path from 'path';

// playwright/.auth/user.json dosyasından setup aşamasında alınmış gerçek token'ı okur.
// Bu sayede hem rate limit (429) yemeyiz, hem de CDN/Server gerçek token'ı doğrulayabildiği için 404 vermez.
function getRealTokenFromStorage(): { token: string; userId: number; tenantId: number } | null {
  try {
    const filePath = path.join(process.cwd(), 'playwright/.auth/user.json');
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const cookie = data.cookies.find((c: any) => c.name === 'gs_token');
      
      // LocalStorage'dan userId ve tenantId çekmeye çalışalım
      let userId = 34;
      let tenantId = 37;
      const originData = data.origins?.find((o: any) => o.origin.includes('gitsec.io'));
      const gsAuthStr = originData?.localStorage?.find((l: any) => l.name === 'gs-auth')?.value;
      if (gsAuthStr) {
        const gsAuth = JSON.parse(gsAuthStr);
        const user = gsAuth?.state?.auth?.user;
        if (user) {
          userId = user.userId || userId;
          tenantId = user.tenantId || tenantId;
        }
      }

      if (cookie && cookie.value) {
        console.log(`🔑 [Mock Test Helper] Kayıtlı oturumdan gerçek JWT Token başarıyla okundu (User ID: ${userId}, Tenant ID: ${tenantId}).`);
        return { token: cookie.value, userId, tenantId };
      }
    }
  } catch (e) {
    console.error('⚠️ [Mock Test Helper] Kayıtlı oturum dosyası okunurken hata oluştu:', e);
  }
  return null;
}

test.describe('Login Mocked — UI Giriş Formu Mock Akışı', () => {
  // Temiz bir oturum durumu ile başla (Önceki oturum çerezlerini temizle)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Giriş formunun doldurulması ve mock API sonrası dashboard yönlendirmesi', { tag: ['@smoke', '@critical'] }, async ({ page, loginPage }) => {
    (page as GitSecPage).ignoredErrors = [
      /currentRate/i,
      /Cannot read properties of undefined/i,
      /Failed to load resource/i
    ];
    const workspaceId = requireEnv('WORKSPACE_ID');
    const apiBaseUrl = requireEnv('API_BASE_URL');
    
    // Setup'ın kaydettiği gerçek token verisini çek (Yoksa yedek mock değerleri kullan)
    const sessionData = getRealTokenFromStorage() || {
      token: 'mock-jwt-token-for-fallback',
      userId: 34,
      tenantId: 37
    };

    // 1. reCAPTCHA ve Turnstile çözümlerini önceden mockla (UI'ın kilitlenmesini önler)
    await page.addInitScript(() => {
      (window as any).grecaptcha = {
        ready: (cb: any) => cb(),
        execute: () => Promise.resolve('mock-recaptcha-token'),
        getResponse: () => 'mock-recaptcha-token'
      };
      (window as any).turnstile = {
        render: () => 'mock-turnstile-token',
        reset: () => {},
        getResponse: () => 'mock-turnstile-token'
      };
    });

    // 2. Tüm API sunucusu isteklerini yakala (Rate limit ve 401 hatalarını önlemek için)
    await page.route(
      (url) => url.href.startsWith(apiBaseUrl),
      async (route) => {
        const urlStr = route.request().url();
        const method = route.request().method();
        console.log(`🛡️ [MOCK API] URL: ${urlStr} (${method})`);

        if (urlStr.includes('/auth/signin')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                userId: sessionData.userId,
                tenantId: sessionData.tenantId,
                name: 'Gitsec',
                surName: 'Testt',
                email: 'mock-e2e-user@gitsec.io',
                token: sessionData.token,
                refreshToken: 'mock-refresh-token',
                uniqueKey: null,
                otpAuthenticationType: null
              }
            })
          });
        } else if (urlStr.includes('/auth/user')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                id: sessionData.userId,
                tenantId: sessionData.tenantId,
                name: 'Gitsec',
                surName: 'Testt',
                email: 'mock-e2e-user@gitsec.io'
              }
            })
          });
        } else if (urlStr.includes('/workspaces')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                pagination: {
                  currentPage: 1,
                  maxPage: 1,
                  rowOffset: 0,
                  maxRowsPerPage: 99,
                  resultRowCount: 1,
                  totalRowCount: 1
                },
                list: [
                  {
                    id: Number(workspaceId) || 28,
                    name: "Gitsec's Default Workspace",
                    code: null,
                    description: null,
                    avatarUrl: null,
                    colorCode: null,
                    isDefault: true,
                    isArchived: false,
                    tenantId: sessionData.tenantId,
                    archivedAt: null,
                    lastActivityAt: null
                  }
                ]
              }
            })
          });
        } else if (urlStr.includes('/storage-policies/policies/check')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                completed: true
              }
            })
          });
        } else {
          // Diğer tüm backend isteklerine (check-policy, activities vs.) generic success dön
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: {} })
          });
        }
      }
    );

    // ─── ADIM 1: Giriş sayfasına git ───
    await loginPage.goto();

    // ─── ADIM 2: Form alanlarını doldur ───
    await loginPage.fillForm('mock-e2e-user@gitsec.io', 'MockPassword123!');

    // ─── ADIM 3: Captcha yüklenmesini beklemeden butonu zorla aktif edip tıkla ───
    console.log('🔘 [E2E Mocked] Sign in butonu aktif ediliyor ve tıklanıyor...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b => b.getAttribute('type') === 'submit' || /Sign in/i.test(b.textContent || ''));
      if (btn) {
        btn.removeAttribute('disabled');
        btn.disabled = false;
      }
    });
    
    await loginPage.signInButton.click({ force: true });

    // ─── ADIM 4: Dashboard yönlendirmesini doğrula ───
    console.log('⏳ [E2E Mocked] Dashboard yönlendirmesi bekleniyor...');
    await expect(page).toHaveURL(new RegExp(`/${workspaceId}/`), { timeout: 25000 });
    await expect(page).not.toHaveURL(/sign-in/);
    
    // Dashboard üzerinde ana layout bileşeninin görünmesini bekle
    const mainLayout = page.locator('main, aside, nav').first();
    await expect(mainLayout).toBeVisible({ timeout: 20000 });

    console.log('🎉 [E2E Mocked] Mocklu E2E Giriş testi başarıyla tamamlandı!');
  });
});
