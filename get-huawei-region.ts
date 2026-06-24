import { chromium } from '@playwright/test';
import * as path from 'path';
import { requireEnv } from './tests/support/require-env';

async function main() {
  const authFile = path.resolve('playwright/.auth/user-with-provider.json');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();

  const workspaceId = requireEnv('WORKSPACE_ID');
  const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');

  await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage/add`, { waitUntil: 'domcontentloaded' });

  // Click the element that has "Huawei" and is a card or button
  const huaweiCard = page.locator('h3, h4, p, div, span, button, a').filter({ hasText: /^Huawei OBS$/ }).first();
  if (await huaweiCard.isVisible()) {
    console.log('Huawei OBS element is visible! Clicking...');
    await huaweiCard.click();
    await page.waitForLoadState('domcontentloaded');

    // Print all buttons and visible text inside the form
    const formHtml = await page.evaluate(() => {
      const form = document.querySelector('form') || document.querySelector('main main');
      if (!form) return 'Form not found';
      
      // Get all interactive elements
      return Array.from(form.querySelectorAll('*')).map(el => {
        const text = el.textContent?.trim();
        const role = el.getAttribute('role');
        const ariaHasPopup = el.getAttribute('aria-haspopup');
        return {
          tagName: el.tagName,
          text: text ? text.substring(0, 100) : '',
          role,
          ariaHasPopup,
          id: el.id,
          class: el.className
        };
      }).filter(item => ['BUTTON', 'SELECT', 'INPUT', 'TEXTAREA'].includes(item.tagName) || item.role === 'combobox' || item.ariaHasPopup);
    });
    console.log('Form interactive elements:');
    console.log(JSON.stringify(formHtml, null, 2));
  } else {
    console.log('Huawei OBS element is not visible.');
  }

  await browser.close();
}

main().catch(console.error);
