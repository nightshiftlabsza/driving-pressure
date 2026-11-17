import { describe, it, expect, beforeEach } from 'vitest';
import { selectDueToday, completeDueRetestsForCompetency } from './dueToday';
import { scheduleDelayedRetest, listDelayedRetests, clearTutorExchanges } from '../tutor/store';

const HOUR = 3600 * 1000;
const NOW = new Date('2026-11-14T12:00:00.000Z');

const mk = (id: string, dueAt: number) => ({
  id,
  competencyId: 'mech.auto-peep',
  caseId: 'c1',
  dueAt,
  createdAt: dueAt - 48 * HOUR,
  completedAt: null,
  passed: null,
});

describe('due today', () => {
  beforeEach(async () => {
    await clearTutorExchanges();
  });

  it('includes a retest stored 48h ago and excludes a not-yet-due one', () => {
    const due = mk('r-due', NOW.getTime() - 1 * HOUR);
    const later = mk('r-later', NOW.getTime() + 5 * HOUR);
    const res = selectDueToday({ items: [], cardStates: {}, retests: [due, later], now: NOW });
    expect(res.retests.map(r => r.id)).toEqual(['r-due']);
    expect(res.total).toBe(1);
  });

  it('completing a retest removes it from due today', async () => {
    await scheduleDelayedRetest(mk('r-due', NOW.getTime() - 48 * HOUR + 1));
    await scheduleDelayedRetest(mk('r-later', NOW.getTime() + 5 * HOUR));
    let res = selectDueToday({ items: [], cardStates: {}, retests: await listDelayedRetests(), now: NOW });
    expect(res.retests.map(r => r.id)).toEqual(['r-due']);

    const done = await completeDueRetestsForCompetency('mech.auto-peep', true, NOW);
    expect(done).toEqual(['r-due']);

    res = selectDueToday({ items: [], cardStates: {}, retests: await listDelayedRetests(), now: NOW });
    expect(res.retests).toEqual([]);
    const stored = (await listDelayedRetests()).find(r => r.id === 'r-due')!;
    expect(stored.passed).toBe(true);
    expect((await listDelayedRetests()).find(r => r.id === 'r-later')!.completedAt).toBeNull();
  });
});
