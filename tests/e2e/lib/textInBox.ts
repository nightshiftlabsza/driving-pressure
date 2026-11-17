// @ts-nocheck
// Runs inside the page. Returns every piece of visible text that sticks out of, or is cut by, its nearest visible box.
// Used by text-in-box.spec.ts. A fixed-height box that is too small for its content is exactly what this catches.
/* eslint-disable */
export const findTextOutsideBox = () => {
  const vis = e => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0 && r.width > 0 && r.height > 0; };
  const hasOwnText = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) || [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
  const isBox = e => { const s = getComputedStyle(e); const bw = ['Top','Right','Bottom','Left'].some(k => parseFloat(s['border'+k+'Width']) > 0 && s['border'+k+'Style'] !== 'none'); const bg = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'; const clip = /hidden|clip|auto|scroll/.test(s.overflowX + s.overflowY); return bw || bg || clip; };
  const name = e => (e.getAttribute('data-testid') ? '[' + e.getAttribute('data-testid') + ']' : '') + e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
  const out = [];
  const textRect = e => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName)) return e.getBoundingClientRect(); const rg = document.createRange(); let r = null; for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) { if (!q.width) continue; r = r ? { left: Math.min(r.left, q.left), top: Math.min(r.top, q.top), right: Math.max(r.right, q.right), bottom: Math.max(r.bottom, q.bottom) } : { left: q.left, top: q.top, right: q.right, bottom: q.bottom }; } } return r; };
  for (const e of document.querySelectorAll('body *')) {
    if (!hasOwnText(e) || !vis(e)) continue;
    if (e.closest('svg, [aria-hidden="true"], .sr-only')) continue;
    const det = e.closest('details:not([open])'); if (det && !e.closest('summary')) continue;
    const s = getComputedStyle(e);
    if (s.position === 'fixed') continue;
    const r = textRect(e); if (!r) continue;
    if (/hidden|clip/.test(s.overflowX) && s.textOverflow === 'ellipsis') continue;
    const txt = String((typeof e.value === 'string' ? e.value : e.textContent) ?? '').trim().slice(0, 30);
    // own clipping: text wider/taller than the element that hides overflow, without ellipsis
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(e.tagName) && /hidden|clip/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1 && s.textOverflow !== 'ellipsis')
      out.push({ kind: 'clipped', el: name(e), txt, by: e.scrollWidth - e.clientWidth });
    if (e.tagName === 'INPUT' && e.type === 'text' && e.scrollWidth > e.clientWidth + 1)
      out.push({ kind: 'input-clipped', el: name(e), txt, by: e.scrollWidth - e.clientWidth });
    let b = e.parentElement, abs = s.position === 'absolute';
    while (b && b !== document.body) {
      const bs = getComputedStyle(b);
      if (isBox(b)) {
        const br = b.getBoundingClientRect();
        const scrolls = /auto|scroll/.test(bs.overflowX + bs.overflowY);
        const d = { l: br.left - r.left, t: br.top - r.top, r: r.right - br.right, b: r.bottom - br.bottom };
        const worst = Math.max(d.l, d.t, d.r, d.b);
        if (worst > 1.5 && !scrolls) out.push({ kind: /hidden|clip/.test(bs.overflowX + bs.overflowY) ? 'cut-by-box' : 'spills', el: name(e), txt, box: name(b), by: Math.round(worst * 10) / 10, side: Object.entries(d).sort((a, c) => c[1] - a[1])[0][0], abs });
        if (scrolls && (d.l > 1.5 || d.r > 1.5) && b.scrollWidth > b.clientWidth + 1 && bs.overflowX !== 'auto' && bs.overflowX !== 'scroll') out.push({ kind: 'cut-by-box', el: name(e), txt, box: name(b), by: Math.round(Math.max(d.l, d.r)) });
        break;
      }
      b = b.parentElement;
    }
  }
  // Covered text and unreadable text.
  const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return { l: 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]), a: m[3] === undefined ? 1 : m[3] }; };
  const modal = document.querySelector('.vt-dialog-backdrop, [role="dialog"], [aria-modal="true"]');
  for (const e of document.querySelectorAll('body *')) {
    if (!hasOwnText(e) || !vis(e) || e.closest('svg, [aria-hidden="true"], .sr-only, option')) continue;
    if (modal && !modal.contains(e)) continue;
    const det = e.closest('details:not([open])'); if (det && !e.closest('summary')) continue;
    const r = textRect(e); if (!r) continue;
    const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    let clippedAway = false;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const as = getComputedStyle(a); if (/auto|scroll|hidden|clip/.test(as.overflowX + as.overflowY)) { const ar = a.getBoundingClientRect(); if (x < ar.left || x > ar.right || y < ar.top || y > ar.bottom) { clippedAway = true; break; } } }
    if (clippedAway) continue;
    const txt = String((typeof e.value === 'string' ? e.value : e.textContent) ?? '').trim().slice(0, 30);
    const top = document.elementFromPoint(x, y);
    if (top && top !== e && !e.contains(top) && !top.contains(e) && getComputedStyle(e).pointerEvents !== 'none' && getComputedStyle(top).pointerEvents !== 'none' && !top.closest('.vt-dialog-backdrop'))
      out.push({ kind: 'covered', el: name(e), txt, box: name(top) });
    if (e.closest(':disabled, [aria-disabled="true"]') || (e.tagName === 'INPUT' && !e.value) || e.tagName === 'SELECT') continue;
    let bg = null, op = 1;
    for (let a = e; a; a = a.parentElement) { const as = getComputedStyle(a); op *= +as.opacity; if (!bg) { const c = lum(as.backgroundColor); if (c.a > 0.5) bg = c.l; if (as.backgroundImage !== 'none') { bg = null; break; } } }
    if (bg === null || op < 0.7) continue;
    const fg = lum(getComputedStyle(e).color); if (fg.a < 0.5) continue;
    const ratio = (Math.max(fg.l, bg) + 0.05) / (Math.min(fg.l, bg) + 0.05);
    if (ratio < 2.5) out.push({ kind: 'unreadable', el: name(e), txt, by: Math.round(ratio * 10) / 10 });
  }
  // Charts: nothing drawn in an SVG may fall outside that SVG.
  for (const svg of document.querySelectorAll('svg')) {
    if (!vis(svg)) continue;
    const sr = svg.getBoundingClientRect();
    for (const g of svg.querySelectorAll('text, line, rect, circle')) {
      const r = g.getBoundingClientRect(); if (!r.width && !r.height) continue;
      const worst = Math.max(sr.left - r.left, sr.top - r.top, r.right - sr.right, r.bottom - sr.bottom);
      if (worst > 2) { out.push({ kind: 'drawn-outside-chart', el: g.tagName, txt: (g.textContent || '').trim().slice(0, 30), box: name(svg), by: Math.round(worst) }); break; }
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push({ kind: 'page-wider-than-screen', by: document.documentElement.scrollWidth - innerWidth });
  return out;
};
