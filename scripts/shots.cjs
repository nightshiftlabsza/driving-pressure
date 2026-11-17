/* Visual evidence capture: node scripts/shots.cjs <outDir> [baseUrl] [sizes=all|key] [themes=light,dark]
 * Takes real browser screenshots of every main screen at the listed viewport sizes and reports sideways overflow. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const outDir = process.argv[2] || 'screenshots/shots';
const base = process.argv[3] || 'http://127.0.0.1:3111';
const sizeArg = process.argv[4] || 'all';
const themes = (process.argv[5] || 'light').split(',');

const ALL_SIZES = [
  [1280, 720], [1440, 900], [1920, 1080], [2560, 1440], [3440, 1440], [3840, 2160], [768, 1024], [390, 844],
];
const sizes = sizeArg === 'key' ? [[1920, 1080], [3440, 1440], [390, 844]] : ALL_SIZES;

const routes = [
  ['home', 'view=home'],
  ['cases', 'view=cases'],
  ['drills', 'view=drills'],
  ['labs', 'view=labs'],
  ['lab-run', 'lab=03-peep-vs-pplat'],
  ['practice', 'view=practice'],
  ['progress', 'view=progress'],
  ['case', 'case=ards-vent-01'],
  ['case-o2', 'case=pneumonia-hfnc-01'],
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const theme of themes) {
    for (const [w, h] of sizes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 200)));
      for (const [name, q] of routes) {
        errors.length = 0;
        await page.goto(`${base}/?${q}&theme=${theme}#/trainer`);
        await page.waitForSelector('.vt', { timeout: 15000 });
        if (name.startsWith('case')) {
          // Get past the handover card into the running bedside when one is shown.
          const begin = page.getByRole('button', { name: /take over|begin|start case|accept/i }).first();
          if (await begin.isVisible().catch(() => false)) await begin.click().catch(() => {});
        }
        await page.waitForTimeout(name.startsWith('case') || name === 'lab-run' ? 2500 : 700);
        const m = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
          sh: document.documentElement.scrollHeight,
        }));
        const file = path.join(outDir, `${name}-${w}x${h}-${theme}.png`);
        await page.screenshot({ path: file });
        report.push({ name, size: `${w}x${h}`, theme, overflowX: m.sw > m.cw + 1 ? m.sw - m.cw : 0, pageHeight: m.sh, errors: [...errors] });
      }
      await ctx.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  const bad = report.filter(r => r.overflowX || r.errors.length);
  console.log(`${report.length} shots. Problems: ${bad.length}`);
  for (const b of bad) console.log(b.name, b.size, b.theme, 'overflowX=' + b.overflowX, b.errors.join(' | '));
})();
