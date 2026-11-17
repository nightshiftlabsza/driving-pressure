import { test, expect } from '@playwright/test';

test.describe('Phase 7B Practice (Spaced Repetition & PDF extraction)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear storage for fresh test state
    await page.goto('/#/legacy');
    await page.evaluate(() => {
      try {
        localStorage.clear();
      } catch {
        /* ignore */
      }
    });
  });

  test('Navigate to Practice screen and verify clinical items and sources', async ({ page }) => {
    await page.goto('/#/legacy');

    const trainerBtn = page.getByRole('button', { name: /ICU Respiratory Trainer/i });
    await expect(trainerBtn).toBeVisible({ timeout: 10000 });
    await trainerBtn.click();

    const practiceTab = page.getByTestId('tab-practice');
    await expect(practiceTab).toBeVisible({ timeout: 10000 });
    await practiceTab.click();

    // Verify practice screen container
    const practiceScreen = page.getByTestId('practice-screen');
    await expect(practiceScreen).toBeVisible({ timeout: 10000 });

    // Verify header and counts
    await expect(page.getByText('Active Clinical Practice')).toBeVisible();
    const dueCountEl = page.getByTestId('practice-due-count');
    await expect(dueCountEl).toBeVisible();

    // Verify total items count is at least 190 items
    await expect(page.getByText(/\b(19[0-9]|[2-9][0-9]{2})\b total items/)).toBeVisible();

    // Verify Start Practice Session button exists
    const startBtn = page.getByTestId('practice-start-btn');
    await expect(startBtn).toBeVisible();

    // Verify Source Coverage & Mastery section
    await expect(page.getByText('Source Coverage & Mastery')).toBeVisible();
  });

  test('Filter by source and chapter', async ({ page }) => {
    await page.goto('/#/trainer?view=practice');

    const practiceScreen = page.getByTestId('practice-screen');
    await expect(practiceScreen).toBeVisible({ timeout: 10000 });

    // Find source selector
    const sourceSelect = page.locator('select').first();
    await expect(sourceSelect).toBeVisible();

    // Select the first non-'all' source option
    const options = await sourceSelect.locator('option').allInnerTexts();
    expect(options.length).toBeGreaterThan(1);

    await sourceSelect.selectOption({ index: 1 });

    // When a specific source is selected, the chapter selector should appear if chapters exist
    const chapterSelect = page.locator('select').nth(1);
    await expect(chapterSelect).toBeVisible();
  });

  test('Run an interactive practice session with commit, citation, and grading', async ({ page }) => {
    await page.goto('/#/trainer?view=practice');

    const practiceScreen = page.getByTestId('practice-screen');
    await expect(practiceScreen).toBeVisible({ timeout: 10000 });

    // Start practice session
    const startBtn = page.getByTestId('practice-start-btn');
    await startBtn.click();

    // Session runner should be visible
    const session = page.getByTestId('practice-session');
    await expect(session).toBeVisible({ timeout: 10000 });

    // Test first item interaction
    const commitBtn = page.getByTestId('practice-commit-btn');
    await expect(commitBtn).toBeVisible();

    // Check if there are choices to pick (multiple choice predict-then-reveal or case-drill)
    const radioInputs = page.locator('input[type="radio"]');
    const radioCount = await radioInputs.count();
    if (radioCount > 0) {
      await radioInputs.first().check();
    }

    // Click commit or show answer
    await commitBtn.click();

    // Reveal view should appear
    const reveal = page.getByTestId('practice-reveal');
    await expect(reveal).toBeVisible();

    // Test Source Reference modal
    const sourceRefBtn = page.getByRole('button', { name: /View source reference/i });
    if (await sourceRefBtn.isVisible()) {
      await sourceRefBtn.click();
      const modal = page.getByTestId('practice-source-modal');
      await expect(modal).toBeVisible();
      // Close modal
      await modal.getByRole('button', { name: '✕' }).click();
      await expect(modal).not.toBeVisible();
    }

    // Self-evaluate grade: click "Good (3–5d)"
    const gradeGood = page.getByTestId('grade-good');
    await expect(gradeGood).toBeVisible();
    await gradeGood.click();

    // Verify progression: either next item is shown or session ends
    const sessionStillOpen = await session.isVisible().catch(() => false);
    if (sessionStillOpen) {
      // Second item loaded
      await expect(page.getByText(/Item 2 of/i)).toBeVisible();
    } else {
      // Returned to practice screen
      await expect(page.getByTestId('practice-screen')).toBeVisible();
    }
  });
});
