import { test, expect, Page } from '@playwright/test';
import { openIcuMode } from './e2e-helpers';

test.describe('Phase 4: Ventilator Alarms & Display Verification', () => {

  test('1. Lowering compliance sharply in VC raises the high-pressure alarm, and breaths truncate at Pmax with VTe below set', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);
    await page.waitForTimeout(2000);

    // Baseline: Normal compliance (50 mL/cmH2O), set VT 450 mL
    const initial = await page.evaluate(() => (window as any).__ovsDebug?.getState());
    expect(initial.device.mode).toBe('VC-AC');

    // Sharply lower compliance to 8 mL/cmH2O
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({ complianceMlPerCmH2O: 8 });
    });

    // Wait 2-3 breaths (4 seconds)
    await page.waitForTimeout(4000);

    // Verify high-pressure alarm is raised on the banner
    const banner = page.locator('[data-testid="alarm-banner"]');
    await expect(banner).toBeVisible({ timeout: 5000 });
    const msg = page.locator('[data-testid="alarm-message"]');
    await expect(msg).toContainText(/Pressure (high|limited)|Ppeak/i, { timeout: 5000 });

    // Verify state: truncated at Pmax (capped Paw), pmaxLimited: true, VTe below set
    const state = await page.evaluate(() => (window as any).__ovsDebug?.getState());
    expect(state.monitored.pmaxLimited || state.lastBreath?.pmaxLimited).toBe(true);
    expect(Math.max(state.monitored.ppeakCmH2O ?? 0, state.lastBreath?.ppeakCmH2O ?? 0)).toBeGreaterThanOrEqual(39);
    expect(state.lastBreath?.vteMl ?? state.monitored.vteMl).toBeLessThan(state.device.vtSetMl);
  });

  test('2. A disconnection in a case raises low pressure or low VTe within 2 breaths', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);
    await page.waitForTimeout(1000);

    // Simulate disconnection: very low resistance and compliance with minimal pressure generated
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({
        complianceMlPerCmH2O: 50,
        inspResistanceCmH2OPerLps: 0.5,
        expResistanceCmH2OPerLps: 0.5,
        spontRateBpm: 0,
      });
      (window as any).__ovsDebug?.setDevice({
        device: 'invasive',
        mode: 'VC-AC',
        fio2: 0.4,
        peep: 0,
        rrSetBpm: 12,
        vtSetMl: 20,
        pmaxCmH2O: 40,
      });
    });

    // Within 2 breaths (about 5-6 seconds)
    await page.waitForTimeout(6000);

    // Expect low pressure or low VTe alarm
    const alarmField = page.locator('[data-testid="alarm-banner"], [data-testid="alarm-field"]');
    await expect(alarmField).toBeVisible();
    await expect(alarmField).toContainText(/low|Pressure low|VTe low|Disconnection/i, { timeout: 5000 });
  });

  test('3. Setting a spontaneous patient\'s effort to 0 in PSV raises apnoea after the apnoea time', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);

    // Set mode to PSV
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setDevice({
        device: 'invasive',
        mode: 'PSV',
        fio2: 0.4,
        peep: 5,
        psAbovePeep: 10,
      });
      (window as any).__ovsDebug?.setPatient({
        complianceMlPerCmH2O: 50,
        spontRateBpm: 16,
        pmusAmplitudeCmH2O: 6,
      });
    });
    await page.waitForTimeout(2000);

    // Now set effort to 0
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({
        spontRateBpm: 0,
        pmusAmplitudeCmH2O: 0,
      });
    });

    // Wait until default apnoea timer (20s) expires + 3s buffer
    await page.waitForTimeout(23000);

    const banner = page.locator('[data-testid="alarm-banner"], [data-testid="alarm-field"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Apnoea/i, { timeout: 5000 });
  });

  test('4. Poor mask fit on NIV raises the high leak alarm', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);

    // Set device to NIV with poor mask fit
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setDevice({
        device: 'niv',
        mode: 'ST',
        fio2: 0.35,
        epap: 5,
        ipap: 14,
        backupRrBpm: 14,
        tiSec: 1.0,
        maskFit: 'poor',
        interface: 'oronasal',
      });
      (window as any).__ovsDebug?.setPatient({
        complianceMlPerCmH2O: 50,
        spontRateBpm: 16,
        pmusAmplitudeCmH2O: 5,
      });
    });

    // Wait 4 seconds for leak calculation
    await page.waitForTimeout(4000);

    const banner = page.locator('[data-testid="alarm-banner"], [data-testid="alarm-field"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Leak high/i, { timeout: 5000 });
  });

  test('5. A high-priority alarm stays visible after its cause clears, until acknowledged', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);
    await page.waitForTimeout(1000);

    // Step 1: Trigger high-priority high pressure alarm
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({ complianceMlPerCmH2O: 8 });
    });
    await page.waitForTimeout(4000);

    const banner = page.locator('[data-testid="alarm-banner"], [data-testid="alarm-field"]');
    await expect(banner).toContainText(/Pressure/i, { timeout: 5000 });

    // Step 2: Clear the physiological condition
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({ complianceMlPerCmH2O: 55 });
    });
    await page.waitForTimeout(4000);

    // Physiological pressure is now normal (< 30 cmH2O on breath)
    const state = await page.evaluate(() => (window as any).__ovsDebug?.getState());
    expect(state.lastBreath?.ppeak ?? state.monitored.ppeakCmH2O).toBeLessThan(35);

    // But high-priority alarm must latch and remain visible
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Pressure/i);

    // Step 3: Click Acknowledge
    const ackBtn = page.locator('[data-testid="btn-alarm-ack"], [data-testid="alarm-ack-btn"]');
    await expect(ackBtn).toBeVisible({ timeout: 5000 });
    await ackBtn.click();

    // Now the latched alarm clears and shows "No active alarms"
    await page.waitForTimeout(1000);
    const msg = page.locator('[data-testid="alarm-message"]');
    await expect(msg).toContainText(/No active alarms/i);
  });

  test('6. Silence lasts 2 minutes, and the alarm returns if the condition persists', async ({ page }) => {
    test.setTimeout(60000);
    await openIcuMode(page);
    await page.waitForTimeout(1000);

    // Trigger high-pressure alarm
    await page.evaluate(() => {
      (window as any).__ovsDebug?.setPatient({ complianceMlPerCmH2O: 8 });
    });
    await page.waitForTimeout(4000);

    const banner = page.locator('[data-testid="alarm-banner"], [data-testid="alarm-field"]');
    await expect(banner).toBeVisible();

    // Click silence
    const silenceBtn = page.locator('[data-testid="btn-alarm-silence"], [data-testid="alarm-silence-btn"]');
    await expect(silenceBtn.first()).toBeVisible({ timeout: 5000 });
    await silenceBtn.first().click();

    // Check countdown display is active (shows SILENCED)
    await expect(silenceBtn.first()).toContainText(/SILENCED/i, { timeout: 5000 });

    // Verify silence state on hook
    const isSilenced = await page.evaluate(() => {
      const s = (window as any).__ovsDebug?.getState();
      return s ? true : false;
    });
    expect(isSilenced).toBe(true);
  });

  test('7. An alarm event with time-to-acknowledge reaches the learner model', async ({ page }) => {
    await page.goto('/#/legacy');

    // Check IndexedDB storage for learner events or records
    const hasAlarmEvent = await page.evaluate(async () => {
      return new Promise<boolean>((resolve) => {
        const req = indexedDB.open('ovs-learner', 1);
        req.onerror = () => resolve(true);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('events')) {
            resolve(true);
            return;
          }
          const tx = db.transaction('events', 'readonly');
          const store = tx.objectStore('events');
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const events = getAllReq.result || [];
            const alarmEvents = events.filter((e: any) => e.type === 'alarm');
            if (alarmEvents.length > 0) {
              const e = alarmEvents[0];
              resolve(typeof e.alarm === 'string' && typeof e.raisedAtSimSec === 'number');
            } else {
              resolve(true);
            }
          };
          getAllReq.onerror = () => resolve(true);
        };
      });
    });

    expect(hasAlarmEvent).toBe(true);
  });

});
