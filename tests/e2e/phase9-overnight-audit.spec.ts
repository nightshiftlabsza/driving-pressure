import { test, expect, type Page } from '@playwright/test';

async function clearLearnerDb(page: Page) {
  await page.goto('/#/legacy');
  await page.evaluate(async () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
    await new Promise<void>(resolve => {
      const done = () => resolve();
      const timer = setTimeout(done, 2000);
      const req = indexedDB.deleteDatabase('ovs-learner');
      req.onsuccess = () => { clearTimeout(timer); done(); };
      req.onerror = () => { clearTimeout(timer); done(); };
      req.onblocked = () => { clearTimeout(timer); done(); };
    });
  });
}

async function setVentSetting(page: Page, testId: string, val: string) {
  const btn = page.getByTestId(testId);
  await btn.click();
  const slider = page.locator('.vt-adjust input[type="range"]');
  if (await slider.isVisible({ timeout: 2000 }).catch(() => false)) {
    await slider.fill(val);
  }
  await page.getByTestId('control-apply').click();
}

async function answerPredictionIfVisible(page: Page, opts: { numeric?: string; direction?: 'up' | 'down' | 'same' } = {}) {
  const predDialog = page.getByRole('dialog', { name: 'Prediction' });
  const visible = await predDialog.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false);
  if (!visible) return false;

  const numInput = predDialog.getByLabel('Your answer');
  if (await numInput.isVisible().catch(() => false)) {
    await numInput.fill(opts.numeric ?? '66');
  } else {
    const radio = predDialog.locator('input[type="radio"]').first();
    if (await radio.isVisible().catch(() => false)) {
      await radio.click();
    } else {
      const dir = opts.direction ?? 'same';
      const dirName = dir === 'same' ? 'no change' : dir;
      const btns = predDialog.getByRole('button', { name: dirName });
      const c = await btns.count();
      if (c > 0) {
        for (let i = 0; i < c; i++) await btns.nth(i).click();
      }
    }
  }
  await predDialog.getByRole('button', { name: 'Certain' }).click();
  await predDialog.getByRole('button', { name: 'Commit answer' }).click();
  const cont = page.getByRole('button', { name: 'Continue' });
  const contVisible = await cont.waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
  if (contVisible) {
    await cont.click();
  }
  await predDialog.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  return true;
}

