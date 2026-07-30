/**
 * CI ön kontrol: staging Basic Auth ve sign-in erişimini doğrular.
 * Secret yoksa veya yanlışsa testlerden önce net hata verir.
 */

const dashboardUrl = (process.env.DASHBOARD_BASE_URL || 'https://staging.dashboard.gitsec.io').replace(/\/$/, '');
const apiUrl = (process.env.API_BASE_URL || 'https://staging.api.gitsec.io').replace(/\/$/, '');
const user = process.env.E2E_BASIC_AUTH_USER?.trim();
const pass = process.env.E2E_BASIC_AUTH_PASS ?? '';

function fail(message) {
  console.error('\n❌ CI STAGING ERİŞİM HATASI');
  console.error(message);
  console.error('\nÇözüm (repo admin gerekir):');
  console.error('  GitHub → Settings → Secrets and variables → Actions');
  console.error('  E2E_BASIC_AUTH_USER ve E2E_BASIC_AUTH_PASS ekleyin (local .env ile aynı değerler).');
  console.error('  Fork PR ise secret\'lar CI\'a verilmez; dalı ana repoya push edin.\n');
  process.exit(1);
}

if (!user) {
  fail('E2E_BASIC_AUTH_USER tanımlı değil. Staging /sign-in 401 döner; auth testleri geçemez.');
}

const authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

async function checkUrl(label, url) {
  const res = await fetch(url, { headers: { Authorization: authHeader } });
  if (res.status === 401 || res.status === 403) {
    const body = (await res.text()).slice(0, 120);
    fail(`${label} (${url}) → HTTP ${res.status}. Basic Auth reddedildi. Yanıt: ${body}`);
  }
  if (!res.ok) {
    console.warn(`⚠️ ${label} (${url}) → HTTP ${res.status} (devam ediliyor)`);
    return;
  }
  console.log(`✅ ${label} erişilebilir (HTTP ${res.status})`);
}

console.log('🔐 Staging Basic Auth ön kontrolü...');
await checkUrl('Dashboard sign-in', `${dashboardUrl}/sign-in`);
await checkUrl('API signin endpoint', `${apiUrl}/auth/signin`);
console.log('✅ Staging erişim kontrolü tamam.\n');
