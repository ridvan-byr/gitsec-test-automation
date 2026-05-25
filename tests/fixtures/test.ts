import { test as base, expect } from '@playwright/test';

export const test = base.extend({});
export { expect };

// Her testte onboarding'i localStorage üzerinden kesin skip et.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem(
        'gs-tour',
        JSON.stringify({ state: { completedTours: { onboarding: 5 } }, version: 0 })
      );
    } catch {
      // ignore
    }
  });
});

