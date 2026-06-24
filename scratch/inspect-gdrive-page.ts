import { chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const authFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
  
  if (!fs.existsSync(authFile)) {
    console.error('Auth file not found!');
    await browser.close();
    return;
  }
  
  const context = await browser.newContext({
    storageState: authFile
  });
  
  const page = await context.newPage();
  const workspaceId = '28';
  const dashboardBaseUrl = 'https://staging.dashboard.gitsec.io';
  
  console.log(`Navigating to ${dashboardBaseUrl}/${workspaceId}/storage/add?provider=GDrive`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/storage/add?provider=GDrive`, { waitUntil: 'networkidle' });
  
  // Wait a few seconds
  await page.waitForTimeout(4000);
  
  const bodyHtml = await page.evaluate(() => {
    return document.body.innerHTML;
  });
  
  console.log('Body HTML snapshot:');
  // Print inputs and buttons specifically
  const elements = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input, button, [role="button"], label')).map(el => {
      return {
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        text: (el as HTMLElement).innerText || el.textContent || '',
        disabled: (el as any).disabled || false,
        className: el.className || '',
        outerHTML: el.outerHTML.substring(0, 200)
      };
    });
  });
  
  console.log(JSON.stringify(elements, null, 2));
  
  await browser.close();
}

main().catch(console.error);
