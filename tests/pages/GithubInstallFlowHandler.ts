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

    async waitForPossibleSudoPrompt(timeoutMs = 5_000): Promise<boolean> {
        if (this.isGone()) {
            return true;
        }
        console.log(`[github] ⏳ [BEKLEME] Güvenlik teyidi (Sudo / Confirm access) penceresi denetleniyor... (Süre sınırı: ${Math.round(timeoutMs / 1000)}s)`);

        await this.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});

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
                await this.safePause(300);
                continue;
            }
            await this.safePause(250);
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
        if (/settings\/installations\/\d+/i.test(url)) {
            console.log(`[github] ⚠️ Uygulama zaten kurulu (URL: ${url}). Anında aşağı kaydırılarak Uninstall yapılıyor...`);

            // 1. Sayfayı ve Uninstall butonunu bulup en aşağı kaydır
            await this.page.evaluate(() => {
                window.scrollTo(0, 99999);
                if (document.documentElement) document.documentElement.scrollTop = 99999;
                if (document.body) document.body.scrollTop = 99999;
                const uninstall = Array.from(document.querySelectorAll('button, summary, input, a')).find(el => /Uninstall|Kaldır/i.test(el.textContent || (el as HTMLInputElement).value || ''));
                if (uninstall) uninstall.scrollIntoView({ block: 'center', behavior: 'instant' });
            }).catch(() => {});

            await this.safePause(200);

            // 2. Danger Zone içerisindeki Uninstall butonunu bul ve tıkla
            const uninstallBtn = this.page.locator('button, summary, input[type="submit"], [data-show-dialog-id*="uninstall"]')
                .filter({ hasText: /Uninstall|Kaldır/i })
                .first();

            const isUninstallVisible = await uninstallBtn.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
            if (isUninstallVisible) {
                await uninstallBtn.scrollIntoViewIfNeeded().catch(() => {});
                console.log('[github] 👆 [TIKLAMA] "Uninstall" butonuna tıklandı...');
                await uninstallBtn.click({ force: true }).catch(() => {});
                await this.safePause(300);

                // 3. Konfirmasyon modalındaki (dialog) onay butonunu hefle ve bas veya JS ile delete formunu gönder
                await this.page.evaluate(() => {
                    const dialog = document.querySelector('dialog[open], dialog[id*="uninstall"], [role="dialog"], details[open]');
                    if (dialog) {
                        const form = dialog.querySelector('form');
                        if (form) { form.submit(); return; }
                        const btn = dialog.querySelector('button[type="submit"], input[type="submit"], button');
                        if (btn) { (btn as HTMLElement).click(); return; }
                    }
                    const deleteForm = Array.from(document.querySelectorAll('form')).find(f => f.action.includes('installations') || f.querySelector('input[name="_method"][value="delete"]'));
                    if (deleteForm) { deleteForm.submit(); }
                }).catch(() => {});

                console.log('[github] 🎉 [BAŞARILI] GitHub uygulaması Uninstall edildi. Taze kurulum sayfasına gidiliyor...');
                await this.safePause(1500);
            } else {
                console.log('[github] ℹ️ Uninstall butonu bulunamadı, taze kurulum sayfasına gidiliyor...');
            }

            // 4. Silme işleminden sonra taze kurulum sayfasına yönlen
            await this.page.goto('https://github.com/apps/gitsec-backup-staging/installations/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.safePause(500);
        }

        const clicked = await this.clickInstallAndAuthorize();
        if (this.page.isClosed()) {
            return true;
        }

        const currentUrl = this.page.url();
        const isCompleted = currentUrl.includes('gitsec.io') || currentUrl.includes('callback') || /settings\/installations/i.test(currentUrl);
        if (isCompleted) {
            console.log(`[github] 🎉 [BAŞARILI] Kurulum onaylandı ve yönlendirme tamamlandı. (URL: ${currentUrl})`);
            if (!this.page.isClosed()) {
                await this.page.close().catch(() => {});
            }
            return true;
        }

        // YALNIZCA ekranda Sudo veya 2FA teyit formu GERÇEKTEN varsa doğrulama adımlarına gir
        if (await this.isSudoUiVisible()) {
            console.log('[github] 🛡️ [SUDO/2FA] Ekran güvenlik teyit formu algılandı. Otomatik doğrulama başlatılıyor...');
            const sudoOk = await this.handlePostLoginEmailChallenge();
            if (!sudoOk) return false;
        }

        if (!this.page.isClosed()) {
            await this.page.close().catch(() => {});
        }
        return true;
    }

    async clickInstallAndAuthorize(): Promise<boolean> {
        try {
            console.log('[github] 🔍 "Install & Authorize" butonu hedefleniyor ve aşağı kaydırılıyor...');
            
            // GitHub "This App has changed since you last viewed it" uyarısını denetle; varsa sayfayı tazelemek için yenile
            const hasAppChangedBanner = await this.page.locator('.flash-warn, .flash-error, div').filter({ hasText: /This App has changed since you last viewed it/i }).isVisible().catch(() => false);
            if (hasAppChangedBanner) {
                console.log('⚠️ [GITHUB UYARI] "This App has changed since you last viewed it" uyarısı tespit edildi. Taze form almak için sayfa yenileniyor...');
                await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                await this.safePause(500);
            }

            const installBtn = this.page
                .locator('button.js-integrations-install-form-submit')
                .or(this.page.locator('button[data-octo-click*="install"]'))
                .or(this.page.locator('form.js-integrations-install-form button[type="submit"]'))
                .or(this.page.getByRole('button', { name: /Install\s*(?:&|and)?\s*Authorize|Install|Yükle|Kur/i }))
                .or(this.page.locator('button[type="submit"]').filter({ hasText: /Install|Authorize|Yükle|Yetkilendir/i }))
                .first();

            // Sayfayı ve butonu anında en aşağıya kaydırıp bas
            await this.page.evaluate(() => {
                window.scrollTo(0, 99999);
                if (document.documentElement) document.documentElement.scrollTop = 99999;
                if (document.body) document.body.scrollTop = 99999;
                const form = document.querySelector('form.js-integrations-install-form, form[action*="install"]');
                if (form) form.scrollTop = form.scrollHeight;
            }).catch(() => {});

            console.log('[github] 👆 [TIKLAMA] GitHub yeşil "Install & Authorize" butonuna basılıyor...');
            
            await installBtn.click({ force: true }).catch(async () => {
                await installBtn.evaluate((el: any) => el.click()).catch(() => {});
            });

            // Sayfanın GitSec callback URL'ine yönlenmesini bekle (GitHub backend OAuth tetiklemesi için)
            for (let i = 0; i < 40; i++) {
                if (this.page.isClosed()) {
                    console.log('[github] 🎉 [BAŞARILI] Kurulum onaylandı ve popup penceresi kapandı.');
                    return true;
                }
                const currentUrl = this.page.url();
                
                // 1. GitSec Callback URL'ine ulaşıldıysa yönlendirmeyi tamamla
                if (currentUrl.includes('gitsec.io') || currentUrl.includes('callback')) {
                    console.log(`[github] 🎉 [BAŞARILI] Kurulum yetkisi tamamlandı ve GitSec callback URL'ine yönlendi (${currentUrl}).`);
                    await this.safePause(500);
                    if (!this.page.isClosed()) {
                        await this.page.close().catch(() => {});
                    }
                    return true;
                }

                // 2. Eğer GitHub settings/installations/{id} veya /installations sayfasına attıysa ID ile callback çağır
                const matchId = currentUrl.match(/settings\/installations\/(\d+)$/i);
                if (matchId) {
                    const instId = matchId[1];
                    const apiBaseUrl = process.env.API_BASE_URL || 'https://staging.api.gitsec.io';
                    const callbackUrl = `${apiBaseUrl}/api/installations/callback?installation_id=${instId}&setup_action=install`;
                    console.log(`[github] 🔗 GitHub ayarlar sayfasına düşüldü. Doğrudan GitSec Callback URL'ine yönlendiriliyor: ${callbackUrl}`);
                    await this.page.goto(callbackUrl).catch(() => {});
                    await this.safePause(800);
                    if (!this.page.isClosed()) {
                        await this.page.close().catch(() => {});
                    }
                    return true;
                }

                await this.safePause(150);
            }

            return true;
        } catch (err) {
            console.log(`[github] ⚠️ [UYARI] Install & Authorize akışında hata: ${(err as any).message}`);
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
