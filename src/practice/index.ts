import type { PracticeItem, CardState } from './types';
import { validatePracticePack } from './validate';

// Conditionally load all private practice JSON files if present
// When src/practice/private/ is missing, glob returns empty object {}
const privateModules = import.meta.glob('./private/*.json', { eager: true }) as Record<
  string,
  { default?: PracticeItem[] | PracticeItem; items?: PracticeItem[] } | PracticeItem[]
>;

let cachedItems: PracticeItem[] | null = null;

const DOC_ORDER: Record<string, number> = {
  'The Ventilator Book -3rd edition.pdf': 1,
  'ventbook-items.json': 1,
  'vents101.pdf': 2,
  'icuedu-vents-items.json': 2,
  'ICUedu Vent Hemodynamics PDF.pdf': 3,
  'icuedu-other-items.json': 3,
};

function getDocPriority(path?: string, item?: PracticeItem): number {
  if (path) {
    for (const [key, prio] of Object.entries(DOC_ORDER)) {
      if (path.includes(key)) return prio;
    }
  }
  const file = item?.source?.file || '';
  for (const [key, prio] of Object.entries(DOC_ORDER)) {
    if (file.includes(key)) return prio;
  }
  return 99;
}

function parseChapterNumber(chapter?: string): number {
  if (!chapter) return 999;
  if (/philosophy|intro|foreword|preface/i.test(chapter)) return 0;
  if (/appendix/i.test(chapter)) return 900;
  const match = chapter.match(/Chapter\s+(\d+)/i) || chapter.match(/Ch\.?\s*(\d+)/i) || chapter.match(/^(\d+)/);
  if (match) return parseInt(match[1], 10);
  return 500;
}

export function loadPracticeItems(): PracticeItem[] {
  if (cachedItems !== null) {
    return cachedItems;
  }

  // Sort module paths by curriculum document priority: ventbook -> icuedu-vents -> icuedu-other
  const sortedPaths = Object.keys(privateModules).sort((a, b) => {
    const prioA = getDocPriority(a);
    const prioB = getDocPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    return a.localeCompare(b);
  });

  const allItems: PracticeItem[] = [];

  for (const path of sortedPaths) {
    const mod = privateModules[path];
    let itemsInMod: PracticeItem[] = [];
    if (Array.isArray(mod)) {
      itemsInMod = mod;
    } else if (mod && typeof mod === 'object') {
      if ('default' in mod && Array.isArray(mod.default)) {
        itemsInMod = mod.default as PracticeItem[];
      } else if ('items' in mod && Array.isArray(mod.items)) {
        itemsInMod = mod.items as PracticeItem[];
      } else if ('id' in mod && 'kind' in mod) {
        itemsInMod = [mod as unknown as PracticeItem];
      }
    }

    for (const item of itemsInMod) {
      allItems.push(item);
    }
  }

  // Sort items by (docPriority, chapterNumber, difficulty), preserving file order as tie-breaker
  allItems.sort((a, b) => {
    const prioA = getDocPriority(undefined, a);
    const prioB = getDocPriority(undefined, b);
    if (prioA !== prioB) return prioA - prioB;

    const chapA = parseChapterNumber(a.source?.chapter);
    const chapB = parseChapterNumber(b.source?.chapter);
    if (chapA !== chapB) return chapA - chapB;

    const diffA = a.difficulty ?? 2;
    const diffB = b.difficulty ?? 2;
    if (diffA !== diffB) return diffA - diffB;

    return 0;
  });

  cachedItems = allItems;
  return cachedItems;
}

export function hasPracticePack(): boolean {
  const items = loadPracticeItems();
  return items.length > 0;
}

export function getPracticeItemsBySource(): Record<string, { title: string; count: number; items: PracticeItem[] }> {
  const items = loadPracticeItems();
  const map: Record<string, { title: string; count: number; items: PracticeItem[] }> = {};

  for (const item of items) {
    const file = item.source.file;
    if (!map[file]) {
      map[file] = {
        title: file.replace('.pdf', ''),
        count: 0,
        items: [],
      };
    }
    map[file].count++;
    map[file].items.push(item);
  }

  return map;
}

export * from './types';
export * from './validate';
export * from './scheduler';
