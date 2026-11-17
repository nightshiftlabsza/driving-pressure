import React from 'react';
import type { OrderType } from '../shared/caseSchema';

export interface StageOrder { order: OrderType }

/** Orders that only gather information. Anything else the learner places (or a settings change) is an action. */
const LOOK_ORDERS: OrderType[] = ['examine', 'abg', 'cxr'];
const REASSESS_ORDERS: OrderType[] = ['examine', 'abg'];

export interface Stages { assess: boolean; act: boolean; reassess: boolean }

/**
 * Three stages lit from what the learner has actually done, in the order they did it.
 * Assess: the handoff is taken and an exam or blood gas has been ordered.
 * Act: the first settings or device change, or the first treatment order.
 * Reassess: an exam or blood gas ordered after that first action.
 */
export function caseStages(orders: readonly StageOrder[], handoffTaken: boolean): Stages {
  const firstAct = orders.findIndex(o => !LOOK_ORDERS.includes(o.order));
  const assess = handoffTaken && orders.some(o => REASSESS_ORDERS.includes(o.order));
  const act = firstAct >= 0;
  const reassess = act && orders.slice(firstAct + 1).some(o => REASSESS_ORDERS.includes(o.order));
  return { assess, act, reassess };
}

const STAGE_LABELS: [keyof Stages, string][] = [['assess', 'Assess'], ['act', 'Act'], ['reassess', 'Reassess']];

export const CaseProgress: React.FC<{
  simTimeSec: number;
  maxSimMin: number;
  studyTime: string;
  stages: Stages;
  fmt: (sec: number) => string;
  children?: React.ReactNode;
}> = ({ simTimeSec, maxSimMin, studyTime, stages, fmt, children }) => {
  const maxSec = maxSimMin * 60;
  const pct = Math.max(0, Math.min(100, (simTimeSec / maxSec) * 100));
  return (
    <section className="px-3 py-2 border-b" style={{ borderColor: 'var(--line)' }} aria-label="Case progress" data-testid="case-progress">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2" title="Patient time is simulated clinical time. Study time is the real time you have spent in this case.">
        <span className="text-xs" style={{ color: 'var(--text-2)' }}>
          Patient time <span className="num text-lg font-semibold" style={{ color: 'var(--text)' }} aria-label="Simulated time">{fmt(simTimeSec)}</span>
          <span className="num"> of up to {fmt(maxSec)}</span>
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-3)' }}>Study time <span className="num" data-testid="study-time">{studyTime}</span></span>
      </div>
      <div className="mt-1.5 h-1 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }} role="progressbar" aria-label="Patient time used" aria-valuemin={0} aria-valuemax={maxSec} aria-valuenow={Math.round(Math.min(simTimeSec, maxSec))}>
        <div className="h-full" style={{ width: `${pct}%`, background: 'var(--sel)' }} />
      </div>
      <ol className="mt-2 flex gap-4 text-xs" data-testid="case-stages">
        {STAGE_LABELS.map(([k, label]) => (
          <li key={k} className="flex items-center gap-1.5" data-lit={stages[k] || undefined} aria-label={`${label}${stages[k] ? ', done' : ''}`}>
            <span aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-full border" style={{ borderColor: stages[k] ? 'var(--sel)' : 'var(--line-strong)', background: stages[k] ? 'var(--sel)' : 'transparent' }} />
            <span className={stages[k] ? 'font-semibold' : ''} style={{ color: stages[k] ? 'var(--text)' : 'var(--text-3)' }}>{label}</span>
          </li>
        ))}
      </ol>
      {children}
    </section>
  );
};
