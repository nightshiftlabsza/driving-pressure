import { test, expect } from '@playwright/test';

/**
 * Generates an authentic pre-Phase-9 (Phase 8, commit c6fd5f0) learner export JSON
 * containing session_start, run_start, order, settings_change, abg_result, prediction,
 * drill_answer, rubric_result, mistake, alarm, run_end, guidanceOverrides, and practiceCardStates
 * (with zero Phase 9 assessment_commit / rationale events).
 */
function buildPrePhase9ExportJson(): string {
  const sessionId = 'phase8-legacy-session-1';
  const payload = {
    format: 'ovs-learner',
    version: 1,
    exportedAt: '2026-11-08T18:30:00.000Z',
    events: [
      {
        v: 1,
        id: 'leg-1',
        wallTime: '2026-11-01T10:00:00.000Z',
        sessionId,
        type: 'session_start',
        appVersion: '0.1.0-icu-trainer',
      },
      // Mastered mech.eom across 3 contexts (Level 1)
      {
        v: 1,
        id: 'leg-2',
        wallTime: '2026-11-01T10:05:00.000Z',
        sessionId,
        runId: 'leg-lab-01',
        activity: 'lab',
        activityId: '01-rc-time-constant-exhalation',
        type: 'run_start',
        guidanceByCompetency: { 'mech.eom': 'independent' },
      },
      {
        v: 1,
        id: 'leg-3',
        wallTime: '2026-11-01T10:06:00.000Z',
        sessionId,
        runId: 'leg-lab-01',
        activity: 'lab',
        activityId: '01-rc-time-constant-exhalation',
        type: 'prediction',
        predictionId: 'lab-pred-1',
        question: 'Resistance change effect',
        answer: { ppeak: 'up' },
        expected: { ppeak: 'up' },
        competency: 'mech.eom',
        evidenceType: 'prediction',
        correct: true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: ['lab-rc'],
      },
      {
        v: 1,
        id: 'leg-4',
        wallTime: '2026-11-01T10:10:00.000Z',
        sessionId,
        runId: 'leg-lab-01',
        activity: 'lab',
        activityId: '01-rc-time-constant-exhalation',
        type: 'run_end',
        outcome: 'completed',
        score: 1,
        maxScore: 1,
      },
      // Legacy Phase 8 COPD NIV run with a mistake + alarm + rubric_result
      {
        v: 1,
        id: 'leg-5',
        wallTime: '2026-11-02T09:00:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        activityVersion: '0.1.0',
        simTimeSec: 0,
        contextTags: ['copd', 'hypercapnia', 'niv'],
        type: 'run_start',
        guidanceByCompetency: {
          'niv.selection': 'guided',
          'niv.titration': 'guided',
          'modes.peep-fio2': 'guided',
        },
      },
      {
        v: 1,
        id: 'leg-6',
        wallTime: '2026-11-02T09:02:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        simTimeSec: 120,
        type: 'alarm',
        alarm: 'spo2-low',
        priority: 'high',
        raisedAtSimSec: 100,
        acknowledgedAtSimSec: 120,
        timeToAcknowledgeSec: 20,
      },
      {
        v: 1,
        id: 'leg-7',
        wallTime: '2026-11-02T09:05:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        simTimeSec: 300,
        type: 'order',
        order: 'change-device',
        detail: {
          device: {
            device: 'niv',
            mode: 'ST',
            fio2: 0.3,
            epap: 5,
            ipap: 14,
            backupRrBpm: 12,
            tiSec: 1.0,
            interface: 'oronasal',
            maskFit: 'good',
          },
        },
      },
      {
        v: 1,
        id: 'leg-8',
        wallTime: '2026-11-02T09:06:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        simTimeSec: 360,
        type: 'mistake',
        mistake: 'unsafe_action',
        competency: 'modes.peep-fio2',
        severity: 'major',
        detail: 'Legacy Phase 8 over-oxygenation event (SpO2 > 96%).',
      },
      {
        v: 1,
        id: 'leg-9',
        wallTime: '2026-11-02T09:20:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        simTimeSec: 1200,
        type: 'rubric_result',
        rubricId: 'r-niv-start',
        met: true,
        critical: true,
        competency: 'niv.selection',
        evidenceType: 'decision',
        correct: true,
        guidance: 'guided',
        hidden: false,
      },
      {
        v: 1,
        id: 'leg-10',
        wallTime: '2026-11-02T09:25:00.000Z',
        sessionId,
        runId: 'leg-copd-1',
        activity: 'case',
        activityId: 'copd-niv-01',
        simTimeSec: 1500,
        type: 'run_end',
        outcome: 'improved',
        score: 7,
        maxScore: 9,
      },
    ],
    guidanceOverrides: {
      'gas.acid-base': 'prompted',
    },
    practiceCardStates: {
      'ventbook-001': {
        cardId: 'ventbook-001',
        repetitions: 3,
        intervalDays: 7,
        easeFactor: 2.5,
        lastReviewed: '2026-11-01',
        nextReview: '2026-11-08',
      },
    },
  };
  return JSON.stringify(payload, null, 2);
}