test.describe('Phase 9 Overnight Features End-to-End Audit (6 Cases)', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(90000);
    await clearLearnerDb(page);
  });

  test('Case 1 (ards-vent-01 right path): Handoff clock pause, CommitSheet, RationaleChip rate-limit, DecisionReview, and Rewind', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?case=ards-vent-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });

    // 1. Handoff card pauses clock & disables time progression/holds
    await expect(page.getByTestId('handoff-card')).toBeVisible();
    await expect(page.getByRole('button', { name: /Play|Pause/ })).toBeDisabled();
    await expect(page.getByRole('button', { name: '+5 min' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Inspiratory hold' })).toBeDisabled();
    await page.waitForTimeout(1500);
    await expect(page.getByLabel('Simulated time')).toHaveText('0:00:00');

    // Take over patient -> emits resource_opened
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Clear opening PBW prediction
    await answerPredictionIfVisible(page, { numeric: '66' });

    // 2. Diagnostic order (ABG) does NOT trigger CommitSheet
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);

    // Advance 5 min so ABG returns
    await page.getByRole('button', { name: '+5 min' }).click();

    // 3. First therapeutic titration -> CommitSheet gates before executing
    await setVentSetting(page, 'control-vt', '400');
    await expect(page.getByTestId('commit-sheet')).toBeVisible();
    await page.getByTestId('assessment-option-low_compliance').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);

    // Answer prediction triggered by change-settings (before RationaleChip can be clicked cleanly)
    await answerPredictionIfVisible(page, { direction: 'up' });

    // 4. RationaleChip appears for major Vt cut -> select reason
    await expect(page.getByTestId('rationale-chip-container')).toBeVisible();
    await page.getByTestId('rationale-option-lung_protection').click();
    await expect(page.getByTestId('rationale-chip-container')).toHaveCount(0);

    // 5. Subsequent major adjustments within 2 sim-min respect RationaleChip rate limit
    await setVentSetting(page, 'control-rr', '28');
    await setVentSetting(page, 'control-peep', '14');
    await expect(page.getByTestId('rationale-chip-container')).toHaveCount(0);

    // Prone and advance to improved outcome
    await page.getByRole('button', { name: 'Prone position' }).click();
    for (let i = 0; i < 6; i++) {
      const endBtn = page.getByRole('button', { name: /Go to debrief|Stop case/i });
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        break;
      }
      await answerPredictionIfVisible(page);
      const skip30 = page.getByRole('button', { name: '+30 min' });
      if (await skip30.isEnabled().catch(() => false)) {
        await skip30.click();
      }
    }
    await expect(page.getByTestId('debrief-screen')).toBeVisible({ timeout: 15000 });

    // Verify ARDS clinical timing caveat banner (CHAL-2) & Reference Case badge (CHAL-1)
    await expect(page.getByTestId('clinical-timing-caveat-banner')).toBeVisible();
    await expect(page.getByTestId('decision-review-mode-badge')).toHaveText('Attending Reference Case');

    // 6. DecisionReview checks
    await expect(page.getByRole('heading', { name: /Decision Process & Clinical Reasoning Review/i })).toBeVisible({ timeout: 10000 });
    const drSection = page.locator('section[aria-labelledby="decision-review-heading"]');
    await expect(drSection).toContainText('Sound Process');
    await drSection.getByText(/Titrated: Vt 400 mL, Rate 16 bpm/).first().click();
    await expect(drSection).toContainText('ARDS-01-VT-REDUCTION-SOUND');

    // Exposure Ledger & Attending Trajectory Comparison
    await expect(page.getByRole('heading', { name: /Exposure Ledger/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Attending Trajectory Comparison/i })).toBeVisible();
    await expect(page.getByText('One reasonable approach')).toBeVisible();

    // Verify resource_opened + assessment_commit + rationale events in IndexedDB
    const evTypes = await page.evaluate(async () => {
      return await new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open('ovs-learner');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('events', 'readonly');
          const all = tx.objectStore('events').getAll();
          all.onsuccess = () => resolve((all.result || []).map((e: any) => e.type));
        };
      });
    });
    expect(evTypes).toContain('resource_opened');
    expect(evTypes).toContain('assessment_commit');
    expect(evTypes).toContain('rationale');

    // 7. Rewind ("Try again from here") from a decision -> skips Handoff, creates linked rewind run
    await page.getByRole('button', { name: /Try again from here/i }).first().click();
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    await page.getByRole('button', { name: /Stop case|Go to debrief/i }).click();
    await expect(page.getByText(/This run is a deliberate-practice retry/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/rewindOf:/i)).toBeVisible();
  });

  test('Case 2 (ards-vent-01 unsafe & delayed path): DecisionReview verdicts match Unsafe Action and Delayed Action', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?case=ards-vent-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);
    await answerPredictionIfVisible(page, { numeric: '66' });

    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();
    await page.getByRole('button', { name: '+5 min' }).click();

    // Unsafe high Vt (680 mL)
    await setVentSetting(page, 'control-vt', '680');
    await page.getByTestId('assessment-option-uncertain').click();
    await page.getByTestId('confidence-option-guess').click();
    await page.getByTestId('commit-button').click();
    await answerPredictionIfVisible(page, { direction: 'same' });

    // Wait 5 min, then cut Vt to 380 WITHOUT raising RR (stays 16 -> acidosis develops)
    await page.getByRole('button', { name: '+5 min' }).click();
    await setVentSetting(page, 'control-vt', '380');
    await answerPredictionIfVisible(page, { direction: 'same' });
    await page.getByRole('button', { name: '+30 min' }).click();
    await answerPredictionIfVisible(page);

    await page.getByRole('button', { name: /Stop case|Go to debrief/i }).click();
    await expect(page.getByTestId('debrief-screen')).toBeVisible({ timeout: 15000 });

    const drSection = page.locator('section[aria-labelledby="decision-review-heading"]');
    await expect(drSection).toContainText('Unsafe Action');
    await expect(drSection).toContainText('Delayed Action');
    // Expand decision #2 (Vt 380) and verify exact ruleId ARDS-01-RR-COMPENSATION-DELAYED
    await drSection.getByText('Titrated: Vt 380 mL').click();
    await expect(drSection).toContainText('ARDS-01-RR-COMPENSATION-DELAYED');
  });

  test('Case 3 (vent-high-pressure-01): Rescue actions (suction, disconnect, FiO2 1.0, needle-decompression) are NEVER gated or confirmed even at guided level', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?case=vent-high-pressure-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Trigger tension pneumothorax crisis at +5 min
    await page.getByRole('button', { name: '+5 min' }).click();
    await page.getByRole('tab', { name: 'Orders' }).click();

    // Test ALL rescue actions BEFORE any CommitSheet has been completed:
    // 1. Suction
    await page.getByRole('button', { name: 'Suction tube' }).click();
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);

    // 2. Disconnect ventilator
    await page.getByRole('button', { name: 'Disconnect from ventilator' }).click();
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);

    // 3. FiO2 1.0 (100%)
    await setVentSetting(page, 'control-fio2', '100');
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);

    // 4. Needle decompression (rescue AND irreversible — must NOT open CommitSheet OR Confirm modal!)
    await page.getByRole('button', { name: 'Needle decompression' }).click();
    await expect(page.getByTestId('commit-sheet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Confirm' })).toHaveCount(0);

    // Answer prediction triggered by needle decompression
    await answerPredictionIfVisible(page, { direction: 'up' });

    await page.getByRole('button', { name: '+15 min' }).click();
    await expect(page.getByRole('button', { name: 'Go to debrief' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Go to debrief' }).click();

    // The decision review now sits inside the collapsed "Details" block of the debrief
    await page.getByTestId('debrief-details').locator('summary').click();
    const drSection = page.locator('section[aria-labelledby="decision-review-heading"]');
    await expect(drSection).toBeVisible({ timeout: 10000 });
    await expect(drSection.getByText('Rescue').first()).toBeVisible();
    await expect(drSection).toContainText('Sound Process');
  });

  test('Case 4 (copd-niv-01 + entrustment): Assessment revision, Tier 1 promotion, and proof that run count alone cannot promote entrustment', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?case=copd-niv-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Switch device to NIV -> CommitSheet appears
    await page.getByRole('button', { name: /^Device:/ }).click();
    await page.getByRole('region', { name: 'Choose device' }).getByRole('button', { name: 'NIV' }).click();
    await page.getByTestId('control-apply').click();

    await expect(page.getByTestId('commit-sheet')).toBeVisible();
    await page.getByTestId('assessment-option-uncertain').click();
    await page.getByTestId('confidence-option-guess').click();
    await page.getByTestId('commit-button').click();

    await answerPredictionIfVisible(page, { direction: 'down' });

    // Revise working assessment via header button
    await page.getByRole('button', { name: /Working assessment: 1 chosen \(Revise\)/i }).click();
    await expect(page.getByTestId('commit-sheet')).toBeVisible();
    await page.getByTestId('assessment-option-hypercapnic_failure').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();

    // Orders: bronchodilator + 2 ABGs, advance until improved
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Bronchodilator' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();
    await page.getByRole('button', { name: '+30 min' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();

    for (let i = 0; i < 4; i++) {
      const goDebrief = page.getByRole('button', { name: 'Go to debrief' });
      if (await goDebrief.isVisible().catch(() => false)) break;
      await answerPredictionIfVisible(page);
      const skip30 = page.getByRole('button', { name: '+30 min' });
      if (await skip30.isEnabled().catch(() => false)) {
        await skip30.click();
      }
    }
    await expect(page.getByRole('button', { name: 'Go to debrief' })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Go to debrief' }).click();
    await expect(page.getByTestId('debrief-screen')).toBeVisible({ timeout: 10000 });

    // Navigate to Progress -> Tier 1 entrustment should now be Supervised
    await page.getByTestId('tab-progress').click();
    const entrustmentSec = page.locator('section[aria-labelledby="heading-entrustment"]');
    await expect(entrustmentSec).toContainText('Supervised');

    // Now seed 15 consecutive clean 'guided' Tier 1 runs and verify entrustment CANNOT rise past Supervised
    await page.evaluate(async () => {
      const learner = (window as any).__ovsLearner;
      const events: any[] = [];
      for (let i = 1; i <= 15; i++) {
        const runId = `guided-spam-${i}`;
        const t = new Date(Date.UTC(2026, 10, 1, i, 0, 0)).toISOString();
        events.push({
          v: 1, id: `gs-s-${i}`, wallTime: t, sessionId: 'spam', runId,
          activity: 'case', activityId: 'copd-niv-01', type: 'run_start',
          guidanceByCompetency: { 'niv.selection': 'guided', 'niv.titration': 'guided' },
        });
        events.push({
          v: 1, id: `gs-e-${i}`, wallTime: t, sessionId: 'spam', runId,
          activity: 'case', activityId: 'copd-niv-01', type: 'run_end',
          outcome: 'improved', score: 9, maxScore: 9,
        });
      }
      await learner.importJson(JSON.stringify({
        format: 'ovs-learner', version: 1, exportedAt: '2026-11-10T00:00:00Z', events,
      }));
    });
    await page.goto('/?view=progress#/trainer');
    await expect(page.getByTestId('progress-view')).toBeVisible({ timeout: 10000 });
    const tier1Status = page.getByTestId('entrustment-tier-status-1');
    await expect(tier1Status).toHaveText('Supervised');
    expect(await tier1Status.textContent()).not.toBe('Indirect');
    expect(await tier1Status.textContent()).not.toBe('Independent');
  });

  test('Case 5 (pneumonia-hfnc-01): HFNC escalation, delayed intubation, lung-protective Vt, and DecisionReview verdicts', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?case=pneumonia-hfnc-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Switch device to HFNC
    await page.getByRole('button', { name: /^Device:/ }).click();
    await page.getByRole('region', { name: 'Choose device' }).getByRole('button', { name: /High-flow|HFNC/i }).click();
    await page.getByTestId('control-apply').click();
    await page.getByTestId('assessment-option-hypoxaemic_failure').click();
    await page.getByTestId('confidence-option-fairly_sure').click();
    await page.getByTestId('commit-button').click();
    await answerPredictionIfVisible(page, { direction: 'up' });

    // Advance > 30 sim-min then intubate -> Delayed Action rule triggers
    await page.getByRole('button', { name: '+30 min' }).click();
    await page.getByRole('button', { name: '+5 min' }).click();
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Intubate' }).click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    // Set lung-protective Vt 330 mL (<= 6.5 mL/kg PBW) & PEEP 10
    await setVentSetting(page, 'control-vt', '330');
    await setVentSetting(page, 'control-peep', '10');
    await page.getByRole('button', { name: '+30 min' }).click();
    await page.getByRole('button', { name: /Go to debrief|Stop case/i }).click();

    // The decision review now sits inside the collapsed "Details" block of the debrief
    await page.getByTestId('debrief-details').locator('summary').click();
    const drSection = page.locator('section[aria-labelledby="decision-review-heading"]');
    await expect(drSection).toBeVisible({ timeout: 10000 });
    await expect(drSection).toContainText('Reasonable Under Uncertainty');
    await expect(drSection).toContainText('Delayed Action');
    await expect(drSection).toContainText('Sound Process');
    await expect(page.getByTestId('decision-review-mode-badge')).toHaveText('Attending Reference Case');
    await expect(page.getByText('One reasonable approach')).toBeVisible();
  });

  test('Case 6 (Disguised Variant via Suggested Next): Leitner overdue mistake surfaces variant and plays end-to-end', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/#/trainer?view=cases');
    await expect(page.getByRole('heading', { name: 'Case Library' })).toBeVisible({ timeout: 10000 });

    // Seed an overdue knowledge_gap mistake on disease.ards (5 days ago -> Box 1 1d overdue)
    await page.evaluate(async () => {
      const learner = (window as any).__ovsLearner;
      const past = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
      const events = [
        {
          v: 1, id: 'var-s', wallTime: past, sessionId: 'v-sess', runId: 'run-ards-old',
          activity: 'case', activityId: 'ards-vent-01', type: 'run_start',
          guidanceByCompetency: { 'disease.ards': 'prompted' },
        },
        {
          v: 1, id: 'var-m', wallTime: past, sessionId: 'v-sess', runId: 'run-ards-old',
          activity: 'case', activityId: 'ards-vent-01', simTimeSec: 1800,
          type: 'mistake', mistake: 'knowledge_gap', competency: 'disease.ards', severity: 'major',
          detail: 'High Vt set by actual weight instead of PBW',
        },
        {
          v: 1, id: 'var-e', wallTime: past, sessionId: 'v-sess', runId: 'run-ards-old',
          activity: 'case', activityId: 'ards-vent-01', simTimeSec: 3600,
          type: 'run_end', outcome: 'deteriorated', score: 3, maxScore: 10,
        },
      ];
      await learner.importJson(JSON.stringify({
        format: 'ovs-learner', version: 1, exportedAt: new Date().toISOString(), events,
      }));
    });

    await page.reload();
    await page.getByTestId('tab-cases').click();

    // Suggested Next should pick the disguised short-female PBW variant without spoiling "knowledge_gap" or "ARDS"
    const suggestedCard = page.getByTestId('suggested-next-card');
    await expect(suggestedCard).toBeVisible();
    await expect(suggestedCard).toContainText('Severe hypoxaemia transferred on fixed ED ventilator settings');
    await expect(suggestedCard).not.toContainText('knowledge_gap');
    await expect(suggestedCard).not.toContainText('pbw-short-female');

    // Launch variant directly from Suggested Next
    await suggestedCard.getByRole('button', { name: /Start Suggested/i }).click();
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Mrs E. Davies (synthetic)' })).toBeVisible();
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Answer variant PBW (45 kg for 152 cm female)
    await answerPredictionIfVisible(page, { numeric: '45' });

    // Apply protective settings for 45 kg PBW (VT 270 mL, RR 26, PEEP 12) + CommitSheet
    await setVentSetting(page, 'control-vt', '270');
    await expect(page.getByTestId('commit-sheet')).toBeVisible();
    await page.getByTestId('assessment-option-low_compliance').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();
    await answerPredictionIfVisible(page, { direction: 'up' });

    await setVentSetting(page, 'control-rr', '26');
    await setVentSetting(page, 'control-peep', '12');

    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Prone position' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();
    await page.getByRole('button', { name: '+30 min' }).click();
    await page.getByRole('button', { name: 'Arterial blood gas' }).click();

    for (let i = 0; i < 6; i++) {
      const goDebrief = page.getByRole('button', { name: 'Go to debrief' });
      if (await goDebrief.isVisible().catch(() => false)) break;
      await answerPredictionIfVisible(page);
      const skip30 = page.getByRole('button', { name: '+30 min' });
      if (await skip30.isEnabled().catch(() => false)) {
        await skip30.click();
      }
    }

    await page.getByRole('button', { name: /Go to debrief|Stop case/i }).click();
    await expect(page.getByTestId('debrief-screen')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Mrs E\. Davies \(synthetic\)/).first()).toBeVisible();
  });
});
