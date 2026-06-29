import { Page, Locator } from '@playwright/test';
import { pollGithubEmailOtp } from '../support/github-email-otp';

/** GitHub 2FA ekranı değerlendirmesi (login veya sudo). */
export type Github2FaAssessment = {
    hasTwoFactor: boolean;
    method: 'none' | 'email' | 'sudo_email' | 'totp' | 'passkey' | 'sms' | 'unknown';
    automatable: boolean;
    message: string;
};

export class GithubLoginPage {
    readonly page: Page;
    readonly usernameInput: Locator;
    readonly passwordInput: Locator;
    readonly signInButton: Locator;
    readonly deviceCodeInput: Locator;
    readonly sudoEmailOtpInput: Locator;
    readonly authorizeButton: Locator;
    readonly installAuthorizeButton: Locator;

    private readonly usedOtpCodes: string[] = [];

    /** OAuth popup kapanmışsa (başarılı redirect) sayfa işlemleri yapılmaz. */
    private isGone(): boolean {
        return this.page.isClosed();
    }

    private async safePause(ms: number): Promise<void> {
        if (this.isGone()) return;
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    constructor(page: Page) {
        this.page = page;

        this.usernameInput = page.locator('input[name="login"]');
        this.passwordInput = page.locator('input[name="password"]');
        this.signInButton = page.locator('input[name="commit"]');

        this.sudoEmailOtpInput = page.locator('#sudo_email_otp, input[name="sudo_email_otp"]');
        this.deviceCodeInput = this.sudoEmailOtpInput
            .or(page.locator('#otp, input[name="otp"], input[name="verification_key"], input[autocomplete="one-time-code"]'))
            .first();

        this.authorizeButton = page.locator('button[name="authorize"]');

        this.installAuthorizeButton = page
            .getByRole('button', { name: /Install\s*(?:&|and)?\s*Authorize|Yükle\s*(?:ve|&)?\s*Yetkilendir|Kur\s*(?:ve|&)?\s*Yetkilendir/i })
            .or(page.locator('button[type="submit"]').filter({ hasText: /Install|Yükle|Kur/i }).filter({ hasText: /Authorize|Yetkilendir/i }))
            .or(
                page.locator('button').filter({
                    has: page.locator('span.Button-label', { hasText: /\b(Install|Yükle|Kur)\b.*\b(Authorize|Yetkilendir)\b/i }),
                })
            )
            .or(page.locator('button.btn-primary').filter({ hasText: /Install|Yükle|Kur/i }).filter({ hasText: /Authorize|Yetkilendir/i }));
    }

    async login(username: string, password: string) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.signInButton.click();
    }

    private hasGithubMailConfigured(): boolean {
        return Boolean(process.env.GITHUB_MAIL_USER?.trim()) && Boolean(process.env.GITHUB_MAIL_PASSWORD?.trim());
    }

    private loginOtpInput(): Locator {
        return this.page.locator('#otp, input[name="otp"]').first();
    }

    /** Aktif OTP kutusu: sudo (8 hane) veya giriş 2FA (6 hane). */
    private async activeOtpInput(): Promise<Locator> {
        if (await this.sudoEmailOtpInput.isVisible().catch(() => false)) {
            return this.sudoEmailOtpInput;
        }
        const loginOtp = this.loginOtpInput();
        if (await loginOtp.isVisible().catch(() => false)) {
            return loginOtp;
        }
        return this.deviceCodeInput;
    }

    /** GitHub: <span class="Button-label">Send a code via email</span> */
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