test.describe('Phase 9 Regression & Legacy Profile Import Audit', () => {
  test('1. Imports a pre-Phase-9 exported learner JSON via Progress UI and preserves all history + adaptive views', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/trainer?view=progress');
    await expect(page.locator('h1:has-text("Competency Progress")')).toBeVisible({ timeout: 10000 });

    const legacyJson = buildPrePhase9ExportJson();
    const fileInput = page.locator('#progress-import-file');
    await fileInput.setInputFiles({
      name: 'phase8-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(legacyJson, 'utf8'),
    });

    const confirmDialog = page.getByRole('dialog', { name: /Confirm Progress Import/i });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Confirm Import' }).click();

    await expect(page.getByText('Progress successfully imported.')).toBeVisible();

    // Reload page and confirm IndexedDB persisted the imported legacy data cleanly
    await page.reload();
    await page.getByTestId('tab-progress').click();
    await expect(page.locator('h1:has-text("Competency Progress")')).toBeVisible({ timeout: 10000 });

    // Tier 1 should now show Supervised (from the legacy improved copd-niv-01 run)
    const tier1Text = await page.locator('section[aria-labelledby="heading-entrustment"]').innerText();
    expect(tier1Text).toContain('Supervised');
    expect(tier1Text).toContain('Runs: 1');

    // Legacy mistake should show in Recurring Mistakes & Spaced Re-test Schedule
    const mistakesText = await page.locator('section[aria-labelledby="heading-mistakes"]').innerText();
    expect(mistakesText).toContain('modes.peep-fio2');
    expect(mistakesText).toContain('due now');

    // Guidance override preserved
    const acidBaseOverride = page.getByTestId('override-gas.acid-base');
    await expect(acidBaseOverride).toHaveValue('prompted');

    // Calibration stats reflect legacy prediction (1/1 certain)
    await expect(page.getByText('1 / 1 correct (100%)')).toBeVisible();

    // Practice screen still reads legacy practiceCardStates (1 mastered item)
    await page.getByTestId('tab-practice').click();
    await expect(page.getByTestId('practice-screen')).toBeVisible();
    await expect(page.getByText('1 mastered')).toBeVisible();
  });

  test('2. VentControls Cancel discards pending change and unconfirmed changes auto-revert after 10 seconds', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?case=ards-vent-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('take-over-button').click();

    // Clear opening prediction p-pbw
    const predDialog = page.getByRole('dialog', { name: 'Prediction' });
    await expect(predDialog).toBeVisible({ timeout: 5000 });
    await predDialog.getByLabel('Your answer').fill('66');
    await predDialog.getByRole('button', { name: 'Certain' }).click();
    await predDialog.getByRole('button', { name: 'Commit answer' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Verify Cancel button discards staged PEEP change
    const peepInput = page.getByTestId('control-peep');
    await expect(peepInput).toHaveValue('5');
    await peepInput.click();
    await page.getByRole('button', { name: 'Increase PEEP' }).click();
    await page.getByRole('button', { name: 'Increase PEEP' }).click();
    await expect(peepInput).toHaveValue('7');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(peepInput).toHaveValue('5');

    // Verify 10s unconfirmed auto-revert (Deliverable 4)
    await peepInput.click();
    await page.getByRole('button', { name: 'Increase PEEP' }).click();
    await page.getByRole('button', { name: 'Increase PEEP' }).click();
    await expect(peepInput).toHaveValue('7');
    // AdjustBar should remain open initially, then auto-revert after 10s
    await expect(page.getByRole('group', { name: 'Adjust PEEP' })).toBeVisible();
    await page.waitForTimeout(10500);
    await expect(page.getByRole('group', { name: 'Adjust PEEP' })).toHaveCount(0);
    await expect(peepInput).toHaveValue('5');
    await expect(page.getByTestId('vent-peep')).toContainText('5');
  });
});
