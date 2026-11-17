import React, { useEffect, useMemo, useState } from 'react';
import type { LearnerApi } from '../shared/learnerApi';
import type { PracticeItem, CardState } from '../practice/types';
import { loadPracticeItems } from '../practice';
import { selectDueToday } from '../practice/dueToday';
import { listDelayedRetests, type DelayedRetestRecord } from '../tutor/store';

export interface DueTodayStripProps {
  learner: LearnerApi;
  /** Opens the Practice screen; wired to the trainer's hash navigation by Home. */
  onOpenPractice: () => void;
}

/**
 * The "Due today" line at the top of Home: due spaced-review cards plus due delayed
 * retests, using the same selector as the Practice screen. Renders nothing when
 * nothing is due.
 */
export const DueTodayStrip: React.FC<DueTodayStripProps> = ({ learner, onOpenPractice }) => {
  const allItems = useMemo<PracticeItem[]>(() => loadPracticeItems(), []);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const [retests, setRetests] = useState<DueTodayRetests>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Saved card states live in learner storage; the interface carries the method only
      // when the storage backend provides it (same optional call the Practice screen makes).
      const store: LearnerApi & { getPracticeCardStates?: () => Promise<Record<string, CardState>> } = learner;
      let states: Record<string, CardState> = {};
      try {
        states = store.getPracticeCardStates ? (await store.getPracticeCardStates()) ?? {} : {};
      } catch { /* storage unavailable in test / memory environments */ }
      let rts: DelayedRetestRecord[] = [];
      try {
        rts = await listDelayedRetests().catch(() => [] as DelayedRetestRecord[]);
      } catch { /* storage unavailable */ }
      if (cancelled) return;
      setCardStates(states);
      setRetests(rts);
    })();
    return () => { cancelled = true; };
  }, [learner]);

  const today = useMemo(() => new Date(), []);
  const due = useMemo(
    () => selectDueToday({ items: allItems, cardStates, retests, now: today }),
    [allItems, cardStates, retests, today],
  );

  if (due.total === 0) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 px-3 py-2 rounded border text-sm" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }} data-testid="due-today-strip">
      <span>
        Due today: <span className="num font-semibold">{due.reviewItems.length}</span> review cards,{' '}
        <span className="num font-semibold">{due.retests.length}</span> retests
      </span>
      <button type="button" className="vt-btn vt-btn--quiet !py-1 !px-2.5 !text-xs" data-testid="due-today-open-practice" onClick={onOpenPractice}>
        Open Practice
      </button>
    </div>
  );
};

type DueTodayRetests = DelayedRetestRecord[];
