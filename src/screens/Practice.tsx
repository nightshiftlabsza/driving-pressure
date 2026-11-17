import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { LearnerApi } from '../shared/learnerApi';
import type {
  PracticeItem,
  CardState,
  ReviewGrade,
  PracticeSession,
  PracticeSessionItem,
} from '../practice/types';
import {
  loadPracticeItems,
  hasPracticePack,
  getPracticeItemsBySource,
} from '../practice/index';
import {
  scheduleNextReview,
  createInitialCardState,
  isCardDue,
  buildPracticeSession,
  formatDateIso,
} from '../practice/scheduler';
import { recordPracticeEvidence } from '../practice/learnerLinkage';
import { selectDueToday } from '../practice/dueToday';
import { listDelayedRetests, type DelayedRetestRecord } from '../tutor/store';
import { getFriendlyCompetencyName } from '../learner/derivation';
import type { Confidence } from '../shared/events';
import { TutorPanel } from '../tutor/TutorPanel';
import { buildPracticeContext } from '../tutor/context';
import { computeHelpLevelCap } from '../tutor/policy';

export interface PracticeProps {
  learner: LearnerApi;
  onNavigateToCase?: (caseId: string) => void;
  onNavigateToLab?: (labId: string) => void;
}

export const Practice: React.FC<PracticeProps> = ({
  learner,
  onNavigateToCase,
  onNavigateToLab,
}) => {
  const packInstalled = useMemo(() => hasPracticePack(), []);
  const allItems = useMemo(() => loadPracticeItems(), []);
  const sourcesMap = useMemo(() => getPracticeItemsBySource(), []);

  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const [delayedRetests, setDelayedRetests] = useState<DelayedRetestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [selectedChapter, setSelectedChapter] = useState<string>('all');

  // Active session state
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [currentQueue, setCurrentQueue] = useState<PracticeSessionItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);

  // Current item interaction state
  const [userPrediction, setUserPrediction] = useState<string>('');
  const [confidence, setConfidence] = useState<Confidence>('fairly_sure');
  const [isCommitted, setIsCommitted] = useState(false);
  const [drillStepIndex, setDrillStepIndex] = useState(0);
  const [drillAnswers, setDrillAnswers] = useState<number[]>([]);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [showUnpackTutor, setShowUnpackTutor] = useState(false);

  // Load saved card states from learner storage
  const loadStates = useCallback(async () => {
    try {
      if ((learner as any).getPracticeCardStates) {
        const states = await (learner as any).getPracticeCardStates();
        setCardStates(states ?? {});
      }
      setDelayedRetests(await listDelayedRetests().catch(() => []));
    } catch {
      // Ignore storage errors in test / memory environments
    } finally {
      setLoading(false);
    }
  }, [learner]);

  useEffect(() => {
    void loadStates();
  }, [loadStates]);

  // Save states helper
  const persistStates = async (newStates: Record<string, CardState>) => {
    setCardStates(newStates);
    try {
      if ((learner as any).savePracticeCardStates) {
        await (learner as any).savePracticeCardStates(newStates);
      }
    } catch {
      // Ignore
    }
  };

  // Metrics
  const today = useMemo(() => new Date(), []);
  const dueToday = useMemo(
    () => selectDueToday({ items: allItems, cardStates, retests: delayedRetests, now: today }),
    [allItems, cardStates, delayedRetests, today],
  );
  const dueItems = dueToday.reviewItems;

  const masteredCount = useMemo(() => {
    return Object.values(cardStates).filter(
      s => s.repetitions >= 3 && s.intervalDays >= 7,
    ).length;
  }, [cardStates]);

  // Available chapters for selected source
  const availableChapters = useMemo(() => {
    if (selectedSource === 'all') return [];
    const sourceItems = sourcesMap[selectedSource]?.items ?? [];
    const set = new Set<string>();
    for (const i of sourceItems) {
      set.add(i.source.chapter);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [selectedSource, sourcesMap]);

  // Start a new practice session
  const startSession = (onlyDue = false) => {
    let candidateItems = allItems;
    if (selectedSource !== 'all') {
      candidateItems = candidateItems.filter(i => i.source.file === selectedSource);
    }
    if (selectedChapter !== 'all') {
      candidateItems = candidateItems.filter(i => i.source.chapter === selectedChapter);
    }

    const newSession = buildPracticeSession(candidateItems, cardStates, today, {
      maxDue: onlyDue ? 50 : 15,
      maxNew: onlyDue ? 0 : 10,
    });

    if (newSession.items.length === 0) return;

    setSession(newSession);
    setCurrentQueue([...newSession.items]);
    setQueueIndex(0);
    resetItemInteraction();
  };

  const resetItemInteraction = () => {
    setUserPrediction('');
    setConfidence('fairly_sure');
    setIsCommitted(false);
    setDrillStepIndex(0);
    setDrillAnswers([]);
    setShowSourceModal(false);
    setShowUnpackTutor(false);
  };

  const currentSessionItem = currentQueue[queueIndex];

  // Spacebar reveals flashcard answer when not focused on input/textarea
  useEffect(() => {
    if (!session || !currentSessionItem) return;
    const item = currentSessionItem.item;
    if (item.kind !== 'flashcard' || isCommitted) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === ' ') {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea') return;
        e.preventDefault();
        setIsCommitted(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [session, currentSessionItem, isCommitted]);

  // Handle Review Grade (again, hard, good, easy)
  const handleGrade = async (grade: ReviewGrade) => {
    if (!currentSessionItem) return;

    const item = currentSessionItem.item;
    const currentState =
      cardStates[item.id] ?? createInitialCardState(item.id, formatDateIso(today));

    // Calculate next spaced repetition schedule
    const nextState = scheduleNextReview(currentState, grade, new Date());
    const updatedStates = { ...cardStates, [item.id]: nextState };
    await persistStates(updatedStates);

    // Record evidence and mistake in learner model
    let feedback: string | undefined;
    if (item.kind === 'case-drill') {
      const step = item.steps[drillStepIndex];
      const opt = step?.options[drillAnswers[drillStepIndex]];
      if (opt && !opt.isCorrect) feedback = opt.feedback;
    }
    await recordPracticeEvidence(learner, item, grade, confidence, feedback);

    // Re-queue card if grade was 'again' (re-test in same session)
    if (grade === 'again') {
      setCurrentQueue(prev => [...prev, currentSessionItem]);
    }

    // Advance to next item
    if (queueIndex + 1 < currentQueue.length) {
      setQueueIndex(prev => prev + 1);
      resetItemInteraction();
    } else {
      // Completed session
      setSession(null);
      setCurrentQueue([]);
      resetItemInteraction();
    }
  };

  if (!packInstalled) {
    return (
      <div className="p-6 max-w-4xl mx-auto" data-testid="practice-screen">
        <div className="vt-card p-8 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full mx-auto" style={{ background: 'var(--surface-2)', border: '1px solid var(--line-strong)' }}>
            <svg className="w-6 h-6" style={{ color: 'var(--act)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
          </div>
          <h1 className="text-xl font-bold">Personal Practice Pack Not Installed</h1>
          <p className="text-sm opacity-80 max-w-xl mx-auto">
            This module turns your clinical library into active practice (predict-then-reveal, case drills, and spaced repetition flashcards).
          </p>
          <div className="p-4 rounded border text-left text-xs space-y-2 max-w-md mx-auto" style={{ borderColor: 'var(--line)', background: 'var(--surface-muted)' }}>
            <div className="font-semibold">How to install your private pack:</div>
            <div>1. Place source PDFs into <code>reference/</code>.</div>
            <div>2. Extract and generate items into <code>src/practice/private/*.json</code>.</div>
            <div>3. Both folders are strictly gitignored to protect copyrighted materials.</div>
          </div>
        </div>
      </div>
    );
  }

  // --- Session Runner View ---
  if (session && currentSessionItem) {
    const item = currentSessionItem.item;
    const isNew = currentSessionItem.isNew;
    const progressPercent = Math.round((queueIndex / currentQueue.length) * 100);

    return (
      <div className="p-4 max-w-3xl mx-auto space-y-4" data-testid="practice-session">
        {/* Progress & Header */}
        <div className="flex items-center justify-between text-xs opacity-75">
          <div>
            Item {queueIndex + 1} of {currentQueue.length} {isNew ? '(New)' : '(Review)'}
          </div>
          <button
            type="button"
            className="vt-btn vt-btn-secondary text-xs px-2 py-1"
            onClick={() => {
              if (window.confirm('End this practice session?')) {
                setSession(null);
                setCurrentQueue([]);
              }
            }}
          >
            End Session
          </button>
        </div>
        <div className="w-full bg-[var(--surface-3)] h-1.5 rounded-full overflow-hidden">
          <div
            className="bg-[var(--primary)] h-full transition-all duration-200"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Practice Item Card */}
        <div className="vt-card p-6 space-y-5" data-testid="practice-item-card">
          {/* Source Citation Pill */}
          <div className="flex items-center justify-between">
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--text-muted)' }}>
              {item.source.chapter}
            </span>
            <button
              type="button"
              className="text-xs underline text-[var(--sel)] hover:text-[var(--sel)]"
              onClick={() => setShowSourceModal(true)}
              data-testid="practice-source-btn"
            >
              📖 Source (pp {item.source.pageStart}–{item.source.pageEnd})
            </button>
          </div>

          {/* ITEM KIND 1: PREDICT-THEN-REVEAL */}
          {item.kind === 'predict-then-reveal' && (
            <div className="space-y-4">
              <div className="text-sm font-semibold">{item.scenario}</div>
              <div className="text-sm">{item.question}</div>

              {!isCommitted ? (
                <div className="space-y-4 pt-2">
                  {item.options && item.options.length > 0 ? (
                    <div className="space-y-2">
                      {item.options.map((opt, i) => (
                        <label
                          key={i}
                          className="flex items-start gap-2 p-2 rounded cursor-pointer border text-sm"
                          style={{
                            borderColor: userPrediction === opt ? 'var(--accent)' : 'var(--line)',
                            background: userPrediction === opt ? 'var(--surface-muted)' : 'transparent',
                          }}
                        >
                          <input
                            type="radio"
                            name="prediction"
                            value={opt}
                            checked={userPrediction === opt}
                            onChange={() => setUserPrediction(opt)}
                            className="mt-1"
                          />
                          <span>{opt}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <textarea
                        className="vt-input w-full text-sm p-2"
                        rows={3}
                        placeholder="Type your clinical prediction before revealing..."
                        value={userPrediction}
                        onChange={e => setUserPrediction(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Confidence selector */}
                  <div className="flex items-center gap-3 text-xs pt-2">
                    <span className="font-semibold">Confidence:</span>
                    {(['guess', 'fairly_sure', 'certain'] as Confidence[]).map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`px-2.5 py-1 rounded text-xs border ${
                          confidence === c ? 'bg-[var(--primary)] text-[var(--primary-ink)] font-bold' : 'opacity-80'
                        }`}
                        style={{ borderColor: 'var(--line)' }}
                        onClick={() => setConfidence(c)}
                      >
                        {c === 'guess' ? 'Guess' : c === 'fairly_sure' ? 'Fairly Sure' : 'Certain'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="vt-btn vt-btn-primary w-full py-2 text-sm mt-3"
                    disabled={!userPrediction.trim()}
                    onClick={() => setIsCommitted(true)}
                    data-testid="practice-commit-btn"
                  >
                    Commit Prediction & Reveal
                  </button>
                </div>
              ) : (
                /* Revealed Answer & Explanation */
                <div className="space-y-4 pt-3 border-t" style={{ borderColor: 'var(--line)' }} data-testid="practice-reveal">
                  <div className="p-3 rounded text-sm space-y-1" style={{ background: 'var(--surface-muted)' }}>
                    <div className="text-xs font-semibold opacity-75">Your committed prediction:</div>
                    <div className="italic">{userPrediction}</div>
                  </div>

                  <div className="p-3 rounded border text-sm space-y-1" style={{ borderColor: 'var(--ok)', background: 'var(--ok-bg)' }}>
                    <div className="text-xs font-bold text-[var(--ok-ink)]">Correct Answer:</div>
                    <div className="font-medium">{item.correctAnswer}</div>
                  </div>

                  <div className="text-xs leading-relaxed opacity-90">
                    <span className="font-semibold">Physiological explanation: </span>
                    {item.explanation}
                  </div>

                  {item.simulatorCheckLink && (
                    <div className="pt-1">
                      <button
                        type="button"
                        className="text-xs text-[var(--sel)] hover:underline"
                        onClick={() => {
                          if (item.simulatorCheckLink?.type === 'case' && onNavigateToCase) {
                            onNavigateToCase(item.simulatorCheckLink.id);
                          } else if (item.simulatorCheckLink?.type === 'lab' && onNavigateToLab) {
                            onNavigateToLab(item.simulatorCheckLink.id);
                          }
                        }}
                      >
                        <span className="font-semibold text-xs inline-flex items-center gap-1 text-[var(--act)] hover:underline">
                          <span>Verify in Simulator:</span> {item.simulatorCheckLink.label} →
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Self-evaluation grading */}
                  <div className="pt-3 border-t space-y-2" style={{ borderColor: 'var(--line)' }}>
                    <div className="text-xs font-semibold text-center opacity-80">How did you do?</div>
                    <div className="grid grid-cols-4 gap-2">
                      <button
                        type="button"
                        className="vt-grade-btn vt-grade-btn--again"
                        onClick={() => handleGrade('again')}
                        data-testid="grade-again"
                      >
                        Again (&lt;1d)
                      </button>
                      <button
                        type="button"
                        className="vt-grade-btn vt-grade-btn--hard"
                        onClick={() => handleGrade('hard')}
                        data-testid="grade-hard"
                      >
                        Hard (1–2d)
                      </button>
                      <button
                        type="button"
                        className="vt-grade-btn vt-grade-btn--good"
                        onClick={() => handleGrade('good')}
                        data-testid="grade-good"
                      >
                        Good (3–5d)
                      </button>
                      <button
                        type="button"
                        className="vt-grade-btn vt-grade-btn--easy"
                        onClick={() => handleGrade('easy')}
                        data-testid="grade-easy"
                      >
                        Easy (7+d)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ITEM KIND 2: CASE DRILL */}
          {item.kind === 'case-drill' && (
            <div className="space-y-4">
              <div className="p-3 rounded text-sm" style={{ background: 'var(--surface-muted)' }}>
                <span className="font-bold">Clinical Vignette: </span>
                {item.vignette}
              </div>

              {item.steps[drillStepIndex] && (
                <div className="space-y-3 pt-2">
                  <div className="text-xs font-semibold opacity-75">
                    Decision Step {drillStepIndex + 1} of {item.steps.length}:
                  </div>
                  <div className="text-sm font-medium">{item.steps[drillStepIndex].prompt}</div>

                  <div className="space-y-2">
                    {item.steps[drillStepIndex].options.map((opt, i) => {
                      const isSelected = drillAnswers[drillStepIndex] === i;
                      const hasAnswered = drillAnswers[drillStepIndex] !== undefined;

                      return (
                        <div key={i} className="space-y-1">
                          <button
                            type="button"
                            disabled={hasAnswered}
                            className={`w-full text-left p-2.5 rounded border text-xs leading-relaxed transition-all ${
                              hasAnswered
                                ? opt.isCorrect
                                  ? 'border-[var(--ok-line)] bg-[var(--ok-bg)]'
                                  : isSelected
                                  ? 'border-[var(--danger-line)] bg-[var(--danger-bg)]'
                                  : 'opacity-50'
                                : 'hover:border-[var(--info-line)]'
                            }`}
                            style={{ borderColor: !hasAnswered ? 'var(--line)' : undefined }}
                            onClick={() => {
                              const newAnswers = [...drillAnswers];
                              newAnswers[drillStepIndex] = i;
                              setDrillAnswers(newAnswers);
                            }}
                          >
                            <span className="font-semibold mr-2">{String.fromCharCode(65 + i)}.</span>
                            {opt.text}
                          </button>

                          {hasAnswered && (isSelected || opt.isCorrect) && (
                            <div
                              className={`text-xs p-2 rounded ${
                                opt.isCorrect ? 'text-[var(--ok-ink)]' : 'text-[var(--danger-ink)]'
                              }`}
                            >
                              {opt.feedback}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {drillAnswers[drillStepIndex] !== undefined && (
                    <div className="pt-3 flex justify-end">
                      {drillStepIndex + 1 < item.steps.length ? (
                        <button
                          type="button"
                          className="vt-btn vt-btn-primary text-xs px-4 py-2"
                          onClick={() => setDrillStepIndex(prev => prev + 1)}
                        >
                          Next Step →
                        </button>
                      ) : (
                        <div className="w-full pt-2 border-t space-y-3" style={{ borderColor: 'var(--line)' }}>
                          {item.simulatorCheckLink && (
                            <div className="pt-1 text-center">
                              <button
                                type="button"
                                className="text-xs text-[var(--sel)] hover:underline"
                                onClick={() => {
                                  if (item.simulatorCheckLink?.type === 'case' && onNavigateToCase) {
                                    onNavigateToCase(item.simulatorCheckLink.id);
                                  } else if (item.simulatorCheckLink?.type === 'lab' && onNavigateToLab) {
                                    onNavigateToLab(item.simulatorCheckLink.id);
                                  }
                                }}
                              >
                                <span className="font-semibold text-xs inline-flex items-center gap-1 text-[var(--act)] hover:underline">
                                  <span>Verify in Simulator:</span> {item.simulatorCheckLink.label} →
                                </span>
                              </button>
                            </div>
                          )}

                          {/* Confidence selector for case-drill */}
                          <div className="flex items-center justify-center gap-3 text-xs pt-1">
                            <span className="font-semibold">Confidence:</span>
                            {(['guess', 'fairly_sure', 'certain'] as Confidence[]).map(c => (
                              <button
                                key={c}
                                type="button"
                                className={`px-2.5 py-1 rounded text-xs border ${
                                  confidence === c ? 'bg-[var(--primary)] text-[var(--primary-ink)] font-bold' : 'opacity-80'
                                }`}
                                style={{ borderColor: 'var(--line)' }}
                                onClick={() => setConfidence(c)}
                                data-testid={`practice-confidence-${c}`}
                              >
                                {c === 'guess' ? 'Guess' : c === 'fairly_sure' ? 'Fairly Sure' : 'Certain'}
                              </button>
                            ))}
                          </div>

                          <div className="text-xs font-semibold text-center opacity-80">Drill Completed! Rate ease of decision:</div>
                          <div className="grid grid-cols-4 gap-2">
                            <button type="button" className="vt-grade-btn vt-grade-btn--again" onClick={() => handleGrade('again')} data-testid="grade-again">
                              Again (&lt;1d)
                            </button>
                            <button type="button" className="vt-grade-btn vt-grade-btn--hard" onClick={() => handleGrade('hard')} data-testid="grade-hard">
                              Hard (1–2d)
                            </button>
                            <button type="button" className="vt-grade-btn vt-grade-btn--good" onClick={() => handleGrade('good')} data-testid="grade-good">
                              Good (3–5d)
                            </button>
                            <button type="button" className="vt-grade-btn vt-grade-btn--easy" onClick={() => handleGrade('easy')} data-testid="grade-easy">
                              Easy (7+d)
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ITEM KIND 3: FLASHCARD */}
          {item.kind === 'flashcard' && (
            <div className="space-y-4">
              {item.subheading && (
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--sel)]">
                  {item.subheading}
                </div>
              )}
              <div className="text-base font-semibold min-h-[4rem] flex items-center">{item.front}</div>

              {!isCommitted ? (
                <div className="pt-4 space-y-3">
                  {/* Confidence selector for flashcard */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="font-semibold">Confidence:</span>
                    {(['guess', 'fairly_sure', 'certain'] as Confidence[]).map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`px-2.5 py-1 rounded text-xs border ${
                          confidence === c ? 'bg-[var(--primary)] text-[var(--primary-ink)] font-bold' : 'opacity-80'
                        }`}
                        style={{ borderColor: 'var(--line)' }}
                        onClick={() => setConfidence(c)}
                        data-testid={`practice-confidence-${c}`}
                      >
                        {c === 'guess' ? 'Guess' : c === 'fairly_sure' ? 'Fairly Sure' : 'Certain'}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="vt-btn vt-btn-primary w-full py-2.5 text-sm"
                    onClick={() => setIsCommitted(true)}
                    data-testid="practice-commit-btn"
                  >
                    Show Answer (Space)
                  </button>
                </div>
              ) : (
                <div className="space-y-5 pt-3 border-t" style={{ borderColor: 'var(--line)' }} data-testid="practice-reveal">
                  <div className="p-4 rounded border text-sm leading-relaxed whitespace-pre-line" style={{ borderColor: 'var(--line)', background: 'var(--surface-muted)' }}>
                    {item.back}
                  </div>

                  {item.simulatorCheckLink && (
                    <div className="pt-1">
                      <button
                        type="button"
                        className="text-xs text-[var(--sel)] hover:underline"
                        onClick={() => {
                          if (item.simulatorCheckLink?.type === 'case' && onNavigateToCase) {
                            onNavigateToCase(item.simulatorCheckLink.id);
                          } else if (item.simulatorCheckLink?.type === 'lab' && onNavigateToLab) {
                            onNavigateToLab(item.simulatorCheckLink.id);
                          }
                        }}
                      >
                        <span className="font-semibold text-xs inline-flex items-center gap-1 text-[var(--act)] hover:underline">
                          <span>Verify in Simulator:</span> {item.simulatorCheckLink.label} →
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-center opacity-80">Recall difficulty:</div>
                    <div className="grid grid-cols-4 gap-2">
                      <button type="button" className="vt-grade-btn vt-grade-btn--again" onClick={() => handleGrade('again')} data-testid="grade-again">
                        Again (&lt;1d)
                      </button>
                      <button type="button" className="vt-grade-btn vt-grade-btn--hard" onClick={() => handleGrade('hard')} data-testid="grade-hard">
                        Hard (1–2d)
                      </button>
                      <button type="button" className="vt-grade-btn vt-grade-btn--good" onClick={() => handleGrade('good')} data-testid="grade-good">
                        Good (3–5d)
                      </button>
                      <button type="button" className="vt-grade-btn vt-grade-btn--easy" onClick={() => handleGrade('easy')} data-testid="grade-easy">
                        Easy (7+d)
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Source Reference Modal */}
        {showSourceModal && (
          <div
            className="fixed inset-0 bg-[rgba(0,0,0,0.5)] z-50 flex items-center justify-center p-4"
            data-testid="practice-source-modal"
            onClick={() => setShowSourceModal(false)}
          >
            <div
              className="vt-card max-w-lg w-full p-6 space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--line)' }}>
                <h3 className="font-bold text-sm">Source Reference</h3>
                <button
                  type="button"
                  className="text-xs font-bold px-2 py-1"
                  onClick={() => setShowSourceModal(false)}
                >
                  ✕
                </button>
              </div>
              <div className="space-y-2 text-xs">
                <div>
                  <span className="font-semibold">Document: </span>
                  {item.source.file}
                </div>
                <div>
                  <span className="font-semibold">Chapter: </span>
                  {item.source.chapter}
                </div>
                <div>
                  <span className="font-semibold">Page Range: </span>
                  Pages {item.source.pageStart} to {item.source.pageEnd}
                </div>
                <div>
                  <span className="font-semibold">Target Competency: </span>
                  <code>{item.competencyId}</code>
                </div>
              </div>
              <div className="pt-2 text-xs opacity-75">
                To consult the complete source text, open the corresponding PDF inside your private <code>reference/</code> folder.
              </div>
            </div>
          </div>
        )}

        {/* Surface 8.1(g): Tutor hidden during active item; Unpack Mechanism appears only after reveal */}
        {(item.kind === 'case-drill'
          ? drillAnswers[drillStepIndex] !== undefined
          : isCommitted) && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <button
                type="button"
                data-testid="unpack-mechanism-btn"
                onClick={() => setShowUnpackTutor(v => !v)}
                className="vt-btn text-xs"
              >
                {showUnpackTutor ? 'Hide Mechanism Tutor' : 'Unpack Mechanism'}
              </button>
            </div>
            {showUnpackTutor && (
              <TutorPanel
                defaultOpen={true}
                getContext={() =>
                  buildPracticeContext({
                    item,
                    revealed: true,
                    currentStepIndex: drillStepIndex,
                    stepRevealed: true,
                    learnerAnswer: userPrediction || drillAnswers,
                  }).contextText
                }
                contextKind="practice"
                getCap={(requestKind, learnerMessage) =>
                  computeHelpLevelCap({
                    guidanceLevel: 'prompted',
                    isProbe: false,
                    hasCommittedDecision: true,
                    failedAttemptsCount: 0,
                    hasConfidentError: false,
                    isStuck: false,
                    isImmediateDanger: false,
                    learnerRequest: requestKind,
                    learnerMessage,
                    contextKind: 'practice',
                  })
                }
                getForbiddenPhrases={() =>
                  buildPracticeContext({
                    item,
                    revealed: true,
                    currentStepIndex: drillStepIndex,
                    stepRevealed: true,
                  }).forbiddenPhrases
                }
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // --- Main Practice Hub View ---
  return (
    <div className="p-4 max-w-4xl mx-auto space-y-6" data-testid="practice-screen">
      {/* Hero / Review Card */}
      <div className="vt-card p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="space-y-1 text-center sm:text-left">
          <h1 className="text-xl font-bold">Active Clinical Practice</h1>
          <p className="text-xs opacity-80">
            Spaced repetition recall, scenario prediction, and bedside decision drills from your reference library.
          </p>
          <div className="flex items-center gap-4 text-xs pt-2">
            <div>
              <span className="font-bold text-lg text-[var(--sel)]" data-testid="practice-due-count">
                {dueToday.total}
              </span>{' '}
              due today
              {dueToday.retests.length > 0 && (
                <span className="opacity-80" data-testid="practice-due-retests">
                  {' '}
                  (incl. retest:{' '}
                  {dueToday.retests.map(r => getFriendlyCompetencyName(r.competencyId)).join(', ')})
                </span>
              )}
            </div>
            <div>•</div>
            <div>
              <span className="font-bold text-lg">{masteredCount}</span> mastered
            </div>
            <div>•</div>
            <div>
              <span className="font-bold text-lg">{allItems.length}</span> total items
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          {dueItems.length > 0 && (
            <button
              type="button"
              className="vt-btn vt-btn-primary px-5 py-2.5 text-sm font-semibold"
              onClick={() => startSession(true)}
              data-testid="practice-due-btn"
            >
              Review Due ({dueItems.length})
            </button>
          )}
          <button
            type="button"
            className="vt-btn vt-btn-secondary px-5 py-2.5 text-sm font-semibold"
            onClick={() => startSession(false)}
            data-testid="practice-start-btn"
          >
            Start Practice Session
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="vt-card p-4 flex flex-wrap gap-4 text-xs items-center">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Source:</span>
          <select
            className="vt-input text-xs py-1 px-2"
            value={selectedSource}
            onChange={e => {
              setSelectedSource(e.target.value);
              setSelectedChapter('all');
            }}
          >
            <option value="all">All Sources ({allItems.length} items)</option>
            {Object.keys(sourcesMap).map(file => (
              <option key={file} value={file}>
                {sourcesMap[file].title} ({sourcesMap[file].count})
              </option>
            ))}
          </select>
        </div>

        {selectedSource !== 'all' && availableChapters.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-semibold">Chapter:</span>
            <select
              className="vt-input text-xs py-1 px-2 max-w-xs"
              value={selectedChapter}
              onChange={e => setSelectedChapter(e.target.value)}
            >
              <option value="all">All Chapters</option>
              {availableChapters.map(ch => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Per-Source Library Coverage */}
      <div className="space-y-3">
        <h3 className="text-sm font-bold">Source Coverage & Mastery</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(sourcesMap).map(([file, info]) => {
            const attempted = info.items.filter(
              i => cardStates[i.id]?.lastReviewed !== null && cardStates[i.id]?.lastReviewed !== undefined,
            ).length;
            const mastered = info.items.filter(
              i => (cardStates[i.id]?.repetitions ?? 0) >= 3,
            ).length;
            const percent = Math.round((attempted / info.count) * 100);

            return (
              <div key={file} className="vt-card p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold truncate max-w-[240px]">{info.title}</span>
                  <span className="opacity-75">
                    {attempted} / {info.count} seen ({mastered} mastered)
                  </span>
                </div>
                <div className="w-full bg-[var(--surface-3)] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[var(--ok)] h-full transition-all duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
