/**
 * Register E2E Form Testi (UI Tabanlı, Mail.tm API Entegrasyonlu, Giriş ve Workspace ID Loglamalı)
 * 
 * Bu test:
 * 1. Mail.tm API'sinden geçici bir e-posta adresi oluşturur ve JWT Token alır.
 * 2. /sign-up sayfasına gider, tüm formu doldurur (İsim, Soyisim, E-posta, Şifreler, Koşullar).
 * 3. Captcha algılanırsa manuel çözülmesi için bekler.
 * 4. "Sign up" butonuna tıklar.
 * 5. Mail.tm API'sini dinleyerek (polling) gelen aktivasyon/doğrulama mailini bekler.
 * 6. Gelen mailin içeriğindeki aktivasyon linkini regex ile çıkarıp tarayıcıda açar ve kaydı doğrular.
 * 7. Giriş (Login) sayfasına yönlendikten sonra oluşturulan yeni bilgiler ile giriş yapar.
 * 8. Giriş sonrası yönlenilen Dashboard URL'inden ve Workspace API yanıtından Workspace ID bilgisini çıkarıp loglar ve saklar.
 *
 * Çalıştırma: npx playwright test tests/e2e/auth/register.spec.ts
 */
import { test, expect } from '../../fixtures/test';
import * as fs from 'fs';
import * as path from 'path';

