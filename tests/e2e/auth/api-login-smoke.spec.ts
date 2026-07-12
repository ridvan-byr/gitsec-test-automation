import { test, expect } from '../../fixtures/test';
import { requireEnv } from '../../support/require-env';

test.describe('Login API — Giriş Servisi Entegrasyon Akışı', () => {
  test('Doğru kullanıcı bilgileriyle API üzerinden token alınabilmeli', { tag: ['@smoke', '@critical'] }, async ({ request }) => {
    const apiBaseUrl = requireEnv('API_BASE_URL');
    const email = requireEnv('E2E_USER_EMAIL');
    const password = requireEnv('E2E_USER_PASSWORD');

    console.log(`📡 [API Smoke] Giriş isteği gönderiliyor... (Endpoint: ${apiBaseUrl}/auth/signin)`);
    const response = await request.post(`${apiBaseUrl}/auth/signin`, {
      data: {
        email,
        password,
      },
    });

    // HTTP durum kodunu kontrol et
    expect(response.status()).toBe(200);

    const body = await response.json();
    console.log('✅ [API Smoke] Giriş cevabı başarılı.');

    // Yanıt yapısını doğrula (Token ve E-posta mevcudiyeti)
    expect(body).toHaveProperty('success', true);
    expect(body?.data?.token).toBeDefined();
    expect(body?.data?.email).toBe(email);

    // Workspaces endpointini çağır ve logla
    console.log('📡 [API Smoke] Workspaces listesi çekiliyor...');
    const wsResponse = await request.get(`${apiBaseUrl}/api/workspaces`, {
      headers: {
        'Authorization': `Bearer ${body.data.token}`
      }
    });
    console.log('Workspaces status:', wsResponse.status());
    const wsBody = await wsResponse.json();
    console.log('WORKSPACES API RESPONSE:', JSON.stringify(wsBody, null, 2));

    // Storage policies check endpointini çağır ve logla
    console.log('📡 [API Smoke] Storage policies check çağrılıyor...');
    const spResponse = await request.get(`${apiBaseUrl}/api/storage-policies/policies/check`, {
      headers: {
        'Authorization': `Bearer ${body.data.token}`
      }
    });
    console.log('Storage policies status:', spResponse.status());
    const spBody = await spResponse.json();
    console.log('STORAGE POLICIES RESPONSE:', JSON.stringify(spBody, null, 2));
  });
});
