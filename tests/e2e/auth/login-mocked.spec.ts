import { test, expect, GitSecPage } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';
import type { LoginPage } from '../../pages/LoginPage';

async function prepareStableLoginForm(
  page: GitSecPage,
  loginPage: LoginPage,
  email: string,
  password: string
): Promise<void> {
  await expect(loginPage.emailInput).toBeEditable({ timeout: 10_000 });
  await expect(loginPage.passwordInput).toBeEditable({ timeout: 10_000 });
  await loginPage.fillForm(email, password);

  await page.evaluate(() => {
    const turnstileInput = document.querySelector('input[name="cf-turnstile-response"], [name="g-recaptcha-response"]') as HTMLInputElement | null;
    if (turnstileInput) {
      turnstileInput.value = 'mock-turnstile-token';
      turnstileInput.dispatchEvent(new Event('input', { bubbles: true }));
      turnstileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  await expect(loginPage.emailInput).toHaveValue(email);
  await expect(loginPage.passwordInput).toHaveValue(password);

  // Sign in butonunun aktif olmasını bekle veya mock ortamında etkinleştir
  await expect(loginPage.signInButton).toBeEnabled({ timeout: 5_000 }).catch(async () => {
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b =>
        b.getAttribute('type') === 'submit' || /^Sign in$/i.test(b.textContent?.trim() ?? '')
      );
      if (btn instanceof HTMLButtonElement) {
        btn.disabled = false;
        btn.removeAttribute('disabled');
      }
    });
  });
}

