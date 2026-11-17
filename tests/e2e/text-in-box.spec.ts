import { test, expect, Page } from '@playwright/test';
import { appendFileSync } from 'node:fs';
import { findTextOutsideBox } from './lib/textInBox';

// Rendered check: no visible text may stick out of, or be cut by, its box, on any screen, at any supported size.
// History: the setting tiles had a fixed height smaller than their three lines, so units ("%", "mL") fell out of
// the tile at every size for a week. Width-only checks and box-size measurements never saw it. This one does.

const SIZES = [[1366, 768], [1720, 720], [1920, 1080], [2560, 1440], [3440, 1440]] as const;
const CASES = ['ards-vent-01', 'apo-cpap-01', 'asthma-vent-01', 'copd-niv-01', 'copd-psv-trigger-01', 'dka-intubated-01',
  'dyssynchrony-01', 'pneumonia-hfnc-01', 'sbt-fail-01', 'sbt-pass-01', 'vent-high-pressure-01'];
const SHOTS = process.env.TEXT_IN_BOX_SHOTS;

async function answerPopups(p: Page) {
  for (let k = 0; k < 6; k++) {
    const commit = p.getByRole('button', { name: /Commit answer/ });
    const cont = p.getByRole('button', { name: 'Continue' });
    if (!(await commit.count())) {
      if (await cont.count()) { await cont.first().click({ timeout: 1500 }).catch(() => {}); continue; }
      break;
    }
    const inp = p.locator('.vt-dialog input, [role=dialog] input').first();
    if (await inp.count()) await inp.fill('66').catch(() => {});
    await p.getByRole('button', { name: 'Guess' }).first().click({ timeout: 1500 }).catch(() => {});
    await commit.click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(300);
    if (await cont.count()) await cont.first().click({ timeout: 2000 }).catch(() => {});
    await p.waitForTimeout(300);
  }
}

async function openCase(p: Page, id: string, answer = true) {
  await p.goto(`/?case=${id}#/trainer`);
  const take = p.getByRole('button', { name: /Take over the patient/ });
  await take.waitFor({ timeout: 15000 });
  await take.first().click();
  await p.waitForTimeout(500);
  if (answer) await answerPopups(p);
}

async function check(p: Page, name: string) {
  await p.waitForTimeout(250);
  const faults = await p.evaluate(findTextOutsideBox);
  const vp = p.viewportSize()!;
  if (SHOTS && faults.length) appendFileSync(`${SHOTS}/faults.jsonl`, JSON.stringify({ name, size: `${vp.width}x${vp.height}`, faults }) + '\n');
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}-${vp.width}x${vp.height}.png`, fullPage: true });
  expect.soft(faults, `${name} at ${vp.width}x${vp.height}`).toEqual([]);
}

for (const [w, h] of SIZES) {
  test.describe(`text stays inside its box at ${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => { try { localStorage.setItem('ovs-intro-tour-done', '1'); } catch { /* ignore */ } });
    });

    for (const view of ['home', 'cases', 'practice', 'progress', 'labs', 'drills']) {
      test(`screen: ${view}`, async ({ page }) => {
        await page.goto(`/?view=${view}#/trainer`);
        await page.waitForTimeout(700);
        await check(page, `view-${view}`);
      });
    }

    for (const id of CASES) {
      test(`case start and side tabs: ${id}`, async ({ page }) => {
        await openCase(page, id);
        await check(page, `case-${id}`);
        for (const tab of ['Orders', 'Blood gases', 'Timeline', 'Consultant']) {
          const t = page.getByRole('tab', { name: tab });
          if (await t.count() && await t.first().isVisible()) { await t.first().click(); await check(page, `case-${id}-tab-${tab.replace(' ', '')}`); }
        }
      });
    }

    test('ARDS: first question pop-up open', async ({ page }) => {
      await openCase(page, 'ards-vent-01', false);
      await check(page, 'ards-popup');
    });

    test('ARDS: every ventilator mode, tile selected, tile changed', async ({ page }) => {
      test.setTimeout(90000);
      await openCase(page, 'ards-vent-01');
      const tabs = page.locator('.vt-modetab');
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        const label = ((await tabs.nth(i).textContent()) ?? '').trim();
        if (/more modes|invasive/i.test(label) || await tabs.nth(i).isDisabled()) continue;
        await tabs.nth(i).click({ timeout: 3000 });
        await answerPopups(page);
        await check(page, `ards-mode-${label.replace(/\W/g, '')}`);
      }
      await page.locator('.vt-key').nth(1).click({ timeout: 3000 });
      await check(page, 'ards-tile-selected');
      const input = page.locator('.vt-key input').nth(1);
      await input.fill('400', { timeout: 3000 });
      await check(page, 'ards-tile-changed');
    });

    test('ARDS: after a blood gas and 30 minutes, then the debrief', async ({ page }) => {
      test.setTimeout(90000);
      await openCase(page, 'ards-vent-01');
      const orders = page.getByRole('tab', { name: 'Orders' });
      if (await orders.count() && await orders.first().isVisible()) await orders.first().click();
      const abg = page.getByRole('button', { name: /Arterial blood gas/i }).first();
      if (await abg.count()) await abg.click({ timeout: 3000 }).catch(() => {});
      const confirm = page.getByRole('button', { name: 'Confirm' });
      if (await confirm.count()) await confirm.first().click().catch(() => {});
      await answerPopups(page);
      await page.getByRole('button', { name: /\+30 min/ }).first().click();
      await page.waitForTimeout(2500);
      await answerPopups(page);
      await check(page, 'ards-late');
      await page.getByRole('button', { name: /Stop case|Go to debrief/ }).first().click();
      const sure = page.getByRole('button', { name: /^(Stop|End|Yes|Confirm)/ });
      if (await sure.count()) await sure.first().click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await check(page, 'debrief');
    });
  });
}
