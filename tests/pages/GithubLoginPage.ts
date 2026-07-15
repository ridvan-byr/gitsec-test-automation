import { Page, Locator } from '@playwright/test';
import { Github2FaHandler, Github2FaAssessment } from './Github2FaHandler';
import { GithubInstallFlowHandler } from './GithubInstallFlowHandler';

export { Github2FaAssessment };

export class GithubLoginPage {
    readonly page: Page;
    readonly usernameInput: Locator;
    readonly passwordInput: Locator;
    readonly signInButton: Locator;
    readonly deviceCodeInput: Locator;
    readonly sudoEmailOtpInput: Locator;
    readonly authorizeButton: Locator;
    readonly installAuthorizeButton: Locator;

    private readonly twoFactorHandler: Github2FaHandler;
    private readonly installFlowHandler: GithubInstallFlowHandler;

    constructor(page: Page) {
        this.page = page;

        this.usernameInput = page.locator('input[name="login"]');
        this.passwordInput = page.locator('input[name="password"]');
        this.signInButton = page.locator('input[name="commit"]');

        this.twoFactorHandler = new Github2FaHandler(page);
        this.installFlowHandler = new GithubInstallFlowHandler(page, this.twoFactorHandler);

        // Keep field reference exposures identical for backward compatibility
        this.sudoEmailOtpInput = this.twoFactorHandler.sudoEmailOtpInput;
        this.deviceCodeInput = this.twoFactorHandler.deviceCodeInput;
        this.authorizeButton = this.installFlowHandler.authorizeButton;
        this.installAuthorizeButton = this.installFlowHandler.installAuthorizeButton;
    }

    private isGone(): boolean {
        return this.page.isClosed();
    }

    private async safePause(ms: number): Promise<void> {
        if (this.isGone()) return;
        await new Promise(resolve => setTimeout(resolve, ms));
    }

    async login(username: string, password: string) {
        await this.usernameInput.fill(username);
        await this.passwordInput.fill(password);
        await this.signInButton.click();
    }

    async assessTwoFactorChallenge(): Promise<Github2FaAssessment> {
        return this.twoFactorHandler.assessTwoFactorChallenge();
    }

    async tryRevealEmailTwoFactorOption(): Promise<boolean> {
        return this.twoFactorHandler.tryRevealEmailTwoFactorOption();
    }

    async tryClickSendCodeViaEmail(): Promise<boolean> {
        return this.twoFactorHandler.tryClickSendCodeViaEmail();
    }

    async completeEmailOtpIfConfigured(minReceivedAt?: Date): Promise<boolean> {
        return this.twoFactorHandler.completeEmailOtpIfConfigured(minReceivedAt);
    }

    async handleTwoFactorAuthentication(preLoginTime?: Date): Promise<boolean> {
        return this.twoFactorHandler.handleTwoFactorAuthentication(preLoginTime);
    }

    async loginAndHandleTwoFactor(username: string, password: string): Promise<boolean> {
        const preLoginTime = new Date();
        await this.login(username, password);
        return this.handleTwoFactorAuthentication(preLoginTime);
    }

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

    async submitSudoEmailOtp(): Promise<void> {
        return this.twoFactorHandler.submitSudoEmailOtp();
    }

    async isSudoAuthFailedVisible(): Promise<boolean> {
        return this.installFlowHandler.isSudoAuthFailedVisible();
    }

    async isSudoUiVisible(): Promise<boolean> {
        return this.installFlowHandler.isSudoUiVisible();
    }

    async waitForSudoChallengeResolved(timeoutMs = 90_000): Promise<boolean> {
        return this.installFlowHandler.waitForSudoChallengeResolved(timeoutMs);
    }

    async handlePostLoginEmailChallenge(opts?: { waitForSudoMs?: number }): Promise<boolean> {
        return this.installFlowHandler.handlePostLoginEmailChallenge(opts);
    }

    async completePermissionsInstallFlow(): Promise<boolean> {
        return this.installFlowHandler.completePermissionsInstallFlow();
    }

    async clickInstallAndAuthorize(): Promise<boolean> {
        return this.installFlowHandler.clickInstallAndAuthorize();
    }

    async authorizeApp() {
        return this.installFlowHandler.authorizeApp();
    }

    async enterVerificationCode(code: string) {
        return this.twoFactorHandler.enterVerificationCode(code);
    }
}
