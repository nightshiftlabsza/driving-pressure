import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Theme colours must come from the CSS variables in src/styles/tokens.css.
// Fixed palette colours are what kept the Lab dark in the light theme.
const PALETTE = /\b(?:bg|text|border|ring|from|to|placeholder|divide|fill|stroke)-(?:slate|gray|zinc|neutral|stone|white|black|sky|blue|amber|emerald|red|green|rose|yellow|orange|cyan|indigo|teal|purple|violet|pink|lime|fuchsia)(?:-\d{2,3})?(?:\/\d+)?\b/g;
const HEX = /-\[#[0-9a-fA-F]{3,8}\]/;
const ALLOWED = /^bg-black\/\d+$/; // modal backdrops

const SRC = path.resolve(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

describe('no hard-coded colours in components', () => {
  it('uses theme tokens only', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const bad = (line.match(PALETTE) ?? []).filter(m => !ALLOWED.test(m));
        if (bad.length > 0 || HEX.test(line)) {
          offenders.push(`${path.relative(SRC, file).replace(/\\/g, '/')}:${i + 1} ${[...bad, ...(HEX.test(line) ? ['hex'] : [])].join(',')}`);
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
