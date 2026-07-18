import { expect, test, type GitSecPage } from '../../fixtures/test';
import type { Frame, Page, APIRequestContext, Locator } from '@playwright/test';
import { requireEnv } from '../../support/require-env';

type SupportedPlan = 'Freemium' | 'Startup' | 'Premium' | 'Premium+';

type IyzicoTestCard = {
  holder: string;
  number: string;
  expiry: string;
  cvc: string;
};

type BillingAddressData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  city: string;
  postalCode: string;
  address: string;
  taxId: string;
};

function paymentFrames(page: Page): Frame[] {
  return page.context().pages().flatMap(candidate => candidate.frames());
}

/**
 * Kullanıcının Workspace ID bilgisini .env bağımlılığı olmaksızın API veya URL yönlendirmesiyle otomatik tespit eder.
 */
async function resolveWorkspaceId(page: Page, request: APIRequestContext, apiBaseUrl: string, dashboardBaseUrl: string): Promise<string> {
  const envWorkspaceId = process.env.WORKSPACE_ID?.trim();

  // Önce oturum sahibinin workspace listesini doğrula. Böylece hesap değiştirildiğinde
  // .env içinde kalan eski bir WORKSPACE_ID ile başka hesabın billing sayfasına gidilmez.
  try {
    const authCookie = (await page.context().cookies()).find(c => c.name === 'gs_token');
    if (authCookie?.value) {
      const response = await request.get(`${apiBaseUrl}/api/workspaces`, {
        headers: { Authorization: `Bearer ${authCookie.value}` }
      });
      if (response.ok()) {
        const body = await response.json();
        const workspaces = Array.isArray(body?.data?.list)
          ? body.data.list
          : Array.isArray(body?.data)
            ? body.data
            : body?.data?.id
              ? [body.data]
              : [];
        const configuredWorkspace = workspaces.find((workspace: { id?: string | number }) =>
          String(workspace?.id) === envWorkspaceId
        );
        const firstWorkspace = configuredWorkspace || workspaces[0];
        if (firstWorkspace?.id) {
          const detectedId = String(firstWorkspace.id);
          if (envWorkspaceId && !configuredWorkspace) {
            console.warn(`⚠️ [WORKSPACE] .env WORKSPACE_ID=${envWorkspaceId} mevcut kullanıcıya ait değil; API'den bulunan ${detectedId} kullanılacak.`);
          } else {
            console.log(`🔍 [WORKSPACE] Workspace ID API'den doğrulandı: ${detectedId}`);
          }
          return detectedId;
        }
      }
    }
  } catch (err) {
    console.warn('⚠️ [WORKSPACE] API üzerinden workspace tespiti yapılamadı, URL yönlendirmesi deneniyor...', err);
  }

  if (envWorkspaceId) {
    console.warn(`⚠️ [WORKSPACE] Workspace listesi API'den doğrulanamadı; .env WORKSPACE_ID=${envWorkspaceId} fallback olarak kullanılacak.`);
    return envWorkspaceId;
  }

  // Fallback: Dashboard ana sayfasına gidip yönlenen URL'den ID'yi çek
  await page.goto(dashboardBaseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/dashboard\.gitsec\.io\/\d+/i, { timeout: 15_000 }).catch(() => {});
  const urlMatch = page.url().match(/dashboard\.gitsec\.io\/(\d+)/);
  if (urlMatch) {
    console.log(`🔍 [WORKSPACE] Workspace ID URL yönlendirmesinden otomatik tespit edildi: ${urlMatch[1]}`);
    return urlMatch[1];
  }

  throw new Error('❌ [WORKSPACE] Kullanıcının Workspace ID bilgisi ne API ne de URL üzerinden otomatik tespit edilemedi.');
}

/**
 * Aylık / Yıllık (Monthly / Yearly) faturalandırma periyodunu seçer.
 * HTML: <button ...>Yearly<span ...>Save 20%</span></button>
 */
async function selectBillingInterval(page: Page, targetInterval: 'monthly' | 'yearly'): Promise<void> {
  console.log(`🗓️ [LICENSE] Abonelik alanındaki fatura periyodu seçiliyor: "${targetInterval.toUpperCase()}"...`);

  // Sayfayı abonelik alanına kaydır (y=450)
  await page.evaluate(() => window.scrollTo(0, 450)).catch(() => {});
  await page.waitForTimeout(400);

  const isYearly = targetInterval === 'yearly';

  // Tam HTML eşleşmesi: "Yearly" metni ve "Save 20%" rozetini içeren buton (Heads up banner'ı ile karışması imkansız)
  const toggleBtn = isYearly
    ? page.locator('button')
        .filter({ hasText: /Yearly/i })
        .filter({ hasText: /Save/i })
        .or(page.locator('button').filter({ hasText: /^Yearly/i }))
        .first()
    : page.locator('button')
        .filter({ hasText: /^Monthly$/i })
        .or(page.locator('button').filter({ hasText: /Monthly/i }))
        .first();

  await expect(toggleBtn).toBeVisible({ timeout: 15_000 });
  await toggleBtn.scrollIntoViewIfNeeded().catch(() => {});
  await toggleBtn.click({ force: true }).catch(() => toggleBtn.click());
  console.log(`✅ [LICENSE] Aboneliklerin sağ üstündeki "${targetInterval.toUpperCase()}" butonuna başarıyla tıklandı.`);
  await page.waitForTimeout(600);
}

