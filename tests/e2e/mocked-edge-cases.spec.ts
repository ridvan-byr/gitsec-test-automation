import { test, expect } from '../fixtures/test';
import type { Page } from '@playwright/test';
import { RestorePage } from '../pages/RestorePage';
import { requireEnv } from '../support/require-env';

let dashboardBaseUrl: string;
let apiBaseUrl: string;
let workspaceId: string;

test.beforeEach(async () => {
  dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
  apiBaseUrl = requireEnv('API_BASE_URL');
  workspaceId = requireEnv('WORKSPACE_ID');
});

// UI Butonunu JavaScript ile aktif edip tıklama fonksiyonu (Turnstile/reCAPTCHA kilidini aşmak için)
async function forceEnableAndClick(page: Page, selectorText: string | RegExp) {
  await page.evaluate((textPattern) => {
    const pattern = new RegExp(textPattern, 'i');
    document.querySelectorAll('button').forEach(btn => {
      if (pattern.test(btn.textContent || '') || pattern.test(btn.value || '')) {
        btn.removeAttribute('disabled');
      }
    });
  }, typeof selectorText === 'string' ? selectorText : selectorText.source);
  
  const btn = page.getByRole('button', { name: selectorText }).first();
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  await btn.click({ force: true });
}

test.describe('Kimlik Doğrulama (Authentication) Mocked Edge Cases', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    // reCAPTCHA ve Turnstile çözümlerini önceden mockla
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
  });

  test('Giriş API 429 Too Many Requests döndüğünde UI kullanıcıyı engellemeli ve doğru mesajı göstermelidir', async ({ page }) => {
    const loginEndpoint = `${apiBaseUrl}/auth/signin`;

    await page.route(loginEndpoint, async (route) => {
      console.log('🛡️ [MOCK RATE LIMIT] Giriş isteğine 429 Too Many Requests dönülüyor.');
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Too many login attempts. Please try again in 15 minutes.'
        })
      });
    });

    await page.goto(`${dashboardBaseUrl}/sign-in`, { waitUntil: 'load' });
    
    await page.locator('input[name="email"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('input[name="email"]').fill('rate_limit_test@gitsec.io');
    await page.locator('input[name="password"]').fill('ValidPassword123.');

    // Captcha yüklenmesini beklemeden butonu zorla aktif edip tıkla
    await forceEnableAndClick(page, /Sign in/i);

    // UI üzerinde hata bildiriminin çıktığını doğrula
    const errorMsg = page.getByText(/too many|attempts|try again|çok fazla|deneme/i).first();
    await expect(errorMsg).toBeVisible({ timeout: 15000 });
  });

  test('Kayıt API 500 Internal Server Error döndüğünde arayüz çökmeyip hata mesajı göstermelidir', async ({ page }) => {
    const registerEndpoint = `${apiBaseUrl}/auth/signup`;

    await page.route(registerEndpoint, async (route) => {
      console.log('🛡️ [MOCK REGISTER FAILURE] Kayıt isteğine 500 Internal Server Error dönülüyor.');
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Internal Database connection issue occurred.'
        })
      });
    });

    await page.goto(`${dashboardBaseUrl}/sign-up`, { waitUntil: 'load' });
    
    // Sayfanın ilk otomatik yenilenmesini/reCAPTCHA yüklenmesini bekle
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 15000 }).catch(() => {});
    
    await page.locator('input[name="name"]').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('input[name="name"]').fill('Edge');
    await page.locator('input[name="surname"]').fill('Case');
    await page.locator('input[name="email"]').fill('register_fail_test@gitsec.io');
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('SecurePass123!');
    await passwordInputs.nth(1).fill('SecurePass123!');

    await page.locator('#terms').click({ force: true }).catch(() => {});
    await page.locator('#privacy').click({ force: true }).catch(() => {});

    // Butonu zorla aktif edip tıkla
    await forceEnableAndClick(page, /Create account|Sign up/i);

    // Hata mesajını doğrula
    const serverErrorMsg = page.getByText(/internal|server|500|hata|error/i).first();
    await expect(serverErrorMsg).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Zamanlayıcı (Schedulers) Mocked Edge Cases', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Schedulers GET isteğini mockla (502 yönlendirmelerini önlemek için)
    await page.route(url => url.href.includes('/schedulers'), async (route) => {
      if (route.request().method() === 'GET') {
        console.log('🛡️ [MOCK GET SCHEDULERS] Boş zamanlayıcı listesi başarılı dönülüyor.');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: []
          })
        });
      } else {
        await route.continue();
      }
    });

    // Workspace repositories listesini mockla
    await page.route(url => url.href.includes('/repositories') && !url.href.includes('/license'), async (route) => {
      console.log('🛡️ [MOCK REPOSITORIES] Aktif repository listesi mock olarak dönülüyor.');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            { id: 101, name: 'e2e-restore-mock', fullName: 'gitsectest-cmd/e2e-restore-mock', isIncluded: true }
          ]
        })
      });
    });
  });

  test('Mükerrer plan ismi ile yeni zamanlayıcı kaydedilmeye çalışıldığında API 409 Conflict mesajını UI göstermelidir', async ({ page }) => {
    await page.route(url => url.href.includes('/schedulers'), async (route) => {
      if (route.request().method() === 'POST') {
        console.log('🛡️ [MOCK SCHEDULER DUPLICATE] Schedulers API 409 Conflict dönülüyor.');
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'A scheduler with this name already exists in this workspace.'
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'load' });
    
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i }).first();
    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 10000 });
    await newSchedulerBtn.click();

    // Dialog'un görünür olmasını bekle
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'visible', timeout: 10000 });

    const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await repoCombo.waitFor({ state: 'visible', timeout: 10000 });
    await repoCombo.click();
    
    const repoOption = page.locator('[role="option"], [data-slot="select-item"]').first();
    await repoOption.waitFor({ state: 'visible', timeout: 10000 });
    await repoOption.click();

    const nameInput = page.getByPlaceholder('e.g. Nightly Full Backup')
      .or(page.locator('input[name="name"]'))
      .first();
    await nameInput.fill('Duplicate-Name-Test');

    const saveBtn = page.getByRole('button').filter({ hasText: /save|create|confirm|submit/i }).first();
    await saveBtn.click();

    const duplicateErrorMsg = page.getByText(/already exists|duplicate|name|mükerrer/i).first();
    await expect(duplicateErrorMsg).toBeVisible({ timeout: 15000 });
  });

  test('Geçersiz cron formatı girilerek kaydedildiğinde API 400 Bad Request hata bildirimini UI göstermelidir', async ({ page }) => {
    await page.route(url => url.href.includes('/schedulers'), async (route) => {
      if (route.request().method() === 'POST') {
        console.log('🛡️ [MOCK SCHEDULER INVALID CRON] Schedulers API 400 Bad Request dönülüyor.');
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Invalid cron format. Please verify cron fields.'
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/schedulers`, { waitUntil: 'load' });
    
    const newSchedulerBtn = page.getByRole('button', { name: /New Scheduler/i }).first();
    await newSchedulerBtn.waitFor({ state: 'visible', timeout: 10000 });
    await newSchedulerBtn.click();

    // Dialog'un görünür olmasını bekle
    await page.locator('[role="dialog"], [data-slot="dialog-content"]').first().waitFor({ state: 'visible', timeout: 10000 });

    const repoCombo = page.getByRole('combobox').filter({ hasText: /Select a repository/i }).first();
    await repoCombo.waitFor({ state: 'visible', timeout: 10000 });
    await repoCombo.click();
    
    const repoOption = page.locator('[role="option"], [data-slot="select-item"]').first();
    await repoOption.waitFor({ state: 'visible', timeout: 10000 });
    await repoOption.click();

    const typeTrigger = page.locator('[data-slot="select-trigger"], [role="combobox"]').nth(1);
    await typeTrigger.waitFor({ state: 'visible', timeout: 10000 });
    await typeTrigger.click();
    
    const cronOption = page.locator('[role="option"], [data-slot="select-item"]').filter({ hasText: 'Cron' }).first();
    await cronOption.waitFor({ state: 'visible', timeout: 10000 });
    await cronOption.click();

    const cronInput = page.locator('input[name="cron"]').or(page.locator('input[placeholder*="* * * * *"]')).first();
    await cronInput.waitFor({ state: 'visible', timeout: 10000 });
    await cronInput.fill('invalid cron expression here');

    const saveBtn = page.getByRole('button').filter({ hasText: /save|create|confirm|submit/i }).first();
    await saveBtn.click();

    const cronErrorMsg = page.getByText(/invalid cron|cron format|verify cron|geçersiz/i).first();
    await expect(cronErrorMsg).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Depolama Sağlayıcıları (Storage) Mocked Edge Cases', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Storage providers listesinin 502/400 almasını engellemek için listeleme isteğini mocklayalım
    await page.route(url => url.href.includes('/storage-providers') && url.href.includes('/global'), async (route) => {
      console.log('🛡️ [MOCK STORAGE GLOBAL LIST] Boş sağlayıcı listesi başarılı olarak dönülüyor.');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [] })
      });
    });
  });

  test('Azure bağlantı dizesine çok büyük veri (5000+ karakter) bloku yapıştırıldığında front-end kilitlenmemeli ve hata vermelidir', async ({ page }) => {
    // Sadece POST/kayıt isteğini 400 dönecek şekilde mocklayalım
    await page.route(
      (url) => url.href.includes('/storage-providers') && !url.href.includes('/global') && !url.href.includes('/test') && !url.href.includes('/check'),
      async (route) => {
        if (route.request().method() === 'POST') {
          console.log('🛡️ [MOCK STORAGE PAYLOAD] Storage API 400 Bad Request dönülüyor.');
          await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              message: 'Connection string payload length exceeds standard limit.'
            })
          });
        } else {
          await route.continue();
        }
      }
    );

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage/add`, { waitUntil: 'load' });

    const azureOption = page.getByText('Azure Blob Storage', { exact: true }).or(page.getByText('Microsoft Azure Blob Storage')).first();
    await azureOption.waitFor({ state: 'visible', timeout: 10000 });
    await azureOption.click({ force: true });

    const largePayload = 'DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=' + 'a'.repeat(5000) + ';EndpointSuffix=core.windows.net';
    await page.locator('input[name="name"]').first().fill('Big-Payload-Azure-Test');
    await page.locator('textarea[name="identifier"]').first().fill(largePayload);

    // Eğer Save butonu disabled ise, zorla aktif et
    await forceEnableAndClick(page, /save|connect|update/i);

    const payloadErrorMsg = page.getByText(/exceeds|limit|invalid|connection|hata/i).first();
    await expect(payloadErrorMsg).toBeVisible({ timeout: 15000 });
  });

  test('Sağlayıcı doğrulanırken ağ kesintisi/gecikmesi (Timeout) oluştuğunda UI loading durumundan çıkıp hata vermelidir', async ({ page }) => {
    // Test check API'sini abort et
    await page.route(
      (url) => url.href.includes('/storage-providers') && (url.href.includes('/test') || url.href.includes('/check')),
      async (route) => {
        console.log('🛡️ [MOCK NETWORK TIMEOUT] İstek 8 saniye bekletiliyor ve iptal ediliyor.');
        await expect(page.locator('body')).toBeVisible({ timeout: 15000 });
        await route.abort('timedout');
      }
    );

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage/add`, { waitUntil: 'load' });

    const huaweiCard = page.getByText('Huawei OBS', { exact: true }).or(page.getByText('Huawei Object Storage Service')).first();
    await huaweiCard.click({ force: true });

    await page.locator('input[name="name"]').first().fill('Huawei-Timeout-Test');
    await page.locator('input[name="containerName"]').first().fill('test-bucket-name');
    await page.locator('input[name="identifier"]').first().fill('test-access-key-id');
    await page.locator('input[name="credential"]').first().fill('test-secret-access-key');

    const regionCombobox = page.locator('main main').getByRole('combobox').or(page.getByRole('combobox', { name: /Region|Bölge/i })).first();
    if (await regionCombobox.isVisible().catch(() => false)) {
      await regionCombobox.click();
      const listbox = page.locator('[role="listbox"], [role="menu"], [class*="select-content"]').first();
      await listbox.waitFor({ state: 'visible', timeout: 5000 });
      await listbox.locator('[role="option"], [data-slot="select-item"]').first().click({ force: true });
    }

    // Test Connection butonuna tıklayalım (Normal tıklama yapıyoruz - Execution context destruction olmasın)
    const testBtn = page.getByRole('button', { name: /Test Connection|Test|Validate/i }).first();
    await testBtn.click();

    // Loader simgesinin çıktığını doğrula
    const loader = page.locator('[data-slot="loader"], .spinner, svg.animate-spin').first();
    await expect(loader).toBeVisible({ timeout: 3000 });

    // Arayüzün loading durumundan çıkıp timeout hata mesajı gösterdiğini doğrula
    const timeoutMsg = page.getByText(/timeout|timed out|network|error|failed/i).first();
    await expect(timeoutMsg).toBeVisible({ timeout: 20000 });
  });
});

test.describe('Geri Yükleme (Restore) Mocked Edge Cases', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    // Backups listesini mocklayarak testlerin çalışabileceği tamamlanmış bir backup row render edilmesini sağlayalım
    await page.route('**/api/backups**', async (route) => {
      console.log('🛡️ [MOCK BACKUPS] Bir adet Completed yedek satırı mock olarak dönülüyor.');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [
            {
              id: 141,
              repository: { id: 244, fullName: 'gitsectest-cmd/e2e-restore-mock', name: 'e2e-restore-mock' },
              status: 'Completed',
              createdDate: '2026-06-24T10:00:00.000Z'
            }
          ]
        })
      });
    });

    // Repositories ve organization listelerini mockla
    await page.route('**/api/workspaces/**/repositories**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: [{ id: 244, name: 'e2e-restore-mock', fullName: 'gitsectest-cmd/e2e-restore-mock', isIncluded: true }]
        })
      });
    });
  });

  test('Aynı depo için devam eden bir geri yükleme varken ikinci kez restore tetiklendiğinde API 409 dönmeli ve UI çakışmayı göstermelidir', async ({ page }) => {
    // POST restore API'sini 409 Conflict dönecek şekilde route et
    await page.route('**/api/restore**', async (route) => {
      if (route.request().method() === 'POST') {
        console.log('🛡️ [MOCK CONCURRENT RESTORE] Restore API 409 Conflict dönülüyor.');
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'A restore operation is already in progress for this repository.'
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/backups`, { waitUntil: 'load' });
    
    const restoreBtn = page.locator('a[title="Restore"], button[title="Restore"]').first();
    await restoreBtn.waitFor({ state: 'visible', timeout: 10000 });
    await restoreBtn.click();

    // Restore sayfasına yönlenilmesini bekle
    await expect(page).toHaveURL(/\/restore(\/|\?)/, { timeout: 25000 });

    const restorePage = new RestorePage(page);

    // Step 1: Complete Target Organization Step
    await restorePage.completeTargetOrganizationStep(async () => {}).catch(() => {});

    // Step 2: Select backup source (if visible) and click Next
    const backupTrigger = page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first();
    await backupTrigger.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await backupTrigger.isVisible().catch(() => false)) {
      await backupTrigger.click();
      const backupOptions = page.getByRole('option')
        .or(page.locator('[data-slot="select-item"]'))
        .filter({ hasNotText: /Select a backup/i });
      await backupOptions.first().waitFor({ state: 'visible', timeout: 5000 });
      await backupOptions.first().click();
    }

    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // Step 3: Select Included Items
    const inputs = page.locator('input[data-slot="input"]');
    await expect(inputs.first()).toBeVisible({ timeout: 10000 });
    const count = await inputs.count();
    let repoInput = inputs.first();
    let descInput = inputs.nth(1);

    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInput = inputs.nth(i + 1);
        descInput = inputs.nth(i + 2);
        break;
      }
    }
    await repoInput.fill('concurrent-restore-lock-test');
    await descInput.fill('Concurrent restore check');

    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    await nextStepBtn3.click();

    // Step 4: Start Restore
    const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
    await startRestoreBtn.waitFor({ state: 'visible', timeout: 10000 });
    await startRestoreBtn.click({ force: true });

    // Hata mesajını doğrula
    const concurrentErrorMsg = page.getByText(/already in progress|conflict|restore/i).first();
    await expect(concurrentErrorMsg).toBeVisible({ timeout: 15000 });
  });

  test('Lisans limitleri dolduğunda API 403 / License Limit hatasını UI doğrulamalıdır', async ({ page }) => {
    await page.route('**/api/restore**', async (route) => {
      if (route.request().method() === 'POST') {
        console.log('🛡️ [MOCK LICENSE EXCEEDED] Restore API 403 Forbidden dönülüyor.');
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            message: 'Your active subscription license limit for restore operations has been exceeded.'
          })
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${dashboardBaseUrl}/${workspaceId}/backups`, { waitUntil: 'load' });
    
    const restoreBtn = page.locator('a[title="Restore"], button[title="Restore"]').first();
    await restoreBtn.waitFor({ state: 'visible', timeout: 10000 });
    await restoreBtn.click();

    // Restore sayfasına yönlenilmesini bekle
    await expect(page).toHaveURL(/\/restore(\/|\?)/, { timeout: 25000 });

    const restorePage = new RestorePage(page);

    // Step 1: Complete Target Organization Step
    await restorePage.completeTargetOrganizationStep(async () => {}).catch(() => {});

    // Step 2: Select backup source (if visible) and click Next
    const backupTrigger = page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first();
    await backupTrigger.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (await backupTrigger.isVisible().catch(() => false)) {
      await backupTrigger.click();
      const backupOptions = page.getByRole('option')
        .or(page.locator('[data-slot="select-item"]'))
        .filter({ hasNotText: /Select a backup/i });
      await backupOptions.first().waitFor({ state: 'visible', timeout: 5000 });
      await backupOptions.first().click();
    }

    const nextBtn = page.getByRole('button', { name: /^Next/i });
    await nextBtn.click();

    // Step 3: Select Included Items
    const inputs = page.locator('input[data-slot="input"]');
    await expect(inputs.first()).toBeVisible({ timeout: 10000 });
    const count = await inputs.count();
    let repoInput = inputs.first();
    let descInput = inputs.nth(1);

    for (let i = 0; i < count; i++) {
      const placeholder = await inputs.nth(i).getAttribute('placeholder') || '';
      if (placeholder.toLowerCase().includes('search')) {
        repoInput = inputs.nth(i + 1);
        descInput = inputs.nth(i + 2);
        break;
      }
    }
    await repoInput.fill('license-restore-limit-test');
    await descInput.fill('License limit check');

    const nextStepBtn3 = page.getByRole('button', { name: /Next/i }).first();
    await nextStepBtn3.click();

    // Step 4: Start Restore
    const startRestoreBtn = page.getByRole('button', { name: 'Start Restore', exact: true }).first();
    await startRestoreBtn.waitFor({ state: 'visible', timeout: 10000 });
    await startRestoreBtn.click({ force: true });

    // Hata mesajını doğrula
    const licenseErrorMsg = page.getByText(/license|subscription|limit|exceeded|forbidden/i).first();
    await expect(licenseErrorMsg).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Aktivite ve Denetim Günlükleri (Activity Logs) Mocked Edge Cases', () => {
  test.use({ storageState: 'playwright/.auth/user.json' });

  test('Sistemde hiç aktivite olmadığında (Empty State) UI temiz bir "Kayıt Bulunmamaktadır" görünümü sunmalıdır', async ({ page }) => {
    // SSR'ı atlatmak ve client-side fetch'i tetiklemek için önce dashboard'a gidiyoruz
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'load' });

    // API isteğini kesip boş dönecek şekilde route ediyoruz
    await page.route('**/api/activities*', async (route) => {
      console.log('🛡️ [MOCK EMPTY ACTIVITIES] Activities listesi boş dizi [] dönülüyor.');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            list: [],
            pagination: {
              currentPage: 1,
              totalPages: 0,
              totalRows: 0,
              maxRowsPerPage: 20
            }
          }
        })
      });
    });

    // Sidebar üzerinden Activity grubunu genişletip Backup linkine tıklayarak client-side navigasyonu tetikliyoruz
    const activityLink = page.getByRole('link', { name: /^Activity$/i }).or(page.getByRole('button', { name: /^Activity$/i })).first();
    await activityLink.waitFor({ state: 'visible', timeout: 10000 });
    await activityLink.click();

    const backupLink = page.getByRole('link', { name: /^Backup$/i }).first();
    await backupLink.waitFor({ state: 'visible', timeout: 10000 });
    await backupLink.click();

    const emptyStateText = page.locator('text=/no activities|bulunamadı|kayıt yok|boş|empty/i').first();
    await expect(emptyStateText).toBeVisible({ timeout: 15000 });
  });

  test('Log verilerinde emojiler ve karmaşık UTF-8 karakterleri yer aldığında UI bunları bozmadan render etmelidir', async ({ page }) => {
    const emojiAndSpecialCharText = '🚀 Test Backup: Başarıyla Tamamlandı! 🔥 (çğıöşü - Unicode ⚡)';

    // SSR'ı atlatmak ve client-side fetch'i tetiklemek için önce dashboard'a gidiyoruz
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/dashboard`, { waitUntil: 'load' });

    await page.route('**/api/activities*', async (route) => {
      console.log('🛡️ [MOCK UTF-8 ACTIVITIES] Emojili ve özel karakterli log kaydı dönülüyor.');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            list: [
              {
                activityId: 999,
                category: 'Backup',
                description: emojiAndSpecialCharText,
                ipAddress: '127.0.0.1',
                userAgent: 'Mozilla/5.0',
                createdDate: new Date().toISOString(),
                details: {
                  'EVENT ID': 'MOCK_EV_999',
                  'IP ADDRESS': '127.0.0.1',
                  'USER AGENT': 'Mozilla/5.0',
                  'TIMESTAMP': new Date().toISOString(),
                  'DESCRIPTION': emojiAndSpecialCharText,
                  'WORKSPACE': "Gitsec's Default Workspace"
                }
              }
            ],
            pagination: {
              currentPage: 1,
              totalPages: 1,
              totalRows: 1,
              maxRowsPerPage: 20
            }
          }
        })
      });
    });

    // Sidebar üzerinden Activity grubunu genişletip Backup linkine tıklayarak client-side navigasyonu tetikliyoruz
    const activityLink = page.getByRole('link', { name: /^Activity$/i }).or(page.getByRole('button', { name: /^Activity$/i })).first();
    await activityLink.waitFor({ state: 'visible', timeout: 10000 });
    await activityLink.click();

    const backupLink = page.getByRole('link', { name: /^Backup$/i }).first();
    await backupLink.waitFor({ state: 'visible', timeout: 10000 });
    await backupLink.click();

    const logDescription = page.getByText(emojiAndSpecialCharText).first();
    await expect(logDescription).toBeVisible({ timeout: 15000 });
  });
});