function generateRandomString(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function generateRandomLetters(length: number) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

test.describe('Register — UI Kayıt Formu E2E & Mail.tm Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Mail.tm ile geçici mail alıp kayıt olma, doğrulama, login ve Workspace ID loglama',
    { tag: ['@manual-interactive'] },
    async ({ page, registerPage, loginPage }) => {
      test.setTimeout(1_800_000); // 30 dakika tolerans

      // ─── ADIM 1: Mail.tm API'sinden geçici e-posta oluştur ve JWT Token al ───
      console.log('📧 [E2E] Mail.tm API üzerinden domain listesi alınıyor...');
      const domainResponse = await page.request.get('https://api.mail.tm/domains');
      expect(domainResponse.ok()).toBeTruthy();
      const domainData = await domainResponse.json();
      const domain = domainData['hydra:member'][0].domain;

      const randomFirstName = 'TestName' + generateRandomLetters(5);
      const randomLastName = 'TestSurname' + generateRandomLetters(5);
      const emailPrefix = 'gitsec_test_' + generateRandomString(6);
      const randomEmail = `${emailPrefix}@${domain}`;
      const randomPassword = 'Password123!_' + generateRandomString(5);

      console.log(`📧 [E2E] E-posta adresi belirlendi: ${randomEmail}`);

      // 1a. Hesap oluştur
      const accountResponse = await page.request.post('https://api.mail.tm/accounts', {
        data: { address: randomEmail, password: randomPassword }
      });
      expect(accountResponse.ok()).toBeTruthy();
      console.log('✅ [E2E] Mail.tm hesabı başarıyla açıldı.');

      // 1b. Giriş yapıp JWT Token al
      console.log('🔑 [E2E] Mail.tm JWT Token alınıyor...');
      const tokenResponse = await page.request.post('https://api.mail.tm/token', {
        data: { address: randomEmail, password: randomPassword }
      });
      expect(tokenResponse.ok()).toBeTruthy();
      const tokenData = await tokenResponse.json();
      const jwtToken = tokenData.token;
      console.log('✅ [E2E] JWT Token başarıyla alındı.');

      // ─── ADIM 2: Sign-up sayfasına git ───
      await registerPage.goto();

      // ─── ADIM 3: Tüm form alanlarını doldur ───
      await registerPage.fillForm(randomFirstName, randomLastName, randomEmail, randomPassword);

      // ─── ADIM 4: Captcha algıla ve çözülmesini bekle ───
      await registerPage.handleCaptchaIfVisible(600000, 10000);

      // ─── ADIM 5: Koşulları onayla ───
      console.log('☑️ [E2E] Kullanım koşulları ve Gizlilik politikası onay kutuları işaretleniyor...');
      const termsCheckbox = page.getByRole('checkbox', { name: /terms of service/i });
      const privacyCheckbox = page.getByRole('checkbox', { name: /privacy policy/i });

      await termsCheckbox.click();
      await expect(termsCheckbox).toHaveAttribute('data-state', 'checked', { timeout: 5000 });
      console.log('✅ [E2E] Kullanım koşulları (#terms) başarıyla işaretlendi.');

      await privacyCheckbox.click();
      await expect(privacyCheckbox).toHaveAttribute('data-state', 'checked', { timeout: 5000 });
      console.log('✅ [E2E] Gizlilik politikası (#privacy) başarıyla işaretlendi.');

      // ─── ADIM 6: Kayıt Formunu Gönder ───
      console.log('🔘 [E2E] Kayıt formu gönderiliyor...');
      await registerPage.submit();

      // ─── ADIM 7: Mail.tm gelen kutusunu dinle (Polling) ───
      console.log('⏳ [E2E] Aktivasyon e-postası bekleniyor (Mail.tm dinleniyor)...');
      let messageId: string | null = null;
      await expect(async () => {
        const messagesResponse = await page.request.get('https://api.mail.tm/messages', {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        });

        if (!messagesResponse.ok()) {
          throw new Error('Failed to fetch messages');
        }

        const messagesData = await messagesResponse.json();
        const messagesList = messagesData['hydra:member'];
        
        if (!messagesList || messagesList.length === 0) {
          throw new Error('No messages arrived yet');
        }

        messageId = messagesList[0].id;
        console.log(`📩 [E2E] Doğrulama e-postası ulaştı! Mesaj ID: ${messageId}`);
      }).toPass({ timeout: 60000, intervals: [5000] });

      if (!messageId) {
        throw new Error('❌ [E2E] Aktivasyon e-postası belirlenen sürede Mail.tm gelen kutusuna ulaşmadı.');
      }

      // ─── ADIM 8: E-posta içeriğini oku ve doğrulama linkini çıkar ───
      console.log('📖 [E2E] E-posta detayları çekiliyor...');
      const messageDetailResponse = await page.request.get(`https://api.mail.tm/messages/${messageId}`, {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });
      expect(messageDetailResponse.ok()).toBeTruthy();
      const messageDetail = await messageDetailResponse.json();
      
      const emailHtml = messageDetail.html ? messageDetail.html[0] : '';
      const emailText = messageDetail.text ? messageDetail.text : '';
      const emailContent = emailHtml + ' ' + emailText;

      const urlRegex = /(https?:\/\/[^\s"']+(?:verify|confirm|activate|auth|check)[^\s"']*)/i;
      const match = emailContent.match(urlRegex);

      if (!match) {
        throw new Error('❌ [E2E] E-posta içeriğinde doğrulama linki tespit edilemedi.');
      }

      const verificationLink = match[1];
      console.log(`🔗 [E2E] Doğrulama Linki Tespit Edildi: ${verificationLink}`);

      // ─── ADIM 9: Doğrulama linkini aç ───
      console.log(`🚀 [E2E] Doğrulama sayfasına yönlendiriliyor...`);
      await page.goto(verificationLink);
      await page.waitForLoadState('domcontentloaded');

      const signInRedirectButton = page.locator('a, button').filter({ hasText: /sign in|log in|giriş/i }).first();
      
      const redirectedDirectly = await page.waitForURL(/\/(?:sign-in|login)(?:[/?#]|$)/i, { timeout: 5000 })
        .then(() => true)
        .catch(() => false);

      if (!redirectedDirectly) {
        await expect(signInRedirectButton).toBeVisible({ timeout: 15000 });
        console.log('👆 [E2E] Doğrulama başarılı! Sayfadaki "Sign in" butonuna otomatik tıklanıyor...');
        await signInRedirectButton.click();
        await expect(page).toHaveURL(/\/(?:sign-in|login)(?:[/?#]|$)/i, { timeout: 15000 });
      }

      // ─── ADIM 10: Yeni Hesaba Giriş Yap (Login) ve Workspace ID Bilgisini Çıkar ───
      console.log('🔐 [E2E] Doğrulama sonrası yeni oluşturulan kullanıcı ile Giriş Yapılıyor...');
      await expect(loginPage.emailInput).toBeVisible({ timeout: 15000 });

      // Workspace API yanıtını ve URL yönlendirmesini takip et
      const workspacesResponsePromise = page.waitForResponse(response =>
        response.url().includes('/workspaces') && response.status() === 200
      ).catch(() => null);

      await loginPage.fillForm(randomEmail, randomPassword);
      await loginPage.handleCaptchaIfVisible(600000, 10000, false);
      await loginPage.submit();

      // ─── ADIM 10a: Onboarding Sihirbazı (İlk Kullanım) Butonlarına Bas ───
      // Yeni kayıt olmuş kullanıcıya ilk giriş sonrası onboarding wizard gösteriliyor.
      // Sırasıyla: "Let's Get Started" → "Continue" → "Continue" → "Go to Dashboard"
      console.log('🧭 [E2E] Onboarding sihirbazı adımları bekleniyor...');

      const onboardingButtons = [
        "Let's Get Started",
        'Continue',
        'Continue',
        'Go to Dashboard',
      ];

      for (const btnLabel of onboardingButtons) {
        // Buton ekranda belirene kadar bekle (onboarding animasyonları olabilir)
        const btn = page.getByRole('button', { name: new RegExp(btnLabel, 'i') }).first();
        await expect(btn).toBeVisible({ timeout: 30_000 });
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click();
        console.log(`  ✅ [ONBOARDING] "${btnLabel}" butonuna tıklandı.`);
        // Adımlar arası kısa bekleme (geçiş animasyonu)
        await page.waitForTimeout(500);
      }

      console.log('🏠 [E2E] Onboarding tamamlandı! Dashboard yönlendirmesi bekleniyor...');

      // Dashboard'a yönlenmeyi bekle
      console.log('⏳ [E2E] Dashboard yönlendirmesi ve Workspace bilgisi bekleniyor...');
      await page.waitForURL(/dashboard\.gitsec\.io\/\d+/i, { timeout: 30_000 }).catch(() => {});

      let workspaceId: string | number | undefined;

      // 1. Yol: Workspace API yanıtından al
      const workspacesResponse = await workspacesResponsePromise;
      if (workspacesResponse) {
        const body = await workspacesResponse.json().catch(() => null);
        workspaceId = body?.data?.list?.[0]?.id || body?.data?.[0]?.id;
      }

      // 2. Yol: Sayfa URL'inden al
      if (!workspaceId) {
        const urlMatch = page.url().match(/dashboard\.gitsec\.io\/(\d+)/);
        if (urlMatch) {
          workspaceId = urlMatch[1];
        }
      }

      // 3. Yol: localStorage gs-auth veya gs-workspace bilgisinden al
      if (!workspaceId) {
        workspaceId = await page.evaluate(() => {
          try {
            const rawAuth = window.localStorage.getItem('gs-auth');
            if (rawAuth) {
              const parsed = JSON.parse(rawAuth);
              return parsed?.state?.auth?.user?.workspaceId || parsed?.state?.workspace?.currentWorkspaceId;
            }
          } catch {
            return null;
          }
          return null;
        }).catch(() => undefined);
      }

      console.log('\n🎉 [E2E] Kayıt, e-posta doğrulama ve Giriş testi başarıyla tamamlandı!');
      console.log('==================================================');
      console.log('📋 YENİ KULLANICI & WORKSPACE DETAYLARI:');
      console.log(`   📧 E-posta     : ${randomEmail}`);
      console.log(`   🔑 Şifre       : ${randomPassword}`);
      console.log(`   👤 İsim        : ${randomFirstName} ${randomLastName}`);
      console.log(`   🏢 Workspace ID: ${workspaceId || 'Tespit Edilemedi'}`);
      console.log('==================================================\n');

      // ─── ADIM 11: Tüm Bilgileri JSON Dosyasına Kaydet ───
      const userData = {
        email: randomEmail,
        password: randomPassword,
        firstName: randomFirstName,
        lastName: randomLastName,
        workspaceId: workspaceId || null,
        registeredAt: new Date().toISOString()
      };

      try {
        const outputPath = path.join(process.cwd(), 'last-registered-user.json');
        fs.writeFileSync(outputPath, JSON.stringify(userData, null, 2), 'utf-8');
        console.log(`💾 [E2E] Kullanıcı ve Workspace bilgileri dosyaya kaydedildi: ${path.resolve(outputPath)}`);
      } catch (err) {
        console.error('⚠️ [E2E] Kullanıcı bilgileri dosyaya kaydedilirken hata oluştu:', err);
      }
    }
  );
});