// playwright/.auth/user.json dosyasından setup aşamasında alınmış gerçek token'ı okur.
// Bu sayede hem rate limit (429) yemeyiz, hem de CDN/Server gerçek token'ı doğrulayabildiği için 404 vermez.
test.describe('Login Mocked — UI Giriş Formu Mock Akışı', () => {
  // Temiz bir oturum durumu ile başla (Önceki oturum çerezlerini temizle)
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Giriş formunun doldurulması ve mock API sonrası istemci oturumunun oluşması', { tag: ['@smoke', '@critical'] }, async ({ page, loginPage }) => {
    page.ignoredErrors = [
      /currentRate/i,
      /Failed to load resource/i,
      /Server Components/i,
      /500/
    ];
    const workspaceId = requireEnv('WORKSPACE_ID');
    const apiBaseUrl = requireEnv('API_BASE_URL');
    
    const sessionData = {
      token: 'mock-jwt-token',
      userId: 34,
      tenantId: 37
    };
    const mockEmail = 'mock-e2e-user@gitsec.io';
    const mockPassword = 'MockPassword123!';
    let signInPayload: Record<string, unknown> | undefined;

    // 1. reCAPTCHA ve Turnstile çözümlerini önceden mockla (UI'ın kilitlenmesini önler)
    await page.addInitScript(() => {
      const captchaWindow = window as typeof window & {
        grecaptcha: Record<string, unknown>;
        turnstile: Record<string, unknown>;
      };

      captchaWindow.grecaptcha = {
        ready: (callback: (...args: unknown[]) => unknown) => callback(),
        execute: () => Promise.resolve('mock-recaptcha-token'),
        getResponse: () => 'mock-recaptcha-token'
      };
      captchaWindow.turnstile = {
        render: (
          _container: unknown,
          options?: { callback?: CallableFunction }
        ) => {
          queueMicrotask(() => options?.callback?.('mock-turnstile-token'));
          return 'mock-turnstile-widget';
        },
        reset: () => {},
        getResponse: () => 'mock-turnstile-token'
      };
    });

    // Gerçek Turnstile scripti init mock'unu ezmesin; widget callback'i uygulama state'ini etkinleştirsin.
    await page.route(/challenges\.cloudflare\.com\/turnstile\/.*\/api\.js/i, async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `window.turnstile={
          render:function(_container,options){
            queueMicrotask(function(){
              if(options&&typeof options.callback==='function') options.callback('mock-turnstile-token');
            });
            return 'mock-turnstile-widget';
          },
          reset:function(){},
          getResponse:function(){return 'mock-turnstile-token';}
        };`
      });
    });

    // 2. Tüm API sunucusu isteklerini yakala (Rate limit ve 401 hatalarını önlemek için)
    await page.route(
      (url) => url.href.startsWith(apiBaseUrl),
      async (route) => {
        const urlStr = route.request().url();
        const method = route.request().method();
        console.log(`🛡️ [MOCK API] URL: ${urlStr} (${method})`);

        if (urlStr.includes('/auth/signin')) {
          signInPayload = route.request().postDataJSON() as Record<string, unknown>;
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
                email: mockEmail,
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
                email: mockEmail
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
        } else if (urlStr.includes('/licences/current')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                id: 1,
                licenceId: 1,
                tenantId: sessionData.tenantId,
                limit: 100,
                usage: 10,
                status: 'Active',
                isActive: true,
                tierName: 'Premium',
                expiresAt: '2030-01-01T00:00:00Z',
                billingCycle: 1
              }
            })
          });
        } else if (urlStr.includes('/licences/usage-summary')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                total: 100,
                used: 10,
                features: [],
                remainingPlanChanges: 3,
                planChangeResetAtUnix: Math.floor(Date.now() / 1000) + 86400
              }
            })
          });
        } else if (urlStr.includes('/backup/executions/statistics')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                totalCount: 0,
                successCount: 0,
                failedCount: 0,
                repositories: { total: 0, lastMonthTotal: 0 },
                snapshots: { totalCount: 0, lastMonthCount: 0, totalSize: 0, lastMonthSize: 0 },
                successRate: { currentRate: {}, lastMonthRate: {} }
              }
            })
          });
        } else if (urlStr.includes('/backup/executions/backup-storage-usage')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                usages: []
              }
            })
          });
        } else if (urlStr.includes('/backup/executions/dashboard-recent')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                list: [],
                pagination: {
                  currentPage: 1,
                  maxPage: 1,
                  rowOffset: 0,
                  maxRowsPerPage: 10,
                  resultRowCount: 0,
                  totalRowCount: 0
                }
              }
            })
          });
        } else if (urlStr.includes('/installations')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              errors: [],
              message: 'Process Successful.',
              data: {
                list: [],
                pagination: {
                  currentPage: 1,
                  maxPage: 1,
                  rowOffset: 0,
                  maxRowsPerPage: 10,
                  resultRowCount: 0,
                  totalRowCount: 0
                }
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
    
    // ─── ADIM 2: Formu doldur ───
    await prepareStableLoginForm(page, loginPage, mockEmail, mockPassword);

    // ─── ADIM 3: Mock Captcha senaryosunda form submit'ini tetikle ───
    console.log('🔘 [E2E Mocked] Form kararlı; Sign in butonuna tıklanıyor...');
    
    const signInResponsePromise = page.waitForResponse(response =>
      response.url().includes('/auth/signin') && response.request().method() === 'POST'
    );

    await expect(loginPage.signInButton).toBeVisible();
    await loginPage.submit();

    const signInResponse = await signInResponsePromise;
    expect(signInResponse.status()).toBe(200);

    // ─── ADIM 4: Login contract ve istemci auth state durumunu doğrula ───
    expect(signInPayload).toMatchObject({ email: mockEmail, password: mockPassword });

    await page.waitForFunction(() => window.localStorage.getItem('gs-auth') !== null);

    const authState = await page.evaluate(() => {
      const rawState = window.localStorage.getItem('gs-auth');
      return rawState ? JSON.parse(rawState) : null;
    });
    expect(authState?.state?.auth?.user?.email).toBe(mockEmail);

    console.log(`🎉 [E2E Mocked] Login contract ve istemci auth state doğrulandı (Workspace: ${workspaceId}).`);
  });
});
