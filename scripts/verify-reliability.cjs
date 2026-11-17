/* Real-browser checks for the reliability work: node scripts/verify-reliability.cjs [baseUrl]
 * 1. Theme: every screen follows the chosen theme, through navigation, repeated switching and reload.
 * 2. Alarms: plain labels, tone requested, silence and acknowledge behave.
 * 3. Bug reporter: screenshot, diagnostics, save to disk, retrieval, download fallback.
 * Prints PASS/FAIL lines and exits non-zero on any failure. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const base = process.argv[2] || 'http://127.0.0.1:3112';
const outDir = 'screenshots/reliability/verify';
fs.mkdirSync(outDir, { recursive: true });
let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

/** Share of the viewport covered by "wrong-tone" backgrounds: dark panels in a light theme, or light panels in dark. */
async function wrongToneShare(page, theme) {
  return page.evaluate((theme) => {
    const lum = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null;
      const [r, g, b, a = 1] = m[1].split(',').map(Number); if (a < 0.5) return null;
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    const vw = innerWidth, vh = innerHeight; let bad = 0; const offenders = [];
    for (const el of document.querySelectorAll('.vt *')) {
      if (el.closest('canvas, svg, [data-wave-well]')) continue;
      const cs = getComputedStyle(el); const l = lum(cs.backgroundColor); if (l === null) continue;
      const wrong = theme === 'dark' ? l > 0.75 : l < 0.25;
      if (!wrong) continue;
      const r = el.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      const share = (w * h) / (vw * vh);
      if (share > 0.01) { bad = Math.max(bad, share); offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${(share * 100).toFixed(1)}%`); }
    }
    return { bad, offenders: offenders.slice(0, 4) };
  }, theme);
}

async function enterCase(page) {
  // Get past the handover card and the opening prediction so the bedside is live.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(400);
    const takeOver = page.locator('[data-testid="handoff-card"] button').last();
    if (await takeOver.isVisible().catch(() => false)) { await takeOver.click(); continue; }
    const answer = page.getByLabel('Your answer');
    if (await answer.isVisible().catch(() => false)) {
      await answer.fill('66'); await page.getByRole('button', { name: 'Fairly sure' }).click();
      await page.getByRole('button', { name: 'Commit answer' }).click();
      await page.getByRole('button', { name: 'Continue' }).click().catch(() => {});
    }
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => consoleErrors.push('pageerror ' + String(e).slice(0, 160)));
  page.on('dialog', d => d.accept());

  // ---------- 1. Theme ----------
  await page.goto(`${base}/#/trainer`);
  await page.waitForSelector('.vt');
  const themeOf = () => page.getAttribute('.vt', 'data-theme');
  const tabs = ['tab-home', 'tab-cases', 'tab-drills', 'tab-lab', 'tab-practice', 'tab-progress'];
  const labTab = await page.locator('nav button', { hasText: /^Lab$/ }).getAttribute('data-testid');
  tabs[3] = labTab;
  for (const theme of ['light', 'dark', 'light', 'dark', 'light']) {
    await page.click(`[data-testid="theme-${theme}"]`);
    for (const t of tabs) {
      await page.click(`[data-testid="${t}"]`);
      await page.waitForTimeout(250);
      const got = await themeOf();
      const tone = await wrongToneShare(page, theme);
      check(got === theme && tone.bad < 0.03, `theme ${theme} on ${t}`, got !== theme ? `data-theme=${got}` : tone.offenders.join(' | '));
    }
  }
  // Inside a running lab experiment, switching both ways.
  await page.click(`[data-testid="${labTab}"]`);
  await page.getByRole('button', { name: /Start Experiment/i }).first().click();
  await page.waitForTimeout(1500);
  for (const theme of ['light', 'dark', 'light']) {
    await page.click(`[data-testid="theme-${theme}"]`);
    await page.waitForTimeout(300);
    const tone = await wrongToneShare(page, theme);
    check((await themeOf()) === theme && tone.bad < 0.03, `theme ${theme} inside a lab experiment`, tone.offenders.join(' | '));
    await page.screenshot({ path: path.join(outDir, `lab-run-${theme}.png`) });
  }
  // Leave the lab and come back: still light. Reload: still light. Then the same for dark.
  await page.click('[data-testid="tab-home"]'); await page.click(`[data-testid="${labTab}"]`);
  check((await themeOf()) === 'light', 'light survives leaving and re-entering the Lab');
  await page.reload(); await page.waitForSelector('.vt');
  check((await themeOf()) === 'light', 'light survives a page reload');
  await page.click('[data-testid="theme-dark"]'); await page.click(`[data-testid="${labTab}"]`);
  await page.reload(); await page.waitForSelector('.vt');
  check((await themeOf()) === 'dark', 'dark survives a page reload');
  await page.click('[data-testid="theme-light"]');

  // Brand picker: not on Drills, present in a case.
  await page.click('[data-testid="tab-drills"]');
  check((await page.locator('[data-testid="skin-picker"]').count()) === 0, 'ventilator brand picker is absent on Drills');

  // ---------- 2. Alarms (ARDS case starts with a high pressure alarm) ----------
  await page.goto(`${base}/?case=ards-vent-01&theme=light#/trainer`);
  await page.waitForSelector('[data-testid="case-runner"]');
  await enterCase(page);
  check((await page.locator('[data-testid="skin-picker"]').count()) === 1, 'ventilator brand picker is present in a case');
  await page.click('[data-testid="skin-picker"] button:has-text("Mindray")');
  const modeMindray = await page.textContent('[data-testid="active-mode"]');
  await page.click('[data-testid="skin-picker"] button:has-text("Hamilton")');
  const modeHamilton = await page.textContent('[data-testid="active-mode"]');
  check(modeMindray !== modeHamilton, 'brand picker changes the ventilator labels', `${modeHamilton} vs ${modeMindray}`);
  await page.waitForTimeout(1500);
  const bar = page.locator('[data-testid="alarm-field"]');
  const barText = await bar.innerText();
  check(/Pressure high|SpO2 low/i.test(barText), 'alarm bar names the alarm', barText.replace(/\n/g, ' / '));
  check(/Silence 2 min/.test(barText) && /Acknowledge/.test(barText) && /Sound on/.test(barText), 'alarm controls use plain words');
  check(!/\bAck\b|Silence 2m\b/.test(barText), 'no cryptic "Ack" or "Silence 2m"');
  check((await bar.getAttribute('data-sounding')) === 'high', 'high-priority tone is sounding', String(await bar.getAttribute('data-sounding')));
  await page.screenshot({ path: path.join(outDir, 'case-alarm-light.png') });
  await page.click('[data-testid="alarm-silence-btn"]');
  check(/Silenced \d:\d\d/.test(await bar.innerText()) && (await bar.getAttribute('data-sounding')) === 'off', 'Silence stops the tone and shows a countdown');
  await page.click('[data-testid="alarm-silence-btn"]');
  check((await bar.getAttribute('data-sounding')) === 'high', 'pressing Silenced again lets the tone return');
  await page.click('[data-testid="alarm-ack-btn"]');
  check(/Acknowledged/.test(await bar.innerText()) && (await bar.getAttribute('data-sounding')) === 'off', 'Acknowledge marks the alarm and stops its tone');
  await page.click('[data-testid="alarm-sound-toggle"]');
  check(/Sound off/.test(await bar.innerText()), 'sound switch turns off');
  await page.reload(); await page.waitForSelector('[data-testid="alarm-field"]'); await enterCase(page);
  check(/Sound off/.test(await page.locator('[data-testid="alarm-field"]').innerText()), 'sound switch is remembered after reload');
  await page.click('[data-testid="alarm-sound-toggle"]');

  // Consultant tab holds the tutor; nothing at the page bottom.
  await page.getByRole('tab', { name: /Consultant/ }).click();
  check(await page.locator('[data-testid="consultant-pane"] [data-testid="tutor-off"]').isVisible(), 'AI tutor is in the Consultant tab');

  // ---------- 3. Bug reporter during the active case ----------
  await page.getByRole('tab', { name: /Patient/ }).click();
  await page.click('[data-testid="bug-report-open"]');
  await page.waitForSelector('[data-testid="bug-report-dialog"]');
  const preview = page.locator('[data-testid="bug-report-preview"]');
  check(await preview.isVisible().catch(() => false), 'screenshot preview is shown');
  const nat = await preview.evaluate(i => ({ w: i.naturalWidth, h: i.naturalHeight })).catch(() => ({ w: 0, h: 0 }));
  check(nat.w >= 1900 && nat.h >= 1000, 'screenshot has the size of the window', `${nat.w}x${nat.h}`);
  await page.fill('[data-testid="bug-report-text"]', 'Verification run: reporter test during an active case.');
  await page.click('[data-testid="bug-report-send"]');
  await page.waitForSelector('[data-testid="bug-report-saved"]', { timeout: 15000 });
  const id = await page.textContent('[data-testid="bug-report-id"]');
  const folder = path.join('bug-reports', id);
  const jsonPath = path.join(folder, 'report.json');
  check(fs.existsSync(jsonPath) && fs.existsSync(path.join(folder, 'screenshot.png')), 'report and screenshot are on disk', folder);
  if (fs.existsSync(jsonPath)) {
    const r = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    check(r.section === 'case:ards-vent-01' && r.context?.case?.caseId === 'ards-vent-01', 'report names the screen and case', r.section);
    check(r.context?.case?.device?.device === 'invasive' && typeof r.context?.case?.monitored?.spo2Pct === 'number', 'report holds ventilator settings and patient values');
    check(r.environment?.viewport?.width === 1920 && r.environment?.browser === 'Chrome' && r.theme === 'light' && !!r.app?.commit, 'report holds browser, viewport, theme, build', `${r.environment?.browser} ${r.environment?.browserVersion} commit ${r.app?.commit}`);
    check(Array.isArray(r.recentActions) && r.recentActions.some(a => /alarm-silence-btn|alarm-sound-toggle/.test(a.target)), 'report holds recent clicks');
    check(/Verification run/.test(r.description), 'report holds the optional description');
    fs.copyFileSync(path.join(folder, 'screenshot.png'), path.join(outDir, 'bug-report-screenshot-case.png'));
  }
  await page.getByRole('button', { name: 'Back to studying' }).click();
  check(await page.locator('[data-testid="case-runner"]').isVisible(), 'the case is still running after reporting');
  const list = await (await page.request.get(`${base}/api/bug-report`)).json();
  check(list.success && list.reports.some(r => r.id === id), 'saved report can be listed again');

  // No description, on a phone-sized window.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-testid="bug-report-open"]');
  await page.waitForSelector('[data-testid="bug-report-dialog"]');
  const dlgBox = await page.locator('[data-testid="bug-report-dialog"]').boundingBox();
  check(!!dlgBox && dlgBox.x >= 0 && dlgBox.x + dlgBox.width <= 391, 'report dialog fits a phone screen');
  await page.screenshot({ path: path.join(outDir, 'bug-report-dialog-phone.png') });
  await page.click('[data-testid="bug-report-send"]');
  await page.waitForSelector('[data-testid="bug-report-saved"]', { timeout: 15000 });
  check(true, 'report with no description is accepted');
  await page.getByRole('button', { name: 'Back to studying' }).click();
  await page.setViewportSize({ width: 1920, height: 1080 });

  // Fallback: the local store is unreachable, so the report downloads instead.
  await page.route('**/api/bug-report', r => r.abort());
  await page.click('[data-testid="bug-report-open"]');
  await page.waitForSelector('[data-testid="bug-report-dialog"]');
  await page.screenshot({ path: path.join(outDir, 'bug-report-dialog-desktop.png') });
  await page.click('[data-testid="bug-report-send"]');
  await page.waitForSelector('[data-testid="bug-report-fallback"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="bug-report-download"]')]);
  const dlPath = path.join(outDir, 'fallback-' + dl.suggestedFilename());
  await dl.saveAs(dlPath);
  const exported = fs.existsSync(dlPath) && dlPath.endsWith('.json') ? JSON.parse(fs.readFileSync(dlPath, 'utf8')) : null;
  check(!!exported && String(exported.screenshotPngDataUrl).startsWith('data:image/png') && exported.section === 'case:ards-vent-01', 'download fallback gives a complete report with screenshot');
  if (exported) fs.unlinkSync(dlPath);
  await page.unroute('**/api/bug-report');

  const realErrors = consoleErrors.filter(e => !/bug-report|net::ERR_FAILED/.test(e));
  check(realErrors.length === 0, 'no console errors during the whole run', realErrors.slice(0, 3).join(' | '));

  await browser.close();
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
