import { Page, Locator } from '@playwright/test';
import { pollGithubEmailOtp } from '../tests/support/github-email-otp';

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
        await this.page.waitForTimeout(ms).catch(() => {});
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
            .getByRole('button', { name: /Install\s*(?:&|and)?\s*Authorize/i })
            .or(page.locator('button[type="submit"]').filter({ hasText: /Install/i }).filter({ hasText: /Authorize/i }))
            .or(
                page.locator('button').filter({
                    has: page.locator('span.Button-label', { hasText: /\bInstall\b.*\bAuthorize\b/i }),
                })
            )
            .or(page.locator('button.btn-primary').filter({ hasText: /Install/i }).filter({ hasText: /Authorize/i }));
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
                has: this.page.locator('span.Button-label', { hasText: /^Send a code via email$/i }),
            })
            .or(this.page.getByRole('button', { name: /^Send a code via email$/i }))
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
                name: /send (\w+ )?code via email|verify via e-?mail|verify via email|verify with e-?mail/i,
            })
            .first()
            .isVisible()
            .catch(() => false);
            
        if (hasEmailBtn) return true;
        
        // Device verification automatically sends an email, without requiring a button click
        return this.page
            .getByText(/device verification|we sent a (?:verification )?code to|sent an email with a/i)
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
            .getByRole('heading', { name: /two.factor|two-step|authentication code|confirm access/i })
            .first()
            .isVisible()
            .catch(() => false);
        const label = await this.page
            .getByText(/two.factor authentication|two-step verification/i)
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
        console.error('[github-2fa] --------------------------------------------------');
        console.error('[github-2fa] Girilen GitHub hesabında iki faktörlü doğrulama (2FA) tespit edildi.');
        console.error(`[github-2fa] Yöntem: ${assessment.method}`);
        console.error(`[github-2fa] ${assessment.message}`);
        if (!assessment.automatable) {
            console.error('[github-2fa] OTOMATİK TEST GEÇİLEMEZ: Bu 2FA türü Playwright ile tamamlanamaz.');
            console.error(
                '[github-2fa] Yapılması gerekenler: (1) Tarayıcıda elle giriş yapıp oturumu playwright/.auth/github.json olarak kaydedin,'
            );
            console.error(
                '[github-2fa] (2) Test hesabında 2FA\'yı kapatın veya yalnızca e-posta doğrulaması + .env GITHUB_MAIL_* kullanın,'
            );
            console.error('[github-2fa] (3) Passkey / yalnızca authenticator kullanan hesaplarla otomasyon çalışmaz.');
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
            console.log('[github-2fa] İki faktörlü doğrulama ekranı yok; devam ediliyor.');
            return true;
        }

        console.log(
            `[github-2fa] 2FA tespit edildi (yöntem=${assessment.method}, otomatik=${assessment.automatable ? 'evet' : 'hayır'}).`
        );
        console.log(`[github-2fa] ${assessment.message}`);

        if (!assessment.automatable) {
            this.logTwoFactorBlocked(assessment);
            return false;
        }

        await this.tryRevealEmailTwoFactorOption();
        const sentAt = preLoginTime || new Date();
        const clicked = await this.tryClickSendCodeViaEmail();
        if (!clicked) {
            console.log('[github-2fa] Verify via email tıklanamadı; OTP kutusu zaten açık olabilir.');
        }

        const otpOk = await this.completeEmailOtpIfConfigured(sentAt);
        if (this.isGone()) {
            console.log('[github-2fa] Doğrulama sonrası popup kapandı (başarılı).');
            return true;
        }

        if (!otpOk) {
            assessment = await this.assessTwoFactorChallenge();
            if (assessment.hasTwoFactor) {
                console.error('[github-2fa] E-posta kodu ile 2FA tamamlanamadı.');
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

        console.log('[github-2fa] İki faktörlü doğrulama e-posta ile tamamlandı; test devam edebilir.');
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
            console.log('[github] Doğrulama kodu e-postaya zaten gönderilmiş (Cihaz Doğrulaması). Buton aranmıyor.');
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
                console.log('[github] Send a code via email (Button-label) tıklandı.');
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                return true;
            }
        }

        const combinedBtn = this.page.locator('#sudo-send-email').or(
            this.page.getByRole('button', {
                name: /send (\w+ )?code via email|verify via e-?mail|verify via email|verify with e-?mail/i,
            })
        ).first();

        if (await tryClickVisible(combinedBtn, 4000)) {
            console.log('[github] Verify / Send code via email tıklandı.');
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
            .or(this.page.locator('button[type="submit"]').filter({ hasText: /^verify$/i }))
            .first();
    }

    async submitSudoEmailOtp(): Promise<void> {
        const submit = this.sudoOtpSubmitButton();
        if (await submit.isVisible().catch(() => false)) {
            await submit.scrollIntoViewIfNeeded().catch(() => {});
            await submit.click({ timeout: 10_000 }).catch(() => {});
            console.log('[github] Sudo OTP Verify gönderildi.');
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
        console.log(`[github] Sudo / Confirm access bekleniyor (${Math.round(timeoutMs / 1000)}s)...`);

        await this.page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
        await this.page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

        const sudoHeading = this.page.getByRole('heading', { name: /confirm access/i });
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
            console.log('[github] GITHUB_MAIL_* tanımlı değil; OTP IMAP atlanıyor.');
            return false;
        }

        const otpField = await this.activeOtpInput();
        try {
            await otpField.waitFor({ state: 'visible', timeout: 90_000 });
        } catch {
            console.log('[github] OTP alanı (sudo_email_otp / otp) görünmedi.');
            return false;
        }

        if (minReceivedAt) {
            console.log('[github] Postanın gelmesi için 6 sn bekleniyor...');
            await this.safePause(6000);
            if (this.isGone()) {
                console.log('[github] Bekleme sırasında popup kapandı (OAuth).');
                return true;
            }
        }

        console.log('[github] IMAP: 6 veya 8 haneli doğrulama kodu bekleniyor (en yeni GitHub doğrulama postası)...');
        const code = await pollGithubEmailOtp({
            maxWaitMs: 120_000,
            pollMs: 4000,
            minReceivedAt,
            excludeCodes: this.usedOtpCodes,
        });
        this.usedOtpCodes.push(code);
        console.log(`[imap-debug] IMAP → Playwright: kutuya yazılacak tam kod = "${code}" (${code.length} hane)`);

        await this.enterVerificationCode(code);
        const filled = await otpField.inputValue().catch(() => '');
        console.log(`[imap-debug] OTP alanındaki değer = "${filled}"`);

        await this.submitSudoEmailOtp();
        if (this.isGone()) {
            console.log('[github] OTP gönderildi; popup kapandı (sudo/OAuth başarılı).');
            return true;
        }

        await this.safePause(2500);
        if (this.isGone()) {
            console.log('[github] E-posta OTP kabul edildi; popup kapandı.');
            return true;
        }

        if (await this.isSudoAuthFailedVisible()) {
            console.log('[github] sudo Authentication failed — kod reddedildi.');
            return false;
        }
        console.log('[github] E-posta OTP kabul edildi.');
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
                    '[github] Sudo görünmedi — Verify/IMAP atlandı (gerekliyse GITHUB_SUDO_WAIT_MS ile süreyi artır).'
                );
            }
            return true;
        }

        const sentAt = new Date();
        const clickedVerify = await this.tryClickSendCodeViaEmail();
        if (!clickedVerify) {
            console.log('[github] Verify via email tıklanamadı; OTP kutusu doğrudan açılmış olabilir.');
        }

        let ok = await this.completeEmailOtpIfConfigured(sentAt);
        if (this.isGone()) {
            console.log('[github] Sudo/OTP sonrası popup kapandı (başarılı).');
            return true;
        }

        for (let attempt = 0; !ok && !this.isGone() && attempt < 2 && (await this.isSudoAuthFailedVisible()); attempt++) {
            console.log('[github] Yeni kod için Verify via email tekrar (deneme', attempt + 2, ')...');
            await this.sudoEmailOtpInput.fill('').catch(() => {});
            await this.page.locator('#sudo-send-email').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            const retryAt = new Date();
            await this.tryClickSendCodeViaEmail();
            await this.sudoEmailOtpInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
            ok = await this.completeEmailOtpIfConfigured(retryAt);
        }

        if (this.isGone()) {
            console.log('[github] Sudo doğrulama tamam (popup kapandı).');
            return true;
        }

        if (!(await this.waitForSudoChallengeResolved()) || (await this.isSudoAuthFailedVisible())) {
            console.log('[github] Sudo doğrulama BAŞARISIZ.');
            return false;
        }
        console.log('[github] Sudo doğrulama tamam.');
        return true;
    }

    /**
     * GitHub App permissions: önce Install (sudo tetikler) → e-posta sudo → gerekirse tekrar Install.
     */
    async completePermissionsInstallFlow(): Promise<boolean> {
        await this.clickInstallAndAuthorize();

        await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
        await this.safePause(500);

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
            console.log('[github] Sudo sonrası Install & Authorize tekrar tıklanıyor.');
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
                await this.page.waitForTimeout(300);
                if (await btn.isVisible().catch(() => false)) {
                    break;
                }
            }

            await btn.scrollIntoViewIfNeeded();
            await this.page.waitForTimeout(300);
            try {
                await btn.click({ timeout: 15_000 });
            } catch {
                await btn.click({ force: true });
            }
            console.log('[github] Install & Authorize tıklandı.');
            return true;
        } catch {
            console.log('[github] Install & Authorize bulunamadı, URL:', this.page.url());
            return false;
        }
    }

    async authorizeApp() {
        try {
            await this.authorizeButton.waitFor({ state: 'visible', timeout: 5000 });
            await this.authorizeButton.scrollIntoViewIfNeeded();
            await this.authorizeButton.click();
        } catch {
            console.log('Authorize butonu çıkmadı.');
        }
    }
}
