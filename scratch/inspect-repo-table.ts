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
  
  console.log(`Navigating to ${dashboardBaseUrl}/${workspaceId}/repositories/github`);
  await page.goto(`${dashboardBaseUrl}/${workspaceId}/repositories/github`, { waitUntil: 'networkidle' });
  
  const rowsHtml = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.slice(0, 3).map(row => row.innerHTML);
  });
  
  console.log('HTML of first few rows:');
  rowsHtml.forEach((html, i) => {
    console.log(`--- Row ${i} ---`);
    console.log(html);
  });
  
  await browser.close();
}

main().catch(console.error);