    private async isEmailTwoFactorOptionVisible(): Promise<boolean> {
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
        
        // Device verification automatically sends an email, without requiring a button click
        return this.page
            .getByText(/device verification|we sent a (?:verification )?code to|sent an email with a|cihaz doğrulaması/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    private async isPasskeyTwoFactorVisible(): Promise<boolean> {
        return this.page
            .getByText(/passkey|security key|use your passkey|sign in with a passkey|use a passkey/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    private async isTotpTwoFactorVisible(): Promise<boolean> {
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

    private async isSmsTwoFactorVisible(): Promise<boolean> {
        return this.page
            .getByText(/text message|sms code|sent to your phone|phone number/i)
            .first()
            .isVisible()
            .catch(() => false);
    }

    private async isTwoFactorScreenVisible(): Promise<boolean> {
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
        return heading || label || sudo || (otpVisible && !(await this.usernameInput.isVisible().catch(() => false)));
    }

    /**
     * Giriş/OAuth sonrası 2FA ekranını sınıflandırır.
     * E-posta (sudo veya login) + GITHUB_MAIL_* ile otomatik geçilebilir; passkey/TOTP-only/SMS ile geçilemez.
     */
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

    private logTwoFactorBlocked(assessment: Github2FaAssessment): void {
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

    /** Giriş 2FA ekranında "More options" → e-posta yolunu açmayı dener. */
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

    /**
     * Login sonrası veya açık OAuth penceresinde 2FA varsa işler.
     * @param preLoginTime Device verification gibi durumlarda, email loginden hemen sonra yollanır, bu yüzden login butonuna basılmadan önceki anı vermek mailleri kaçırmamayı sağlar.
     * @returns true = 2FA yok veya başarıyla geçildi; false = otomasyonla geçilemedi
     */
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

    /** Kullanıcı/şifre girer; ardından 2FA varsa değerlendirir ve mümkünse e-posta ile geçer. */
    async loginAndHandleTwoFactor(username: string, password: string): Promise<boolean> {
        const preLoginTime = new Date();
        await this.login(username, password);
        return this.handleTwoFactorAuthentication(preLoginTime);
    }

    /** Giriş formu kaybolana veya popup kapanana kadar bekler. */
    async waitForLoginScreenCleared(timeoutMs = 45_000): Promise<boolean> {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (this.isGone()) {
                return true;
            }
            const onLoginUrl = /\/login\b/i.test(this.page.url());
            const loginVisible = await this.usernameInput.isVisible().catch(() => false);
            if (!loginVisible && !onLoginUrl) {
                return true;
            }
            await this.safePause(400);
        }
        if (this.isGone()) {
            return true;
        }
        const stillLogin = await this.usernameInput.isVisible().catch(() => false);
        return !stillLogin;
    }

    async tryClickSendCodeViaEmail(): Promise<boolean> {
        // Eğer zaten mail gönderildiğini belirten cihaz doğrulama yazısı varsa boşuna buton beklemeyelim.
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

    private sudoOtpSubmitButton(): Locator {
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

    async isSudoAuthFailedVisible(): Promise<boolean> {
        if (this.isGone()) return false;
        return this.page.getByText(/authentication failed/i).isVisible().catch(() => false);
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

    /** Install sonrası sudo ekranı yüklenene kadar bekler (ilk poll’da yoktu → IMAP atlama sorunu). */
    private async waitForPossibleSudoPrompt(timeoutMs = 45_000): Promise<boolean> {
        if (this.isGone()) {
            return true;
        }
        console.log(`[github] ⏳ [BEKLEME] Güvenlik teyidi (Sudo / Confirm access) penceresi bekleniyor... (Süre sınırı: ${Math.round(timeoutMs / 1000)}s)`);

        await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

        const sudoHeading = this.page.getByRole('heading', { name: /confirm access|erişimi onayla/i });
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (this.isGone()) {
                return true;
            }
            if (await this.isSudoUiVisible()) {
                return true;
            }
            if (await sudoHeading.isVisible().catch(() => false)) {
                await this.safePause(500);
                continue;
            }
            await this.safePause(450);
        }

        return this.isSudoUiVisible().catch(() => false);
    }

    async waitForSudoChallengeResolved(timeoutMs = 90_000): Promise<boolean> {
        if (this.isGone()) {
            return true;
        }
        const deadline = Date.now() + timeoutMs;

        while (Date.now() < deadline) {
            if (this.isGone()) {
                return true;
            }
            if (await this.isSudoAuthFailedVisible()) {
                return false;
            }
            if (!(await this.isSudoUiVisible())) {
                return true;
            }
            await this.safePause(300);
        }
        return this.isGone() ? true : false;
    }

    async completeEmailOtpIfConfigured(minReceivedAt?: Date): Promise<boolean> {
        const hasMail =
            Boolean(process.env.GITHUB_MAIL_USER?.trim()) && Boolean(process.env.GITHUB_MAIL_PASSWORD?.trim());
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

        if (await this.isSudoAuthFailedVisible()) {
            console.log('[github] ❌ [HATA] Güvenli işlem (Sudo) doğrulaması başarısız oldu! (Girilen kod GitHub tarafından reddedildi)');
            return false;
        }
        console.log('[github] 🎉 [BAŞARILI] E-posta OTP doğrulama kodu başarıyla onaylandı.');
        return true;
    }

    /**
     * @param waitForSudoMs Install tıklandıktan sonra sudo gecikmeli gelir; >0 ise bu kadar ms bekle.
     * Giriş sonrası çağrıda 0 bırak (hemen dön, gereksiz 45s bekleme olmasın).
     */
    async handlePostLoginEmailChallenge(opts?: { waitForSudoMs?: number }): Promise<boolean> {
        const waitMs = opts?.waitForSudoMs ?? 0;

        let sawSudo = await this.isSudoUiVisible();
        if (!sawSudo && waitMs > 0) {
            sawSudo = await this.waitForPossibleSudoPrompt(waitMs);
        }
        if (!sawSudo) {
            if (waitMs > 0) {
                console.log(
                    `[github] 🔍 [KONTROL] Sudo güvenlik teyidi ekranı açılmadı, doğrulama adımları atlanıyor. (Beklenen Süre: ${waitMs}ms)`
                );
            }
            return true;
        }

        const sentAt = new Date();
        const clickedVerify = await this.tryClickSendCodeViaEmail();
        if (!clickedVerify) {
            console.log('[github] ℹ️ [BİLGİ] "Verify via email" butonuna tıklanamadı, kod giriş kutusu zaten hazır olabilir.');
        }

        let ok = await this.completeEmailOtpIfConfigured(sentAt);
        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] Sudo şifre/OTP doğrulaması sonrasında pencere başarıyla kapatıldı.');
            return true;
        }

        for (let attempt = 0; !ok && !this.isGone() && attempt < 2 && (await this.isSudoAuthFailedVisible()); attempt++) {
            console.log(`[github] 🔄 [TEKRAR] Doğrulama kodu geçersiz oldu, yeni bir kod isteniyor... (Deneme: ${attempt + 2})`);
            await this.sudoEmailOtpInput.fill('').catch(() => {});
            await this.page.locator('#sudo-send-email').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            const retryAt = new Date();
            await this.tryClickSendCodeViaEmail();
            await this.sudoEmailOtpInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
            ok = await this.completeEmailOtpIfConfigured(retryAt);
        }

        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] Sudo doğrulama tamam (popup kapandı).');
            return true;
        }

        if (!(await this.waitForSudoChallengeResolved()) || (await this.isSudoAuthFailedVisible())) {
            console.log('[github] ❌ [HATA] Sudo/Güvenlik doğrulama süreci başarısız oldu.');
            return false;
        }
        console.log('[github] 🎉 [BAŞARILI] Sudo/Güvenlik doğrulaması başarıyla tamamlandı.');
        return true;
    }

    /**
     * GitHub App permissions: önce Install (sudo tetikler) → e-posta sudo → gerekirse tekrar Install.
     */
    async completePermissionsInstallFlow(): Promise<boolean> {
        const url = this.page.url();
        if (/settings\/installations\/\d+$/i.test(url)) {
            console.log(`[github] Uygulama zaten kurulu görünüyor (URL: ${url}).`);
            const match = url.match(/settings\/installations\/(\d+)$/i);
            if (match) {
                const instId = match[1];
                const apiBaseUrl = process.env.API_BASE_URL || 'https://staging.api.gitsec.io';
                const callbackUrl = `${apiBaseUrl}/api/installations/callback?installation_id=${instId}&setup_action=install`;
                console.log(`[github] Doğrudan Callback URL'ine yönlendiriliyor: ${callbackUrl}`);
                
                await this.page.goto(callbackUrl).catch(() => {});
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                await this.page.close().catch(() => {});
                return true;
            }
            
            const saveBtn = this.page.locator('button, input[type="submit"]').filter({ hasText: /Save|Kaydet/i }).or(
                this.page.locator('input[type="submit"][value*="Save"]').or(this.page.locator('input[type="submit"][value*="Kaydet"]'))
            ).first();
            await saveBtn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
            if (await saveBtn.isVisible().catch(() => false)) {
                console.log('[github] 👆 [TIKLAMA] GitHub settings sayfasında "Save" butonuna tıklanıyor...');
                await saveBtn.click().catch(() => {});
                await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
                return true;
            }
            console.log(`[github] Save butonu bulunamadı. Sayfa başlığı: "${await this.page.title().catch(() => '')}", URL: "${this.page.url()}"`);
            await this.page.close().catch(() => {});
            return true;
        }

        const clicked = await this.clickInstallAndAuthorize();
        if (!clicked && (/settings\/installations\/\d+$/i.test(this.page.url()) || this.page.isClosed())) {
            console.log(`[github] "Install & Authorize" butonu bulunamadı ve mevcut URL veya kapalı durum kurulumun bittiğini gösteriyor.`);
            if (!this.page.isClosed()) {
                await this.page.close().catch(() => {});
            }
            return true;
        }

        if (this.page.isClosed()) {
            return true;
        }

        await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await this.safePause(500);

        if (/settings\/installations\/\d+$/i.test(this.page.url()) || this.page.isClosed()) {
            if (!this.page.isClosed()) {
                await this.page.close().catch(() => {});
            }
            return true;
        }

        const sudoOk = await this.handlePostLoginEmailChallenge({
            waitForSudoMs: Number(process.env.GITHUB_SUDO_WAIT_MS || '60000') || 60_000,
        });
        if (!sudoOk) {
            return false;
        }

        if (this.page.isClosed()) {
            return true;
        }

        if (await this.installAuthorizeButton.first().isVisible().catch(() => false)) {
            console.log('[github] 👆 [TIKLAMA] Sudo doğrulaması sonrasında "Install & Authorize" butonuna tekrar tıklanıyor.');
            await this.clickInstallAndAuthorize();
        }

        return true;
    }

    async enterVerificationCode(code: string) {
        const otpField = await this.activeOtpInput();
        await otpField.click({ timeout: 5000 }).catch(() => {});
        await otpField.fill('');
        await otpField.pressSequentially(code, { delay: 40 });
    }

    async clickInstallAndAuthorize(): Promise<boolean> {
        try {
            const btn = this.installAuthorizeButton.first();
            await btn.waitFor({ state: 'attached', timeout: 45_000 });

            for (let pass = 0; pass < 10; pass++) {
                await this.page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                    document.querySelectorAll('main, [role="main"], .application-main').forEach((el) => {
                        if (el instanceof HTMLElement) {
                            el.scrollTop = el.scrollHeight;
                        }
                    });
                });
                await this.page.keyboard.press('End').catch(() => {});
                await this.safePause(300);
                if (await btn.isVisible().catch(() => false)) {
                    break;
                }
            }

            await btn.scrollIntoViewIfNeeded();
            await this.safePause(300);
            try {
                await btn.click({ timeout: 15_000 });
            } catch {
                await btn.click({ force: true });
            }
            console.log('[github] 👆 [TIKLAMA] GitHub "Install & Authorize" / "Yükle ve Yetkilendir" butonuna tıklandı.');
            return true;
        } catch {
            console.log(`[github] ⚠️ [UYARI] Sayfada "Install & Authorize" butonu bulunamadı. (Mevcut URL: ${this.page.url()})`);
            return false;
        }
    }

    async authorizeApp() {
        try {
            await this.authorizeButton.waitFor({ state: 'visible', timeout: 5000 });
            await this.authorizeButton.scrollIntoViewIfNeeded();
            await this.authorizeButton.click();
        } catch {
            console.log('[github] 🔍 [KONTROL] Authorize (Yetkilendir) butonu çıkmadı.');
        }
    }
}
