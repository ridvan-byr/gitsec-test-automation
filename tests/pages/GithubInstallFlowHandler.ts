import { Page, Locator } from '@playwright/test';
import { Github2FaHandler } from './Github2FaHandler';

export class GithubInstallFlowHandler {
    readonly page: Page;
    readonly installAuthorizeButton: Locator;
    readonly authorizeButton: Locator;
    readonly twoFactorHandler: Github2FaHandler;

    constructor(page: Page, twoFactorHandler: Github2FaHandler) {
        this.page = page;
        this.twoFactorHandler = twoFactorHandler;
        
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

    isGone(): boolean {
        return this.page.isClosed();
    }

    async safePause(ms: number): Promise<void> {
        if (this.isGone()) return;
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async isSudoAuthFailedVisible(): Promise<boolean> {
        if (this.isGone()) return false;
        return this.page.getByText(/authentication failed/i).isVisible().catch(() => false);
    }

    async isSudoUiVisible(): Promise<boolean> {
        return this.twoFactorHandler.isSudoUiVisible();
    }

    async waitForPossibleSudoPrompt(timeoutMs = 45_000): Promise<boolean> {
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
        const clickedVerify = await this.twoFactorHandler.tryClickSendCodeViaEmail();
        if (!clickedVerify) {
            console.log('[github] ℹ️ [BİLGİ] "Verify via email" butonuna tıklanamadı, kod giriş kutusu zaten hazır olabilir.');
        }

        let ok = await this.twoFactorHandler.completeEmailOtpIfConfigured(sentAt);
        if (this.isGone()) {
            console.log('[github] 🎉 [BAŞARILI] Sudo şifre/OTP doğrulaması sonrasında pencere başarıyla kapatıldı.');
            return true;
        }

        for (let attempt = 0; !ok && !this.isGone() && attempt < 2 && (await this.isSudoAuthFailedVisible()); attempt++) {
            console.log(`[github] 🔄 [TEKRAR] Doğrulama kodu geçersiz oldu, yeni bir kod isteniyor... (Deneme: ${attempt + 2})`);
            await this.twoFactorHandler.sudoEmailOtpInput.fill('').catch(() => {});
            await this.page.locator('#sudo-send-email').waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {});
            const retryAt = new Date();
            await this.twoFactorHandler.tryClickSendCodeViaEmail();
            await this.twoFactorHandler.sudoEmailOtpInput.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
            ok = await this.twoFactorHandler.completeEmailOtpIfConfigured(retryAt);
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
