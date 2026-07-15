import { expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export interface AuditLogExpectation {
  category: string;
  descriptionRegex: RegExp;
  timeoutMs?: number;
  strictFields?: boolean; // If true, asserts that checked fields are not placeholders/empty
}

/**
 * Normalizes a category string by removing special characters, spaces, and converting to lowercase.
 * This ensures robust matching across "Storage Provider" and "STORAGE_PROVIDER".
 */
function normalizeCategory(s: string): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if a value is empty, null, undefined, or a generic placeholder.
 */
function isPlaceholder(val: any): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === 'string') {
    const clean = val.trim();
    return clean === '' || clean === '-' || clean.toLowerCase() === 'n/a' || clean.toLowerCase() === 'unknown';
  }
  return false;
}

/**
 * Verifies that the correct activity log exists in the database by querying the API.
 * Scans root and nested details for empty fields, and prints descriptive warnings.
 */
export async function verifyAuditLogViaAPI(page: Page, expectation: AuditLogExpectation) {
  const timeoutMs = expectation.timeoutMs ?? 15000;
  const category = expectation.category;
  const descriptionRegex = expectation.descriptionRegex;

  console.log(`\n🔍 [API Audit Verification] Category: "${category}", Description regex: ${descriptionRegex.toString()}`);

  // 1. Get gs_token from the active browser context cookies
  let token = '';
  const cookies = await page.context().cookies().catch(() => []);
  const tokenCookie = cookies.find(c => c.name === 'gs_token');
  if (tokenCookie) {
    token = tokenCookie.value;
  } else {
    // Fallback: Read from storageState file
    try {
      const authPath = path.join(process.cwd(), 'playwright/.auth/user-with-provider.json');
      if (fs.existsSync(authPath)) {
        const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));
        const fileCookie = authData.cookies?.find((c: any) => c.name === 'gs_token');
        if (fileCookie) {
          token = fileCookie.value;
        }
      }
    } catch (err: any) {
      console.warn(`[API Audit] Failed to read auth file: ${err.message}`);
    }
  }

  if (!token) {
    throw new Error('❌ [API Audit] Could not retrieve gs_token from context cookies or auth file!');
  }

  // 2. Resolve Workspace ID
  let workspaceId = process.env.WORKSPACE_ID || '';
  const urlMatch = page.url().match(/\/(\d+)\//);
  if (urlMatch && urlMatch[1]) {
    workspaceId = urlMatch[1];
  }
  if (!workspaceId) {
    throw new Error('Missing required environment variable: WORKSPACE_ID');
  }

  // 3. Poll API endpoint for matching log using expect().toPass()
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error('Missing required environment variable: API_BASE_URL');
  }
  const targetUrl = `${apiBaseUrl}/api/activities/?Pagination.CurrentPage=1&Pagination.MaxRowsPerPage=20`;
  let matchedItem: any = null;

  await expect(async () => {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'workspace-id': workspaceId,
        'WorkspaceId': workspaceId,
        'X-Workspace-Id': workspaceId
      }
    });

    if (!response.ok) {
      throw new Error(`[API Audit] GET /activities returned status ${response.status} ${response.statusText}`);
    }

    const json = await response.json();
    const list = json.data?.list || [];
    
    // Find matching item
    for (const item of list) {
      const itemCategory = item.category || '';
      const itemDescription = item.description || '';
      
      const catMatches = normalizeCategory(itemCategory) === normalizeCategory(category) || 
                         itemCategory.toLowerCase().includes(category.toLowerCase()) || 
                         category.toLowerCase().includes(itemCategory.toLowerCase());
      
      const descMatches = descriptionRegex.test(itemDescription);

      if (catMatches && descMatches) {
        matchedItem = item;
        return;
      }
    }
    throw new Error('Matching log item not found yet');
  }).toPass({ timeout: timeoutMs, intervals: [2000] });

  if (!matchedItem) {
    const err = `❌ [API Audit Error] Expected log not found within ${timeoutMs}ms for Category: "${category}" and Description matching ${descriptionRegex.toString()}`;
    console.error(err);
    throw new Error(err);
  }

  // 4. Log matched activity and details
  console.log(`✅ [API Audit Match] Found activity log:`);
  console.log(`   - Activity ID: ${matchedItem.activityId}`);
  console.log(`   - Category: ${matchedItem.category}`);
  console.log(`   - Description: ${matchedItem.description}`);
  console.log(`   - IP Address: ${matchedItem.ipAddress}`);
  console.log(`   - User Agent: ${matchedItem.userAgent}`);
  console.log(`   - Created Date: ${matchedItem.createdDate}`);
  console.log(`   - Details: ${JSON.stringify(matchedItem.details)}`);

  // 5. Empty Field Scanner
  // Scan root fields
  const rootFieldsToCheck = ['ipAddress', 'userAgent', 'operatingSystem'];
  for (const field of rootFieldsToCheck) {
    const val = matchedItem[field];
    if (isPlaceholder(val)) {
      const msg = `⚠️ [AUDIT WARNING] Root field '${field}' is empty/placeholder in API log (Value: ${JSON.stringify(val)}) for Category "${matchedItem.category}" / Description: "${matchedItem.description}"`;
      console.warn(msg);
      if (expectation.strictFields) {
        expect(isPlaceholder(val), `Root field '${field}' must not be empty or a placeholder: ${msg}`).toBeFalsy();
      }
    }
  }

  // Scan details fields
  if (matchedItem.details && typeof matchedItem.details === 'object') {
    for (const [key, val] of Object.entries(matchedItem.details)) {
      if (isPlaceholder(val)) {
        const msg = `⚠️ [AUDIT WARNING] Detail field '${key}' is empty/placeholder in API log (Value: ${JSON.stringify(val)}) for Category "${matchedItem.category}" / Description: "${matchedItem.description}"`;
        console.warn(msg);
        if (expectation.strictFields) {
          expect(isPlaceholder(val), `Detail field '${key}' must not be empty or a placeholder: ${msg}`).toBeFalsy();
        }
      }
    }
  }

  return matchedItem;
}
