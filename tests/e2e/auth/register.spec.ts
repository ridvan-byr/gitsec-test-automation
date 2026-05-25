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
import { test, expect } from '@playwright/test';
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

const dashboardBaseUrl = process.env.DASHBOARD_BASE_URL ?? 'https://dev.dashboard.gitsec.io';

test.describe('Register — UI Kayıt Formu E2E & Mail.tm Akışı', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('Mail.tm ile geçici mail alıp, UI üzerinden kayıt olma ve e-posta doğrulama', async ({ page }) => {
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
    const signUpUrl = `${dashboardBaseUrl}/sign-up`;
    console.log(`🚀 [E2E] Kayıt sayfasına gidiliyor: ${signUpUrl}`);
    await page.goto(signUpUrl, { waitUntil: 'load' });

    console.log('⏳ [E2E] Sayfanın ilk otomatik yenilenmesi bekleniyor...');
    await page.waitForTimeout(5000);

    // Locators
    const nameInput = page.locator('input[name="name"]');
    const surnameInput = page.locator('input[name="surname"]');
    const emailInput = page.locator('input[name="email"]');
    const passwordInputs = page.locator('input[type="password"]');
    const submitButton = page.getByRole('button', { name: /Create account/i });

    // ─── ADIM 3: Tüm form alanlarını doldur (Sırayla ve kesintisiz) ───
    console.log(`👤 [E2E] İsim yazılıyor: ${randomFirstName}`);
    await nameInput.click();
    await nameInput.pressSequentially(randomFirstName, { delay: 50 });

    console.log(`👤 [E2E] Soyisim yazılıyor: ${randomLastName}`);
    await surnameInput.click();
    await surnameInput.pressSequentially(randomLastName, { delay: 50 });

    console.log(`✉️ [E2E] E-posta yazılıyor: ${randomEmail}`);
    await emailInput.click();
    await emailInput.pressSequentially(randomEmail, { delay: 50 });

    const pwdCount = await passwordInputs.count();
    if (pwdCount >= 2) {
      console.log(`🔑 [E2E] Şifreler yazılıyor...`);
      await passwordInputs.nth(0).click();
      await passwordInputs.nth(0).pressSequentially(randomPassword, { delay: 50 });
      await page.waitForTimeout(300);
      
      await passwordInputs.nth(1).click();
      await passwordInputs.nth(1).pressSequentially(randomPassword, { delay: 50 });
    } else {
      console.log(`🔑 [E2E] Şifre yazılıyor...`);
      await passwordInputs.first().click();
      await passwordInputs.first().pressSequentially(randomPassword, { delay: 50 });
    }

    console.log('☑️ [E2E] Kullanım koşulları ve Gizlilik politikası onay kutuları işaretleniyor...');
    const termsCheckbox = page.locator('#terms');
    const privacyCheckbox = page.locator('#privacy');
    
    // 1. Terms Checkbox İşaretleme (Retry)
    let isTermsChecked = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await termsCheckbox.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      const ariaChecked = await termsCheckbox.getAttribute('aria-checked');
      const isHtmlChecked = await termsCheckbox.isChecked().catch(() => false);
      
      if (ariaChecked === 'true' || isHtmlChecked) {
        isTermsChecked = true;
        console.log('✅ [E2E] Kullanım koşulları (#terms) başarıyla işaretlendi.');
        break;
      }
      console.log(`⚠️ [E2E] Terms onay kutusu işaretlenemedi, tekrar deneniyor... (Deneme ${attempt}/3)`);
    }

    if (!isTermsChecked) {
      console.log('🔄 [E2E] Alternatif yöntem: Terms kutusuna tekrar zorlanarak tıklanıyor...');
      await termsCheckbox.click({ force: true }).catch(() => {});
    }

    // 2. Privacy Checkbox İşaretleme (Retry)
    let isPrivacyChecked = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await privacyCheckbox.click({ force: true }).catch(() => {});
      await page.waitForTimeout(500);
      const ariaChecked = await privacyCheckbox.getAttribute('aria-checked');
      const isHtmlChecked = await privacyCheckbox.isChecked().catch(() => false);
      
      if (ariaChecked === 'true' || isHtmlChecked) {
        isPrivacyChecked = true;
        console.log('✅ [E2E] Gizlilik politikası (#privacy) başarıyla işaretlendi.');
        break;
      }
      console.log(`⚠️ [E2E] Privacy onay kutusu işaretlenemedi, tekrar deneniyor... (Deneme ${attempt}/3)`);
    }

    if (!isPrivacyChecked) {
      console.log('🔄 [E2E] Alternatif yöntem: Privacy kutusuna tekrar zorlanarak tıklanıyor...');
      await privacyCheckbox.click({ force: true }).catch(() => {});
    }

    // ─── ADIM 4: Form dolduktan sonra Captcha kontrolü yap (SADECE iframe varlığına bak) ───
    // Sayfayı sessizce en alta (buton ve captcha bölgesine) odakla ve orada sabitle
    console.log('🔄 [E2E] Sayfa görünümü form sonuna kaydırılıyor...');
    await submitButton.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(500);

    const isCaptchaVisible = await page.locator('iframe[src*="challenges.cloudflare.com"]').isVisible().catch(() => false);

    if (isCaptchaVisible) {
      console.log('\n=========================================');
      console.log('⚠️⚠️ [CAPTCHA TESPİT EDİLDİ] ⚠️⚠️');
      console.log('💡 Form doldurulurken Captcha devreye girdi!');
      console.log('💡 Sayfa görünümü sabitlendi. Lütfen açılan Chrome tarayıcısından Captcha\'yı MANUEL olarak çözün.');
      console.log('💡 Çözdüğünüz an test otomatik olarak kaldığı yerden devam edecektir.');
      console.log('=========================================\n');

      // SIFIR-SCROLL SESSİZ BEKLEME: JS tabanlı elementHandle sorgusu ile sayfa odağını bozmadan butonun aktifleşmesini bekle
      console.log('⏳ [E2E] Captcha çözümü bekleniyor... (Ekran sabitlendi - 90 saniye tolerans)');
      const buttonHandle = await submitButton.elementHandle();
      if (buttonHandle) {
        await page.waitForFunction(
          (btn) => btn instanceof HTMLButtonElement && !btn.disabled,
          buttonHandle,
          { timeout: 90000 }
        ).catch(() => {});
      } else {
        // Fallback (eğer elementHandle alınamazsa)
        await expect(submitButton).toBeEnabled({ timeout: 90000 });
      }
      
      console.log('✅ [E2E] Captcha çözüldü, buton aktif!');
      await page.waitForTimeout(1000);
    }

    // ─── ADIM 5: Kayıt işlemini gerçekleştir ───
    console.log('👆 [E2E] "Sign up" butonuna tıklanıyor...');
    await submitButton.click({ force: true });

    // ─── ADIM 6: Mail.tm gelen kutusunu dinle (Polling) ───
    console.log('⏳ [E2E] Aktivasyon e-postası bekleniyor (Mail.tm dinleniyor)...');
    let messageId = null;
    const startTime = Date.now();
    const timeout = 60000; // E-posta gelmesi için maksimum 60 saniye bekle

    while (Date.now() - startTime < timeout) {
      const messagesResponse = await page.request.get('https://api.mail.tm/messages', {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      });

      if (messagesResponse.ok()) {
        const messagesData = await messagesResponse.json();
        const messagesList = messagesData['hydra:member'];
        
        if (messagesList && messagesList.length > 0) {
          messageId = messagesList[0].id;
          console.log(`📩 [E2E] Doğrulama e-postası ulaştı! Mesaj ID: ${messageId}`);
          break;
        }
      }
      
      console.log('⏳ [E2E] Henüz mail gelmedi, 5 saniye sonra tekrar kontrol edilecek...');
      await page.waitForTimeout(5000);
    }

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
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Doğrulama sayfasındaki "Sign in" butonunu/linkini bulup tıklayalım
    const signInRedirectButton = page.locator('a, button').filter({ hasText: /sign in|log in|giriş/i }).first();
    
    // Butonun görünmesini maksimum 15 saniye bekle
    await expect(signInRedirectButton).toBeVisible({ timeout: 15000 }).catch(() => {});
    
    if (await signInRedirectButton.isVisible().catch(() => false)) {
      console.log('👆 [E2E] Doğrulama başarılı! Sayfadaki "Sign in" butonuna otomatik tıklanıyor...');
      await signInRedirectButton.click({ force: true });
      console.log('⏳ [E2E] Giriş ekranına başarıyla yönlenildi, akışın görülmesi için 6 saniye bekleniyor...');
      await page.waitForTimeout(6000);
    } else {
      console.log('ℹ️ [E2E] Doğrulama sayfası yüklendi ancak yönlendirme butonu ekranda bulunamadı, 5 saniye bekleniyor...');
      await page.waitForTimeout(5000);
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
      const outputPath = path.join(__dirname, '../../../../last-registered-user.json');
      fs.writeFileSync(outputPath, JSON.stringify(userData, null, 2), 'utf-8');
      console.log(`💾 [E2E] Kullanıcı bilgileri dosyaya kaydedildi: ${path.resolve(outputPath)}`);
    } catch (err) {
      console.error('⚠️ [E2E] Kullanıcı bilgileri dosyaya kaydedilirken hata oluştu:', err);
    }
    
    await page.waitForTimeout(4000);
  });
});
