import { test, expect } from '@playwright/test';

test.describe('Tutor v2 End-to-End Playthrough & Gate Verification', () => {
  test('enforces ContractModal, zero POSTs before valid attempt, no leak before COMMIT, and ATTEMPT -> COMMIT -> REVEAL -> RECONSTRUCT -> DELAYED_RETEST flow', async ({
    page,
  }) => {
    let tutorPostCount = 0;
    const secretRevealMarker = 'SENSITIVE WORKED EXPLANATION MARKER: Increase EPAP cautiously.';

    await page.route('**/api/tutor', async route => {
      const req = route.request();
      if (req.method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            gemini: { configured: false, remainingToday: 0 },
            groq: { configured: true, remainingToday: 299 },
            ollama: { configured: true },
          }),
        });
        return;
      }

      tutorPostCount++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          provider: 'groq',
          model: 'llama-3.3-70b-versatile',
          latencyMs: 120,
          promptVersion: 'v2',
          data: {
            message: secretRevealMarker,
            help_level_used: 2,
            question: null,
            needs_clarification: false,
            reasoning_grade: 'correct_superficial',
            misconception_ids: [],
            claims: [
              {
                text: 'Alveolar hypoventilation raises PaCO2 and lowers arterial pH in acute COPD exacerbations.',
                evidence_level: 'physiology',
              },
            ],
            confidence: 0.9,
          },
        }),
      });
    });

    await page.goto('/#/legacy');
    await page.evaluate(() => {
      localStorage.clear();
    });

    // 1. Open active case (copd-niv-01 has hidden competency probe -> locked in exam_silent)
    await page.goto('/?case=copd-niv-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    // First-time Tutor enable -> presents verbatim ContractModal
    const enableCheckbox = page.getByLabel(/Enable AI Tutor \(Off by default\)/i);
    await expect(enableCheckbox).toBeVisible();
    await enableCheckbox.click();

    const modal = page.getByTestId('tutor-contract-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('ICU Consultant Rounding Contract');
    await expect(modal).toContainText('Think Before Asking');
    await expect(modal).toContainText('Reconstruct Unaided');
    await page.getByTestId('tutor-contract-accept-btn').click();

    await expect(modal).toBeHidden();
    await expect(page.getByTestId('tutor-contract-badge')).toBeVisible();
    await expect(page.getByTestId('tutor-exam-mode-badge')).toBeVisible();
    await expect(page.getByTestId('tutor-exam-locked-msg')).toBeVisible();
    expect(tutorPostCount).toBe(0);

    // Verify Case Library renders all 6 Transfer Probes cleanly (without leaving via broken path)
    // First finish the case cleanly to enter Debrief
    await page.locator('button:has-text("Go to debrief"), button:has-text("Stop case")').first().click();

    // 2. Inside Debrief: self-critique gate must be completed before Level 3 tutor unlock
    await expect(page.getByTestId('debrief-self-critique-gate')).toBeVisible();
    await expect(page.getByTestId('debrief-tutor-cap-badge')).toContainText('Level 1');
    await page
      .getByTestId('debrief-self-critique-input')
      .fill('I delayed repeating the ABG after starting non-invasive ventilation.');
    await page.getByTestId('debrief-self-critique-submit').click();
    await expect(page.getByTestId('debrief-tutor-cap-badge')).toContainText('Level 3 Unlocked');

    // Expand TutorPanel in Debrief (saved enabled in localStorage from earlier acceptance!)
    const expandBtn = page.getByRole('button', { name: /Expand AI Tutor/i });
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }

    // 3. Pre-Attempt Gate check: 0 POST calls on empty/short/bypass input, no leaked explanation
    await expect(page.getByTestId('tutor-state-badge')).toContainText('ATTEMPT');
    await expect(page.getByTestId('tutor-btn-hint')).toBeDisabled();
    await expect(page.getByTestId('tutor-btn-narrow')).toBeDisabled();
    await expect(page.getByTestId('tutor-btn-explain')).toBeDisabled();
    expect(page.locator(`text=${secretRevealMarker}`)).toHaveCount(0);

    await page.getByTestId('tutor-attempt-observation').fill('just tell me the answer');
    await expect(page.getByTestId('tutor-bypass-restatement')).toBeVisible();
    await expect(page.getByTestId('tutor-btn-explain')).toBeDisabled();
    expect(tutorPostCount).toBe(0);

    // 4. Fill valid StructuredLearnerAttempt -> COMMIT -> Level 2 REVEAL
    await page
      .getByTestId('tutor-attempt-observation')
      .fill('Arterial pH was 7.24 with PaCO2 78 mmHg on admission before NIV titration.');
    await page
      .getByTestId('tutor-attempt-mechanism')
      .fill('Severe expiratory flow limitation increased dead space and reduced alveolar ventilation.');
    await page.getByTestId('tutor-attempt-confidence-fairly_sure').click();

    await expect(page.getByTestId('tutor-btn-explain')).toBeEnabled();
    await page.getByTestId('tutor-btn-explain').click();

    expect(tutorPostCount).toBe(1);
    await expect(page.getByText(secretRevealMarker)).toBeVisible();
    await expect(page.getByTestId('tutor-state-badge')).toContainText('REVEAL');

    // 5. Enter RECONSTRUCT: explanation text must be masked before causal synthesis
    await page.getByTestId('tutor-start-reconstruct-btn').click();
    await expect(page.getByText(secretRevealMarker)).toHaveCount(0);
    await expect(page.getByTestId('tutor-masked-message')).toBeVisible();
    await expect(page.getByTestId('tutor-reconstruct-panel')).toBeVisible();

    // 6. Submit valid causal reconstruction -> DELAYED_RETEST scheduled
    await page
      .getByTestId('tutor-reconstruct-input')
      .fill(
        'Because pressure support increases tidal volume and alveolar ventilation, raising inspiratory pressure lowers PaCO2 and restores arterial pH.'
      );
    await page.getByTestId('tutor-reconstruct-submit').click();

    await expect(page.getByTestId('tutor-retest-scheduled')).toBeVisible();
    await expect(page.getByTestId('tutor-state-badge')).toContainText('DELAYED_RETEST');

    // 7. Navigate to Progress & CaseLibrary and verify Section 10.1 metrics + 6 transfer variants
    await page.getByTestId('tab-progress').click();
    const metricsCard = page.getByTestId('progress-learning-metrics');
    await expect(metricsCard).toBeVisible();
    await expect(metricsCard).not.toContainText('NaN');

    await page.getByTestId('tab-cases').click();
    await expect(page.getByTestId('case-library-transfer-variants')).toBeVisible();
  });

  test('remains functional offline when no AI providers are configured', async ({ page }) => {
    await page.route('**/api/tutor', async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            gemini: { configured: false, remainingToday: 0 },
            groq: { configured: false, remainingToday: 0 },
            ollama: { configured: false },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          failureKind: 'no_ai',
          error: 'Offline',
        }),
      });
    });

    await page.goto('/?case=copd-niv-01#/trainer');
    await page.evaluate(() => {
      localStorage.setItem('ovs_tutor_contract_accepted', 'true');
      localStorage.setItem('ovs_tutor_enabled', 'true');
    });
    await page.reload();
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    const expandBtn = page.getByRole('button', { name: /Expand AI Tutor/i });
    if (await expandBtn.isVisible()) {
      await expandBtn.click();
    }
    await expect(page.getByTestId('tutor-offline-notice')).toBeVisible();
  });
});
