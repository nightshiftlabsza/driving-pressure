// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { DueTodayStrip } from './DueTodayStrip';
import { FakeLearner } from './FakeLearner';
import { scheduleDelayedRetest, clearTutorExchanges } from '../tutor/store';
import type { PracticeItem } from '../practice/types';

const hoisted = vi.hoisted(() => {
  const item: PracticeItem = {
    id: 'practice-test-card',
    kind: 'flashcard',
    source: { file: 'test.json', chapter: 'Chapter 1', pageStart: 1, pageEnd: 2 },
    competencyId: 'gas.dead-space',
    difficulty: 1,
    tags: [],
    front: 'Front',
    back: 'Back',
  };
  return { items: [item] as PracticeItem[] };
});

vi.mock('../practice', () => ({
  loadPracticeItems: () => hoisted.items,
}));

const dueCardState = {
  itemId: 'practice-test-card',
  intervalDays: 1,
  repetitions: 1,
  easeFactor: 2.5,
  dueDate: '2020-01-01',
  lastReviewed: '2020-01-01T00:00:00.000Z',
  lapseCount: 0,
};

function learnerWithCardStates(states: Record<string, unknown>): FakeLearner {
  const learner = new FakeLearner();
  Object.assign(learner, { getPracticeCardStates: async () => states });
  return learner;
}

beforeEach(async () => {
  await clearTutorExchanges();
});

afterEach(async () => {
  cleanup();
  await clearTutorExchanges();
});

describe('DueTodayStrip', () => {
  it('renders nothing when nothing is due', async () => {
    const learner = learnerWithCardStates({});
    const { container } = render(<DueTodayStrip learner={learner} onOpenPractice={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-testid="due-today-strip"]')).toBeNull());
    expect(screen.queryByText(/Due today/)).toBeNull();
  });

  it('shows the two counts and opens Practice from the button', async () => {
    await scheduleDelayedRetest({
      id: 'retest-1', competencyId: 'gas.dead-space', caseId: 'ards-vent-01',
      dueAt: Date.now() - 1000, createdAt: Date.now() - 5000, completedAt: null, passed: null,
    });
    const onOpenPractice = vi.fn();
    render(<DueTodayStrip learner={learnerWithCardStates({ 'practice-test-card': dueCardState })} onOpenPractice={onOpenPractice} />);
    const strip = await screen.findByTestId('due-today-strip');
    expect(strip.textContent).toContain('Due today: 1 review cards, 1 retests');
    fireEvent.click(screen.getByTestId('due-today-open-practice'));
    expect(onOpenPractice).toHaveBeenCalledTimes(1);
  });

  it('hides strip again when the only retest is completed', async () => {
    await scheduleDelayedRetest({
      id: 'retest-2', competencyId: 'gas.dead-space', caseId: 'ards-vent-01',
      dueAt: Date.now() - 1000, createdAt: Date.now() - 5000, completedAt: Date.now() - 500, passed: true,
    });
    const { container } = render(<DueTodayStrip learner={learnerWithCardStates({})} onOpenPractice={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-testid="due-today-strip"]')).toBeNull());
  });
});
