import { test, expect } from '@playwright/test';

function generateLevel1MasteredPayload(): string {
  const level1Comps = ['mech.eom', 'modes.vc-vs-pc', 'mech.res-vs-comp', 'wave.normal'];
  const events: any[] = [];
  const sessionId = 'seed-p1-session';
  let counter = 5000;

  events.push({
    v: 1,
    id: `ev-${counter++}`,
    wallTime: '2026-11-01T08:00:00.000Z',
    sessionId,
    type: 'session_start',
    appVersion: '0.1.0-icu-trainer',
  });

  // Provide 3 independent correct evidence items per competency to reach 'mastered' status
  for (const compId of level1Comps) {
    for (let c = 1; c <= 3; c++) {
      events.push({
        v: 1,
        id: `ev-${counter++}`,
        wallTime: `2026-11-0${c + 1}T09:00:00.000Z`,
        sessionId,
        type: 'prediction',
        predictionId: `pred-${compId}-${c}`,
        question: `Question on ${compId}`,
        answer: 'correct',
        expected: 'correct',
        competency: compId,
        evidenceType: 'prediction',
        correct: true,
        confidence: 'certain',
        guidance: 'independent',
        hidden: false,
        contextTags: [`context-${compId}-${c}`],
      });
    }
  }

  // Complete runs for Level 1 labs
  const l1Labs = [
    '03-peep-vs-pplat',
    '02-vc-vs-pc-compliance',
    '01-rc-time-constant-exhalation',
    '10-ps-level-vs-vt-rr',
  ];
  for (const labId of l1Labs) {
    const runId = `run-${labId}`;
    events.push({
      v: 1,
      id: `ev-${counter++}`,
      wallTime: '2026-11-04T10:00:00.000Z',
      sessionId,
      runId,
      activity: 'lab',
      activityId: labId,
      activityVersion: '0.1.0',
      type: 'run_start',
    });
    events.push({
      v: 1,
      id: `ev-${counter++}`,
      wallTime: '2026-11-04T10:15:00.000Z',
      sessionId,
      runId,
      activity: 'lab',
      activityId: labId,
      activityVersion: '0.1.0',
      type: 'run_end',
      outcome: 'completed',
      score: 3,
      maxScore: 3,
    });
  }

  // Level 1 now also lists two cases (ards-vent-01, apo-cpap-01); finish those too
  for (const caseId of ['ards-vent-01', 'apo-cpap-01']) {
    const runId = `run-${caseId}`;
    events.push({
      v: 1,
      id: `ev-${counter++}`,
      wallTime: '2026-11-04T11:00:00.000Z',
      sessionId,
      runId,
      activity: 'case',
      activityId: caseId,
      activityVersion: '0.1.0',
      type: 'run_start',
    });
    events.push({
      v: 1,
      id: `ev-${counter++}`,
      wallTime: '2026-11-04T11:20:00.000Z',
      sessionId,
      runId,
      activity: 'case',
      activityId: caseId,
      activityVersion: '0.1.0',
      type: 'run_end',
      outcome: 'completed',
      score: 3,
      maxScore: 3,
    });
  }

  // Complete run for waveforms drill
  events.push({
    v: 1,
    id: `ev-${counter++}`,
    wallTime: '2026-11-04T13:00:00.000Z',
    sessionId,
    runId: 'run-waveforms',
    activity: 'drill',
    activityId: 'waveforms',
    type: 'run_start',
    guidanceByCompetency: {},
  });
  events.push({
    v: 1,
    id: `ev-${counter++}`,
    wallTime: '2026-11-04T13:10:00.000Z',
    sessionId,
    runId: 'run-waveforms',
    activity: 'drill',
    activityId: 'waveforms',
    type: 'run_end',
    outcome: 'completed',
  });

  return JSON.stringify({
    format: 'ovs-learner',
    version: 1,
    exportedAt: '2026-11-07T12:00:00.000Z',
    events,
  });
}

test.describe('Curriculum Learning Pathway E2E', () => {
  test('New learner first session: Level 1 is unlocked, Level 2-4 are locked, override toggle works', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/legacy');

    const trainerBtn = page.getByRole('button', { name: /ICU Respiratory Trainer/i });
    await expect(trainerBtn).toBeVisible({ timeout: 10000 });
    await trainerBtn.click();

    // Navigate to Home tab
    const homeTab = page.getByTestId('tab-home');
    await expect(homeTab).toBeVisible({ timeout: 10000 });
    await homeTab.click();

    // Verify Pathway Home is loaded
    await expect(page.getByTestId('pathway-home')).toBeVisible({ timeout: 10000 });

    // Level 1 should be active and unlocked (no 🔒 Locked badge)
    const l1 = page.getByTestId('pathway-level-1');
    await expect(l1).toBeVisible();
    await expect(l1.getByText('Active', { exact: true })).toBeVisible();
    await expect(l1.getByText('🔒 Locked')).toHaveCount(0);

    // Level 2 should be locked
    const l2 = page.getByTestId('pathway-level-2');
    await expect(l2).toBeVisible();
    await expect(l2.getByText('🔒 Locked').first()).toBeVisible();

    // Recommended activity card should be visible
    const recCard = page.getByTestId('home-recommended-card');
    await expect(recCard).toBeVisible();
    await expect(recCard.getByText('Recommended Next')).toBeVisible();

    // Test override toggle: "Browse mode (unlock all)"
    const overrideToggle = page.getByTestId('toggle-browse-mode');
    await expect(overrideToggle).toBeVisible();
    await overrideToggle.click();

    // Now Level 2 should NOT be locked (unlocked via override)
    await expect(l2.getByText('🔒 Locked')).toHaveCount(0);

    // Uncheck override to restore locked state
    await overrideToggle.click();
    await expect(l2.getByText('🔒 Locked').first()).toBeVisible();
  });

  test('Natural progression: mastering Level 1 competencies unlocks Level 2', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/legacy');

    const trainerBtn = page.getByRole('button', { name: /ICU Respiratory Trainer/i });
    await expect(trainerBtn).toBeVisible({ timeout: 10000 });
    await trainerBtn.click();

    const homeTab = page.getByTestId('tab-home');
    await expect(homeTab).toBeVisible({ timeout: 10000 });
    await homeTab.click();
    await expect(page.getByTestId('pathway-home')).toBeVisible({ timeout: 10000 });

    // Seed Level 1 mastered learner data
    const payload = generateLevel1MasteredPayload();
    await page.evaluate(async (jsonStr) => {
      const learner = (window as any).__ovsLearner;
      if (learner && learner.importJson) {
        await learner.importJson(jsonStr);
      }
    }, payload);

    // Refresh page to load new learner data
    await page.reload();
    await page.getByTestId('tab-home').click();
    await expect(page.getByTestId('pathway-home')).toBeVisible({ timeout: 10000 });

    // Level 1 should show completed status
    // (Level 2 is now the current level, so Level 1 starts collapsed: expand it first)
    await page.getByTestId('pathway-level-toggle-1').click();
    const l1 = page.getByTestId('pathway-level-1');
    await expect(l1).toBeVisible();
    await expect(l1.getByText('✓ Completed')).toBeVisible();

    // Level 2 should now be naturally unlocked and active without override
    const l2 = page.getByTestId('pathway-level-2');
    await expect(l2).toBeVisible();
    await expect(l2.getByText('Active', { exact: true })).toBeVisible();
  });
});
