import { Page } from '@playwright/test';

export async function openIcuMode(page: Page) {
  await page.goto('/#/legacy');
  const icuButton = page.locator('button', { hasText: /Intensive Care Unit/i }).first();
  await icuButton.click();
  const invasiveButton = page.locator('button', { hasText: /Invasive/i }).first();
  await invasiveButton.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
  if (await invasiveButton.isVisible()) {
    await invasiveButton.click();
  }
}

export async function getEngineState(page: Page): Promise<any> {
  return await page.evaluate(() => {
    return (window as any).__ovsDebug?.getState();
  });
}

export async function setControlValue(page: Page, testId: string, value: string) {
  const el = page.locator(`[data-testid="${testId}"]`);
  if (testId === 'control-mode' && !(await el.isVisible())) {
    // From 768 px wide the mode select is hidden and the modes are tabs (same options, same labels).
    const label = await el.locator(`option[value="${value}"]`).innerText();
    await page.getByRole('tab', { name: label, exact: true }).click();
    const apply = page.locator('[data-testid="control-apply"]');
    if (await apply.isVisible({ timeout: 1000 }).catch(() => false)) await apply.click();
    return;
  }
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await el.evaluate(e => e.tagName.toLowerCase());
  if (tagName === 'select') {
    await el.selectOption(value);
  } else if (tagName === 'input') {
    await el.fill(value);
  } else {
    await el.click();
    const option = page.locator(`button:has-text("${value}"), [role="option"]:has-text("${value}")`).first();
    if (await option.isVisible({ timeout: 1000 }).catch(() => false)) {
      await option.click();
    }
  }
  const applyBtn = page.locator('[data-testid="control-apply"]');
  if (await applyBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await applyBtn.click();
  }
}

export async function selectPatientPreset(page: Page, presetName: string) {
  const el = page.locator('[data-testid="patient-preset"]');
  await el.waitFor({ state: 'visible', timeout: 5000 });
  const tagName = await el.evaluate(e => e.tagName.toLowerCase());
  if (tagName === 'select') {
    await el.selectOption({ label: presetName });
  } else {
    await el.click();
    const opt = page.locator(`text=${presetName}`).first();
    await opt.click();
  }
}

export async function safeScreenshot(page: Page, options: Parameters<Page['screenshot']>[0]) {
  try {
    await page.screenshot(options);
  } catch (err) {
    await page.waitForTimeout(400);
    try {
      await page.screenshot(options);
    } catch {
      // Non-fatal if screenshot write is blocked by OS file indexing
    }
  }
}
