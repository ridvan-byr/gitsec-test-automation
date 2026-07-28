import { Page, Locator } from '@playwright/test';
import { pollGithubEmailOtp } from '../support/github-email-otp';
import * as OTPAuth from 'otpauth';

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

    hasGithubTotpConfigured(): boolean {
        const secret = process.env.GITHUB_TEST_TOTP_SECRET?.trim() || process.env.GITHUB_TOTP_SECRET?.trim();
        return Boolean(secret);
    }

    generateTotpCode(): string | null {
        const rawSecret = process.env.GITHUB_TEST_TOTP_SECRET?.trim() || process.env.GITHUB_TOTP_SECRET?.trim();
        if (!rawSecret) return null;
        try {
            const cleanSecret = rawSecret.replace(/\s+/g, '').toUpperCase();
            const totp = new OTPAuth.TOTP({
                issuer: 'GitHub',
                label: 'GitHub',
                algorithm: 'SHA1',
                digits: 6,
                period: 30,
                secret: OTPAuth.Secret.fromBase32(cleanSecret),
            });
            return totp.generate();
        } catch (err: any) {
            console.error(`[github-2fa] ❌ [HATA] TOTP kodu üretilemedi: ${err?.message || err}`);
            return null;
        }
    }

    loginOtpInput(): Locator {
        return this.page.locator('#app_totp, input[name="app_totp"], #otp, input[name="otp"], input[name="verification_key"], input[autocomplete="one-time-code"]').first();
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
        const url = this.page.url();
        if (/\/two-factor\/app|\/two-factor\/totp|\/two-factor\b/i.test(url)) {
            return true;
        }

        const loginOtp = await this.loginOtpInput().isVisible().catch(() => false);
        const sudoOtp = await this.sudoEmailOtpInput.isVisible().catch(() => false);
        if (loginOtp && !sudoOtp) {
            return true;
        }

        const authenticatorHint = await this.page
            .getByText(/authenticator app|authentication app|verification code from your app|two-factor authentication|enter the code/i)
            .first()
            .isVisible()
            .catch(() => false);
        const totpHeading = await this.page
            .getByRole('heading', { name: /authentication code|enter the code|two-factor authentication/i })
            .first()
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
        const isVerifiedDeviceUrl = /verified-device|sessions\/verified/i.test(this.page.url());
        const emailCodeText = await this.page
            .getByText(/sent your authentication code via email|Device Verification Code|sent an email with a verification code/i)
            .first()
            .isVisible()
            .catch(() => false);
        const heading = await this.page
            .getByRole('heading', { name: /two.factor|two-step|authentication code|confirm access|iki faktörlü|iki adımlı|erişimi onayla|Device Verification Code|Email/i })
            .first()
            .isVisible()
            .catch(() => false);
        const label = await this.page
            .getByText(/two.factor authentication|two-step verification|iki faktörlü doğrulama|iki adımlı doğrulama|Device Verification/i)
            .first()
            .isVisible()
            .catch(() => false);
        const otpVisible = await this.deviceCodeInput.isVisible().catch(() => false);
        const sudo = await this.isSudoUiVisible();
        const usernameVisible = await this.page.locator('input[name="login"]').isVisible().catch(() => false);
        return isVerifiedDeviceUrl || emailCodeText || heading || label || sudo || (otpVisible && !usernameVisible);
    }

    async isSudoUiVisible(): Promise<boolean> {
        if (this.isGone()) return false;
        const isVerifiedDeviceUrl = /verified-device|sessions\/verified/i.test(this.page.url());
        const emailCodeText = await this.page
            .getByText(/sent your authentication code via email|Device Verification Code/i)
            .first()
            .isVisible()
            .catch(() => false);
        const otp = await this.sudoEmailOtpInput.isVisible().catch(() => false);
        const deviceOtp = await this.deviceCodeInput.isVisible().catch(() => false);
        const send = await this.page.locator('#sudo-send-email').isVisible().catch(() => false);
        const sendCodeEmail = await this.isSendCodeViaEmailVisible();
        const verifyEmail = await this.page
            .getByRole('button', { name: /verify via e-?mail|verify/i })
            .isVisible()
            .catch(() => false);
        return isVerifiedDeviceUrl || emailCodeText || otp || deviceOtp || send || sendCodeEmail || verifyEmail;
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
        const isVerifiedDeviceUrl = /verified-device|sessions\/verified/i.test(this.page.url());

        if (emailOption || sudoOtp || isVerifiedDeviceUrl) {
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
            const hasTotp = this.hasGithubTotpConfigured();
            return {
                hasTwoFactor: true,
                method: 'totp',
                automatable: hasTotp,
                message: hasTotp
                    ? 'Hesap TOTP (Authenticator) ile korunuyor; GITHUB_TEST_TOTP_SECRET ile canlı kod otomatik üretilecek.'
                    : 'Hesap TOTP (Authenticator) ile korunuyor ancak .env içerisinde GITHUB_TEST_TOTP_SECRET tanımlı değil.',
            };
        }

        const otpVisible = await this.loginOtpInput().isVisible().catch(() => false);
        if (otpVisible) {
            const hasTotp = this.hasGithubTotpConfigured();
            const hasMail = this.hasGithubMailConfigured();
            return {
                hasTwoFactor: true,
                method: hasTotp ? 'totp' : (hasMail ? 'email' : 'unknown'),
                automatable: hasTotp || hasMail,
                message: hasTotp
                    ? 'İki faktörlü doğrulama ekranı (TOTP) aktif; GITHUB_TEST_TOTP_SECRET ile otomatik tamamlanacak.'
                    : (hasMail ? 'İki faktörlü doğrulama ekranı (E-posta) aktif; GITHUB_MAIL_* ile tamamlanacak.' : 'OTP girişi gerekiyor ancak .env bilgisi eksik.'),
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
                '[github-2fa]   └─ Yapılması gerekenler: .env dosyasına GITHUB_TEST_TOTP_SECRET ekleyin veya GITHUB_MAIL_* kullanın.'
            );
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
            console.log('[github] 🚀 [GİRİŞ] Güvenli işlem OTP doğrulama kodu gönderildi.');
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

    async handlePasskeyOrTrustedDevicePrompts(): Promise<boolean> {
        if (this.isGone()) return true;

        const url = this.page.url();
        const isTrustedDevice = /sessions\/trusted-device|trusted-device/i.test(url);
        const hasPasskeyPrompt = await this.page.getByText(/Configure passwordless authentication|Add a passkey/i).first().isVisible().catch(() => false);

        if (isTrustedDevice || hasPasskeyPrompt) {
            console.log('⚡ [GITHUB PROMPT] "Configure passwordless authentication / Add a passkey" ekranı tespit edildi.');

            const askMeLaterBtn = this.page.locator('input[value="Ask me later"], input[value*="Ask me later"], button:has-text("Ask me later"), input[type="submit"][value*="Ask me later"]').first();
            const isAskVisible = await askMeLaterBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);

            if (isAskVisible) {
                console.log('👆 [TIKLAMA] "Ask me later" butonuna tıklanıyor...');
                await askMeLaterBtn.click({ force: true }).catch(() => {});
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                console.log('✅ [GITHUB PROMPT] "Ask me later" tıklaması başarıyla tamamlandı.');
                return true;
            }

            const dontAskBtn = this.page.locator('button:has-text("Don\'t ask again"), input[value*="Don\'t ask"], a:has-text("Don\'t ask again")').first();
            if (await dontAskBtn.isVisible().catch(() => false)) {
                console.log('👆 [TIKLAMA] "Don\'t ask again for this browser" butonuna tıklanıyor...');
                await dontAskBtn.click({ force: true }).catch(() => {});
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                return true;
            }
        }

        return false;
    }

    async completeTotpIfConfigured(): Promise<boolean> {
        const hasTotp = this.hasGithubTotpConfigured();
        if (!hasTotp) {
            console.log('[github-2fa] ⚠️ [UYARI] Çevre değişkenlerinde GITHUB_TEST_TOTP_SECRET eksik.');
            return false;
        }

        const code = this.generateTotpCode();
        if (!code) {
            console.error('[github-2fa] ❌ [HATA] Canlı TOTP kodu üretilemedi!');
            return false;
        }

        console.log(`[github-2fa] 🔑 [TOTP] Canlı 6 haneli TOTP doğrulama kodu otomatik üretildi: "${code}"`);
        const otpField = await this.activeOtpInput();
        try {
            await otpField.waitFor({ state: 'visible', timeout: 10_000 });
        } catch {
            console.log('[github-2fa] ⚠️ [UYARI] TOTP giriş kutusu ekranda görünür olmadı.');
            return false;
        }

        await this.enterVerificationCode(code);
        console.log(`[github-2fa] ✍️ [TOTP] TOTP kodu ("${code}") giriş kutusuna yazıldı.`);

        // GitHub 6 basamak yazıldığında formu JS ile otomatik gönderir.
        // Çift submit veya ekstra Enter basışı GitHub oturumunu yenileme (refresh) döngüsüne soktuğu için bekleme yapılır.
        await this.safePause(500);

        if (this.isGone()) {
            console.log('[github-2fa] 🎉 [BAŞARILI] TOTP doğrulaması tamamlandı ve pencere kapandı.');
            return true;
        }

        // Anında URL değişimini ve Passkey / Trusted Device "Ask me later" ekranını kontrol et
        for (let i = 0; i < 20; i++) {
            if (this.isGone()) return true;
            await this.handlePasskeyOrTrustedDevicePrompts().catch(() => {});
            const url = this.page.url();
            if (!/two-factor|sessions\/verify|sessions\/trusted-device/i.test(url)) {
                console.log(`[github-2fa] 🎉 [BAŞARILI] TOTP doğrulaması tamamlandı ve sayfa yönlendi (${url}).`);
                return true;
            }
            await this.safePause(100);
        }

        return true;
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

        console.log('[github] ⚡ [ANLIK HIZ] E-posta sunucusundan (IMAP) 6 veya 8 haneli OTP kodu aranıyor...');
        const code = await pollGithubEmailOtp({
            maxWaitMs: 60_000,
            pollMs: 800,
            minReceivedAt,
            excludeCodes: this.usedOtpCodes,
        });
        this.usedOtpCodes.push(code);
        console.log(`[github] 🔑 [OTURUM] E-posta ile gelen doğrulama kodu okundu: "${code}" (Kod Uzunluğu: ${code.length} karakter)`);

        await this.enterVerificationCode(code);
        const filled = await otpField.inputValue().catch(() => '') || code;
        console.log(`[github] 🔍 [KONTROL] Okunan OTP kodu ("${code}") giriş kutusuna başarıyla yazıldı. (Giriş Değeri: "${filled}")`);

        await this.submitSudoEmailOtp();
        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] OTP doğrulama kodu onaylandı ve pencere kapandı.');
            return true;
        }

        for (let i = 0; i < 15; i++) {
            if (this.isGone()) return true;
            const url = this.page.url();
            if (!/verified-device|sessions\/verify/i.test(url)) {
                console.log(`[github] 🎉 [BAŞARILI] OTP doğrulaması tamamlandı ve sayfa yönlendi (${url}).`);
                return true;
            }
            await this.safePause(200);
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

        await this.safePause(50);
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

        // A) Eğer TOTP (Authenticator) metodu kullanılıyorsa
        if (assessment.method === 'totp' || (await this.isTotpTwoFactorVisible())) {
            const totpOk = await this.completeTotpIfConfigured();
            if (totpOk || this.isGone()) {
                console.log('[github-2fa] 🎉 [BAŞARILI] TOTP 2FA doğrulaması otomatik olarak tamamlandı.');
                return true;
            }
        }

        // B) Eğer E-posta metodu kullanılıyorsa
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
                console.error('[github-2fa] ❌ [HATA] 2FA tamamlanamadı.');
                this.logTwoFactorBlocked({
                    ...assessment,
                    automatable: false,
                    message: '2FA doğrulama kodu onaylanamadı. GITHUB_TEST_TOTP_SECRET veya GITHUB_MAIL_* bilgilerini kontrol edin.',
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

        console.log('[github-2fa] 🎉 [BAŞARILI] 2FA doğrulaması başarıyla tamamlandı. Akış devam ediyor.');
        return true;
    }
}
