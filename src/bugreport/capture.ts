/**
 * Screenshot of what the learner is looking at, made inside the browser with no extra library and no permission prompt.
 *
 * How: copy the page (with its own stylesheets, so themes and layout are exact), swap each live waveform canvas for a
 * still image of itself, carry over what is typed in fields, and let the browser paint that copy into a PNG.
 * It is taken before the report dialog opens, so the dialog never covers the picture.
 * Inner panels keep their scroll offset. Known limit: hover highlights are not kept.
 */

function collectCss(): string {
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) css += rule.cssText + '\n';
    } catch { /* a cross-origin sheet cannot be read: skip it */ }
  }
  return css;
}

function freezeLiveContent(source: Element, clone: Element): void {
  const srcCanvases = source.querySelectorAll('canvas');
  const cloneCanvases = clone.querySelectorAll('canvas');
  srcCanvases.forEach((c, i) => {
    const target = cloneCanvases[i];
    if (!target) return;
    const img = document.createElement('img');
    try { img.src = c.toDataURL('image/png'); } catch { return; }
    for (const attr of Array.from(c.attributes)) if (attr.name !== 'width' && attr.name !== 'height') img.setAttribute(attr.name, attr.value);
    const r = c.getBoundingClientRect();
    img.style.width = `${r.width}px`;
    img.style.height = `${r.height}px`;
    img.style.display = getComputedStyle(c).display === 'inline' ? 'inline-block' : getComputedStyle(c).display;
    target.replaceWith(img);
  });

  const srcFields = source.querySelectorAll('input, textarea, select');
  const cloneFields = clone.querySelectorAll('input, textarea, select');
  srcFields.forEach((f, i) => {
    const t = cloneFields[i];
    if (!t) return;
    if (f instanceof HTMLInputElement && t instanceof HTMLInputElement) {
      if (f.type === 'checkbox' || f.type === 'radio') { if (f.checked) t.setAttribute('checked', ''); else t.removeAttribute('checked'); }
      else if (f.type !== 'password') t.setAttribute('value', f.value);
    } else if (f instanceof HTMLTextAreaElement) {
      t.textContent = f.value;
    } else if (f instanceof HTMLSelectElement && t instanceof HTMLSelectElement) {
      Array.from(t.options).forEach((o, j) => { if (j === f.selectedIndex) o.setAttribute('selected', ''); else o.removeAttribute('selected'); });
    }
  });

  // position:fixed has no meaning inside the copy; pin those elements where they are on screen.
  const srcAll = source.querySelectorAll<HTMLElement>('*');
  const cloneAll = clone.querySelectorAll<HTMLElement>('*');
  srcAll.forEach((el, i) => {
    const t = cloneAll[i];
    if (!t || getComputedStyle(el).position !== 'fixed') return;
    const r = el.getBoundingClientRect();
    t.style.position = 'absolute';
    t.style.left = `${r.left + window.scrollX}px`;
    t.style.top = `${r.top + window.scrollY}px`;
    t.style.width = `${r.width}px`;
    t.style.height = `${r.height}px`;
    t.style.right = 'auto';
    t.style.bottom = 'auto';
  });

  // Inner panels scrolled with scrollTop/scrollLeft: clip the copy and shift its content by the same offset.
  srcAll.forEach((el, i) => {
    const t = cloneAll[i];
    if (!t || (el.scrollTop <= 0 && el.scrollLeft <= 0)) return;
    const cs = getComputedStyle(el);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') return;
    const wrap = document.createElement('div');
    wrap.style.boxSizing = 'border-box';
    wrap.style.width = `${el.scrollWidth}px`;
    wrap.style.height = `${el.scrollHeight}px`;
    wrap.style.flex = 'none';
    wrap.style.padding = cs.padding;
    wrap.style.display = cs.display === 'inline' ? 'block' : cs.display;
    wrap.style.flexDirection = cs.flexDirection;
    wrap.style.flexWrap = cs.flexWrap;
    wrap.style.gap = cs.gap;
    wrap.style.alignItems = cs.alignItems;
    wrap.style.justifyContent = cs.justifyContent;
    wrap.style.gridTemplateColumns = cs.gridTemplateColumns;
    wrap.style.gridTemplateRows = cs.gridTemplateRows;
    wrap.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    while (t.firstChild) wrap.appendChild(t.firstChild);
    t.appendChild(wrap);
    t.style.overflow = 'hidden';
    t.style.padding = '0';
  });
}

export interface Screenshot { dataUrl: string; width: number; height: number }

/** Returns a PNG data URL of the visible page, or throws with a plain reason. */
export async function captureScreenshot(maxPixelRatio = 2): Promise<Screenshot> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const body = document.body;
  const clone = body.cloneNode(true) as HTMLElement;
  // Match source and clone by index first; remove nodes only afterwards so the indexes stay aligned.
  freezeLiveContent(body, clone);
  clone.querySelectorAll('script, noscript, [data-bugreport-ui]').forEach(n => n.remove());

  const bodyStyle = getComputedStyle(body);
  const html = document.documentElement;
  const xhtml = new XMLSerializer().serializeToString(clone);
  const css = collectCss().replace(/<\/style/gi, '<\\/style');
  const rootAttrs = Array.from(html.attributes).filter(a => a.name === 'class' || a.name.startsWith('data-')).map(a => `${a.name}="${a.value.replace(/"/g, '&quot;')}"`).join(' ');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" ${rootAttrs} style="width:${width}px;height:${height}px;overflow:hidden;position:relative;background:${bodyStyle.backgroundColor};">` +
    `<style>${css.replace(/&/g, '&amp;').replace(/</g, '&lt;')}\n*{scrollbar-width:none}</style>` +
    `<div style="position:absolute;left:${-window.scrollX}px;top:${-window.scrollY}px;width:${html.scrollWidth}px;">${xhtml}</div>` +
    `</div></foreignObject></svg>`;

  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('The browser could not draw the page copy.'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  // Keep very large displays (4K, ultrawide) at a sensible file size.
  const ratio = Math.min(window.devicePixelRatio || 1, maxPixelRatio, 4096 / width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.scale(ratio, ratio);
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}
