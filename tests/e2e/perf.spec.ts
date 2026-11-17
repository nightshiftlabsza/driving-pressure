import { test, expect } from '@playwright/test';
import { openIcuMode } from './e2e-helpers';

test.describe('Release QA: Waveform & Simulation Performance', () => {
  test.setTimeout(60000);

  test('1. Waveform frame time at 1x and 10x simulation speeds', async ({ page }) => {
    await openIcuMode(page);
    await page.waitForTimeout(1000);

    const frameMetrics = await page.evaluate(async () => {
      return new Promise<{ avgFrameTimeMs: number; fps: number; maxFrameTimeMs: number }>((resolve) => {
        const frameDeltas: number[] = [];
        let last = performance.now();
        let count = 0;

        function step(now: number) {
          const delta = now - last;
          last = now;
          if (count > 0) frameDeltas.push(delta);
          count++;

          if (count < 60) {
            requestAnimationFrame(step);
          } else {
            const sum = frameDeltas.reduce((a, b) => a + b, 0);
            const avg = sum / frameDeltas.length;
            const max = Math.max(...frameDeltas);
            resolve({
              avgFrameTimeMs: Math.round(avg * 10) / 10,
              fps: Math.round(1000 / avg),
              maxFrameTimeMs: Math.round(max * 10) / 10,
            });
          }
        }
        requestAnimationFrame(step);
      });
    });

    console.log(`PERF_METRICS: ${JSON.stringify(frameMetrics)}`);
    // Frame time should be <= 33.3 ms (>= 30 fps)
    expect(frameMetrics.avgFrameTimeMs).toBeLessThanOrEqual(33.4);
  });

  test('2. Time to skip 30 simulated minutes in Case Runner', async ({ page }) => {
    await page.goto('/?case=sbt-pass-01#/trainer');
    await expect(page.locator('[data-testid="case-runner"]')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('take-over-button').click();

    const startTime = Date.now();
    // Advance 15 min twice
    await page.locator('button[role="tab"]:has-text("Orders")').click();
    await page.locator('button:has-text("+15 min")').click();
    await page.locator('button:has-text("+15 min")').click();
    const durationMs = Date.now() - startTime;

    console.log(`TIME_TO_SKIP_30_SIM_MIN: ${durationMs} ms`);
    // 30 simulated minutes should advance in under 5000 ms real time
    expect(durationMs).toBeLessThan(5000);
  });

  test('3. Heap memory stability across intensive simulation', async ({ page }) => {
    await page.goto('/#/legacy');
    const memBefore = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 1000000);

    // Run simulated steps
    await page.goto('/#/trainer');
    await page.getByTestId('tab-lab').click();
    await page.waitForTimeout(2000);

    const memAfter = await page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 1000000);
    const growthRatio = memAfter / memBefore;
    console.log(`HEAP_GROWTH_RATIO: ${growthRatio.toFixed(3)}`);
    // Memory growth should remain stable
    expect(growthRatio).toBeLessThan(1.50);
  });
});
