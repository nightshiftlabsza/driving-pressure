import { test, expect } from '@playwright/test';
import { openIcuMode } from './e2e-helpers';

test.describe('Part 0.1: Sweep Waveform Lag & Frame Continuity', () => {
  test('Measures frame times, playhead continuity, and setting-change-to-waveform latency on Bedside and Trainer', async ({ page }) => {
    test.setTimeout(60000);

    // 1. BEDSIDE SCREEN MEASUREMENT
    await openIcuMode(page);
    await page.waitForTimeout(1500);

    // Stage PEEP = 22 on Bedside UI before starting measurement
    await page.getByTestId('control-peep').fill('22');

    const bedsideMetrics = await page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="sweep-waveforms"]') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const origFillRect = ctx.fillRect.bind(ctx);
      const origMoveTo = ctx.moveTo.bind(ctx);
      const origLineTo = ctx.lineTo.bind(ctx);
      const origStroke = ctx.stroke.bind(ctx);

      const frameTimes: number[] = [];
      const playheadXs: number[] = [];
      let lastFrameTs = performance.now();
      let strokeCountInFrame = 0;
      let curPawPts: Array<{ x: number; y: number }> = [];
      let latestPawPts: Array<{ x: number; y: number }> = [];

      let eventTs = 0;
      let numbersUpdatedTs = 0;
      let waveformUpdatedTs = 0;
      let baselineMinY = 9999;
      let baselineLastY = 0;
      let maxSegmentGapPx = 0;

      ctx.fillRect = function (x: number, y: number, w: number, h: number) {
        if (x === 0 && y === 0 && w > 100) {
          const now = performance.now();
          frameTimes.push(now - lastFrameTs);
          lastFrameTs = now;
          strokeCountInFrame = 0;
          curPawPts = [];
        } else if (x > 30 && y === 0 && h > 100) {
          playheadXs.push(x);
        }
        return origFillRect(x, y, w, h);
      };

      ctx.moveTo = function (x: number, y: number) {
        if (strokeCountInFrame === 2) {
          curPawPts.push({ x, y });
        }
        return origMoveTo(x, y);
      };

      ctx.lineTo = function (x: number, y: number) {
        if (strokeCountInFrame === 2) {
          if (curPawPts.length > 0) {
            const prev = curPawPts[curPawPts.length - 1]!;
            if (x > prev.x) {
              const gap = x - prev.x;
              if (eventTs > 0 && gap > maxSegmentGapPx) {
                maxSegmentGapPx = gap;
              }
            }
          }
          curPawPts.push({ x, y });
        }
        return origLineTo(x, y);
      };

      ctx.stroke = function () {
        if (strokeCountInFrame === 2 && curPawPts.length > 0) {
          latestPawPts = curPawPts.slice();
          const lastPt = latestPawPts[latestPawPts.length - 1]!;
          if (eventTs === 0) {
            baselineLastY = lastPt.y;
            if (lastPt.y < baselineMinY) baselineMinY = lastPt.y;
          } else if (waveformUpdatedTs === 0) {
            const cssH = canvas.clientHeight;
            const rowH = cssH / 3;
            const top = 8;
            const h = rowH - 16;
            // With PEEP=22 (up from 5), Paw is >= 22 cmH2O at all times (even during expiration)
            // On [0,30] or [0,40] scale, 22 cmH2O is >= 55% from bottom
            const fracFromBottom = (top + h - lastPt.y) / h;
            if (fracFromBottom >= 0.52) {
              waveformUpdatedTs = performance.now();
            }
          }
        }
        strokeCountInFrame++;
        return origStroke();
      };

      // Observe 1 second of baseline frames
      await new Promise(r => setTimeout(r, 1000));

      // Click Apply to trigger handleSetDevice({ peep: 22 })
      const applyBtn = document.querySelector('[data-testid="control-apply"]') as HTMLButtonElement;
      eventTs = performance.now();
      applyBtn.click();

      // Poll for DOM numeric update and waveform update
      const startWait = performance.now();
      while (performance.now() - startWait < 1500) {
        if (numbersUpdatedTs === 0) {
          const peepText = document.querySelector('[data-testid="vent-peep"]')?.textContent ?? '';
          if (peepText.includes('22')) {
            numbersUpdatedTs = performance.now();
          }
        }
        if (numbersUpdatedTs > 0 && waveformUpdatedTs > 0) break;
        await new Promise(r => setTimeout(r, 4));
      }

      // Observe another 400ms
      await new Promise(r => setTimeout(r, 400));

      ctx.fillRect = origFillRect;
      ctx.moveTo = origMoveTo;
      ctx.lineTo = origLineTo;
      ctx.stroke = origStroke;

      const validFrames = frameTimes.slice(1);
      const avgFrameMs = validFrames.reduce((a, b) => a + b, 0) / Math.max(1, validFrames.length);
      const maxFrameMs = Math.max(0, ...validFrames);
      let stalledPlayheadFrames = 0;
      for (let i = 1; i < playheadXs.length; i++) {
        if (Math.abs(playheadXs[i]! - playheadXs[i - 1]!) < 0.01) {
          stalledPlayheadFrames++;
        }
      }

      return {
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        maxFrameMs: Number(maxFrameMs.toFixed(2)),
        totalFrames: validFrames.length,
        stalledPlayheadFrames,
        numbersLatencyMs: numbersUpdatedTs > 0 ? Number((numbersUpdatedTs - eventTs).toFixed(1)) : -1,
        waveformLatencyMs: waveformUpdatedTs > 0 ? Number((waveformUpdatedTs - eventTs).toFixed(1)) : -1,
        waveformToNumbersLagMs:
          waveformUpdatedTs > 0 && numbersUpdatedTs > 0
            ? Number((waveformUpdatedTs - numbersUpdatedTs).toFixed(1))
            : -1,
        maxSegmentGapPx: Number(maxSegmentGapPx.toFixed(1)),
        baselineLastY: Number(baselineLastY.toFixed(1)),
      };
    });

    console.log('BEDSIDE METRICS:', JSON.stringify(bedsideMetrics));
    expect(bedsideMetrics.avgFrameMs).toBeLessThan(25);
    expect(bedsideMetrics.waveformLatencyMs).toBeGreaterThan(0);
    expect(bedsideMetrics.waveformLatencyMs).toBeLessThan(80);
    expect(Math.abs(bedsideMetrics.waveformToNumbersLagMs)).toBeLessThan(50);
    expect(bedsideMetrics.maxSegmentGapPx).toBeLessThan(10);

    // 2. TRAINER (CaseRunner) SCREEN MEASUREMENT
    await page.goto('/#/legacy');
    // Same-URL hash navigation does not reload; reload to return to the legacy mode menu
    await page.reload();
    await page.locator('button', { hasText: /ICU Respiratory Trainer/i }).click();
    await page.getByTestId('tab-cases').click();
    const icuCase = page.locator('article[role="listitem"]', { hasText: /Sudden high-pressure alarm/i }).first();
    await expect(icuCase).toBeVisible({ timeout: 5000 });
    await icuCase.click();

    await expect(page.locator('[data-testid="sweep-waveforms"]')).toBeVisible({ timeout: 5000 });

    const takeOverBtn = page.getByTestId('take-over-button');
    await takeOverBtn.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {});
    if (await takeOverBtn.isVisible()) {
      await takeOverBtn.click();
    }
    await page.waitForTimeout(800);

    // Clear the first-titration assessment commit sheet cleanly before latency timing
    await page.getByTestId('control-peep').fill('10');
    await page.getByTestId('control-apply').click();
    const commitModal = page.getByTestId('commit-sheet-modal');
    if (await commitModal.isVisible({ timeout: 1500 }).catch(() => false)) {
      await page.getByTestId('assessment-option-uncertain').click();
      await page.getByTestId('commit-submit-button').click();
    }
    await page.waitForTimeout(1000);

    // Stage PEEP = 22 on Trainer UI
    await page.getByTestId('control-peep').fill('22');

    const trainerMetrics = await page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="sweep-waveforms"]') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const origFillRect = ctx.fillRect.bind(ctx);
      const origMoveTo = ctx.moveTo.bind(ctx);
      const origLineTo = ctx.lineTo.bind(ctx);
      const origStroke = ctx.stroke.bind(ctx);

      const frameTimes: number[] = [];
      const playheadXs: number[] = [];
      let lastFrameTs = performance.now();
      let strokeCountInFrame = 0;
      let curPawPts: Array<{ x: number; y: number }> = [];

      let eventTs = 0;
      let numbersUpdatedTs = 0;
      let waveformUpdatedTs = 0;

      ctx.fillRect = function (x: number, y: number, w: number, h: number) {
        if (x === 0 && y === 0 && w > 100) {
          const now = performance.now();
          frameTimes.push(now - lastFrameTs);
          lastFrameTs = now;
          strokeCountInFrame = 0;
          curPawPts = [];
        } else if (x > 30 && y === 0 && h > 100) {
          playheadXs.push(x);
        }
        return origFillRect(x, y, w, h);
      };

      ctx.moveTo = function (x: number, y: number) {
        if (strokeCountInFrame === 2) curPawPts.push({ x, y });
        return origMoveTo(x, y);
      };

      ctx.lineTo = function (x: number, y: number) {
        if (strokeCountInFrame === 2) curPawPts.push({ x, y });
        return origLineTo(x, y);
      };

      ctx.stroke = function () {
        if (strokeCountInFrame === 2 && curPawPts.length > 0 && eventTs > 0 && waveformUpdatedTs === 0) {
          const lastPt = curPawPts[curPawPts.length - 1]!;
          const cssH = canvas.clientHeight;
          const rowH = cssH / 3;
          const top = 8;
          const h = rowH - 16;
          const fracFromBottom = (top + h - lastPt.y) / h;
          if (fracFromBottom >= 0.50) {
            waveformUpdatedTs = performance.now();
          }
        }
        strokeCountInFrame++;
        return origStroke();
      };

      await new Promise(r => setTimeout(r, 800));

      const initialPeepText = document.querySelector('[data-testid="vent-peep"]')?.textContent ?? '';
      const applyBtn = document.querySelector('[data-testid="control-apply"]') as HTMLButtonElement | null;
      eventTs = performance.now();
      if (applyBtn) applyBtn.click();

      const startWait = performance.now();
      while (performance.now() - startWait < 1500) {
        if (numbersUpdatedTs === 0) {
          const peepText = document.querySelector('[data-testid="vent-peep"]')?.textContent ?? '';
          if (peepText !== initialPeepText) {
            numbersUpdatedTs = performance.now();
          }
        }
        if (waveformUpdatedTs > 0 && numbersUpdatedTs > 0) break;
        await new Promise(r => setTimeout(r, 4));
      }

      await new Promise(r => setTimeout(r, 400));

      ctx.fillRect = origFillRect;
      ctx.moveTo = origMoveTo;
      ctx.lineTo = origLineTo;
      ctx.stroke = origStroke;

      const validFrames = frameTimes.slice(1);
      const avgFrameMs = validFrames.reduce((a, b) => a + b, 0) / Math.max(1, validFrames.length);
      const maxFrameMs = Math.max(0, ...validFrames);
      let stalledPlayheadFrames = 0;
      for (let i = 1; i < playheadXs.length; i++) {
        if (Math.abs(playheadXs[i]! - playheadXs[i - 1]!) < 0.01) {
          stalledPlayheadFrames++;
        }
      }

      return {
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        maxFrameMs: Number(maxFrameMs.toFixed(2)),
        totalFrames: validFrames.length,
        stalledPlayheadFrames,
        numbersLatencyMs: numbersUpdatedTs > 0 ? Number((numbersUpdatedTs - eventTs).toFixed(1)) : -1,
        waveformLatencyMs: waveformUpdatedTs > 0 ? Number((waveformUpdatedTs - eventTs).toFixed(1)) : -1,
        waveformToNumbersLagMs:
          waveformUpdatedTs > 0 && numbersUpdatedTs > 0
            ? Number((waveformUpdatedTs - numbersUpdatedTs).toFixed(1))
            : -1,
      };
    });

    console.log('TRAINER METRICS:', JSON.stringify(trainerMetrics));
    expect(trainerMetrics.avgFrameMs).toBeLessThan(25);
    expect(trainerMetrics.waveformLatencyMs).toBeGreaterThan(0);
    expect(trainerMetrics.waveformLatencyMs).toBeLessThan(80);
    expect(Math.abs(trainerMetrics.waveformToNumbersLagMs)).toBeLessThan(50);
  });
});
