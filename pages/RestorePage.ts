import { expect, Locator, Page } from '@playwright/test';

export type RestoreOrgStepResult = 'installed_new_org' | 'selected_existing_org';

export class RestorePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** "Select target organization or install app for a new one" combobox. */
  targetOrganizationCombobox(): Locator {
    return this.page
      .locator('[data-slot="select-trigger"]')
      .filter({ hasText: /Select target organization or install app for a new one/i })
      .or(
        this.page.locator('[data-slot="select-trigger"]').filter({ has: this.page.locator('span[data-slot="badge"]') })
      )
      .or(
        this.page.locator('[data-slot="select-trigger"]').last()
      )
      .first();
  }

  organizationOptions(): Locator {
    return this.page
      .getByRole('option')
      .filter({ hasNotText: /No organizations available/i })
      .filter({ hasNotText: /Select target organization/i });
  }

  nextStepButton(): Locator {
    return this.page.getByRole('button', { name: /^Next Step$/i });
  }

  async openTargetOrganizationSelect(): Promise<void> {
    const trigger = this.targetOrganizationCombobox();
    await trigger.waitFor({ state: 'visible', timeout: 25_000 });
    await trigger.scrollIntoViewIfNeeded().catch(() => {});
    await trigger.click();

    await this.page
      .getByRole('listbox')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(async () => {
        await this.page.locator('[data-slot="select-content"]').waitFor({ state: 'visible', timeout: 5000 });
      })
      .catch(() => {});
  }

  async isNoOrganizationsAvailable(): Promise<boolean> {
    const inList = this.page
      .getByRole('listbox')
      .getByText('No organizations available', { exact: true });
    if (await inList.isVisible().catch(() => false)) {
      return true;
    }
    return this.page.getByText('No organizations available', { exact: true }).isVisible().catch(() => false);
  }

  /** Combobox açıldıktan sonra liste boş mu dolu mu netleşene kadar bekler. */
  async waitForOrganizationListState(timeoutMs = 20_000): Promise<'empty' | 'has_orgs'> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.isNoOrganizationsAvailable()) {
        return 'empty';
      }
      const count = await this.organizationOptions().count();
      if (count > 0) {
        return 'has_orgs';
      }
      const itemCount = await this.page.locator('[data-slot="select-item"]').count();
      if (itemCount > 0 && !(await this.isNoOrganizationsAvailable())) {
        return 'has_orgs';
      }
      await this.page.waitForTimeout(350);
    }
    if (await this.isNoOrganizationsAvailable()) {
      return 'empty';
    }
    throw new Error(
      '[restore] Organizasyon listesi zaman aşımı: "No organizations available" veya seçilebilir org görülmedi.'
    );
  }

  /**
   * Restore hedef organizasyon adımı:
   * - Liste boşsa → Install for New Organization + callback (GitHub OAuth)
   * - Organizasyon varsa → ilkini seç → Next Step
   */
  async completeTargetOrganizationStep(
    onInstallNewOrganization: () => Promise<void>
  ): Promise<RestoreOrgStepResult> {
    const trigger = this.targetOrganizationCombobox();
    await trigger.waitFor({ state: 'visible', timeout: 25_000 });
    
    const triggerText = await trigger.innerText().catch(() => '');
    const isAlreadySelected = !triggerText.match(/Select target organization or install app for a new one/i) && triggerText.trim().length > 0;

    if (isAlreadySelected) {
      console.log(`[restore] Organizasyon zaten seçili durumda: "${triggerText.replace(/\n/g, ' ').trim()}"`);
      const next = this.nextStepButton();
      await expect(next).toBeEnabled({ timeout: 10_000 });
      await next.scrollIntoViewIfNeeded().catch(() => {});
      await next.click();
      console.log('[restore] Next Step tıklandı; sonraki adımlar için hazır.');
      return 'selected_existing_org';
    }

    await this.openTargetOrganizationSelect();

    const listState = await this.waitForOrganizationListState();
    if (listState === 'empty') {
      console.log('[restore] "No organizations available" — Install for New Organization akışı.');
      await this.page.keyboard.press('Escape').catch(() => {});

      const installBtn = this.page.getByRole('button', { name: /Install for New Organization/i });
      await installBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await installBtn.scrollIntoViewIfNeeded().catch(() => {});
      await installBtn.click();
      await onInstallNewOrganization();
      return 'installed_new_org';
    }

    let option = this.organizationOptions().first();
    if ((await this.organizationOptions().count()) === 0) {
      option = this.page
        .locator('[data-slot="select-item"]')
        .filter({ hasNotText: /No organizations available/i })
        .first();
    }

    await option.waitFor({ state: 'visible', timeout: 10_000 });
    const orgLabel = (await option.innerText()).replace(/\s+/g, ' ').trim();
    console.log(`[restore] Organizasyon seçiliyor: "${orgLabel}"`);
    await option.click();

    const next = this.nextStepButton();
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.scrollIntoViewIfNeeded().catch(() => {});
    await next.click();
    console.log('[restore] Next Step tıklandı; sonraki adımlar için hazır.');
    return 'selected_existing_org';
  }
}
