import { loadPracticeItems } from '../practice';
import type { PracticeItem } from '../practice/types';
import type { HelpLevel } from './types';

export interface RagRetrievalOptions {
  competencyIds?: string[];
  misconceptionIds?: string[];
  queryText?: string;
  helpLevelCap: HelpLevel;
  isRevealStep?: boolean;
  items?: readonly PracticeItem[];
  maxItems?: number;
  maxChars?: number;
}

export interface RagPearl {
  id: string;
  competencyId: string;
  summary: string;
  sourceTitle: string;
  score: number;
}

const MAX_ITEMS_CAP = 2;
const DEFAULT_MAX_CHARS = 1000; // ~250 tokens budget at ~4 chars/token
const BM25_K1 = 1.5;
const BM25_B = 0.75;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_.\s-]/g, ' ')
    .split(/\s+/)
    .filter(tok => tok.length >= 2);
}

function itemSearchableText(item: PracticeItem): string {
  if (item.kind === 'predict-then-reveal') {
    return [
      item.competencyId,
      item.tags.join(' '),
      item.scenario,
      item.question,
      item.correctAnswer,
      item.explanation,
    ].join(' ');
  }
  if (item.kind === 'case-drill') {
    const stepText = item.steps
      .map(s => `${s.prompt} ${s.options.map(o => `${o.text} ${o.feedback}`).join(' ')}`)
      .join(' ');
    return [item.competencyId, item.tags.join(' '), item.vignette, stepText].join(' ');
  }
  return [
    item.competencyId,
    item.tags.join(' '),
    item.subheading ?? '',
    item.front,
    item.back,
  ].join(' ');
}

function itemPearlSummary(item: PracticeItem): string {
  if (item.kind === 'predict-then-reveal') {
    return `${item.question} -> ${item.correctAnswer}. ${item.explanation}`.trim();
  }
  if (item.kind === 'case-drill') {
    const firstCorrect = item.steps
      .flatMap(s => s.options)
      .find(o => o.isCorrect);
    return firstCorrect
      ? `${item.vignette.slice(0, 120)}... ${firstCorrect.text}: ${firstCorrect.feedback}`.trim()
      : item.vignette.trim();
  }
  return `${item.front} -> ${item.back}`.trim();
}

function truncateToBudget(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 3) return clean.slice(0, maxChars);
  return `${clean.slice(0, maxChars - 3).trimEnd()}...`;
}

/**
 * Retrieves up to 2 concise teaching pearls from the local Practice pack using offline BM25.
 * Restricted strictly to reveal/teaching contexts (`isRevealStep === true` or `helpLevelCap >= 2`).
 * Safely returns [] when the private practice pack is missing.
 */
export function retrieveLocalTeachingPearls(options: RagRetrievalOptions): RagPearl[] {
  if (!options.isRevealStep && options.helpLevelCap < 2) {
    return [];
  }

  let sourceItems: readonly PracticeItem[];
  try {
    sourceItems = options.items ?? loadPracticeItems();
  } catch {
    return [];
  }

  if (!sourceItems || sourceItems.length === 0) {
    return [];
  }

  const competencySet = new Set(
    (options.competencyIds ?? []).map(c => c.trim().toLowerCase()).filter(Boolean)
  );
  const pool =
    competencySet.size > 0
      ? sourceItems.filter(it => competencySet.has(it.competencyId.toLowerCase()))
      : [...sourceItems];

  if (pool.length === 0) {
    return [];
  }

  const queryTokens = tokenize(
    [
      options.queryText ?? '',
      ...(options.competencyIds ?? []),
      ...(options.misconceptionIds ?? []),
    ].join(' ')
  );

  const docs = pool.map(item => {
    const text = itemSearchableText(item);
    const tokens = tokenize(text);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }
    return { item, tokens, tf };
  });

  const N = docs.length;
  const avgDl = docs.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(1, N);

  const df = new Map<string, number>();
  for (const t of new Set(queryTokens)) {
    let count = 0;
    for (const d of docs) {
      if (d.tf.has(t)) count++;
    }
    df.set(t, count);
  }

  const misconceptionLower = new Set((options.misconceptionIds ?? []).map(m => m.toLowerCase()));

  const scored = docs.map((d, idx) => {
    let bm25 = 0;
    const dl = d.tokens.length;
    for (const q of queryTokens) {
      const f = d.tf.get(q) ?? 0;
      if (f === 0) continue;
      const nq = df.get(q) ?? 0;
      const idf = Math.log(1 + (N - nq + 0.5) / (nq + 0.5));
      const denom = f + BM25_K1 * (1 - BM25_B + BM25_B * (dl / Math.max(1, avgDl)));
      bm25 += idf * ((f * (BM25_K1 + 1)) / denom);
    }

    // Deterministic tie-breaker boost when misconceptionId appears in tags/text
    let tagBoost = 0;
    for (const tag of d.item.tags) {
      if (misconceptionLower.has(tag.toLowerCase())) tagBoost += 0.5;
    }

    // When no query text matches tokens yet, prefer higher-salience structured explanations stably
    const fallbackOrder = queryTokens.length === 0 ? 1 / (idx + 1) : 0;

    return {
      item: d.item,
      score: Math.round((bm25 + tagBoost + fallbackOrder) * 10000) / 10000,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));

  const limit = Math.max(0, Math.min(options.maxItems ?? MAX_ITEMS_CAP, MAX_ITEMS_CAP));
  const maxTotalChars = Math.max(120, options.maxChars ?? DEFAULT_MAX_CHARS);
  const perItemBudget = Math.floor(maxTotalChars / Math.max(1, limit));

  const results: RagPearl[] = [];
  let usedChars = 0;

  for (const entry of scored.slice(0, limit)) {
    const remaining = maxTotalChars - usedChars;
    if (remaining < 40) break;
    const sourceTitle = entry.item.source
      ? `${entry.item.source.chapter || entry.item.source.file}`.replace(/\.pdf$/i, '')
      : 'Local Practice Pack';
    const rawSummary = itemPearlSummary(entry.item);
    const summary = truncateToBudget(rawSummary, Math.min(perItemBudget, remaining));
    usedChars += summary.length;
    results.push({
      id: entry.item.id,
      competencyId: entry.item.competencyId,
      summary,
      sourceTitle,
      score: entry.score,
    });
  }

  return results;
}

export function formatRagPearls(pearls: readonly RagPearl[]): string[] {
  return pearls.map(p => `[${p.competencyId} | ${p.sourceTitle}] ${p.summary}`);
}