/**
 * Lisans değiştirme limitinin (2 hakkın) dolup dolmadığını denetler.
 * Yalnızca kullanıcıya gerçekten gösterilen toast/alert bileşenini yakalar.
 *
 * NOT: Regex'te "subscription renews" tek başına kullanılMAMALI çünkü billing sayfasında
 * "Your subscription renews on [tarih]" gibi normal metin var ve false positive verir.
 */
async function checkPlanChangeLimitReached(page: Page, timeoutMs: number = 3000): Promise<boolean> {
  // Tam Toast metni: "You've reached the plan change limit for this billing period.
  //                    Please try again after your subscription renews."
  // Kesin eşleşme için "plan change limit" ifadesinin geçmesini zorunlu kıl.
  const LIMIT_REGEX = /(?:reached the plan change limit|plan change limit for this billing period|you've reached the plan change limit)/i;

  const visibleLimitToast = page
    .locator('[role="alert"], [role="status"], [data-sonner-toast], [data-radix-toast-viewport]')
    .filter({ hasText: LIMIT_REGEX })
    .first();

  const isVisible = timeoutMs > 0
    ? await visibleLimitToast.waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true).catch(() => false)
    : await visibleLimitToast.isVisible().catch(() => false);

  if (isVisible) {
    console.log('⚠️ [LICENSE LIMIT] Bu fatura dönemi için lisans değiştirme limiti (2 değişiklik hakkı) dolmuştur.');
    console.log('ℹ️ [LICENSE LIMIT] Görünür limit toast mesajı doğrulandı.');
  }

  return isVisible;
}

type PlanSelectionResult = 'clicked' | 'already-active' | 'limit-reached';

/**
 * Sayfadaki hedef plan kartını ve butonunu Sidebar / Header butonları ile çakışmayacak şekilde ana içerik (main) içinden seçip tıklar.
 */
async function selectTargetPlanCardButton(page: Page, targetPlan: string): Promise<PlanSelectionResult> {
  console.log(`🔍 [LICENSE] "${targetPlan}" plan kartı ve butonu bekleniyor...`);

  await page.evaluate(() => window.scrollTo(0, 450)).catch(() => {});
  await page.waitForTimeout(300);
  let result: PlanSelectionResult = 'clicked';

  await expect(async () => {
    const targetPlanTitle = targetPlan === 'Premium+'
      ? /^Premium\+$/i
      : new RegExp(`^${targetPlan}$`, 'i');

    const comparisonTitle = page.getByText(/^Plan Comparison$/i).first();
    await expect(comparisonTitle).toBeVisible();

    // Üst menüdeki aktif plan rozeti ve sidebar bu scope'un tamamen dışında kalır.
    const planComparison = comparisonTitle.locator(
      `xpath=ancestor::div[` +
        `.//button[normalize-space()="Monthly"] and ` +
        `.//button[contains(normalize-space(),"Yearly")] and ` +
        `.//*[normalize-space()="${targetPlan}"]` +
      `][1]`
    ).first();
    await expect(planComparison, 'Plan Comparison bölümü görünür olmalı.').toBeVisible();

    // Uygulama plan adlarını semantik heading yerine normal div içinde render ediyor.
    // Exact text, Premium kartının Premium+ kartıyla karışmasını önler.
    const cardTitle = planComparison.getByText(targetPlanTitle).first();

    if (await cardTitle.isVisible().catch(() => false)) {
      // Başlık ile lisans aksiyon butonunu birlikte içeren en yakın kartı bul.
      // Kart bileşeninde role/data-testid bulunmadığı için ancestor ilişkisi gerekiyor.
      const card = cardTitle.locator(
        'xpath=ancestor::div[.//button[' +
          'normalize-space()="Upgrade" or ' +
          'normalize-space()="Downgrade" or ' +
          'normalize-space()="Select" or ' +
          'normalize-space()="Current Plan" or ' +
          'normalize-space()="Mevcut Plan"' +
        ']][1]'
      ).first();

      await expect(card, `"${targetPlan}" plan kartı görünür olmalı.`).toBeVisible();

      // Yalnızca lisans aksiyonları seçilebilir; sidebar/header butonları bu listeye giremez.
      const buttons = card.getByRole('button', {
        name: /^(Upgrade|Downgrade|Select|Current Plan|Mevcut Plan)$/i
      });
      const count = await buttons.count();

      for (let i = 0; i < count; i++) {
        const btn = buttons.nth(i);
        const btnText = (await btn.innerText().catch(() => '')).trim();

        if (!btnText) {
          continue;
        }

        await btn.scrollIntoViewIfNeeded().catch(() => {});
        const isDisabled = await btn.isDisabled().catch(() => false);

        if (/current plan|mevcut plan/i.test(btnText) || isDisabled) {
          console.log(`ℹ️ [LICENSE] Hesabın mevcut planı zaten "${targetPlan}" ("${btnText}"). Plan değişikliği gerekmiyor.`);
          result = 'already-active';
          return;
        }

        await btn.click({ force: true }).catch(() => btn.click());
        console.log(`🔘 [LICENSE] "${targetPlan}" plan kartındaki buton ("${btnText}") başarıyla tıklandı.`);

        // Tıklamadan hemen sonra API yanıtının dönmesi ve Toast'ın DOM'a düşmesi için 3.5 saniye boyunca denetle
        if (await checkPlanChangeLimitReached(page, 3500)) {
          result = 'limit-reached';
        }
        return;
      }

      const currentBadge = card.getByText(/^Current$/i).first();
      if (await currentBadge.isVisible().catch(() => false)) {
        console.log(`ℹ️ [LICENSE] "${targetPlan}" kartı Current olarak işaretli. Plan değişikliği gerekmiyor.`);
        result = 'already-active';
        return;
      }
    }

    throw new Error(`"${targetPlan}" plan kartı veya geçerli butonu ekranda henüz bulunamadı.`);
  }).toPass({ timeout: 25_000, intervals: [500, 1_000] });

  return result;
}

