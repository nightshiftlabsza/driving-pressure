import { test, expect } from '@playwright/test';

test.describe('Physiology Lab end-to-end user journeys', () => {
  test('plays Experiment 01 (mechanics, non-rule-based) end-to-end with strict anti-spoon-feeding locking', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto('/#/legacy');

    // 1. Navigate from start screen to ICU Respiratory Trainer
    const startBtn = page.getByRole('button', { name: /ICU Respiratory Trainer/i });
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 2. Click the Lab tab
    const labTab = page.getByTestId('tab-lab');
    await expect(labTab).toBeVisible();
    await labTab.click();

    // 3. Catalog must be visible
    const labList = page.getByTestId('lab-experiment-list');
    await expect(labList).toBeVisible();

    // 4. Select Experiment 01 card
    const exp1Card = page.getByTestId('lab-card-01-rc-time-constant-exhalation');
    await exp1Card.scrollIntoViewIfNeeded();
    await expect(exp1Card).toBeVisible();
    // Experiment 01 is not rule-based; should NOT have a rule-based badge
    await expect(exp1Card.getByTestId('lab-rule-based-badge')).toHaveCount(0);

    await exp1Card.getByRole('button', { name: /Start Experiment/i }).click();

    const runner = page.getByTestId('lab-runner');
    await expect(runner).toBeVisible();

    // Verify stage 1 badge
    await expect(page.getByTestId('lab-stage-badge')).toContainText('1. Baseline & Predict');

    // 5. Pre-commit state verification
    // - Hint is visible and does NOT give away the answer
    const hint = page.getByTestId('lab-what-to-look-at');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('What to look at:');
    await expect(hint).toContainText('expiratory flow waveform');

    // - Commit button is disabled
    const commitBtn = page.getByTestId('lab-commit-btn');
    await expect(commitBtn).toBeVisible();
    await expect(commitBtn).toBeDisabled();

    // - Before/After table is NOT in the DOM
    await expect(page.getByTestId('lab-before-after-table')).toHaveCount(0);

    // - Reflection panel is NOT in the DOM
    await expect(page.getByTestId('lab-reflection-panel')).toHaveCount(0);

    // - "Why" view is strictly locked: lab-why-locked visible, lab-why-view has count 0
    await expect(page.getByTestId('lab-why-locked')).toBeVisible();
    await expect(page.getByTestId('lab-why-view')).toHaveCount(0);

    // Clicking the why button scrolls to anchor, but Why trace remains locked
    await page.getByTestId('lab-why-open-btn').click();
    await expect(page.getByTestId('lab-why-locked')).toBeVisible();
    await expect(page.getByTestId('lab-why-view')).toHaveCount(0);

    // 6. Select predictions
    // If only predictions are selected without confidence, commit button MUST remain disabled
    const predictionPanel = page.getByTestId('lab-prediction-panel');
    const increaseBtns = predictionPanel.getByRole('button', { name: /Increase/i });
    const metricCount = await increaseBtns.count();
    expect(metricCount).toBe(3); // autoPeep, endExpFlow, ppeak

    for (let i = 0; i < metricCount; i++) {
      await increaseBtns.nth(i).click();
    }
    await expect(commitBtn).toBeDisabled();

    // Select confidence level: Fairly sure
    await page.getByTestId('lab-confidence-fairly_sure').click();
    await expect(commitBtn).toBeEnabled();

    // 7. Commit prediction
    await commitBtn.click();

    // 8. Observe stage verification
    await expect(page.getByTestId('lab-stage-badge')).toContainText('2. Apply & Observe');

    // Before/After table is now in the DOM and visible
    const table = page.getByTestId('lab-before-after-table');
    await expect(table).toBeVisible();

    // Check table column headers
    await expect(table.locator('th')).toContainText([
      'Metric',
      'Baseline',
      'After',
      'Actual',
      'Predicted',
      'Result',
    ]);

    // Table rows check
    await expect(table.locator('tbody tr')).toHaveCount(3);

    // "Why" view stays locked during Observe until reflection is submitted
    await expect(page.getByTestId('lab-why-locked')).toBeVisible();
    await expect(page.getByTestId('lab-why-view')).toHaveCount(0);

    // 9. Reflection stage
    const reflectionPanel = page.getByTestId('lab-reflection-panel');
    await expect(reflectionPanel).toBeVisible();

    // Select correct reflection option (opt-a: RC time constant)
    const optA = page.getByTestId('lab-reflection-opt-opt-a');
    await expect(optA).toBeVisible();
    await optA.click();

    // Submit reflection
    const submitReflectionBtn = page.getByTestId('lab-reflection-submit');
    await expect(submitReflectionBtn).toBeEnabled();
    await submitReflectionBtn.click();

    // Explanation should appear with physiological analysis
    await expect(page.getByTestId('lab-stage-badge')).toContainText('3. Reflection & Synthesis');
    await expect(reflectionPanel).toContainText('Correct Analysis');
    await expect(reflectionPanel).toContainText('RC = R_exp × C_rs');

    // "Why" view now unlocks: locked message gone, why view visible
    await expect(page.getByTestId('lab-why-locked')).toHaveCount(0);
    const whyView = page.getByTestId('lab-why-view');
    await expect(whyView).toBeVisible();

    // Verify causal trace nodes in why view
    await expect(page.getByTestId('lab-why-node-expResistance')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-timeConstant')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-endExpFlow')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-trappedVolume')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-autoPeep')).toBeVisible();

    // 10. Navigate back to experiment list
    await page.getByTestId('lab-back-btn').click();
    await expect(page.getByTestId('lab-experiment-list')).toBeVisible();
  });

  test('plays Experiment 13 (rule-based hemodynamic PPV) end-to-end and verifies rule-based badges', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1536, height: 864 });
    await page.goto('/#/legacy');

    // 1. Navigate to Lab tab
    await page.getByRole('button', { name: /ICU Respiratory Trainer/i }).click();
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-experiment-list')).toBeVisible();

    // 2. Verify Rule-Based badge on Experiment 13 card
    const exp13Card = page.getByTestId('lab-card-13-ppv-vs-bp-preload-dependent');
    await exp13Card.scrollIntoViewIfNeeded();
    await expect(exp13Card).toBeVisible();

    const cardBadge = exp13Card.getByTestId('lab-rule-based-badge');
    await expect(cardBadge).toBeVisible();
    await expect(cardBadge).toContainText('Rule-based');

    // 3. Open Experiment 13
    await exp13Card.getByRole('button', { name: /Start Experiment/i }).click();
    const runner = page.getByTestId('lab-runner');
    await expect(runner).toBeVisible();

    // Verify Rule-Based badge in runner top bar
    const runnerHeaderBadge = runner.locator('.flex.items-center.gap-2').getByTestId('lab-rule-based-badge');
    await expect(runnerHeaderBadge).toBeVisible();
    await expect(runnerHeaderBadge).toContainText('Rule-based');

    // 4. Verify Pre-commit state
    const hint = page.getByTestId('lab-what-to-look-at');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('mean airway pressure');

    const commitBtn = page.getByTestId('lab-commit-btn');
    await expect(commitBtn).toBeDisabled();
    await expect(page.getByTestId('lab-before-after-table')).toHaveCount(0);
    await expect(page.getByTestId('lab-reflection-panel')).toHaveCount(0);
    await expect(page.getByTestId('lab-why-locked')).toBeVisible();
    await expect(page.getByTestId('lab-why-view')).toHaveCount(0);

    // 5. Select predictions:
    // Metric 1: pmean -> Increase
    // Metric 2: sbp -> Decrease
    // Metric 3: hr -> Increase
    const predictionPanel = page.getByTestId('lab-prediction-panel');
    const pmeanUp = predictionPanel.getByRole('button', { name: /Increase/i }).nth(0);
    const sbpDown = predictionPanel.getByRole('button', { name: /Decrease/i }).nth(1);
    const hrUp = predictionPanel.getByRole('button', { name: /Increase/i }).nth(2);

    await pmeanUp.click();
    await sbpDown.click();
    await hrUp.click();

    // Select confidence level: Certain
    await page.getByTestId('lab-confidence-certain').click();
    await expect(commitBtn).toBeEnabled();

    // 6. Commit prediction & observe
    await commitBtn.click();

    // Before/After table is visible with all columns
    const table = page.getByTestId('lab-before-after-table');
    await expect(table).toBeVisible();
    await expect(table.locator('th')).toContainText([
      'Metric',
      'Baseline',
      'After',
      'Actual',
      'Predicted',
      'Result',
    ]);

    // Causal "Why" view stays locked during Observe until reflection is submitted
    await expect(page.getByTestId('lab-why-locked')).toBeVisible();
    await expect(page.getByTestId('lab-why-view')).toHaveCount(0);

    // 7. Complete Reflection stage
    const reflectionPanel = page.getByTestId('lab-reflection-panel');
    await expect(reflectionPanel).toBeVisible();

    const optPreload = page.getByTestId('lab-reflection-opt-opt-preload-impedance');
    await expect(optPreload).toBeVisible();
    await optPreload.click();

    const submitReflectionBtn = page.getByTestId('lab-reflection-submit');
    await expect(submitReflectionBtn).toBeEnabled();
    await submitReflectionBtn.click();

    // Explanation appears with venous return reasoning and rule-based note
    await expect(reflectionPanel).toContainText('Correct Analysis');
    await expect(reflectionPanel).toContainText('venous return');
    await expect(reflectionPanel).toContainText('Rule-based note:');

    // Causal "Why" view unlocks
    await expect(page.getByTestId('lab-why-locked')).toHaveCount(0);
    const whyView = page.getByTestId('lab-why-view');
    await expect(whyView).toBeVisible();

    // Verify Rule-Based badge in WhyView header
    const whyHeaderBadge = whyView.getByTestId('lab-rule-based-badge').first();
    await expect(whyHeaderBadge).toBeVisible();
    await expect(whyHeaderBadge).toContainText('Rule-based approximation');

    // Verify causal trace chain nodes exist
    await expect(page.getByTestId('lab-why-node-setPeep')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-pmean')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-circulationMultiplier')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-map')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-sbp')).toBeVisible();
    await expect(page.getByTestId('lab-why-node-hr')).toBeVisible();

    // Check that rule-based node (e.g. circulationMultiplier) has the rule-based badge
    const circNode = page.getByTestId('lab-why-node-circulationMultiplier');
    await expect(circNode.getByTestId('lab-rule-based-badge')).toBeVisible();
    await expect(circNode).toContainText('Rule-based approximation');

    // 8. Return to catalog
    await page.getByTestId('lab-back-btn').click();
    await expect(page.getByTestId('lab-experiment-list')).toBeVisible();
  });
});
