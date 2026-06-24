import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { requireEnv } from '../tests/support/require-env';

const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
const authFile = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
const workspaceId = requireEnv('WORKSPACE_ID');

async function main() {
  if (!fs.existsSync(authFile)) {
    console.error(`❌ Auth file not found at ${authFile}. Please run global setup first.`);
    process.exit(1);
  }

  console.log('🚀 Starting Smart Audit Log scraper (Keyed strictly by Category::Action)...');
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: authFile });
  
  // Skip onboarding tour
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'gs-tour',
        JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
      );
    } catch {
      // ignore
    }
  });

  const page = await context.newPage();
  
  try {
    console.log(`🧭 Navigating directly to Audit Logs page...`);
    await page.goto(`${dashboardBaseUrl}/${workspaceId}/audit-logs`, { waitUntil: 'load' });
    await page.waitForTimeout(4000);
    console.log(`📍 Current Page URL: ${page.url()}`);

    const uniqueLogs: Record<string, any> = {};
    let pageNum = 1;
    let hasNextPage = true;

    // Normalization regex helper
    function normalizeDescription(desc: string): string {
      if (!desc) return '';
      return desc
        .replace(/https?:\/\/[^\s]+/g, '{url}')
        .replace(/(?:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g, '{uuid}')
        .replace(/(?:[0-9a-fA-F]{40})/g, '{hash}')
        .replace(/\b(?:OneDrive|GoogleDrive|Dropbox|Box|S3|GoogleCloud|AzureBlob|HuaweiOBS|SharePoint|OneDrivePersonal)\b/gi, '{providerType}')
        .replace(/[a-zA-Z0-9.\-_]+@[a-zA-Z0-9.\-_]+\.[a-zA-Z]{2,}/g, '{email}')
        .replace(/\b(?:OneDrive|GoogleDrive|Dropbox|Box|S3|GoogleCloud|AzureBlob|HuaweiOBS|SharePoint|OneDrivePersonal|AWS-S3|Azure|Huawei|Google|GitHub|Gitsec)-E2E-\d+\b/gi, '{providerName}')
        .replace(/\b(?:e2e-restore|e2e-backup|e2e-repo|e2e-restore-)\d+\b/gi, '{repoName}')
        .replace(/\b\d{10,13}\b/g, '{timestamp}')
        .replace(/(?:\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2})/g, '{datetime}')
        .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '{ip}')
        .replace(/\b(?:Gitsec Testt|Gitsec Test|Gitsec|Testt|tunahantest|ridvan-byr)\b/gi, '{actor}');
    }

    while (hasNextPage) {
      console.log(`📄 Scraping page ${pageNum}...`);
      
      const tableBody = page.locator('tbody').first();
      await tableBody.waitFor({ state: 'visible', timeout: 15000 });
      
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      
      if (count === 0) {
        console.log('⚠️ No rows found on this page.');
        break;
      }

      const firstRowBefore = await rows.first().innerText().catch(() => '');

      for (let i = 0; i < count; i++) {
        // Re-query rows inside loop to avoid stale element references
        const row = page.locator('tbody tr').nth(i);
        const cells = row.locator('td');
        const cellCount = await cells.count();
        
        if (cellCount >= 5) {
          const actor = (await cells.nth(0).innerText()).trim();
          const category = (await cells.nth(1).innerText()).trim();
          const action = (await cells.nth(2).innerText()).trim();
          const description = (await cells.nth(3).innerText()).trim();
          const ipAddress = (await cells.nth(4).innerText()).trim();

          if (!category || !action) continue;

          // Key strictly by Category + Action
          const uniqueKey = `${category}::${action}`;

          if (!uniqueLogs[uniqueKey]) {
            console.log(`✨ New Unique Pair: [${category}] - [${action}]. Expanding inline details...`);
            
            // Expand details (click the chevron button at the end of the row)
            await row.scrollIntoViewIfNeeded().catch(() => {});
            const expandBtn = row.locator('button').last();
            await expandBtn.click({ force: true });
            
            // Wait for the expanded panel row to appear (contains 'IP Address' label)
            const expandedPanel = page.locator('tbody tr').filter({ hasText: /IP Address|User Agent/i }).first();
            await expandedPanel.waitFor({ state: 'visible', timeout: 10000 });
            
            const panelText = await expandedPanel.innerText();

            uniqueLogs[uniqueKey] = {
              category,
              action,
              normalizedDescription: normalizeDescription(description),
              exampleDescription: description,
              exampleActor: actor,
              exampleIpAddress: ipAddress,
              expandedDetailsText: panelText
            };

            console.log(`   Saved. Details Text Sample: "${panelText.substring(0, 80).replace(/\n/g, ' ')}..."`);

            // Collapse details (click the chevron again)
            await expandBtn.click({ force: true });
            await expandedPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(500);
          }
        }
      }

      // Try to click the next page button
      const nextPageBtn = page.locator('button[aria-label="Go to next page"]').first();
      if (await nextPageBtn.isVisible().catch(() => false)) {
        const isDisabled = await nextPageBtn.evaluate((el) => {
          return el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true' || el.classList.contains('disabled');
        }).catch(() => true);
        
        if (!isDisabled) {
          pageNum++;
          console.log('➡️ Clicking Next Page...');
          await nextPageBtn.click();
          
          // Wait until the first row changes to verify navigation occurred
          let transitionSucceeded = false;
          try {
            await page.waitForFunction((oldText) => {
              const firstRow = document.querySelector('tbody tr');
              return firstRow && (firstRow as HTMLElement).innerText !== oldText;
            }, firstRowBefore, { timeout: 10000 });
            transitionSucceeded = true;
          } catch (err) {
            console.log('⚠️ Page transition timed out. Page content did not change.');
          }

          if (!transitionSucceeded) {
            console.log('🏁 Content did not change after clicking Next. Reached the end.');
            hasNextPage = false;
          }
          
          await page.waitForTimeout(1000);
        } else {
          console.log('🏁 Next page button is disabled. Reached the end.');
          hasNextPage = false;
        }
      } else {
        console.log('🏁 Next page button not found. Reached the end.');
        hasNextPage = false;
      }
    }

    // Convert map to list and save
    const uniqueList = Object.values(uniqueLogs);
    const outputPath = path.join(process.cwd(), 'tests/fixtures/audit-logs-unique-templates.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(uniqueList, null, 2), 'utf8');

    console.log(`\n🎉 Scraper completed!`);
    console.log(`📁 Scraped ${pageNum} pages. Saved ${uniqueList.length} unique Category::Action templates (with inline details) to: ${outputPath}`);
  } catch (err: any) {
    console.error(`❌ Scraper Error encountered at URL: ${page.url()}`);
    console.error(err);
    const errorScreenshot = path.join(process.cwd(), 'scraper-error.png');
    await page.screenshot({ path: errorScreenshot });
    console.log(`📸 Saved error screenshot to: ${errorScreenshot}`);
  } finally {
    await browser.close();
  }
}

main().catch(console.error);
