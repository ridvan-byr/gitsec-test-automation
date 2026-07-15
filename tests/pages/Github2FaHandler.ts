import { Page, Locator } from '@playwright/test';
import { pollGithubEmailOtp } from '../support/github-email-otp';

export type Github2FaAssessment = {
    hasTwoFactor: boolean;
    method: 'none' | 'email' | 'sudo_email' | 'totp' | 'passkey' | 'sms' | 'unknown';
    automatable: boolean;
    message: string;
};

export class Github2FaHandler {
    readonly page: Page;
    readonly deviceCodeInput: Locator;
    readonly sudoEmailOtpInput: Locator;
    private readonly usedOtpCodes: string[] = [];

    constructor(page: Page) {
        this.page = page;
        this.sudoEmailOtpInput = page.locator('#sudo_email_otp, input[name="sudo_email_otp"]');
        this.deviceCodeInput = this.sudoEmailOtpInput
            .or(page.locator('#otp, input[name="otp"], input[name="verification_key"], input[autocomplete="one-time-code"]'))
            .first();
    }

    isGone(): boolean {
        return this.page.isClosed();
    }

    async safePause(ms: number): Promise<void> {
        if (this.isGone()) return;
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    hasGithubMailConfigured(): boolean {
        return Boolean(process.env.GITHUB_MAIL_USER?.trim()) && Boolean(process.env.GITHUB_MAIL_PASSWORD?.trim());
    }

    loginOtpInput(): Locator {
        return this.page.locator('#otp, input[name="otp"]').first();
    }

    async activeOtpInput(): Promise<Locator> {
        if (await this.sudoEmailOtpInput.isVisible().catch(() => false)) {
            return this.sudoEmailOtpInput;
        }
        const loginOtp = this.loginOtpInput();
        if (await loginOtp.isVisible().catch(() => false)) {
            return loginOtp;
        }
        return this.deviceCodeInput;
    }

    sendCodeViaEmailButton(): Locator {
        return this.page
            .locator('button')
            .filter({
                has: this.page.locator('span.Button-label', { hasText: /^Send a code via email$|^E-posta ile kod gönder$/i }),
            })
            .or(this.page.getByRole('button', { name: /^Send a code via email$|^E-posta ile kod gönder$/i }))
            .first();
    }

    async isSendCodeViaEmailVisible(): Promise<boolean> {
        if (this.isGone()) {
            return false;
        }
        return this.sendCodeViaEmailButton().isVisible().catch(() => false);
    }

    async isEmailTwoFactorOptionVisible(): Promise<boolean> {
        if (await this.isSendCodeViaEmailVisible()) {
            return true;
        }
        if (await this.page.locator('#sudo-send-email').isVisible().catch(() => false)) {
            return true;
        }
        
        const hasEmailBtn = await this.page
            .getByRole('button', {
                name: /send (\w+ )?code via email|verify via e-?mail|verify via email|verify with e-?mail|e-posta ile (bir )?kod gönder/i,
            })
            .first()
            .isVisible()
            .catch(() => false);
            
        if (hasEmailBtn) return true;
        
        return this.page
            .getByText(/device verification|we sent a (?:verification )?code to|sent an email with a|cihaz doğrulaması/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    async isPasskeyTwoFactorVisible(): Promise<boolean> {
        return this.page
            .getByText(/passkey|security key|use your passkey|sign in with a passkey|use a passkey/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    async isTotpTwoFactorVisible(): Promise<boolean> {
        const loginOtp = await this.loginOtpInput().isVisible().catch(() => false);
        const sudoOtp = await this.sudoEmailOtpInput.isVisible().catch(() => false);
        if (!loginOtp || sudoOtp) {
            return false;
        }
        const authenticatorHint = await this.page
            .getByText(/authenticator app|authentication app|verification code from your app/i)
            .first()
            .isVisible()
            .catch(() => false);
        const totpHeading = await this.page
            .getByRole('heading', { name: /authentication code|enter the code/i })
            .isVisible()
            .catch(() => false);
        return authenticatorHint || totpHeading;
    }

    async isSmsTwoFactorVisible(): Promise<boolean> {
        return this.page
            .getByText(/text message|sms code|sent to your phone|phone number/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    async isTwoFactorScreenVisible(): Promise<boolean> {
        if (this.isGone()) {
            return false;
        }
        const url = this.page.url();
        if (/two-factor|sessions\/two-factor|sessions\/verify/i.test(url)) {
            return true;
        }
        const heading = await this.page
            .getByRole('heading', { name: /two.factor|two-step|authentication code|confirm access|iki faktörlü|iki adımlı|erişimi onayla/i })
            .first()
            .isVisible()
            .catch(() => false);
        const label = await this.page
            .getByText(/two.factor authentication|two-step verification|iki faktörlü doğrulama|iki adımlı doğrulama/i)
            .first()
            .isVisible()
            .catch(() => false);
        const otpVisible = await this.deviceCodeInput.isVisible().catch(() => false);
        const sudo = await this.isSudoUiVisible();
        const usernameVisible = await this.page.locator('input[name="login"]').isVisible().catch(() => false);
        return heading || label || sudo || (otpVisible && !usernameVisible);
    }

    async isSudoUiVisible(): Promise<boolean> {
        if (this.isGone()) return false;
        const otp = await this.sudoEmailOtpInput.isVisible().catch(() => false);
        const send = await this.page.locator('#sudo-send-email').isVisible().catch(() => false);
        const sendCodeEmail = await this.isSendCodeViaEmailVisible();
        const verifyEmail = await this.page
            .getByRole('button', { name: /verify via e-?mail/i })
            .isVisible()
            .catch(() => false);
        return otp || send || sendCodeEmail || verifyEmail;
    }

    async assessTwoFactorChallenge(): Promise<Github2FaAssessment> {
        if (this.isGone()) {
            return { hasTwoFactor: false, method: 'none', automatable: true, message: '' };
        }

        const onScreen = await this.isTwoFactorScreenVisible();
        if (!onScreen) {
            return {
                hasTwoFactor: false,
                method: 'none',
                automatable: true,
                message: 'İki faktörlü doğrulama ekranı görülmedi.',
            };
        }

        if (await this.isPasskeyTwoFactorVisible()) {
            return {
                hasTwoFactor: true,
                method: 'passkey',
                automatable: false,
                message:
                    'Hesap passkey / güvenlik anahtarı ile korunuyor. Playwright bu adımı geçemez; girişi elle yapıp playwright/.auth/github.json kaydedin veya test hesabında passkey kullanmayın.',
            };
        }

        if (await this.isSmsTwoFactorVisible()) {
            return {
                hasTwoFactor: true,
                method: 'sms',
                automatable: false,
                message:
                    'Hesap SMS ile iki faktörlü doğrulama kullanıyor. Otomatik test bu kodu alamaz; giriş elle yapılmalı veya e-posta/TOTP dışı 2FA kapatılmalı.',
            };
        }

        const emailOption = await this.isEmailTwoFactorOptionVisible();
        const sudoOtp = await this.sudoEmailOtpInput.isVisible().catch(() => false);

        if (emailOption || sudoOtp) {
            const hasMail = this.hasGithubMailConfigured();
            return {
                hasTwoFactor: true,
                method: sudoOtp ? 'sudo_email' : 'email',
                automatable: hasMail,
                message: hasMail
                    ? 'E-posta ile doğrulama destekleniyor; kod GITHUB_MAIL_* (IMAP) ile otomatik alınabilir.'
                    : 'E-posta 2FA var ancak GITHUB_MAIL_USER / GITHUB_MAIL_PASSWORD tanımlı değil; otomatik geçiş yapılamaz.',
            };
        }

        if (await this.isTotpTwoFactorVisible()) {
            return {
                hasTwoFactor: true,
                method: 'totp',
                automatable: false,
                message:
                    'Hesap yalnızca authenticator uygulaması (TOTP) ile korunuyor ve e-posta seçeneği görünmüyor. Otomatik test geçemez; girişi elle yapın veya GitHub ayarlarından e-posta ile doğrulamayı etkinleştirin.',
            };
        }

        const otpVisible = await this.loginOtpInput().isVisible().catch(() => false);
        if (otpVisible) {
            return {
                hasTwoFactor: true,
                method: 'unknown',
                automatable: false,
                message:
                    'İki faktörlü doğrulama kodu isteniyor ancak desteklenen e-posta yolu bulunamadı. Giriş elle yapılmalı veya kayıtlı oturum (playwright/.auth/github.json) kullanılmalı.',
            };
        }

        return {
            hasTwoFactor: true,
            method: 'unknown',
            automatable: false,
            message: 'İki faktörlü doğrulama ekranı var; otomatik tamamlanamıyor.',
        };
    }

    logTwoFactorBlocked(assessment: Github2FaAssessment): void {
        console.error('[github-2fa] ⚠️ [UYARI] --------------------------------------------------');
        console.error('[github-2fa] ⚠️ [UYARI] Girilen GitHub hesabında iki faktörlü doğrulama (2FA) tespit edildi.');
        console.error(`[github-2fa]   └─ Yöntem: ${assessment.method}`);
        console.error(`[github-2fa]   └─ Detay: ${assessment.message}`);
        if (!assessment.automatable) {
            console.error('[github-2fa] ❌ [ENGEL] OTOMATİK TEST GEÇİLEMEZ: Bu 2FA türü Playwright ile tamamlanamaz.');
            console.error(
                '[github-2fa]   └─ Yapılması gerekenler: (1) Tarayıcıda elle giriş yapıp oturumu playwright/.auth/github.json olarak kaydedin,'
            );
            console.error(
                '[github-2fa]   └─ (2) Test hesabında 2FA\'yı kapatın veya yalnızca e-posta doğrulaması + .env GITHUB_MAIL_* kullanın,'
            );
            console.error('[github-2fa]   └─ (3) Passkey / yalnızca authenticator kullanan hesaplarla otomasyon çalışmaz.');
        }
        console.error('[github-2fa] --------------------------------------------------');
    }

    async tryRevealEmailTwoFactorOption(): Promise<boolean> {
        const more = this.page
            .getByRole('button', { name: /more options/i })
            .or(this.page.getByRole('link', { name: /more options/i }))
            .first();
        if (await more.isVisible().catch(() => false)) {
            await more.click({ timeout: 8000 }).catch(() => {});
            await this.safePause(600);
        }
        return this.tryClickSendCodeViaEmail();
    }

    async tryClickSendCodeViaEmail(): Promise<boolean> {
        const codeAlreadySent = await this.page
            .getByText(/device verification|we sent a (?:verification )?code to|sent an email with a/i)
            .first()
            .isVisible()
            .catch(() => false);

        if (codeAlreadySent) {
            console.log('[github] 🔍 [KONTROL] GitHub e-posta doğrulama kodunu zaten otomatik göndermiş. (Durum: Cihaz Doğrulaması)');
            return false;
        }

        const tryClickVisible = async (loc: Locator, timeout = 3000): Promise<boolean> => {
            try {
                await loc.waitFor({ state: 'visible', timeout });
                await loc.scrollIntoViewIfNeeded();
                try {
                    await loc.click({ timeout: 4000 });
                } catch {
                    await loc.click({ timeout: 4000, force: true });
                }
                return true;
            } catch {
                return false;
            }
        };

        const sendViaEmail = this.sendCodeViaEmailButton();
        if (await sendViaEmail.isVisible().catch(() => false)) {
            if (await tryClickVisible(sendViaEmail)) {
                console.log('[github] 👆 [TIKLAMA] "Send a code via email" butonuna tıklandı.');
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                return true;
            }
        }

        const combinedBtn = this.page.locator('#sudo-send-email').or(
            this.page.getByRole('button', {
                name: /send (\w+ )?code via email|verify via e-?mail|verify via email|verify with e-?mail|e-posta ile kod gönder/i,
            })
        ).first();

        if (await tryClickVisible(combinedBtn, 4000)) {
            console.log('[github] 👆 [TIKLAMA] "Verify / Send code via email" butonuna tıklandı.');
            await this.page.waitForLoadState('domcontentloaded').catch(() => {});
            return true;
        }

        return false;
    }

    sudoOtpSubmitButton(): Locator {
        return this.page
            .locator('form')
            .filter({ has: this.sudoEmailOtpInput })
            .locator('button[type="submit"]')
            .first()
            .or(this.page.locator('button[type="submit"]').filter({ hasText: /^verify$|^doğrula$/i }))
            .first();
    }

    async submitSudoEmailOtp(): Promise<void> {
        const submit = this.sudoOtpSubmitButton();
        if (await submit.isVisible().catch(() => false)) {
            await submit.scrollIntoViewIfNeeded().catch(() => {});
            await submit.click({ timeout: 10_000 }).catch(() => {});
            console.log('[github] 🚀 [GİRİŞ] Güvenli işlem (Sudo) OTP doğrulama kodu gönderildi.');
            return;
        }
        await this.sudoEmailOtpInput.press('Enter').catch(() => {});
    }

    async enterVerificationCode(code: string) {
        const otpField = await this.activeOtpInput();
        await otpField.click({ timeout: 5000 }).catch(() => {});
        await otpField.fill('');
        await otpField.pressSequentially(code, { delay: 40 });
    }

    async completeEmailOtpIfConfigured(minReceivedAt?: Date): Promise<boolean> {
        const hasMail = this.hasGithubMailConfigured();
        if (!hasMail) {
            console.log('[github] ⚠️ [UYARI] Çevre değişkenlerinde GITHUB_MAIL_USER veya GITHUB_MAIL_PASSWORD eksik. E-posta OTP okuma adımı atlanıyor.');
            return false;
        }

        const otpField = await this.activeOtpInput();
        try {
            await otpField.waitFor({ state: 'visible', timeout: 90_000 });
        } catch {
            console.log('[github] 🔍 [KONTROL] OTP doğrulama kodu giriş alanı bulunamadı. (Sudo veya 2FA gerekmeyebilir)');
            return false;
        }

        if (minReceivedAt) {
            console.log('[github] ⏳ [BEKLEME] E-postanın posta kutusuna ulaşması için 6 saniye bekleniyor...');
            await this.safePause(6000);
            if (this.isGone()) {
                console.log('[github] 🧹 [OTURUM] E-posta beklenirken popup penceresi kapandı. (Oturum tamamlanmış olabilir)');
                return true;
            }
        }

        console.log('[github] ⏳ [BEKLEME] E-posta sunucusundan (IMAP) 6 veya 8 haneli tek kullanımlık güvenlik kodu (OTP) aranıyor...');
        const code = await pollGithubEmailOtp({
            maxWaitMs: 120_000,
            pollMs: 4000,
            minReceivedAt,
            excludeCodes: this.usedOtpCodes,
        });
        this.usedOtpCodes.push(code);
        console.log(`[github] 🔑 [OTURUM] E-posta ile gelen doğrulama kodu okundu: "${code}" (Kod Uzunluğu: ${code.length} karakter)`);

        await this.enterVerificationCode(code);
        const filled = await otpField.inputValue().catch(() => '');
        console.log(`[github] 🔍 [KONTROL] Okunan kod giriş kutusuna yazıldı. (Giriş Değeri: "${filled}")`);

        await this.submitSudoEmailOtp();
        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] OTP doğrulama kodu onaylandı ve pencere kapandı.');
            return true;
        }

        await this.safePause(2500);
        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] E-posta OTP doğrulaması tamamlandı, popup otomatik kapandı.');
            return true;
        }

        const sudoFailed = await this.page.getByText(/authentication failed/i).isVisible().catch(() => false);
        if (sudoFailed) {
            console.log('[github] ❌ [HATA] Güvenli işlem (Sudo) doğrulaması başarısız oldu! (Girilen kod GitHub tarafından reddedildi)');
            return false;
        }
        console.log('[github] 🎉 [BAŞARILI] E-posta OTP doğrulama kodu başarıyla onaylandı.');
        return true;
    }

    async handleTwoFactorAuthentication(preLoginTime?: Date): Promise<boolean> {
        if (this.isGone()) {
            return true;
        }

        await this.safePause(1200);
        let assessment = await this.assessTwoFactorChallenge();

        if (!assessment.hasTwoFactor) {
            console.log('[github-2fa] 🔍 [KONTROL] İki faktörlü doğrulama ekranı yok; doğrudan geçiliyor.');
            return true;
        }

        console.log(
            `[github-2fa] 🛡️ [2FA] İki faktörlü doğrulama (2FA) tespit edildi. (Yöntem: ${assessment.method}, Otomatik: ${assessment.automatable ? 'evet' : 'hayır'})`
        );
        console.log(`[github-2fa] ℹ️ [BİLGİ] Detay: ${assessment.message}`);

        if (!assessment.automatable) {
            this.logTwoFactorBlocked(assessment);
            return false;
        }

        await this.tryRevealEmailTwoFactorOption();
        const sentAt = preLoginTime || new Date();
        const clicked = await this.tryClickSendCodeViaEmail();
        if (!clicked) {
            console.log('[github-2fa] ℹ️ [BİLGİ] "Verify via email" butonuna tıklanamadı. (OTP giriş kutusu zaten aktif olabilir)');
        }

        const otpOk = await this.completeEmailOtpIfConfigured(sentAt);
        if (this.isGone()) {
            console.log('[github-2fa] 🎉 [BAŞARILI] 2FA doğrulaması yapıldıktan sonra popup otomatik olarak kapandı.');
            return true;
        }

        if (!otpOk) {
            assessment = await this.assessTwoFactorChallenge();
            if (assessment.hasTwoFactor) {
                console.error('[github-2fa] ❌ [HATA] E-posta kodu ile 2FA tamamlanamadı.');
                this.logTwoFactorBlocked({
                    ...assessment,
                    automatable: false,
                    message: 'E-posta kodu alınamadı veya reddedildi. GITHUB_MAIL_* ve Gmail uygulama şifresini kontrol edin.',
                });
                return false;
            }
        }

        await this.safePause(800);
        assessment = await this.assessTwoFactorChallenge();
        if (assessment.hasTwoFactor) {
            this.logTwoFactorBlocked(assessment);
            return false;
        }

        console.log('[github-2fa] 🎉 [BAŞARILI] E-posta OTP doğrulaması başarıyla tamamlandı. Akış devam ediyor.');
        return true;
    }
}
