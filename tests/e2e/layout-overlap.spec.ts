import { test, expect } from '@playwright/test';
import { openIcuMode, safeScreenshot } from './e2e-helpers';

const VIEWPORTS = [
  { width: 1280, height: 720, name: '1280x720' },
  { width: 1366, height: 768, name: '1366x768' },
  { width: 1536, height: 864, name: '1536x864' },
  { width: 1920, height: 1080, name: '1920x1080' },
  { width: 900, height: 720, name: '900x720' },
] as const;

interface BoxInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

function boxesIntersect(a: BoxInfo, b: BoxInfo, tolerancePx = 1.5): boolean {
  const overlapX = Math.min(a.right, b.right) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
  return overlapX > tolerancePx && overlapY > tolerancePx;
}

test.describe('Part 0.2: Interface / Ventilator Screen Tile Overlap Check', () => {
  for (const vp of VIEWPORTS) {
    test(`No tile bounding boxes intersect at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openIcuMode(page);
      await page.waitForTimeout(800);

      await safeScreenshot(page, {
        path: `docs/reports/img/interface-${vp.name}.png`,
        fullPage: false,
      });

      const report = await page.evaluate(() => {
        const toBox = (el: Element, fallbackId: string): BoxInfo | null => {
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return null;
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return null;
          }
          const testId = el.getAttribute('data-testid');
          const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
          return {
            id: testId || `${fallbackId}:${text}`,
            x: r.left,
            y: r.top,
            width: r.width,
            height: r.height,
            right: r.right,
            bottom: r.bottom,
          };
        };

        // 1. Collect all peer tiles and controls on the Interface / Ventilator screen
        const peerSelectors = [
          '[data-testid="vent-numerics"] .vt-numeric',
          '[data-testid="vent-numerics"] .bedside-mon-tile',
          '[data-testid="setting-keys"] .vt-key',
          '[data-testid="control-mode"]',
          '[data-testid="patient-preset"]',
          '[data-testid="sweep-waveforms"]',
          '[data-testid="left-handle-btn"]',
        ];

        const peerElements: Element[] = [];
        for (const sel of peerSelectors) {
          document.querySelectorAll(sel).forEach(el => {
            if (!peerElements.includes(el)) peerElements.push(el);
          });
        }

        const peerBoxes: BoxInfo[] = [];
        peerElements.forEach((el, idx) => {
          const b = toBox(el, `tile-${idx}`);
          if (b) peerBoxes.push(b);
        });

        // 2. Also check internal children of every .vt-numeric, .bedside-mon-tile and .vt-key tile do not overlap each other
        const internalOverlaps: Array<{ parent: string; a: BoxInfo; b: BoxInfo }> = [];
        document.querySelectorAll('.vt-numeric, .bedside-mon-tile, .vt-key').forEach((tile, tIdx) => {
          const children = Array.from(tile.children);
          const cBoxes: BoxInfo[] = [];
          children.forEach((c, cIdx) => {
            const b = toBox(c, `child-${cIdx}`);
            if (b) cBoxes.push(b);
          });
          for (let i = 0; i < cBoxes.length; i++) {
            for (let j = i + 1; j < cBoxes.length; j++) {
              const a = cBoxes[i]!;
              const b = cBoxes[j]!;
              const ox = Math.min(a.right, b.right) - Math.max(a.x, b.x);
              const oy = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
              if (ox > 1.5 && oy > 1.5) {
                internalOverlaps.push({
                  parent: tile.getAttribute('data-testid') || `tile-${tIdx}`,
                  a,
                  b,
                });
              }
            }
          }
        });

        return { peerBoxes, internalOverlaps };
      });

      expect(report.peerBoxes.length).toBeGreaterThanOrEqual(12);

      const peerOverlaps: Array<{ a: string; b: string; aBox: BoxInfo; bBox: BoxInfo }> = [];
      for (let i = 0; i < report.peerBoxes.length; i++) {
        for (let j = i + 1; j < report.peerBoxes.length; j++) {
          const a = report.peerBoxes[i]!;
          const b = report.peerBoxes[j]!;
          if (boxesIntersect(a, b)) {
            peerOverlaps.push({ a: a.id, b: b.id, aBox: a, bBox: b });
          }
        }
      }

      expect(peerOverlaps, `Peer tile overlaps at ${vp.name}: ${JSON.stringify(peerOverlaps)}`).toEqual([]);
      expect(
        report.internalOverlaps,
        `Internal tile child overlaps at ${vp.name}: ${JSON.stringify(report.internalOverlaps)}`
      ).toEqual([]);
    });
  }

  // Phase 7C & Phase 9: Assert no overlapping tile boxes on all main/merged screens at all 5 key viewports
  const MAIN_SCREENS = [
    { name: 'Home / Pathway', url: '/?view=home#/trainer', selector: '[data-testid="pathway-home"] .vt-card, [data-testid="pathway-home"] [data-testid^="pathway-level-"]' },
    { name: 'Case Library', url: '/?view=cases#/trainer', selector: 'article[role="listitem"]' },
    { name: 'Lab Catalog', url: '/?view=labs#/trainer', selector: '[data-testid^="lab-card-"]' },
    { name: 'Practice Hub', url: '/?view=practice#/trainer', selector: '[data-testid="practice-screen"] .vt-card' },
    { name: 'Progress Portfolio', url: '/?view=progress#/trainer', selector: '[data-testid="progress-view"] > div > section' },
    { name: 'Progress Entrustment Cards', url: '/?view=progress#/trainer', selector: '[aria-labelledby="heading-entrustment"] .grid > div' },
  ];

  for (const screen of MAIN_SCREENS) {
    for (const vp of VIEWPORTS) {
      test(`${screen.name} - No overlapping tiles at ${vp.name}`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await page.goto(screen.url);
        await page.waitForTimeout(500);

        const result = await page.evaluate((sel) => {
          const elements = Array.from(document.querySelectorAll(sel));
          const boxes: Array<{ id: string; left: number; top: number; right: number; bottom: number }> = [];

          elements.forEach((el, idx) => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) {
              boxes.push({
                id: el.getAttribute('data-testid') || `elem-${idx}`,
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
              });
            }
          });

          const found: Array<{ a: string; b: string }> = [];
          for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i]!;
              const b = boxes[j]!;
              const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
              const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
              if (overlapX > 2 && overlapY > 2) {
                found.push({ a: a.id, b: b.id });
              }
            }
          }
          return { count: boxes.length, overlaps: found };
        }, screen.selector);

        expect(result.count, `Expected elements on ${screen.name} at ${vp.name}`).toBeGreaterThan(0);
        expect(result.overlaps, `Overlaps on ${screen.name} at ${vp.name}`).toEqual([]);
      });
    }
  }

  for (const vp of VIEWPORTS) {
    test(`Active Case Runner with Tutor Panel enabled - No panel overlap at ${vp.name}`, async ({ page }) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/?case=sbt-pass-01#/trainer');
      await expect(page.getByTestId('case-runner')).toBeVisible({ timeout: 10000 });

      // Dismiss initial bedside handoff card
      const takeOverBtn = page.getByTestId('take-over-button');
      if (await takeOverBtn.isVisible().catch(() => false)) {
        await takeOverBtn.click();
        await expect(page.getByTestId('handoff-card')).toHaveCount(0);
      }

      // Enable AI Tutor and accept ContractModal
      await page.getByLabel(/Enable AI Tutor/i).click();
      const acceptBtn = page.getByTestId('tutor-contract-accept-btn');
      await expect(acceptBtn).toBeVisible();
      await acceptBtn.click();
      await expect(page.getByTestId('tutor-panel')).toBeVisible();

      const panelOverlap = await page.evaluate(() => {
        const tutorPanel = document.querySelector('[data-testid="tutor-panel"]');
        const waveforms = document.querySelector('[data-testid="sweep-waveforms"]');
        if (!tutorPanel || !waveforms) return { missing: true };
        const tRect = tutorPanel.getBoundingClientRect();
        const wRect = waveforms.getBoundingClientRect();
        if (tRect.width <= 0 || wRect.width <= 0) return { zeroSize: true };
        const ox = Math.min(tRect.right, wRect.right) - Math.max(tRect.left, wRect.left);
        const oy = Math.min(tRect.bottom, wRect.bottom) - Math.max(tRect.top, wRect.top);
        return ox > 2 && oy > 2 ? { ox, oy, tRect, wRect } : null;
      });

      expect(panelOverlap, `Tutor panel overlapped sweep waveforms at ${vp.name}`).toBeNull();
    });
  }
});
