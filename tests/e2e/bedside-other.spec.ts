import { test, expect } from '@playwright/test';

test.describe('Bedside HFNC & Start Screen Options', () => {
  test('8. Switching to HFNC hides ventilator pressure tiles or shows them as not available', async ({ page }) => {
    await page.goto('/#/legacy');
    const hfButton = page.locator('button', { hasText: /High-Flow Oxygenator/i }).first();
    await hfButton.click();
    await page.waitForTimeout(1000);

    const pressureIds = ['vent-ppeak', 'vent-pmean', 'vent-peep', 'vent-pplat'];
    for (const id of pressureIds) {
      const tile = page.locator(`[data-testid="${id}"]`);
      const count = await tile.count();
      if (count > 0 && await tile.isVisible().catch(() => false)) {
        const text = await tile.innerText();
        const isUnavailable = text.includes('-') || text.includes('N/A') || text.trim() === '';
        expect(isUnavailable).toBe(true);
      } else {
        expect(count === 0 || !(await tile.isVisible().catch(() => false))).toBe(true);
      }
    }
  });

  test('9. The start screen still offers the original modes and the trainer', async ({ page }) => {
    await page.goto('/#/legacy');

    const trainerBtn = page.locator('button', { hasText: /ICU Respiratory Trainer/i });
    await expect(trainerBtn).toBeVisible();

    const icuBtn = page.locator('button', { hasText: /Intensive Care Unit/i });
    await expect(icuBtn).toBeVisible();

    const hfBtn = page.locator('button', { hasText: /High-Flow Oxygenator/i });
    await expect(hfBtn).toBeVisible();
  });
});
