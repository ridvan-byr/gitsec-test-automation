import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  /* Global timeout for each test */
  timeout: 60000,
  /* Sıralı/Paralel koşum ayarı (env ile esnetilebilir) */
  fullyParallel: process.env.FULLY_PARALLEL === 'true',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Varsayılan olarak tek worker (OAuth/CI çakışmalarını önlemek için), env ile artırılabilir */
  workers: process.env.PLAYWRIGHT_WORKERS ? parseInt(process.env.PLAYWRIGHT_WORKERS) : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  expect: {
    timeout: 10000,
  },
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL from .env */
    baseURL: process.env.DASHBOARD_BASE_URL,

    httpCredentials: process.env.E2E_BASIC_AUTH_USER ? {
      username: process.env.E2E_BASIC_AUTH_USER,
      password: process.env.E2E_BASIC_AUTH_PASS || '',
    } : undefined,

    /* Hata durumunda veya başarıda ekran görüntüsü, tam çözünürlüklü video ve trace (iz kaydı) topla */
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: {
      mode: 'retain-on-failure',
      size: { width: 1280, height: 720 },
    },
    actionTimeout: 15000,
    navigationTimeout: 20000,
  },

  /* Tek browser ile çalış: tekrar tekrar sayfa açılmasını engeller */
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'provider-setup',
      dependencies: ['setup'],
      testMatch: /provider\.setup\.ts/,
      use: {
        storageState: 'playwright/.auth/user.json',
      }
    },
    {
      name: 'chromium-unauthenticated',
      testMatch: /tests\/e2e\/auth\/(api-login-smoke|forgot-password|forgot-password-mocked|login|login-failures|login-mocked|register|register-failures)\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        channel: process.env.CI ? undefined : 'chrome',
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
          ],
        },
      }
    },
    {
      name: 'chromium-connect',
      dependencies: ['setup'],
      testMatch: [
        /tests\/e2e\/providers\/(github|bitbucket)-connect\.spec\.ts/,
        /tests\/e2e\/billing\/license-change\.spec\.ts/
      ],
      use: { 
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
        channel: process.env.CI ? undefined : 'chrome',
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
          ],
        },
      }
    },
    {
      name: 'chromium',
      dependencies: ['provider-setup'],
      testIgnore: [
        /tests\/e2e\/auth\/(api-login-smoke|forgot-password|forgot-password-mocked|login|login-failures|login-mocked|register|register-failures)\.spec\.ts/,
        /tests\/e2e\/providers\/(github|bitbucket)-connect\.spec\.ts/,
        /tests\/e2e\/billing\/license-change\.spec\.ts/
      ],
      use: { 
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user-with-provider.json',
        channel: process.env.CI ? undefined : 'chrome',
        launchOptions: {
          args: [
            '--disable-blink-features=AutomationControlled',
          ],
        },
      }
    },
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
