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

    async completePermissionsInstallFlow(initialPopupUrl?: string): Promise<boolean> {
        const url = this.page.url();
        if (/settings\/installations\/\d+/i.test(url)) {
            console.log(`[github] ⚠️ Uygulama zaten kurulu (URL: ${url}). Anında aşağı ve sağa kaydırılarak Uninstall yapılıyor...`);

            // Target URL'i dinamik olarak belirle (OAuth return_to veya gitsec-restore-staging / backup-staging tespiti)
            let targetReinstallUrl = '';
            const searchUrl = initialPopupUrl || url;
            if (searchUrl.includes('return_to=')) {
                const match = searchUrl.match(/return_to=([^&]+)/);
                if (match && match[1]) {
                    const decoded = decodeURIComponent(match[1]);
                    targetReinstallUrl = decoded.startsWith('http') ? decoded : `https://github.com${decoded}`;
                }
            }
            if (!targetReinstallUrl) {
                if (/restore/i.test(searchUrl)) {
                    targetReinstallUrl = 'https://github.com/apps/gitsec-restore-staging/installations/new';
                } else {
                    targetReinstallUrl = 'https://github.com/apps/gitsec-backup-staging/installations/new';
                }
            }

            // 0. Native browser confirm popup'ları için otomatik ACCEPT dinleyicisi ekle
            this.page.once('dialog', async dialog => {
                console.log(`[github-dialog] 🔔 Native browser confirm algılandı ("${dialog.message()}"). Otomatik ACCEPT ediliyor...`);
                await dialog.accept().catch(() => {});
            });

            await this.page.waitForLoadState('domcontentloaded').catch(() => {});

            // 1. Hem DİKEY hem YATAY hem de TÜM KAPSAYICI ELEMENTLERİ en aşağı kaydırıp görünür kıl
            await this.page.evaluate(() => {
                window.scrollTo(0, document.body.scrollHeight || 99999);
                if (document.documentElement) document.documentElement.scrollTop = 99999;
                if (document.body) document.body.scrollTop = 99999;
                const divs = document.querySelectorAll('div, main, section, form, details');
                divs.forEach((el: any) => {
                    if (el.scrollHeight > el.clientHeight) {
                        el.scrollTop = el.scrollHeight;
                    }
                    if (el.tagName && el.tagName.toLowerCase() === 'details') {
                        el.open = true;
                    }
                });
            }).catch(() => {});

            // 2. Tam HTML eşleşmesi: input[type="submit"][value="Uninstall"] veya button
            const uninstallInput = this.page.locator('input[type="submit"][value="Uninstall"], input.btn-danger[value="Uninstall"], input[data-confirm*="uninstall"], button.btn-danger, button[data-show-dialog-id*="uninstall"]')
                .filter({ hasText: /Uninstall|Kaldır/i })
                .or(this.page.locator('input[type="submit"][value="Uninstall"]'))
                .or(this.page.locator('button:has-text("Uninstall")'))
                .first();

            const isInputVisible = await uninstallInput.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);

            if (isInputVisible) {
                await uninstallInput.scrollIntoViewIfNeeded().catch(() => {});
                console.log('[github] 👆 [TIKLAMA] Uninstall butonuna tıklandı...');
                await uninstallInput.click({ force: true }).catch(async () => {
                    await uninstallInput.evaluate((el: any) => el.click()).catch(() => {});
                });
                await this.safePause(1000);
            }

            // 3. Her durumda garanti olması için JS ile direct form.submit() at
            console.log('[github] 💥 [KARSILIKSIZ SILME] Silme formu doğrudan form.submit() ile gönderiliyor...');
            await this.page.evaluate(() => {
                const input = document.querySelector('input[value="Uninstall"], input.btn-danger[value="Uninstall"], input[data-confirm*="uninstall"]');
                if (input) {
                    const form = input.closest('form');
                    if (form) {
                        form.submit();
                        return;
                    }
                }
                const delForm = Array.from(document.querySelectorAll('form')).find(f => {
                    const action = f.getAttribute('action') || (f as HTMLFormElement).action || '';
                    const methodInput = f.querySelector('input[name="_method"]');
                    const methodVal = methodInput ? (methodInput.getAttribute('value') || '').toLowerCase() : '';
                    return action.includes('/settings/installations/') || methodVal === 'delete';
                });
                if (delForm) {
                    delForm.submit();
                }
            }).catch(() => {});

            await this.safePause(2500);
            console.log(`[github] 🎉 [BAŞARILI] GitHub uygulaması Uninstall adımı tamamlandı. Taze kurulum sayfasına gidiliyor: ${targetReinstallUrl}`);

            // 4. Silme işleminden sonra Orijinal OAuth State parametreli taze kurulum sayfasına yönlen
            await this.page.goto(targetReinstallUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
            await this.safePause(600);
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

                // 2. Eğer GitHub settings/installations/{id} veya /installations sayfasına attıysa yetkilendirme tamamlanmıştır, popup'ı kapat
                const matchId = currentUrl.match(/settings\/installations\/(\d+)$/i);
                if (matchId) {
                    console.log(`[github] 🎉 [BAŞARILI] Kurulum tamamlandı. GitHub ayarlar sayfasına yönlendi (${currentUrl}). Popup kapatılıyor...`);
                    await this.safePause(500);
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
