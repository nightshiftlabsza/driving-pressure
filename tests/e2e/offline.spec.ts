import { test, expect } from '@playwright/test';

test.describe('Release QA: Full Offline Operation', () => {
  test('Strictly zero non-localhost / external requests during full navigation', async ({ page }) => {
    const externalRequests: string[] = [];

    // Intercept all network traffic
    await page.route('**/*', (route) => {
      const url = route.request().url();
      const isLocalhost = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      const isDataOrBlob = url.startsWith('data:') || url.startsWith('blob:');

      if (!isLocalhost && !isDataOrBlob) {
        externalRequests.push(url);
        route.abort();
      } else {
        route.continue();
      }
    });

    // 1. Visit Start Screen
    await page.goto('/#/legacy');
    await expect(page.locator('button', { hasText: /ICU Respiratory Trainer/i })).toBeVisible();

    // 2. Open Bedside ICU Simulator
    const bedsideBtn = page.locator('button', { hasText: /Intensive Care Unit/i }).first();
    if (await bedsideBtn.isVisible()) {
      await bedsideBtn.click();
      await page.waitForTimeout(1000);
      await page.goto('/#/legacy');
    }

    // 3. Open Trainer App
    await page.locator('button', { hasText: /ICU Respiratory Trainer/i }).click();
    await expect(page.getByTestId('tab-home')).toBeVisible();

    // 4. Navigate through all primary tabs
    await page.getByTestId('tab-cases').click();
    await expect(page.locator('h1:has-text("Case Library")')).toBeVisible();

    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-experiment-list')).toBeVisible();

    await page.getByTestId('tab-drills').click();
    await expect(page.locator('h2:has-text("Clinical Drills")')).toBeVisible();

    await page.getByTestId('tab-practice').click();
    await expect(page.getByTestId('practice-screen')).toBeVisible();

    await page.getByTestId('tab-progress').click();

    // Confirm that zero external network calls occurred
    expect(externalRequests).toEqual([]);
  });
});
