import { expect, Locator, Page } from '@playwright/test';

export type RestoreOrgStepResult = 'installed_new_org' | 'selected_existing_org';
export type RestoreProvider = 'github' | 'bitbucket';

export class RestorePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** "Select target organization or install app for a new one" combobox. */
  targetOrganizationCombobox(): Locator {
    const card = this.page.locator('main form, form, div[class*="card"]').filter({ hasText: /Target Organization|Select target organization/i }).first()
      .or(this.page.locator('main form, form, div[class*="card"]').first());
    return card.locator('[data-slot="select-trigger"], button[role="combobox"]').first();
  }

  organizationOptions(): Locator {
    return this.page
      .getByRole('option')
      .filter({ hasNotText: /No organizations available/i })
      .filter({ hasNotText: /Select target organization/i });
  }

  nextStepButton(): Locator {
    return this.page.getByRole('button', { name: /Next Step/i });
  }

  async openTargetOrganizationSelect(): Promise<void> {
    const trigger = this.targetOrganizationCombobox();
    await trigger.waitFor({ state: 'visible', timeout: 25_000 });
    await trigger.scrollIntoViewIfNeeded().catch(() => {});

    const isExpanded = await trigger.getAttribute('aria-expanded').catch(() => 'false');
    if (isExpanded !== 'true') {
      await trigger.click({ force: true });
    }

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
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});

    let state: 'empty' | 'has_orgs' | null = null;
    await expect(async () => {
      const count = await this.organizationOptions().count();
      if (count > 0) {
        state = 'has_orgs';
        return;
      }
      const itemCount = await this.page.locator('[data-slot="select-item"]').count();
      if (itemCount > 0 && !(await this.isNoOrganizationsAvailable())) {
        state = 'has_orgs';
        return;
      }
      if (await this.isNoOrganizationsAvailable()) {
        state = 'empty';
        return;
      }

      const isListboxVisible = await this.page.getByRole('listbox').isVisible().catch(() => false);
      if (!isListboxVisible) {
        await this.openTargetOrganizationSelect().catch(() => {});
      }

      throw new Error("State not determined yet");
    }).toPass({ timeout: timeoutMs, intervals: [500, 1000] });

    if (state !== null) {
      return state;
    }
    return 'empty';
  }

  /**
   * Restore hedef organizasyon adımı:
   * - Liste boşsa veya seçili sağlayıcıya uygun org yoksa → Install for New Organization + callback (GitHub / Bitbucket OAuth)
   * - Seçili sağlayıcıya (GitHub / Bitbucket) uygun org varsa → onu seç → Next Step
   */
  async completeTargetOrganizationStep(
    onInstallNewOrganization: () => Promise<void>,
    targetProvider: RestoreProvider = 'github'
  ): Promise<RestoreOrgStepResult> {
    const trigger = this.targetOrganizationCombobox();
    await trigger.waitFor({ state: 'visible', timeout: 25_000 });
    const triggerText = await trigger.innerText().catch(() => '');

    const isTargetProvider = (text: string) => {
      const lower = text.toLowerCase().trim();
      if (lower.includes('select target organization') || lower.includes('organization required') || lower.length <= 3) {
        return false;
      }
      if (targetProvider === 'bitbucket') {
        return lower.includes('bitbucket');
      }
      return lower.includes('github');
    };

    const isAlreadySelected = isTargetProvider(triggerText);

    if (isAlreadySelected) {
      console.log(`[restore] Hedef organizasyon ("${targetProvider}") zaten doğru seçili durumda: "${triggerText.replace(/\n/g, ' ').trim()}"`);
      const next = this.nextStepButton();
      await expect(next).toBeEnabled({ timeout: 10_000 });
      await next.scrollIntoViewIfNeeded();
      await next.click();
      await expect(this.page.getByText(/Select backup source/i).first()).toBeVisible({
        timeout: 20_000
      });
      console.log('[restore] Next Step doğrulandı; backup source adımı açıldı.');
      return 'selected_existing_org';
    }

    await this.openTargetOrganizationSelect();

    const listState = await this.waitForOrganizationListState();
    let selectedMatchingOption = false;

    if (listState === 'has_orgs') {
      const options = this.organizationOptions();
      const count = await options.count();

      for (let i = 0; i < count; i++) {
        const opt = options.nth(i);
        const text = await opt.innerText().catch(() => '');
        if (isTargetProvider(text)) {
          const orgLabel = text.replace(/\s+/g, ' ').trim();
          console.log(`[restore] Hedef "${targetProvider}" için uygun organizasyon seçiliyor: "${orgLabel}"`);
          await opt.click();
          selectedMatchingOption = true;
          break;
        }
      }
    }

    if (!selectedMatchingOption) {
      console.log(`[restore] "${targetProvider}" için listede uygun organizasyon bulunamadı — Install for New Organization akışı başlatılıyor...`);
      await this.page.keyboard.press('Escape').catch(() => {});

      const installBtn = this.page.getByRole('button', { name: /Install for New Organization/i });
      await installBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await installBtn.scrollIntoViewIfNeeded().catch(() => {});
      await installBtn.click();
      await onInstallNewOrganization();

      console.log('[restore] Yetkilendirme sonrası organizasyonun yüklenmesi bekleniyor...');
      
      let selectedOrganizationLabel = '';
      await expect(async () => {
        await this.page.reload({ waitUntil: 'domcontentloaded' });
        await this.openTargetOrganizationSelect();

        const options = this.organizationOptions();
        const count = await options.count();
        for (let i = 0; i < count; i++) {
          const option = options.nth(i);
          const text = await option.innerText();
          if (isTargetProvider(text)) {
            selectedOrganizationLabel = text.replace(/\s+/g, ' ').trim();
            await option.click();
            return;
          }
        }

        await this.page.keyboard.press('Escape');
        throw new Error(
          `Yeni yetkilendirme sonrası ${targetProvider} organization henüz listede değil.`
        );
      }).toPass({ timeout: 60_000, intervals: [2_000, 3_000, 5_000] });

      console.log(
        `[restore] Yeni yetkilendirilen ${targetProvider} organization seçildi: "${selectedOrganizationLabel}"`
      );

      const next = this.nextStepButton();
      await expect(next).toBeEnabled({ timeout: 25000 });
      await next.scrollIntoViewIfNeeded();
      await next.click();
      await expect(this.page.getByText(/Select backup source/i).first()).toBeVisible({
        timeout: 20_000
      });
      console.log('[restore] Next Step doğrulandı; backup source adımı açıldı.');
      
      return 'installed_new_org';
    }

    const next = this.nextStepButton();
    await expect(next).toBeEnabled({ timeout: 20_000 });
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await expect(this.page.getByText(/Select backup source/i).first()).toBeVisible({
      timeout: 20_000
    });
    console.log('[restore] Next Step doğrulandı; backup source adımı açıldı.');
    return 'selected_existing_org';
  }

  async selectBackupSourceIfVisible(): Promise<'backup_selected' | 'no_backups_found' | 'already_selected'> {
    const step2Heading = this.page.getByText(/Select backup source/i).first();
    const backupTrigger = this.page.locator('[data-slot="select-trigger"]').filter({ hasText: /Select a backup/i }).first();
    const createFirstBackupLink = this.page.locator('a[href*="/repository/"], button, [role="button"]').filter({ hasText: /Create first backup/i }).first();

    await Promise.race([
      step2Heading.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
      backupTrigger.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {}),
      createFirstBackupLink.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
    ]);

    const isNoBackupsFoundVisible = await createFirstBackupLink.isVisible().catch(() => false);
    if (isNoBackupsFoundVisible) {
      console.log('ℹ️ [RESTORE] "No Backups Found" — Bu repository için henüz yedek bulunamadı.');
      return 'no_backups_found';
    }

    const isBackupTriggerVisible = await backupTrigger.isVisible().catch(() => false);

    if (isBackupTriggerVisible) {
      console.log('[e2e] "Select a backup" tespit edildi, yedek seçiliyor...');
      await backupTrigger.click();

      const backupOptions = this.page.getByRole('option')
        .or(this.page.locator('[data-slot="select-item"]'))
        .filter({ hasNotText: /Select a backup/i });

      const hasOptions = await backupOptions.first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
      if (hasOptions) {
        const backupText = await backupOptions.first().innerText().catch(() => '');
        console.log(`[e2e] Yedek seçiliyor: "${backupText.trim()}"`);
        await backupOptions.first().click();
        return 'backup_selected';
      } else {
        console.warn('⚠️ [UYARI] Seçilen repository için henüz tamamlanmış (Completed) bir yedek bulunamadı.');
        await this.page.keyboard.press('Escape').catch(() => {});
        return 'no_backups_found';
      }
    }

    console.log('[e2e] Yedek zaten seçili durumda veya görünmüyor.');
    return 'already_selected';
  }
}