/**
 * 1. Fatura adresi kontrolü ve gerekirse "Add Billing Address" modalını doldurup kaydetme adımı
 */
async function handleBillingAddressIfRequired(page: Page, addressData: BillingAddressData): Promise<boolean> {
  console.log('🔍 [LICENSE/BILLING] Faturalandırma adres durumu ve Continue to Payment butonu kontrol ediliyor...');

  // Limit uyarısı toast'ı ekrana düşmüş mü kontrol et
  if (await checkPlanChangeLimitReached(page, 2000)) {
    return true;
  }

  const continueToPaymentBtn = page.getByRole('button', { name: /continue to payment|ödemeye devam/i }).first();
  const isContinueVisible = await continueToPaymentBtn.isVisible().catch(() => false);
  const isContinueEnabled = isContinueVisible && !(await continueToPaymentBtn.isDisabled().catch(() => true));

  if (isContinueEnabled) {
    console.log('✅ [LICENSE/BILLING] Fatura adresi zaten mevcut. "Continue to payment" butonuna tıklanıyor...');
    await continueToPaymentBtn.click({ force: true });
    return false;
  }

  if (await checkPlanChangeLimitReached(page, 0)) {
    return true;
  }

  console.log('📌 [LICENSE/BILLING] Fatura adresi eksik. "Add a billing address →" butonu aranıyor...');
  const addAddressButton = page.locator('button')
    .filter({ hasText: /Add a billing address/i })
    .or(page.getByRole('button', { name: /Add a billing address/i }))
    .or(page.getByText(/Add a billing address/i))
    .first();

  const addAddressAppeared = await addAddressButton.waitFor({ state: 'visible', timeout: 3_000 })
    .then(() => true)
    .catch(() => false);

  if (!addAddressAppeared) {
    // Adres butonu görünmediyse 4 saniye boyunca DOM'da limit uyarısını kontrol et
    const limitFound = await checkPlanChangeLimitReached(page, 4000);
    if (limitFound) {
      return true;
    }
    throw new Error('"Add a billing address" butonu görünmedi ve lisans limit uyarısı da tespit edilemedi.');
  }

  await addAddressButton.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await addAddressButton.click({ force: true }).catch(() => addAddressButton.click());
  console.log('📌 [LICENSE/BILLING] "Add a billing address →" butonuna başarıyla tıklandı.');

  await page.waitForTimeout(1000);
  console.log('📝 [LICENSE/BILLING] "Add Billing Address" formu Gitsec Test bilgileriyle dolduruluyor...');

  // Kesin ve doğrudan doldurma yardımcı fonksiyonu
  const fillField = async (locator: Locator, value: string, label: string) => {
    try {
      const el = locator.first();
      await el.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.focus().catch(() => {});
      await el.click({ force: true }).catch(() => {});
      await el.fill(value);
      await el.dispatchEvent('input').catch(() => {});
      await el.dispatchEvent('change').catch(() => {});
      await el.dispatchEvent('blur').catch(() => {});
      console.log(`✅ [LICENSE/BILLING] ${label}: ${value}`);
      await page.waitForTimeout(200);
    } catch (err) {
      console.log(`⚠️ [LICENSE/BILLING] ${label} doldurulamadı: ${err}`);
    }
  };

  const firstNameInput = page.locator('input[name*="firstName" i], input[name*="first_name" i], input[id*="firstName" i]').or(page.getByPlaceholder(/first/i)).first();
  const lastNameInput = page.locator('input[name*="lastName" i], input[name*="last_name" i], input[id*="lastName" i]').or(page.getByPlaceholder(/last/i)).first();
  const emailInput = page.locator('input[type="email"], input[name*="email" i]').or(page.getByPlaceholder(/email/i)).first();
  const phoneInput = page.locator('input[name*="phone" i], input[type="tel"]').or(page.getByPlaceholder(/phone|\+90/i)).first();

  await firstNameInput.waitFor({ state: 'visible', timeout: 15_000 });
  await fillField(firstNameInput, addressData.firstName, 'Ad');
  await fillField(lastNameInput, addressData.lastName, 'Soyad');
  await fillField(emailInput, addressData.email, 'E-posta');
  await fillField(phoneInput, addressData.phone, 'Telefon');

  // ─── COUNTRY (ÜLKE) SEÇİMİ ───
  console.log('📝 [LICENSE/BILLING] Ülke (Türkiye) seçiliyor...');
  const countrySelect = page.locator('select[name*="country" i]').first();

  if (await countrySelect.isVisible().catch(() => false)) {
    await countrySelect.selectOption({ label: 'Türkiye' })
      .catch(() => countrySelect.selectOption({ label: 'Turkey' }))
      .catch(() => countrySelect.selectOption({ value: 'TR' }));
    console.log('✅ [LICENSE/BILLING] Ülke "Türkiye" (select) seçildi.');
  } else {
    const countryTrigger = page.locator('button[role="combobox"], [data-slot="select-trigger"], button[aria-haspopup="listbox"]')
      .filter({ hasText: /country|ülke|select|türkiye|turkey/i })
      .first();

    if (await countryTrigger.isVisible().catch(() => false)) {
      await countryTrigger.scrollIntoViewIfNeeded().catch(() => {});
      await countryTrigger.click({ force: true });
      await page.waitForTimeout(400);

      const turkeyOption = page.locator('[role="option"], [data-radix-collection-item], div[class*="select-item" i]')
        .filter({ hasText: /türkiye|turkey/i })
        .first();

      if (await turkeyOption.isVisible().catch(() => false)) {
        await turkeyOption.click({ force: true });
        console.log('✅ [LICENSE/BILLING] Ülke "Türkiye" (combobox option) başarıyla seçildi.');
      } else {
        await page.keyboard.type('Türkiye');
        await page.keyboard.press('Enter');
        console.log('✅ [LICENSE/BILLING] Ülke "Türkiye" (klavye girişi) girildi.');
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  const cityInput = page.locator('input[name*="city" i], input[id*="city" i]').or(page.getByPlaceholder(/istanbul|city|şehir/i)).first();
  const postalCodeInput = page.locator('input[name*="postal" i], input[name*="zip" i]').or(page.getByPlaceholder(/34710|postal|zip|posta/i)).first();
  const addressTextArea = page.locator('textarea[name*="address" i], textarea, input[name*="address" i]').or(page.getByPlaceholder(/street|building|apartment|district|adres/i)).first();

  await fillField(cityInput, addressData.city, 'Şehir');
  await fillField(postalCodeInput, addressData.postalCode, 'Posta Kodu');
  await fillField(addressTextArea, addressData.address, 'Açık Adres');

  // ─── TAX / NATIONAL ID (TC KİMLİK NO) ───
  const taxIdInput = page.locator('input[name*="tc" i], input[name*="tax" i], input[name*="national" i], input[name*="identity" i]')
    .or(page.getByPlaceholder(/11-digit|tc id|kimlik|tax/i))
    .first();

  await fillField(taxIdInput, addressData.taxId, 'TC Kimlik No');

  // ─── SET AS DEFAULT ADDRESS CHECKBOX / SWITCH (KURUMSAL FATURA KUTUSUNA ASLA TIKLANMAZ) ───
  console.log('🔍 [LICENSE/BILLING] "Set as default address" seçeneği kontrol ediliyor...');
  const defaultLabel = page.getByText(/Set as default address|varsayılan/i).first();

  if (await defaultLabel.isVisible().catch(() => false)) {
    await defaultLabel.scrollIntoViewIfNeeded().catch(() => {});
    const checkboxElement = defaultLabel.locator('xpath=./preceding-sibling::*[button or input or @role="checkbox"]')
      .or(defaultLabel.locator('xpath=./ancestor::div[contains(@class,"flex")][1]//button[@role="checkbox" or @type="button"]'))
      .or(defaultLabel.locator('xpath=./ancestor::div[contains(@class,"flex")][1]//input[@type="checkbox"]'))
      .or(defaultLabel)
      .first();

    await checkboxElement.click({ force: true }).catch(() => defaultLabel.click({ force: true }));
    console.log('☑️ [LICENSE/BILLING] Yalnızca "Set as default address" seçeneği işaretlendi.');
    await page.waitForTimeout(300);
  }

  // ─── KAYDET VE CONTINUE TO PAYMENT BUTONUNUN AKTİFLEŞMESİNİ BEKLE ───
  const saveBtn = page.getByRole('button', { name: /save address|save|kaydet/i })
    .or(page.getByRole('button', { name: /save address/i }))
    .or(page.locator('button').filter({ hasText: /save address|kaydet/i }))
    .first();

  await expect(saveBtn).toBeEnabled({ timeout: 5000 });
  await saveBtn.scrollIntoViewIfNeeded().catch(() => {});
  await saveBtn.click({ force: true });
  console.log('💾 [LICENSE/BILLING] "Save Address" butonuna basıldı.');

  // Form gönderildikten sonra Continue to payment butonunun aktifleştiğini doğrula ve tıkla
  await expect(async () => {
    const continueBtn = page.getByRole('button', { name: /continue to payment|ödemeye devam/i }).first();
    const isEnabled = await continueBtn.isEnabled().catch(() => false);
    
    if (!isEnabled) {
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click({ force: true }).catch(() => {});
      }
      throw new Error('"Continue to payment" butonu henüz aktifleşmedi.');
    }

    await continueBtn.scrollIntoViewIfNeeded().catch(() => {});
    await continueBtn.click({ force: true });
    console.log('🚀 [LICENSE/BILLING] "Continue to payment" butonuna tıklandı! İyzico ödeme ekranına geçiliyor...');
  }).toPass({ timeout: 20_000, intervals: [1000, 2000] });

  return false;
}

/**
 * 2. Continue to Payment butonuna basıp İyzico ödeme penceresini açma
 */
async function proceedToPaymentWindow(page: Page): Promise<void> {
  const continueBtn = page.getByRole('button', { name: /continue to payment|ödemeye devam/i })
    .or(page.getByRole('link', { name: /continue to payment|ödemeye devam/i }))
    .first();

  if (await continueBtn.isVisible().catch(() => false)) {
    if (await continueBtn.isEnabled().catch(() => false)) {
      await continueBtn.click({ force: true });
      console.log('➡️ [LICENSE/IYZICO] Continue to payment butonuna tıklandı.');
    }
  } else {
    console.log('ℹ️ [LICENSE/IYZICO] Continue to payment zaten tıklandı; İyzico penceresine geçiliyor.');
  }
}

/**
 * 3. İyzico İlk Ekran: Telefon Onayı ve SMS Kodu (123456)
 */
async function handleIyzicoInitialPhoneAndSms(page: Page): Promise<void> {
  console.log('📱 [LICENSE/IYZICO] İyzico ilk telefon ve 123456 SMS doğrulama adımı kontrol ediliyor...');

  const userPhone = process.env.E2E_USER_PHONE || '5551234567';
  const digitsOnly = userPhone.replace(/\D/g, '');
  const phoneWithout90 = digitsOnly.startsWith('90') ? digitsOnly.slice(2) : digitsOnly;

  let cardFormReached = false;
  const phoneStepAppeared = await expect(async () => {
    for (const frame of paymentFrames(page)) {
      const cardNumberInput = frame.locator([
        'input[autocomplete="cc-number"]',
        'input[name*="cardNumber" i]',
        'input[id*="cardNumber" i]',
        'input[placeholder*="Kart Numarası" i]',
        'input[placeholder*="Card Number" i]'
      ].join(', ')).first();

      // Telefon alanı kart formunda da görünür kalıyor. Kart alanı görünüyorsa bu ekran
      // telefon adımı değildir ve "Ödemeye Devam Et" kart doldurulmadan tıklanmamalıdır.
      if (await cardNumberInput.isVisible().catch(() => false)) {
        cardFormReached = true;
        return;
      }

      // HTML: <input data-testid="gsmNumber" id="gsmNumber" name="gsmNumber" value="+90" ...>
      const phoneInput = frame.locator('input[data-testid="gsmNumber"], input[id="gsmNumber"], input[name="gsmNumber"], input[type="tel"], input[name*="phone" i]').first();

      if (await phoneInput.isVisible().catch(() => false)) {
        const val = await phoneInput.inputValue().catch(() => '');
        if (!val || val.replace(/\D/g, '').length < 7) {
          console.log(`📱 [LICENSE/IYZICO] gsmNumber kutusuna tıklandı, +90 sonrasına kalan numara giriliyor: ${phoneWithout90}`);
          await phoneInput.focus().catch(() => {});
          await phoneInput.click({ force: true }).catch(() => {});
          await page.waitForTimeout(200);

          // +90 temizlenmeden doğrudan devamına 10 haneli numara yazılıyor
          await phoneInput.pressSequentially(phoneWithout90, { delay: 50 }).catch(async () => {
            await phoneInput.fill(`+90${phoneWithout90}`).catch(() => {});
          });
          await page.waitForTimeout(300);
        } else {
          console.log(`📱 [LICENSE/IYZICO] Telefon alanı zaten dolu: ${val}`);
        }
      }

      // Devam Et butonuna tıkla
      const continueBtn = frame.getByRole('button', { name: /^(devam et|continue)$/i }).first();
      if (await continueBtn.isVisible().catch(() => false)) {
        await continueBtn.click({ force: true });
        return;
      }
    }
    throw new Error('İyzico telefon adımı veya Devam Et butonu henüz görünmedi.');
  }).toPass({ timeout: 15_000, intervals: [500, 1_000] })
    .then(() => true)
    .catch(() => false);

  if (!phoneStepAppeared) {
    console.log('ℹ️ [LICENSE/IYZICO] Telefon devam et adımı doğrudan geçildi veya kart ekranına yönlenildi.');
  } else if (cardFormReached) {
    console.log('ℹ️ [LICENSE/IYZICO] Kayıtlı kart bulunmadı; yeni kart formuna geçildi. Telefon alanındaki genel "Ödemeye Devam Et" butonu tıklanmadı.');
    return;
  } else {
    console.log('➡️ [LICENSE/IYZICO] Telefon adımında Devam Et butonuna tıklandı.');
  }

  await expect(async () => {
    for (const frame of paymentFrames(page)) {
      const smsInput = frame.locator('input[name*="otp" i], input[name*="code" i], input[placeholder*="kod" i], input[maxlength="6"]').first();
      if (await smsInput.isVisible().catch(() => false)) {
        await smsInput.fill('123456');
        const submitBtn = frame.getByRole('button', { name: /devam|doğrula|submit|onayla/i }).first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click({ force: true });
        }
        return;
      }
    }
    throw new Error('İlk SMS 123456 input alanı bulunamadı.');
  }).toPass({ timeout: 15_000, intervals: [500, 1_000] })
    .then(() => console.log('✅ [LICENSE/IYZICO] İlk SMS kodu (123456) başarıyla girildi.'))
    .catch(() => console.log('ℹ️ [LICENSE/IYZICO] İlk SMS doğrulama ekranı atlandı veya doğrudan kart ekranına geçildi.'));
}

/**
 * 4. İyzico Kart Bilgilerini Girme ("Yeni Kart Ekle" / "Kart ile Öde" -> Kart detayları -> "Ödemeye Devam Et")
 */
async function fillIyzicoCardDetails(page: Page, card: IyzicoTestCard): Promise<void> {
  console.log('💳 [LICENSE/IYZICO] İyzico kart kontrolü yapılıyor (Kayıtlı Kart veya Yeni Kart)...');

  await expect(async () => {
    for (const frame of paymentFrames(page)) {
      const savedCardPayBtn = frame.getByRole('button', { name: /ödemeye devam et|kayıtlı kart ile öde|öde|pay|ödeme yap/i }).first();
      const cardNumberInput = frame.locator([
        'input[autocomplete="cc-number"]',
        'input[name*="cardNumber" i]',
        'input[id*="cardNumber" i]',
        'input[placeholder*="Kart Numarası" i]',
        'input[placeholder*="Card Number" i]',
        'input[placeholder*="****" i]'
      ].join(', ')).first();

      const isCardInputVisible = await cardNumberInput.isVisible().catch(() => false);

      // 1. Durum A: Halihazırda Kayıtlı Kart varsa "Ödemeye Devam Et / Öde" butonuna bas
      if (!isCardInputVisible && await savedCardPayBtn.isVisible().catch(() => false)) {
        if (await savedCardPayBtn.isEnabled().catch(() => false)) {
          await savedCardPayBtn.click({ force: true });
          console.log('💳 [LICENSE/IYZICO] Kayıtlı kart tespit edildi; "Ödemeye Devam Et / Öde" butonuna tıklandı!');
          return;
        }
      }

      // 2. Durum B: Yeni Kart Bilgilerini Girme
      const newCardTab = frame.getByText(/yeni kart|yeni kart ile öde|pay with new card/i).first();
      if (!isCardInputVisible && await newCardTab.isVisible().catch(() => false)) {
        await newCardTab.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }

      if (await cardNumberInput.isVisible().catch(() => false)) {
        const holderInput = frame.locator('input[placeholder*="Ad Soyad" i], input[name*="holder" i], input[name*="cardHolder" i]').first();
        const expiryInput = frame.locator('input[placeholder*="Ay / Yıl" i], input[placeholder*="AA/YY" i], input[name*="expire" i]').first();
        const cvcInput = frame.locator('input[placeholder*="CVC" i], input[placeholder*="CVV" i], input[name*="cvc" i]').first();

        if (await holderInput.isVisible().catch(() => false)) {
          await holderInput.fill(card.holder);
        }
        await cardNumberInput.fill(card.number);
        if (await expiryInput.isVisible().catch(() => false)) {
          await expiryInput.fill(card.expiry);
        }
        if (await cvcInput.isVisible().catch(() => false)) {
          await cvcInput.fill(card.cvc);
        }

        const payContinueBtn = frame.getByRole('button', { name: /ödemeye devam et|pay|öde|devam et/i }).last();
        await expect(payContinueBtn).toBeEnabled({ timeout: 5000 });
        await payContinueBtn.click({ force: true });
        console.log('💳 [LICENSE/IYZICO] Yeni kart bilgileri dolduruldu ve "Ödemeye Devam Et" butonuna tıklandı.');
        return;
      }

      // 3. Durum C: Herhangi bir "Öde" veya "Devam Et" butonu görünür ve aktifse tıkla
      if (await savedCardPayBtn.isVisible().catch(() => false) && await savedCardPayBtn.isEnabled().catch(() => false)) {
        await savedCardPayBtn.click({ force: true });
        console.log('💳 [LICENSE/IYZICO] Aktif ödeme butonuna tıklandı.');
        return;
      }
    }

    throw new Error('İyzico kart bilgileri veya ödeme butonu henüz hazır değil.');
  }).toPass({ timeout: 25_000, intervals: [500, 1_000] });
}

/**
 * 5. İyzico 3D Secure 2. SMS Onayı (Parantez içi kodu okuma -> Submit)
 */
async function handleIyzico3DSecureSms(page: Page): Promise<void> {
  console.log('🔐 [LICENSE/IYZICO] Kart sonrası SMS doğrulama ekranı bekleniyor...');

  await expect(async () => {
    for (const frame of paymentFrames(page)) {
      const frameText = await frame.locator('body').innerText().catch(() => '');

      const codeMatch = frameText.match(/sms[^()\r\n]{0,100}\((\d{6})\)/i) ||
                        frameText.match(/\((\d{6})\)/);

      const smsInput = frame.locator([
        'input[data-testid*="sms" i]',
        'input[name*="SmsCode" i]',
        'input[name*="otp" i]',
        'input[name*="code" i]',
        'input[placeholder*="SMS Kodu" i]',
        'input[placeholder*="Sms Code" i]',
        'input[maxlength="6"]'
      ].join(', ')).first();

      if (await smsInput.isVisible().catch(() => false)) {
        const verificationCode = codeMatch?.[1] || '123456';
        console.log(`🔑 [LICENSE/IYZICO] SMS doğrulama kodu giriliyor: ${verificationCode}`);

        await smsInput.fill(verificationCode);
        await expect(smsInput).toHaveValue(verificationCode);

        const submitBtn = frame.getByRole('button', { name: /^(doğrula|submit|onayla|devam)$/i }).first();
        await expect(submitBtn).toBeEnabled({ timeout: 5000 });
        await submitBtn.click();
        console.log('✅ [LICENSE/IYZICO] Kart sonrası SMS doğrulama kodu gönderildi.');
        return;
      }
    }
    throw new Error('Kart sonrası SMS doğrulama input alanı henüz gelmedi.');
  }).toPass({ timeout: 30_000, intervals: [500, 1_000] });
}

/**
 * 6. "You're all set!" Başarı Ekranı Doğrulaması
 */
async function verifySuccessScreen(page: Page): Promise<void> {
  console.log('🎉 [LICENSE] Ödeme sonrası "You\'re all set!" başarı ekranı doğrulanıyor...');

  const successMessage = page.getByText(/You're all set!|PAYMENT RECEIVED|Payment Successful/i).first();
  await expect(successMessage).toBeVisible({ timeout: 45_000 });

  const dashboardBtn = page.getByRole('button', { name: /go to dashboard|dashboard'a git/i })
    .or(page.getByRole('link', { name: /go to dashboard|dashboard'a git/i }))
    .first();
  
  if (await dashboardBtn.isVisible().catch(() => false)) {
    console.log('🎉 [LICENSE] "Go to Dashboard" butonu göründü; lisans işlemi tam anlamıyla başarılı!');
  }
}

test.describe('License — Lisans Değiştirme (Upgrade / Downgrade) Akışı', () => {
  test('Seçilen lisans planına geçilmeli (Upgrade/Downgrade), adres ve İyzico adımları başarıyla tamamlanmalı',
    { tag: ['@critical', '@license-change'] },
    async ({ page, request }) => {
      test.setTimeout(180_000); // 3 dakika timeout

      // İyzico kart widget'ının pattern="[0-9 /]*" niteliği Chromium'un /v regex
      // yorumunda üçüncü taraf kaynaklı bir console error üretir; ödeme sonucunu etkilemez.
      (page as GitSecPage).ignoredErrors = [
        /Pattern attribute value \[0-9 \/\]\* is not a valid regular expression/i
      ];

      const dashboardBaseUrl = requireEnv('DASHBOARD_BASE_URL');
      const apiBaseUrl = requireEnv('API_BASE_URL');

      // Workspace ID bilgisini API veya URL yönlendirmesinden OTOMATİK TESPİT ET (Elle ayarlamaya gerek yok)
      const workspaceId = await resolveWorkspaceId(page, request, apiBaseUrl, dashboardBaseUrl);

      const configuredTargetPlan = process.env.E2E_LICENSE_TARGET_PLAN?.trim() || 'Premium+';
      expect(['Freemium', 'Startup', 'Premium', 'Premium+'], 'Dashboard geçerli bir hedef lisans göndermeli.').toContain(configuredTargetPlan);
      const targetPlan = configuredTargetPlan as SupportedPlan;

      // E2E_LICENSE_BILLING_CYCLE eski dashboard sürümleriyle geriye dönük uyumluluk içindir.
      const configuredTargetInterval = (
        process.env.E2E_LICENSE_TARGET_INTERVAL ||
        process.env.E2E_LICENSE_BILLING_CYCLE ||
        'monthly'
      ).trim().toLowerCase();
      expect(['monthly', 'yearly'], 'Dashboard geçerli bir faturalandırma periyodu göndermeli.').toContain(configuredTargetInterval);
      const targetInterval = configuredTargetInterval as 'monthly' | 'yearly';

      const iyzicoCard: IyzicoTestCard = {
        holder: process.env.E2E_IYZICO_CARD_HOLDER?.trim() || 'Gitsec Test',
        number: process.env.E2E_IYZICO_CARD_NUMBER?.replace(/\s+/g, '') || '5890040000000016',
        expiry: process.env.E2E_IYZICO_CARD_EXPIRY?.trim() || '12/30',
        cvc: process.env.E2E_IYZICO_CARD_CVC?.trim() || '123'
      };

      const billingAddress: BillingAddressData = {
        firstName: 'Gitsec',
        lastName: 'Test',
        email: process.env.E2E_USER_EMAIL || 'gitsec_test_ly03zv@web-library.net',
        phone: process.env.E2E_USER_PHONE || '5551234567',
        country: 'Türkiye',
        city: 'Istanbul',
        postalCode: '34710',
        address: 'Atatürk Mah. Karanfil Sok. No:5 Daire:3',
        taxId: '11111111111'
      };

      const authCookie = (await page.context().cookies())
        .find(cookie => cookie.name === 'gs_token' && cookie.value);
      expect(authCookie, 'Kimliği doğrulanmış oturumda gs_token cookie değeri bulunmalı.').toBeDefined();
      const authorizationHeader = `Bearer ${authCookie!.value}`;

      const readCurrentPlanInfo = async (): Promise<{ plan: string; interval: string }> => {
        const response = await request.get(`${apiBaseUrl}/api/licences/current`, {
          headers: { Authorization: authorizationHeader }
        });
        if (response.status() !== 200) return { plan: '', interval: '' };
        const body = await response.json();
        const data = body?.data || {};
        const plan = String(data.currentPlan || data.plan || data.tierName || '').trim();
        const rawBillingCycle = data.interval ?? data.billingInterval ?? data.period ?? data.billingCycle;
        const normalizedBillingCycle = String(rawBillingCycle ?? '').trim().toLowerCase();
        const interval = normalizedBillingCycle === '2' || /^(yearly|annual|annually)$/.test(normalizedBillingCycle)
          ? 'yearly'
          : normalizedBillingCycle === '1' || /^monthly$/.test(normalizedBillingCycle)
            ? 'monthly'
            : '';
        return { plan, interval };
      };

      const { plan: initialPlan, interval: initialInterval } = await readCurrentPlanInfo();
      console.log(`📄 [LICENSE] Başlangıç Lisans Planı: ${initialPlan || 'Bilinmiyor'} (${initialInterval || 'bilinmiyor'}); Hedef Lisans: ${targetPlan} (${targetInterval})`);

      if (initialPlan.toLowerCase() === targetPlan.toLowerCase() && initialInterval === targetInterval) {
        expect(initialPlan, 'Backend hedef lisansı aktif göstermeli.').toBe(targetPlan);
        expect(initialInterval, 'Backend hedef faturalandırma periyodunu aktif göstermeli.').toBe(targetInterval);
        console.log(`✅ [LICENSE] "${targetPlan}" (${targetInterval}) backend üzerinde zaten aktif. Herhangi bir plan veya ödeme butonuna basılmadan test tamamlandı.`);
        return;
      }

      // ─── ADIM 1: Billing & Plans Sayfasına Git ───
      await page.goto(`${dashboardBaseUrl}/${workspaceId}/billing-and-plans`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.getByText(/Plan Comparison|Billing|Plans/i).first()).toBeVisible({ timeout: 30_000 });

      // ─── ADIM 1.5: Fatura Periyodunu Seç (Aylık -> Yıllık Yükseltmesi İçin) ───
      await selectBillingInterval(page, targetInterval);

      // ─── ADIM 2: Target Plan Kartında Değişiklik (Upgrade/Downgrade/Select) Butonuna Tıkla ───
      const planSelectionResult = await selectTargetPlanCardButton(page, targetPlan);
      if (planSelectionResult === 'limit-reached') {
        throw new Error(`Lisans ${initialPlan} planından ${targetPlan} planına değiştirilemedi: bu fatura dönemi için plan değiştirme limiti dolmuş.`);
      }
      if (planSelectionResult === 'already-active') {
        expect(initialPlan.toLowerCase(), 'UI hedef planı aktif gösteriyor ancak backend başlangıç planı farklı.').toBe(targetPlan.toLowerCase());
        expect(initialInterval, 'UI hedef fatura periyodunu aktif gösteriyor ancak backend başlangıç periyodu farklı.').toBe(targetInterval);
        console.log(`ℹ️ [LICENSE] Sayfada "${targetPlan}" (${targetInterval}) planı zaten aktif. Adres/ödeme adımlarına geçilmeden test tamamlandı.`);
        return;
      }

      // Fatura dönemi lisans değişiklik limiti (2 hak) uyarısını denetle
      if (await checkPlanChangeLimitReached(page)) {
        throw new Error(`Lisans ${initialPlan} planından ${targetPlan} planına değiştirilemedi: bu fatura dönemi için plan değiştirme limiti dolmuş.`);
      }

      // ─── ADIM 3: Çıkan Modalda Continue / Confirm Butonuna Tıkla ───
      const confirmationDialog = page.getByRole('dialog');
      const dialogAppeared = await confirmationDialog.waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);

      if (dialogAppeared) {
        const confirmBtn = confirmationDialog.getByRole('button', { name: /continue|confirm|devam|onayla/i }).last();
        await expect(confirmBtn).toBeEnabled();
        await confirmBtn.click();
        console.log('🔘 [LICENSE] Ön onay modalında Continue butonuna tıklandı.');

        // Onay modalından hemen sonra değişiklik limiti uyarısını denetle
        if (await checkPlanChangeLimitReached(page)) {
          throw new Error(`Lisans ${initialPlan} planından ${targetPlan} planına değiştirilemedi: bu fatura dönemi için plan değiştirme limiti dolmuş.`);
        }
      }

      // ─── ADIM 4: Fatura Adresi Kontrolü ve Ekleme (Add Billing Address) ───
      const limitReachedInAddress = await handleBillingAddressIfRequired(page, billingAddress);
      if (limitReachedInAddress) {
        throw new Error(`Lisans ${initialPlan} planından ${targetPlan} planına değiştirilemedi: bu fatura dönemi için plan değiştirme limiti dolmuş.`);
      }

      // ─── ADIM 5: Continue to Payment Butonuna Basıp İyzico'ya Geç ───
      await proceedToPaymentWindow(page);

      // ─── ADIM 6: İyzico İlk Telefon ve 123456 SMS Adımı ───
      await handleIyzicoInitialPhoneAndSms(page);

      // ─── ADIM 7: İyzico Kart Bilgilerini Gir ve "Ödemeye Devam Et" Tıkla ───
      await fillIyzicoCardDetails(page, iyzicoCard);

      // ─── ADIM 8: İyzico 2. SMS (3D Secure - Parantez içi kodu oku ve Submit et) ───
      await handleIyzico3DSecureSms(page);

      // ─── ADIM 9: "You're all set!" Başarı Ekranını Doğrula ───
      await verifySuccessScreen(page);

      // ─── ADIM 10: Backend Lisansının Güncellendiğini Doğrula ───
      await expect.poll(readCurrentPlanInfo, {
        message: `Backend lisansı ${targetPlan} (${targetInterval}) olarak güncellenmeli.`,
        timeout: 60_000,
        intervals: [2_000, 5_000]
      }).toEqual({ plan: targetPlan, interval: targetInterval });

      console.log(`🎉 [LICENSE] Tebrikler! Lisans başarıyla ${targetPlan} planına değiştirildi.`);
    }
  );
});
