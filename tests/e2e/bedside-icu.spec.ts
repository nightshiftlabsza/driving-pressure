import { test, expect, Page } from '@playwright/test';
import { openIcuMode, getEngineState, setControlValue, selectPatientPreset } from './e2e-helpers';

export { openIcuMode, getEngineState, setControlValue, selectPatientPreset };

test.describe('Bedside ICU Screen (Engine driven)', () => {
  test('1. Selecting ICU mode shows a waveform within 2 s, and vent-rr matches set rate in a passive preset', async ({ page }) => {
    await openIcuMode(page);
    await expect(page.locator('[data-testid="waveform-plot"]')).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(3000);
    const ventRrText = await page.locator('[data-testid="vent-rr"]').innerText();
    const ventRr = parseFloat(ventRrText.replace(/[^0-9.]/g, ''));
    const state = await getEngineState(page);
    const setRr = state?.device?.rrSetBpm ?? 12;
    expect(Math.abs(ventRr - setRr)).toBeLessThanOrEqual(1);
  });

  test('2. Raising PEEP from 5 to 10 raises vent-peep to 10 and raises end-expiratory pressure', async ({ page }) => {
    await openIcuMode(page);
    await page.waitForTimeout(1000);
    await setControlValue(page, 'control-peep', '10');
    await expect(page.locator('[data-testid="vent-peep"]')).toContainText('10', { timeout: 3000 });
    const state = await getEngineState(page);
    expect(state.device.peep).toBe(10);
    expect(state.monitored.peepSetCmH2O).toBe(10);
  });

  test('3. In VC with passive ARDS preset, an inspiratory hold gives vent-pplat ≈ PEEP + VT / compliance (±1.5 cmH2O)', async ({ page }) => {
    await openIcuMode(page);
    await setControlValue(page, 'control-mode', 'VC-AC');
    await selectPatientPreset(page, 'ARDS');
    await page.waitForTimeout(1000);

    await page.locator('[data-testid="btn-insp-hold"]').click();
    const pplatEl = page.locator('[data-testid="vent-pplat"]');
    await expect(pplatEl).not.toHaveText('-', { timeout: 8000 });
    const pplatText = await pplatEl.innerText();
    const pplat = parseFloat(pplatText.replace(/[^0-9.]/g, ''));

    const state = await getEngineState(page);
    const compliance = state.patient.complianceMlPerCmH2O;
    const peep = state.device.peep;
    const vt = state.device.vtSetMl ?? 450;
    const expectedPplat = peep + (vt / compliance);
    expect(Math.abs(pplat - expectedPplat)).toBeLessThanOrEqual(1.5);
  });

  test('4. Changing VT from 400 to 600 in VC raises vent-ppeak', async ({ page }) => {
    await openIcuMode(page);
    await setControlValue(page, 'control-mode', 'VC-AC');
    await setControlValue(page, 'control-vt', '400');
    await page.waitForTimeout(3000);
    const ppeak400Text = await page.locator('[data-testid="vent-ppeak"]').innerText();
    const ppeak400 = parseFloat(ppeak400Text.replace(/[^0-9.]/g, ''));

    await setControlValue(page, 'control-vt', '600');
    await page.waitForTimeout(4000);
    const ppeak600Text = await page.locator('[data-testid="vent-ppeak"]').innerText();
    const ppeak600 = parseFloat(ppeak600Text.replace(/[^0-9.]/g, ''));

    expect(ppeak600).toBeGreaterThan(ppeak400);
  });

  test('5. In PC, lowering compliance (switching to ARDS preset) lowers vent-vte', async ({ page }) => {
    await openIcuMode(page);
    await setControlValue(page, 'control-mode', 'PC-AC');
    await selectPatientPreset(page, 'Normal');
    await page.waitForTimeout(3000);
    const vteNormalText = await page.locator('[data-testid="vent-vte"]').innerText();
    const vteNormal = parseFloat(vteNormalText.replace(/[^0-9.]/g, ''));

    await selectPatientPreset(page, 'ARDS');
    await page.waitForTimeout(4000);
    const vteArdsText = await page.locator('[data-testid="vent-vte"]').innerText();
    const vteArds = parseFloat(vteArdsText.replace(/[^0-9.]/g, ''));

    expect(vteArds).toBeLessThan(vteNormal);
  });

  test('6. In COPD preset, raising RR from 12 to 30 produces positive auto-PEEP on expiratory hold', async ({ page }) => {
    await openIcuMode(page);
    await selectPatientPreset(page, 'COPD');
    await setControlValue(page, 'control-rr', '30');
    await page.waitForTimeout(6000);

    await page.locator('[data-testid="btn-exp-hold"]').click();
    await page.waitForTimeout(3000);

    const state = await getEngineState(page);
    const autoPeep = state.lastManoeuvre?.autoPeepCmH2O ?? state.monitored?.autoPeepCmH2O ?? 0;
    expect(autoPeep).toBeGreaterThan(0.5);
  });

  test('7. The values on screen equal getState().monitored (±1 for integers) at three points in time', async ({ page }) => {
    await openIcuMode(page);
    await page.waitForTimeout(2000);

    for (let sample = 0; sample < 3; sample++) {
      if (sample > 0) {
        await page.waitForTimeout(2000);
      }
      const state = await getEngineState(page);
      const mon = state.monitored;

      if (mon.ppeakCmH2O !== null) {
        const ppeakText = await page.locator('[data-testid="vent-ppeak"]').innerText();
        const ppeak = parseFloat(ppeakText.replace(/[^0-9.]/g, ''));
        expect(Math.abs(ppeak - mon.ppeakCmH2O)).toBeLessThanOrEqual(1.5);
      }
      if (mon.peepSetCmH2O !== null) {
        const peepText = await page.locator('[data-testid="vent-peep"]').innerText();
        const peep = parseFloat(peepText.replace(/[^0-9.]/g, ''));
        expect(Math.abs(peep - mon.peepSetCmH2O)).toBeLessThanOrEqual(1.0);
      }
      if (mon.rrTotalBpm !== null) {
        const rrText = await page.locator('[data-testid="vent-rr"]').innerText();
        const rr = parseFloat(rrText.replace(/[^0-9.]/g, ''));
        expect(Math.abs(rr - mon.rrTotalBpm)).toBeLessThanOrEqual(1.0);
      }
    }
  });
});
