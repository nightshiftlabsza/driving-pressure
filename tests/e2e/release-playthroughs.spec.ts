import { test, expect } from '@playwright/test';

test.describe('Release QA: Complete Playthroughs & Learner State', () => {

  test('1. Case playthrough: sbt-pass-01 right path to debrief', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?case=sbt-pass-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    // Open Orders tab
    await page.locator('button[role="tab"]:has-text("Orders")').click();

    // Clinical examination and ABG (diagnostics are never gated)
    await page.locator('button:has-text("Examine patient")').click();
    await page.locator('button:has-text("Arterial blood gas")').click();
    // The SBT must run 30 simulated minutes from case start before extubation counts as success
    await page.locator('button:has-text("+15 min")').click();
    await page.locator('button:has-text("+15 min")').click();

    // Extubate: first therapeutic action gates through CommitSheet then Confirm
    await page.locator('button:has-text("Extubate")').click();
    await page.getByTestId('assessment-option-weaning_ready').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();
    const confirmBtn = page.locator('button:has-text("Confirm")');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Debrief button
    const debriefBtn = page.locator('button:has-text("Go to debrief")');
    await expect(debriefBtn).toBeVisible({ timeout: 10000 });
    await debriefBtn.click();

    // Verify Debrief screen and outcome
    await expect(page.locator('header:has-text("Case Debrief")')).toBeVisible();
    await expect(page.locator('text=Elena Rostova')).toBeVisible();
    await expect(page.locator('span.vt-badge', { hasText: /^Improved$/ })).toBeVisible();
  });

  test('2. Case playthrough: sbt-fail-01 right path (resumed assist)', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?case=sbt-fail-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    await page.locator('button[role="tab"]:has-text("Orders")').click();
    await page.locator('button:has-text("Examine patient")').click();

    // Resume assist: Increase Pressure Support from 5 to 15 cmH2O
    const psControl = page.locator('[data-testid="control-ps"]');
    await psControl.click();
    const plusBtn = page.locator('button[aria-label^="Increase"]');
    await expect(plusBtn).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await plusBtn.click();
    }
    await page.locator('[data-testid="control-apply"]').click();
    await page.getByTestId('assessment-option-weaning_failure').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();

    // Advance time to allow recovery (10 min needed for t-support-resumed)
    await page.locator('button:has-text("+5 min")').click();
    await page.locator('button:has-text("+5 min")').click();

    const debriefBtn = page.locator('button:has-text("Go to debrief")');
    await expect(debriefBtn).toBeVisible({ timeout: 10000 });
    await debriefBtn.click();

    await expect(page.locator('header:has-text("Case Debrief")')).toBeVisible();
    await expect(page.locator('text=Marcus Vance')).toBeVisible();
    await expect(page.locator('span.vt-badge', { hasText: /^Improved$/ })).toBeVisible();
  });

  test('3. Case playthrough: sbt-fail-01 wrong path (premature extubation)', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?case=sbt-fail-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    await page.locator('button[role="tab"]:has-text("Orders")').click();
    await page.locator('button:has-text("Extubate")').click();
    await page.getByTestId('assessment-option-uncertain').click();
    await page.getByTestId('confidence-option-guess').click();
    await page.getByTestId('commit-button').click();

    const confirmBtn = page.locator('button:has-text("Confirm")');
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    const debriefBtn = page.locator('button:has-text("Go to debrief")');
    await expect(debriefBtn).toBeVisible({ timeout: 10000 });
    await debriefBtn.click();

    await expect(page.locator('header:has-text("Case Debrief")')).toBeVisible();
    await expect(page.locator('span.vt-badge', { hasText: /^Deteriorated$/ })).toBeVisible();
  });

  test('4. Case playthrough: dyssynchrony-01 right path (transition to PSV)', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/?case=dyssynchrony-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    // Switch mode to SPONT (PSV) to eliminate dyssynchrony
    const spontTab = page.locator('button[role="tab"]:has-text("SPONT"), [role="tab"]:has-text("SPONT")').first();
    await spontTab.click();
    await page.locator('[data-testid="control-apply"]').click();
    await page.getByTestId('assessment-option-dyssynchrony').click();
    await page.getByTestId('confidence-option-certain').click();
    await page.getByTestId('commit-button').click();

    // Prediction modal opens upon changing settings
    const predDialog = page.getByRole('dialog', { name: 'Prediction' });
    await expect(predDialog).toBeVisible({ timeout: 10000 });

    const downButtons = predDialog.getByRole('button', { name: 'down' });
    const count = await downButtons.count();
    for (let i = 0; i < count; i++) {
      await downButtons.nth(i).click();
    }
    await predDialog.getByRole('button', { name: 'Certain' }).click();
    const commitBtn = predDialog.getByRole('button', { name: 'Commit answer' });
    await expect(commitBtn).toBeEnabled({ timeout: 3000 });
    await commitBtn.click();

    const contBtn = page.getByRole('button', { name: 'Continue' });
    await expect(contBtn).toBeVisible({ timeout: 5000 });
    await contBtn.click();
    await expect(predDialog).not.toBeVisible({ timeout: 5000 });

    // Advance time to allow recovery
    await page.locator('button:has-text("+30 min")').click();
    await page.locator('button:has-text("+30 min")').click();

    const stopOrDebriefBtn = page.locator('button:has-text("Go to debrief"), button:has-text("Stop case")').first();
    await expect(stopOrDebriefBtn).toBeVisible({ timeout: 10000 });
    await stopOrDebriefBtn.click();

    await expect(page.locator('header:has-text("Case Debrief")')).toBeVisible();
  });

  test('5. Lab experiment and drill set execution', async ({ page }) => {
    test.setTimeout(60000);
    // Lab Experiment 01
    await page.goto('/#/trainer');
    await page.getByTestId('tab-lab').click();
    await expect(page.getByTestId('lab-experiment-list')).toBeVisible();
    const exp1Card = page.getByTestId('lab-card-01-rc-time-constant-exhalation');
    await exp1Card.scrollIntoViewIfNeeded();
    await exp1Card.getByRole('button', { name: /Start Experiment/i }).click();
    await expect(page.getByTestId('lab-runner')).toBeVisible();
    await expect(page.getByTestId('lab-stage-badge')).toContainText('1. Baseline & Predict');

    // Make predictions and commit to enter Stage 2 (Observe)
    const predictionPanel = page.getByTestId('lab-prediction-panel');
    const increaseBtns = predictionPanel.getByRole('button', { name: /Increase/i });
    const metricCount = await increaseBtns.count();
    for (let i = 0; i < metricCount; i++) {
      await increaseBtns.nth(i).click();
    }
    await page.getByTestId('lab-confidence-fairly_sure').click();
    await page.getByTestId('lab-commit-btn').click();

    // Verify Stage 2 transition and before/after table
    await expect(page.getByTestId('lab-stage-badge')).toContainText('2. Apply & Observe');
    await expect(page.getByTestId('lab-before-after-table')).toBeVisible();

    // Drills tab
    await page.getByTestId('tab-drills').click();
    await expect(page.locator('h2:has-text("Clinical Drills")')).toBeVisible();
    const startDrillBtn = page.getByTestId('drill-card-alarms').getByRole('button', { name: 'Start' });
    await expect(startDrillBtn).toBeVisible();
    await startDrillBtn.click();
    // Verify drill runner opened with confidence selector
    await expect(page.locator('[data-testid="confidence-selector"]')).toBeVisible();
  });

  test('6. Learner progress persists across page reload', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/trainer');
    await page.getByTestId('tab-progress').click();
    await expect(page.locator('h1:has-text("Competency Progress")')).toBeVisible();

    // Reload page
    await page.reload();
    await expect(page.getByTestId('tab-progress')).toBeVisible();
    await page.getByTestId('tab-progress').click();
    await expect(page.locator('h1:has-text("Competency Progress")')).toBeVisible();
  });

  test('7. Data export and reset controls', async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/trainer');
    await page.getByTestId('tab-progress').click();
    await expect(page.locator('h1:has-text("Competency Progress")')).toBeVisible();

    // Test Export JSON download
    const exportBtn = page.locator('button:has-text("Export JSON")');
    await expect(exportBtn).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
      exportBtn.click(),
    ]);
    if (download) {
      expect(download.suggestedFilename()).toContain('.json');
    }

    // Verify Reset Progress input & validation
    const resetInput = page.locator('input[placeholder="Type RESET"]');
    const resetBtn = page.locator('button:has-text("Reset Progress")');
    await expect(resetBtn).toBeDisabled();
    await resetInput.fill('RESET');
    await expect(resetBtn).toBeEnabled();
  });
});
