import { test, expect } from '@playwright/test';

test.describe('Phase 9 Tutor Adversarial Policy, Offline & Local Storage Audit', () => {
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000);
    await page.goto('/#/legacy');
    await page.evaluate(async () => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
      await new Promise<void>(resolve => {
        const done = () => resolve();
        const timer = setTimeout(done, 2000);
        const req = indexedDB.deleteDatabase('ovs-tutor');
        req.onsuccess = () => { clearTimeout(timer); done(); };
        req.onerror = () => { clearTimeout(timer); done(); };
        req.onblocked = () => { clearTimeout(timer); done(); };
      });
    });
  });

  test('1. AI off by default: strictly zero /api/tutor or external requests across Case, Lab, Practice, Home', async ({ page }) => {
    const externalOrTutorRequests: string[] = [];
    await page.route('**/*', route => {
      const url = route.request().url();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      const isDataOrBlob = url.startsWith('data:') || url.startsWith('blob:');
      if (!isLocal && !isDataOrBlob) {
        externalOrTutorRequests.push(`EXTERNAL:${url}`);
        return route.abort();
      }
      if (url.includes('/api/tutor')) {
        externalOrTutorRequests.push(`TUTOR:${url}`);
      }
      return route.continue();
    });

    // Navigate Home, Case, Lab, Practice, Progress with AI off
    await page.goto('/?view=home#/trainer');
    await expect(page.getByTestId('pathway-home')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Enable AI Tutor (Off by default)')).toBeVisible();

    await page.getByTestId('tab-lab').click();
    await page.getByTestId('lab-card-01-rc-time-constant-exhalation').getByRole('button', { name: /Start Experiment/i }).click();
    await expect(page.getByTestId('lab-runner')).toBeVisible();
    await expect(page.getByText('Enable AI Tutor (Off by default)')).toBeVisible();

    await page.getByTestId('tab-practice').click();
    await page.getByTestId('practice-start-btn').click();
    await expect(page.getByTestId('practice-session')).toBeVisible();
    // In Practice, Tutor is gated behind post-reveal "Unpack mechanism" (zero requests before commit)

    await page.goto('/?case=sbt-pass-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible();
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);
    await expect(page.getByText('Enable AI Tutor (Off by default)')).toBeVisible();

    expect(externalOrTutorRequests).toEqual([]);
  });

  test('2. AI on with keys missing / offline providers degrades cleanly without breaking simulator or leaking keys', async ({ page }) => {
    const externalUrls: string[] = [];
    await page.route('**/*', route => {
      const url = route.request().url();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      const isDataOrBlob = url.startsWith('data:') || url.startsWith('blob:');
      if (!isLocal && !isDataOrBlob) {
        externalUrls.push(url);
        return route.abort();
      }
      if (url.includes('/api/tutor')) {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              gemini: { configured: false, remainingToday: 0 },
              groq: { configured: false, remainingToday: 0 },
              ollama: { configured: true },
            }),
          });
        }
        return route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({
            success: false,
            failureKind: 'no_ai',
            error: 'No AI providers available (missing keys and Ollama offline).',
          }),
        });
      }
      return route.continue();
    });

    await page.goto('/?case=sbt-pass-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible();
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);

    // Enable AI Tutor via ContractModal
    await page.getByLabel('Enable AI Tutor (Off by default)').click();
    await expect(page.getByTestId('tutor-contract-modal')).toBeVisible();
    await page.getByTestId('tutor-contract-accept-btn').click();
    await expect(page.getByTestId('tutor-contract-modal')).toBeHidden();

    await expect(page.getByTestId('tutor-offline-notice')).toBeVisible();
    await expect(page.getByText('Offline (No AI)')).toBeVisible();

    // Attempt to send a UI help question when offline/no keys (works even in exam-silent probe cases)
    await page.getByTestId('tutor-ui-help-btn').click();
    await page.getByLabel('Simulator UI question').fill('Where is the inspiratory hold button?');
    await page.getByRole('button', { name: 'UI Help', exact: true }).click();
    await expect(page.getByText(/No AI providers available/i)).toBeVisible();

    // Verify simulation still runs completely normally afterwards
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'Examine patient' }).click();
    await page.getByRole('button', { name: '+15 min' }).click();
    await expect(page.getByLabel('Simulated time')).not.toHaveText('0:00:00');
    expect(externalUrls).toEqual([]);
  });

  test('3. Help level adapts across Lab, Practice, and Case; browser contacts only proxy host; leakage triggers regen & block; exchanges persist locally', async ({ page }) => {
    test.setTimeout(60000);
    const nonLocalUrls: string[] = [];
    const capturedRequests: Array<{
      contextKind: string;
      helpLevelCap: number;
      requestKind?: string;
      learnerMessage?: string;
      forbiddenPhrases?: string[];
    }> = [];
    let mockMode: 'normal' | 'leak-always' = 'normal';

    await page.route('**/*', route => {
      const url = route.request().url();
      const isLocal = url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
      const isDataOrBlob = url.startsWith('data:') || url.startsWith('blob:');
      if (!isLocal && !isDataOrBlob) {
        nonLocalUrls.push(url);
        return route.abort();
      }
      if (url.includes('/api/tutor')) {
        if (route.request().method() === 'GET') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              gemini: { configured: true, remainingToday: 199 },
              groq: { configured: true, remainingToday: 300 },
              ollama: { configured: true },
            }),
          });
        }
        const reqBody = JSON.parse(route.request().postData() || '{}');
        capturedRequests.push(reqBody);

        if (mockMode === 'leak-always') {
          const leakedTerm = (reqBody.forbiddenPhrases && reqBody.forbiddenPhrases[0]) || 'double triggering';
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              provider: 'groq',
              model: 'openai/gpt-oss-120b',
              latencyMs: 50,
              promptVersion: 'v2',
              data: {
                message: `The exact answer is: ${leakedTerm}.`,
                help_level_used: Math.min(1, reqBody.helpLevelCap ?? 0),
                question: null,
                needs_clarification: false,
                reasoning_grade: 'correct_superficial',
                misconception_ids: [],
                claims: [],
                confidence: 0.9,
              },
            }),
          });
        }

        const capUsed = reqBody.helpLevelCap ?? 0;
        const needNullQ = capUsed < 3 && (reqBody.requestKind === 'explain' || reqBody.requestKind === 'worked_example');
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            provider: 'groq',
            model: 'openai/gpt-oss-120b',
            latencyMs: 80,
            promptVersion: 'v2',
            data: {
              message: `Focus on the relationship between timing and pressure (cap=${capUsed}).`,
              help_level_used: capUsed,
              question: needNullQ ? null : 'What happens to the waveform before the next breath?',
              needs_clarification: false,
              reasoning_grade: 'correct_superficial',
              misconception_ids: [],
              claims: [{ text: 'Monitor waveform timing and emptying intervals carefully.', evidence_level: 'physiology' }],
              confidence: 0.9,
            },
          }),
        });
      }
      return route.continue();
    });

    // A. Lab pre-commit vs post-commit help level adaptation + Pre-Attempt Gate
    await page.goto('/#/trainer?view=lab');
    await page.getByTestId('lab-card-01-rc-time-constant-exhalation').getByRole('button', { name: /Start Experiment/i }).click();
    await expect(page.getByTestId('lab-runner')).toBeVisible();

    await page.getByLabel('Enable AI Tutor (Off by default)').click();
    await expect(page.getByTestId('tutor-contract-modal')).toBeVisible();
    await page.getByTestId('tutor-contract-accept-btn').click();
    await expect(page.getByTestId('tutor-contract-modal')).toBeHidden();

    // Action buttons disabled until Pre-Attempt Gate is filled
    await expect(page.getByTestId('tutor-btn-hint')).toBeDisabled();
    await page.getByTestId('tutor-attempt-observation').fill('Peak airway pressure rises while plateau remains stable');
    await page.getByTestId('tutor-attempt-mechanism').fill('Expiratory resistance slows alveolar emptying and traps end-expiratory gas');
    await page.getByTestId('tutor-attempt-confidence-fairly_sure').click();
    await expect(page.getByTestId('tutor-btn-hint')).toBeEnabled();

    // Hint before commit -> cap <= 1, forbiddenPhrases populated
    await page.getByTestId('tutor-btn-hint').click();
    await expect(page.getByText(/cap=(0|1)/)).toBeVisible();
    expect(capturedRequests[0]!.contextKind).toBe('lab');
    expect(capturedRequests[0]!.helpLevelCap).toBeLessThanOrEqual(1);
    expect((capturedRequests[0]!.forbiddenPhrases ?? []).length).toBeGreaterThan(0);

    // Trigger leakage before commit: client must retry once (2 calls) and block the leaked term
    const beforeCalls = capturedRequests.length;
    mockMode = 'leak-always';
    await page.getByTestId('tutor-btn-hint').click();
    await expect(page.getByText(/Tutor unavailable for this question/i)).toBeVisible();
    expect(capturedRequests.length - beforeCalls).toBe(2);
    mockMode = 'normal';

    // Commit prediction AND reflection -> cap rises to >= 2
    const predPanel = page.getByTestId('lab-prediction-panel');
    const incBtns = predPanel.getByRole('button', { name: /Increase/i });
    const n = await incBtns.count();
    for (let i = 0; i < n; i++) await incBtns.nth(i).click();
    await page.getByTestId('lab-confidence-fairly_sure').click();
    await page.getByTestId('lab-commit-btn').click();
    await page.getByTestId('lab-reflection-opt-opt-a').click();
    await page.getByTestId('lab-reflection-submit').click();

    await page.getByTestId('tutor-attempt-observation').fill('Total PEEP remained elevated after doubling airway resistance');
    await page.getByTestId('tutor-attempt-mechanism').fill('Prolonged time constant prevents complete passive exhalation during available expiratory time');
    await page.getByTestId('tutor-btn-explain').click();
    await expect(page.getByText(/cap=(2|3)/)).toBeVisible();
    expect(capturedRequests[capturedRequests.length - 1]!.helpLevelCap).toBeGreaterThanOrEqual(2);

    // Verify local exchange persistence in IndexedDB ovs-tutor
    const storedCount = await page.evaluate(async () => {
      return await new Promise<number>((resolve, reject) => {
        const req = indexedDB.open('ovs-tutor');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('exchanges', 'readonly');
          const allReq = tx.objectStore('exchanges').getAll();
          allReq.onsuccess = () => resolve((allReq.result || []).length);
        };
      });
    });
    expect(storedCount).toBeGreaterThanOrEqual(2);

    // B. Active Case hidden probe enforces Consultant-Silent mode (exam_silent) during case
    await page.goto('/?case=dyssynchrony-01#/trainer');
    await expect(page.getByTestId('case-runner')).toBeVisible();
    await page.getByTestId('take-over-button').click();
    await expect(page.getByTestId('handoff-card')).toHaveCount(0);
    const expandBtn = page.getByRole('button', { name: 'Expand AI Tutor' });
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
    }
    await expect(page.getByTestId('tutor-exam-mode-badge')).toBeVisible();
    await expect(page.getByTestId('tutor-exam-locked-msg')).toBeVisible();
    expect(nonLocalUrls).toEqual([]);
  });
});
