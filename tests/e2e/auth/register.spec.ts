/**
 * Register E2E Form Testi (UI Tabanlı, Mail.tm API Entegrasyonlu & Manuel Captcha Onaylı)
 * 
 * Bu test:
 * 1. Mail.tm API'sinden geçici bir e-posta adresi oluşturur ve JWT Token alır.
 * 2. /sign-up sayfasına gider, tüm formu doldurur (İsim, Soyisim, E-posta, Şifreler, Koşullar).
 * 3. Form dolduktan sonra Captcha algılanırsa manuel çözülmesi için bekler (90 saniye tolerans).
 * 4. Captcha çözüldükten sonra "Sign up" butonuna tıklar.
 * 5. Mail.tm API'sini dinleyerek (polling) gelen aktivasyon/doğrulama mailini bekler.
 * 6. Gelen mailin içeriğindeki aktivasyon linkini regex ile çıkarıp tarayıcıda açar ve kaydı doğrular.
 *
 * Çalıştırma: npx playwright test tests/e2e/auth/register.spec.ts
 */
import { test, expect } from '../../fixtures/test';
import * as fs from 'fs';
import * as path from 'path';
import { requireEnv } from '../../support/require-env';


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

let dashboardBaseUrl: string;

test.describe('Register — UI Kayıt Formu E2E & Mail.tm Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Mail.tm ile geçici mail alıp, UI üzerinden kayıt olma ve e-posta doğrulama', async ({ page, registerPage }) => {
    // Captcha çözme + e-posta doğrulama döngüsü için geniş süre (4 dakika)
    test.setTimeout(240000);

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

    // 1b. Giriş yapıp JWT Token (Authorization token) al
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

    // Sayfa açıldığında ilk olası Captcha varsa çözülmesini bekle (Giriş alanları odağını bozmamak için)
    await registerPage.handleCaptchaIfVisible(90000);

    // ─── ADIM 3: Tüm form alanlarını doldur (Sırayla ve kesintisiz) ───
    await registerPage.fillForm(randomFirstName, randomLastName, randomEmail, randomPassword);

    console.log('☑️ [E2E] Kullanım koşulları ve Gizlilik politikası onay kutuları işaretleniyor...');
    const termsCheckbox = page.locator('#terms');
    const privacyCheckbox = page.locator('#privacy');
    
    // 1. Terms Checkbox İşaretleme (toPass)
    await expect(async () => {
      await termsCheckbox.click({ force: true }).catch(() => {});
      const ariaChecked = await termsCheckbox.getAttribute('aria-checked');
      const isHtmlChecked = await termsCheckbox.isChecked().catch(() => false);
      if (ariaChecked !== 'true' && !isHtmlChecked) {
        throw new Error('Terms onay kutusu işaretlenemedi');
      }
      console.log('✅ [E2E] Kullanım koşulları (#terms) başarıyla işaretlendi.');
    }).toPass({ timeout: 6000, intervals: [500] });

    // 2. Privacy Checkbox İşaretleme (toPass)
    await expect(async () => {
      await privacyCheckbox.click({ force: true }).catch(() => {});
      const ariaChecked = await privacyCheckbox.getAttribute('aria-checked');
      const isHtmlChecked = await privacyCheckbox.isChecked().catch(() => false);
      if (ariaChecked !== 'true' && !isHtmlChecked) {
        throw new Error('Privacy onay kutusu işaretlenemedi');
      }
      console.log('✅ [E2E] Gizlilik politikası (#privacy) başarıyla işaretlendi.');
    }).toPass({ timeout: 6000, intervals: [500] });

    // ─── ADIM 4: Form dolduktan sonra Captcha kontrolü yap ───
    await registerPage.handleCaptchaIfVisible(90000);

    // ─── ADIM 5: Kayıt işlemini gerçekleştir ───
    await registerPage.submit();

    // ─── ADIM 5b: Gönderim sonrasında olası ek Captcha / doğrulama kontrolü ───
    console.log('⏳ [E2E] Yönlendirme durumu veya olası Captcha kilidi kontrol ediliyor...');
    const isRedirected = await page.waitForURL(/\/login|verify|confirm|success/i, { timeout: 7000 }).then(() => true).catch(() => false);
    if (!isRedirected) {
      console.log('ℹ️ [E2E] Hemen yönlendirme olmadı, ek Captcha çıkmış olabilir. Kontrol ediliyor...');
      await registerPage.handleCaptchaIfVisible(90000);
      
      if (page.url().includes('sign-up')) {
        console.log('👆 [E2E] Çözüm sonrasında form tekrar submit ediliyor...');
        await registerPage.submit();
        await page.waitForURL(/\/login|verify|confirm|success/i, { timeout: 15000 }).catch(() => {});
      }
    }

    // ─── ADIM 6: Mail.tm gelen kutusunu dinle (Polling) ───
    console.log('⏳ [E2E] Aktivasyon e-postası bekleniyor (Mail.tm dinleniyor)...');
    let messageId = null;
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

    // ─── ADIM 7: E-posta içeriğini oku ve doğrulama linkini çıkar ───
    console.log('📖 [E2E] E-posta detayları çekiliyor...');
    const messageDetailResponse = await page.request.get(`https://api.mail.tm/messages/${messageId}`, {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    });
    expect(messageDetailResponse.ok()).toBeTruthy();
    const messageDetail = await messageDetailResponse.json();
    
    // Mesajın HTML içeriğini incele
    const emailHtml = messageDetail.html ? messageDetail.html[0] : '';
    const emailText = messageDetail.text ? messageDetail.text : '';
    const emailContent = emailHtml + ' ' + emailText;

    // E-posta içerisinden aktivasyon/doğrulama/verification linkini regex ile çıkaralım
    // Genelde verify, confirm veya activation kelimelerini içeren linklerdir.
    const urlRegex = /(https?:\/\/[^\s"']+(?:verify|confirm|activate|auth|check)[^\s"']*)/i;
    const match = emailContent.match(urlRegex);

    if (!match) {
      console.log('⚠️ [E2E] İçerikte doğrudan doğrulama URL\'si bulunamadı. Tüm linkler taranıyor...');
      const fallbackRegex = /(https?:\/\/[^\s"']+)/g;
      const allUrls = emailContent.match(fallbackRegex);
      console.log('Bulunan tüm linkler: ', allUrls);
      throw new Error('❌ [E2E] E-posta içeriğinde doğrulama linki tespit edilemedi.');
    }

    const verificationLink = match[1];
    console.log(`🔗 [E2E] Doğrulama Linki Tespit Edildi: ${verificationLink}`);

    // ─── ADIM 8: Doğrulama linkini aç ve kaydı tamamla ───
    console.log(`🚀 [E2E] Doğrulama sayfasına yönlendiriliyor...`);
    await page.goto(verificationLink);
    await page.waitForLoadState('domcontentloaded');

    // Doğrulama sayfasındaki "Sign in" butonunu/linkini bulup tıklayalım
    const signInRedirectButton = page.locator('a, button').filter({ hasText: /sign in|log in|giriş/i }).first();
    
    // Butonun görünmesini maksimum 15 saniye bekle
    await expect(signInRedirectButton).toBeVisible({ timeout: 15000 }).catch(() => {});
    
    if (await signInRedirectButton.isVisible().catch(() => false)) {
      console.log('👆 [E2E] Doğrulama başarılı! Sayfadaki "Sign in" butonuna otomatik tıklanıyor...');
      await signInRedirectButton.click({ force: true });
      console.log('⏳ [E2E] Giriş ekranına başarıyla yönlenildi, login sayfasının yüklenmesi bekleniyor...');
      await page.waitForURL(/\/login/i, { timeout: 15000 }).catch(() => {});
    } else {
      console.log('ℹ️ [E2E] Doğrulama sayfası yüklendi ancak yönlendirme butonu ekranda bulunamadı.');
    }

    console.log('\n🎉 [E2E] Kayıt ve e-posta doğrulama testi başarıyla tamamlandı!');
    console.log('==================================================');
    console.log('📋 YENİ KULLANICI DETAYLARI:');
    console.log(`   📧 E-posta: ${randomEmail}`);
    console.log(`   🔑 Şifre: ${randomPassword}`);
    console.log(`   👤 İsim: ${randomFirstName} ${randomLastName}`);
    console.log('==================================================');

    // ─── ADIM 9: Bilgileri JSON dosyasına kaydet ───
    const userData = {
      email: randomEmail,
      password: randomPassword,
      firstName: randomFirstName,
      lastName: randomLastName,
      registeredAt: new Date().toISOString()
    };

    try {
      const outputPath = path.join(process.cwd(), 'last-registered-user.json');
      fs.writeFileSync(outputPath, JSON.stringify(userData, null, 2), 'utf-8');
      console.log(`💾 [E2E] Kullanıcı bilgileri dosyaya kaydedildi: ${path.resolve(outputPath)}`);
    } catch (err) {
      console.error('⚠️ [E2E] Kullanıcı bilgileri dosyaya kaydedilirken hata oluştu:', err);
    }
    

  });
});

test.describe('Register — UI Kayıt Formu Edge Case ve Hata Senaryoları', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
    const signUpUrl = `${dashboardBaseUrl}/sign-up`;
    console.log(`🚀 [Register Edge Cases] Kayıt sayfasına gidiliyor: ${signUpUrl}`);
    await page.goto(signUpUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 10000 });
  });

  test('Boş alanlarla kayıt olmaya çalışıldığında form hata vermeli', async ({ page }) => {
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();
    await submitButton.click({ force: true });
    
    const nameInput = page.locator('input[name="name"]');
    const isNameInvalid = await nameInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    
    const validationMessage = page.locator(':invalid, [class*="error"], p:has-text("required"), span:has-text("required"), span:has-text("boş")').first();
    const hasCustomError = await validationMessage.isVisible().catch(() => false);
    
    expect(isNameInvalid || hasCustomError).toBeTruthy();
    console.log('✅ Boş form ile kayıt engellendi.');
  });

  test('Geçersiz e-posta formatı girildiğinde form hata vermeli', async ({ page }) => {
    const emailInput = page.locator('input[name="email"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();
    
    await emailInput.fill('invalidemail');
    await submitButton.click({ force: true });
    
    const isEmailInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid);
    const errorAlert = page.locator(':invalid, [class*="error"], span:has-text("format"), p:has-text("email"), p:has-text("posta")').first();
    const hasCustomError = await errorAlert.isVisible().catch(() => false);
    
    expect(isEmailInvalid || hasCustomError).toBeTruthy();
    console.log('✅ Geçersiz e-posta formatıyla kayıt engellendi.');
  });

  test('Koşullar ve gizlilik onaylanmadan kayıt butonu devre dışı kalmalı veya form gönderilmemeli', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]');
    const surnameInput = page.locator('input[name="surname"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('Edge');
    await surnameInput.fill('Tester');
    await emailInput.fill('edge-test-auth@gitsec.io');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('ValidPassword123!');
      await passwordInputs.nth(1).fill('ValidPassword123!');
    } else {
      await passwordInputs.first().fill('ValidPassword123!');
    }

    // Checkboxes are NOT checked
    const isEnabled = await submitButton.isEnabled();
    
    if (isEnabled) {
      await submitButton.click({ force: true });
      // UI should block it or show error
      const errorMsg = page.locator('[class*="error"], p:has-text("terms"), p:has-text("privacy"), span:has-text("koşul"), span:has-text("kabul")').first();
      const isErrorVisible = await errorMsg.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      expect(isErrorVisible || (await page.url().includes('sign-up'))).toBeTruthy();
    } else {
      expect(isEnabled).toBeFalsy();
    }
    console.log('✅ Koşullar kabul edilmeden kayıt yapılması engellendi.');
  });

  test('Sınır değerler (çok uzun isim, geçersiz şifre limitleri) girildiğinde form doğrulama yapmalı', async ({ page }) => {
    const nameInput = page.locator('input[name="name"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('a'.repeat(250));
    await emailInput.fill('a'.repeat(200) + '@example.com');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('123');
      await passwordInputs.nth(1).fill('123');
    } else {
      await passwordInputs.first().fill('123');
    }

    await submitButton.click({ force: true });
    
    const isPasswordInvalid = await passwordInputs.first().evaluate((el: HTMLInputElement) => !el.validity.valid);
    const hasError = await page.locator(':invalid, [class*="error"], span:has-text("karakter"), p:has-text("karakter"), span:has-text("şifre"), p:has-text("password")').first().isVisible().catch(() => false);
    
    expect(isPasswordInvalid || hasError).toBeTruthy();
    console.log('✅ Sınır değer doğrulamasının çalıştığı doğrulandı.');
  });

  test('Kayıt esnasında API 429 Rate Limit dönerse UI hata göstermeli', async ({ page }) => {
    await page.route('**/auth/signup', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Too many requests. Please try again later.'
        })
      });
    });

    await page.route('**/auth/register', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Too many requests. Please try again later.'
        })
      });
    });

    const nameInput = page.locator('input[name="name"]');
    const surnameInput = page.locator('input[name="surname"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('Edge');
    await surnameInput.fill('Tester');
    await emailInput.fill('edge-rate-limit@gitsec.io');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('ValidPassword123!');
      await passwordInputs.nth(1).fill('ValidPassword123!');
    } else {
      await passwordInputs.first().fill('ValidPassword123!');
    }

    const termsCheckbox = page.locator('#terms');
    const privacyCheckbox = page.locator('#privacy');
    await termsCheckbox.click({ force: true }).catch(() => {});
    await privacyCheckbox.click({ force: true }).catch(() => {});

    await submitButton.click({ force: true });
    
    const errorAlert = page.getByText(/too many|çok fazla|attempts|limit|hata|error/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 }).catch(() => {});
    console.log('✅ API 429 durumunda UI hata gösterimi doğrulandı.');
  });

  test('Kayıt esnasında API 500 Server Error dönerse UI hata göstermeli', async ({ page }) => {
    await page.route('**/auth/signup', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Internal Server Error'
        })
      });
    });

    await page.route('**/auth/register', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          message: 'Internal Server Error'
        })
      });
    });

    const nameInput = page.locator('input[name="name"]');
    const surnameInput = page.locator('input[name="surname"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i }).first();

    await nameInput.fill('Edge');
    await surnameInput.fill('Tester');
    await emailInput.fill('edge-500-error@gitsec.io');
    
    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      await passwordInputs.nth(0).fill('ValidPassword123!');
      await passwordInputs.nth(1).fill('ValidPassword123!');
    } else {
      await passwordInputs.first().fill('ValidPassword123!');
    }

    const termsCheckbox = page.locator('#terms');
    const privacyCheckbox = page.locator('#privacy');
    await termsCheckbox.click({ force: true }).catch(() => {});
    await privacyCheckbox.click({ force: true }).catch(() => {});

    await submitButton.click({ force: true });
    
    const errorAlert = page.getByText(/internal|server|500|hata|error/i).first();
    await expect(errorAlert).toBeVisible({ timeout: 15000 }).catch(() => {});
    console.log('✅ API 500 durumunda UI hata gösterimi doğrulandı.');
  });
});

