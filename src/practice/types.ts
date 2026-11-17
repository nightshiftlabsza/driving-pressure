import { z } from 'zod';

export type PracticeItemKind = 'predict-then-reveal' | 'case-drill' | 'flashcard';

export interface PracticeSourceRef {
  file: string;
  chapter: string;
  pageStart: number;
  pageEnd: number;
}

export interface SimulatorLink {
  type: 'case' | 'lab';
  id: string;
  label: string;
}

export interface PredictThenRevealItem {
  id: string;
  kind: 'predict-then-reveal';
  source: PracticeSourceRef;
  competencyId: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  scenario: string;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  simulatorCheckLink?: SimulatorLink;
}

export interface CaseDrillOption {
  text: string;
  isCorrect: boolean;
  feedback: string;
}

export interface CaseDrillStep {
  stepNumber: number;
  prompt: string;
  options: CaseDrillOption[];
}

export interface CaseDrillItem {
  id: string;
  kind: 'case-drill';
  source: PracticeSourceRef;
  competencyId: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  vignette: string;
  steps: CaseDrillStep[];
  simulatorCheckLink?: SimulatorLink;
}

export interface FlashcardItem {
  id: string;
  kind: 'flashcard';
  source: PracticeSourceRef;
  competencyId: string;
  difficulty: 1 | 2 | 3;
  tags: string[];
  front: string;
  back: string;
  subheading?: string;
  cloze?: boolean;
  simulatorCheckLink?: SimulatorLink;
}

export type PracticeItem = PredictThenRevealItem | CaseDrillItem | FlashcardItem;

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';

export interface CardState {
  itemId: string;
  intervalDays: number;
  repetitions: number;
  easeFactor: number;
  dueDate: string; // ISO date YYYY-MM-DD
  lastReviewed: string | null; // ISO timestamp
  lapseCount: number;
  history?: Array<{
    reviewedAt: string;
    grade: ReviewGrade;
  }>;
}

export interface PracticeSessionItem {
  item: PracticeItem;
  cardState: CardState;
  isNew: boolean;
}

export interface PracticeSession {
  id: string;
  startedAt: string;
  items: PracticeSessionItem[];
  currentIndex: number;
  completedItemIds: string[];
}
