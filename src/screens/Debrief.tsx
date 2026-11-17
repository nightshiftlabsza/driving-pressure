import React, { useMemo, useState } from 'react';
import type { CaseFile } from '../shared/caseSchema';
import type { RunSummary } from '../shared/learnerApi';
import type { Confidence, LearnerEvent } from '../shared/events';
import mistakesJson from '../shared/mistakes.json';
import competenciesJson from '../shared/competencies.json';
import { TutorPanel } from '../tutor/TutorPanel';
import { buildDebriefContext } from '../tutor/context';
import { computeHelpLevelCap } from '../tutor/policy';
import { countWords } from '../tutor/types';
import { getFriendlyCompetencyName } from '../learner/derivation';
import { DecisionReview, startRewindFromPoint, type ComputedDecisionReviewData } from '../review/DecisionReview';
import { formatClinical, type ClinicalKind } from '../review/formatClinical';
import type { ReferenceDivergence } from '../review/reference';
import type { RunState } from '../runtime/caseRuntime';
import {
  competencyTitle,
  mistakeTitle,
  outcomeSentence,
  pickEndpoints,
  buildChartSeries,
  pickDecisions,
  formatSimTime as storyFormatSimTime,
} from './debrief/story';
import { CourseChart } from './debrief/CourseChart';

export interface DebriefProps {
  run: RunSummary;
  caseFile: CaseFile;
  onBackToLibrary?: () => void;
  onRewind?: (state: RunState) => void;
  events?: LearnerEvent[];
  unscoredPredictions?: { predictionId: string; elapsedSec: number }[];
}

function formatOutcome(outcome: string | null): string {
  if (!outcome) return 'Completed';
  return outcome.charAt(0).toUpperCase() + outcome.slice(1).replace(/-/g, ' ');
}

function formatConfidence(conf?: Confidence): string {
  switch (conf) {
    case 'certain':
      return 'Certain';
    case 'fairly_sure':
      return 'Fairly sure';
    case 'guess':
      return 'Guess';
    default:
      return 'Not specified';
  }
}

const CLINICAL_KEYS: Record<string, ClinicalKind> = {
  ph: 'ph', paco2: 'paco2', pao2: 'pao2', spo2: 'spo2', pplat: 'pplat', drivingPressure: 'drivingPressure',
  map: 'map', rr: 'rr', rrTotal: 'rr', rrSpont: 'rr',
};

function formatValue(val: unknown, key?: string): string {
  if (val === null || val === undefined) return 'None';
  if (typeof val === 'number') {
    const kind = key ? CLINICAL_KEYS[key] : undefined;
    if (kind) return formatClinical(kind, val);
    return Number.isFinite(val) ? String(Number(val.toFixed(2))) : '--';
  }
  if (typeof val === 'string' || typeof val === 'boolean') {
    return String(val);
  }
  if (Array.isArray(val)) {
    return val.map(v => formatValue(v, key)).join(', ');
  }
  if (typeof val === 'object') {
    return Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${formatValue(v, k)}`)
      .join(', ');
  }
  return String(val);
}

function formatSimTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatOrderName(order: string): string {
  const spaced = order.replace(/-/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const Debrief: React.FC<DebriefProps> = ({ run, caseFile, onBackToLibrary, onRewind, events, unscoredPredictions }) => {
  const [selfCritiqueText, setSelfCritiqueText] = useState<string>('');
  const [selfCritiqueSubmitted, setSelfCritiqueSubmitted] = useState<boolean>(false);
  const [referenceDivergence, setReferenceDivergence] = useState<ReferenceDivergence | null>(null);
  const [reviewData, setReviewData] = useState<ComputedDecisionReviewData | null>(null);
  const isTransferVariant = Boolean(run?.activityId?.includes('--'));
  const transferFailed =
    isTransferVariant &&
    (run?.outcome === 'died' ||
      run?.outcome === 'deteriorated' ||
      Boolean(run?.rubric?.some(r => !r.met)));

  const endpoints = useMemo(() => {
    if (!caseFile) return [];
    return pickEndpoints(caseFile, reviewData?.metrics ?? []);
  }, [caseFile, reviewData?.metrics]);

  const decisions = useMemo(() => {
    if (!run || !caseFile) return [];
    return pickDecisions(
      run,
      caseFile,
      reviewData?.classifications ?? [],
      reviewData?.replayDecisions ?? [],
      3
    );
  }, [run, caseFile, reviewData]);

  const chartSeries = useMemo(() => {
    if (!caseFile) return [];
    return buildChartSeries(caseFile, reviewData?.metrics ?? []);
  }, [caseFile, reviewData?.metrics]);

  const decisionTimes = useMemo(() => {
    const times = new Set<number>();
    if (run?.ordersTimeline) {
      for (const o of run.ordersTimeline) times.add(o.simTimeSec);
    }
    if (reviewData?.replayDecisions) {
      for (const d of reviewData.replayDecisions) times.add(d.simTimeSec);
    }
    return Array.from(times).sort((a, b) => a - b);
  }, [run?.ordersTimeline, reviewData?.replayDecisions]);

  if (!run || !caseFile) {
    return (
      <div className="w-full min-h-screen p-8" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
        <div className="max-w-4xl mx-auto border p-8 text-center" style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text-2)' }}>
          <p className="text-base font-semibold" style={{ color: 'var(--text)' }}>No run summary or case data available for debrief.</p>
        </div>
      </div>
    );
  }

  // 1. Outcome & Score stats
  const totalRubricCount = run.rubric?.length ?? 0;
  const metRubricCount = run.rubric?.filter(r => r.met).length ?? 0;
  const criticalItems =
    run.rubric?.filter(
      r => r.critical || Boolean(caseFile.rubric?.find(cr => cr.id === r.rubricId)?.critical)
    ) ?? [];
  const unmetCritical = criticalItems.filter(r => !r.met);

  // 2. Predictions sorted with confident errors ("certain and wrong") first
  const sortedPredictions = useMemo(() => {
    if (!run.predictions) return [];
    return [...run.predictions].sort((a, b) => {
      const aConfErr = !a.correct && a.confidence === 'certain' ? 1 : 0;
      const bConfErr = !b.correct && b.confidence === 'certain' ? 1 : 0;
      if (aConfErr !== bConfErr) return bConfErr - aConfErr; // Confident errors first
      if (a.correct !== b.correct) return a.correct ? 1 : -1; // Other errors next
      return 0;
    });
  }, [run.predictions]);

  const confidentErrors = useMemo(() => {
    return sortedPredictions.filter(p => !p.correct && p.confidence === 'certain');
  }, [sortedPredictions]);

  const confidentErrorCount = confidentErrors.length;

  // Lookup helper for hidden competencies
  const allCompetencies = useMemo(() => {
    return competenciesJson.domains.flatMap(d =>
      d.competencies.map(c => ({ ...c, domainName: d.name }))
    );
  }, []);

  return (
    <div data-testid="debrief-screen" className="w-full min-h-screen p-4 md:p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <style>{`
        .debrief-two-col {
          display: flex;
          flex-direction: column;
          gap: 1.25rem;
          max-width: 880px;
          margin-left: auto;
          margin-right: auto;
          width: 100%;
        }
        .debrief-col-left {
          display: contents;
        }
        .debrief-col-right {
          display: contents;
        }
        @media (min-width: 1600px) {
          .debrief-two-col {
            display: grid !important;
            grid-template-columns: minmax(0, 1fr) 560px !important;
            gap: 1.5rem !important;
            align-items: start !important;
            max-width: 1600px !important;
          }
          .debrief-col-left {
            display: flex !important;
            flex-direction: column !important;
            gap: 1.25rem !important;
            grid-column: 1 !important;
            min-width: 0 !important;
          }
          .debrief-col-right {
            display: flex !important;
            flex-direction: column !important;
            gap: 1.25rem !important;
            grid-column: 2 !important;
            position: sticky !important;
            top: 1rem !important;
            min-width: 0 !important;
          }
          .debrief-col-span-2 {
            grid-column: 1 / -1 !important;
          }
        }
      `}</style>
      <div className="debrief-two-col">
        {/* Navigation & Case Header */}
        <header className="debrief-col-span-2 border p-4 space-y-3" style={{ order: 0, borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <span className="vt-label" style={{ color: 'var(--act)' }}>
                Case Debrief
              </span>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight mt-0.5">
                {caseFile.title}
              </h1>
              <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
                Patient: {caseFile.patient.displayName} · Setting: {caseFile.setting.toUpperCase()}
              </p>
            </div>

            {onBackToLibrary && (
              <button
                type="button"
                onClick={onBackToLibrary}
                className="vt-btn self-start md:self-auto"
              >
                ← Case Library
              </button>
            )}
          </div>

          <div className="border-t pt-3 flex flex-wrap items-center justify-between gap-2" style={{ borderColor: 'var(--line)' }}>
            <div className="flex items-center gap-2">
              <span
                className="vt-badge font-bold text-xs"
                style={{
                  background: run.outcome === 'improved' ? 'var(--ok)' : 'var(--alarm-high)',
                  color: run.outcome === 'improved' ? '#000' : '#fff',
                }}
              >
                {formatOutcome(run.outcome)}
              </span>
              <span className="text-sm font-semibold">{outcomeSentence(run.outcome)}</span>
            </div>

            <div className="text-xs font-mono" style={{ color: 'var(--text-2)' }}>
              Score: {metRubricCount} / {totalRubricCount} rubric items met
              {typeof run.score === 'number' && typeof run.maxScore === 'number' && (
                <span className="ml-2 font-mono" style={{ color: 'var(--text-3)' }}>
                  (Points: {run.score} / {run.maxScore})
                </span>
              )}
            </div>
          </div>

          {/* Endpoints from pickEndpoints (up to 4) */}
          {endpoints.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
              {endpoints.map((ep, idx) => (
                <div key={idx} className="p-2 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                  <span className="vt-label block text-[11px]" style={{ color: 'var(--text-3)' }}>{ep.label}</span>
                  <div className="text-sm font-bold font-mono">
                    {ep.value}{ep.unit ? <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--text-2)' }}>{ep.unit}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Critical rubric flags */}
          {criticalItems.length > 0 && (
            <div className="pt-1">
              {unmetCritical.length > 0 ? (
                <div className="p-2.5 border text-xs" style={{ borderColor: 'var(--alarm-high)', background: 'var(--surface-2)', color: 'var(--alarm-high)' }}>
                  <strong className="font-semibold">Critical requirement missed:</strong>
                  <ul className="list-disc list-inside mt-1 space-y-0.5">
                    {unmetCritical.map(uc => {
                      const def = caseFile.rubric?.find(r => r.id === uc.rubricId);
                      return (
                        <li key={uc.rubricId}>
                          {def?.description ?? (uc.competency ? competencyTitle(uc.competency) : 'Critical clinical requirement')}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="p-2.5 border text-xs" style={{ borderColor: 'var(--ok)', background: 'var(--surface-2)', color: 'var(--ok)' }}>
                  <span>All critical clinical management criteria were met.</span>
                </div>
              )}
            </div>
          )}
        </header>

        {/* Left column: Steps 1, 2, 4, 5 and Details */}
        <div className="debrief-col-left">
          {/* Step 1: Reflection (Self-Critique Gate) */}
          <section
            aria-labelledby="section-self-critique"
            data-testid="debrief-self-critique-gate"
            className="border"
            style={{ order: 1, borderColor: 'var(--line)', background: 'var(--surface)' }}
          >
          <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-self-critique" className="text-sm font-bold flex items-center gap-2">
              <span>Step 1:</span> Reflection
            </h2>
            <span className="vt-badge text-xs" data-testid="debrief-tutor-cap-badge">
              {selfCritiqueSubmitted ? 'Answered' : 'Answer this first'}
            </span>
          </div>
          <div className="p-4 space-y-2">
            {isTransferVariant && (
              <div
                data-testid="debrief-transfer-probe-status"
                className="p-2 border text-xs"
                style={{
                  borderColor: transferFailed ? 'var(--alarm-high)' : 'var(--ok)',
                  background: 'var(--surface-2)',
                  color: transferFailed ? 'var(--alarm-high)' : 'var(--ok)',
                }}
              >
                {transferFailed
                  ? 'Unaided Transfer Probe Failed: competency drops 1 tier and a 5-day transfer retest is scheduled.'
                  : 'Unaided Transfer Probe Passed (Exam-Silent): counts toward autonomous mastery.'}
              </div>
            )}
            {referenceDivergence && (() => {
              const kind = CLINICAL_KEYS[referenceDivergence.metric];
              const learnerVal = kind
                ? formatClinical(kind, referenceDivergence.learnerValue)
                : String(Number(referenceDivergence.learnerValue.toFixed(1)));
              const refVal = kind
                ? formatClinical(kind, referenceDivergence.referenceValue)
                : String(Number(referenceDivergence.referenceValue.toFixed(1)));
              const upperAbbrevs = ['FiO2', 'PEEP', 'SpO2', 'PaCO2', 'PaO2', 'pH'];
              // Drop a trailing symbol in brackets, e.g. "(ΔP)": lower-casing it produced "(δp)".
              let label = referenceDivergence.label.replace(/\s*\([^)]*\)\s*$/, '');
              const matchedAbbrev = upperAbbrevs.find(a => a.toLowerCase() === label.toLowerCase());
              if (matchedAbbrev) {
                label = matchedAbbrev;
              } else {
                let lower = label.toLowerCase();
                for (const abbrev of upperAbbrevs) {
                  lower = lower.replace(new RegExp(`\\b${abbrev}\\b`, 'gi'), abbrev);
                }
                label = lower;
              }
              const unitStr = referenceDivergence.unit ? ` ${referenceDivergence.unit}` : '';
              return (
                <div
                  data-testid="debrief-reference-divergence"
                  className="p-2 border text-xs"
                  style={{
                    borderColor: 'var(--act)',
                    background: 'var(--surface-2)',
                    color: 'var(--text)',
                  }}
                >
                  At {formatSimTime(referenceDivergence.simTimeSec)} your {label} was {learnerVal}{unitStr}. The reference run had {refVal}{unitStr}.
                </div>
              );
            })()}
            <p className="text-xs" style={{ color: 'var(--text-2)' }}>
              {unmetCritical.length > 0
                ? `You missed a critical step: ${competencyTitle(unmetCritical[0]!.competency)}. In one or two sentences: what went wrong, and what on the screen should have told you?`
                : referenceDivergence
                ? 'In one or two sentences: what had you done differently by then, and was it better or worse for the patient?'
                : 'In one or two sentences: what was your main reasoning, and what would you do sooner next time?'}
            </p>
            <textarea
              rows={2}
              data-testid="debrief-self-critique-input"
              aria-label="Debrief self-critique"
              placeholder="One or two sentences, at least four words."
              value={selfCritiqueText}
              disabled={selfCritiqueSubmitted}
              onChange={e => setSelfCritiqueText(e.target.value)}
              className="vt-select w-full text-xs p-2"
            />
            {!selfCritiqueSubmitted ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  data-testid="debrief-self-critique-submit"
                  disabled={countWords(selfCritiqueText) < 4}
                  onClick={() => setSelfCritiqueSubmitted(true)}
                  className="vt-btn vt-btn--confirm text-xs"
                >
                  Submit
                </button>
              </div>
            ) : (
              <p className="text-xs font-semibold" style={{ color: 'var(--ok)' }}>
                Saved.
              </p>
            )}
          </div>
        </section>

        {/* Step 2: Decisions that mattered */}
        <section
          aria-labelledby="section-decisions"
          data-testid="debrief-step-2-decisions"
          className="border"
          style={{ order: 2, borderColor: 'var(--line)', background: 'var(--surface)' }}
        >
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-decisions" className="text-sm font-bold flex items-center gap-2">
              <span>Step 2:</span> Decisions that mattered
            </h2>
          </div>

          <div className="p-4 space-y-3">
            {decisions.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                No decision stood out in this run.
              </p>
            ) : (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {decisions.map(d => (
                  <div
                    key={d.key}
                    className="p-3.5 space-y-2.5"
                    style={{
                      background: 'var(--surface)',
                      borderLeft: d.tone === 'bad' ? '3px solid var(--alarm-high)' : d.tone === 'good' ? '3px solid var(--ok)' : undefined,
                    }}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                        {d.title}
                      </span>
                      {d.point && (
                        <button
                          type="button"
                          onClick={() => startRewindFromPoint(d.point!, run.runId, caseFile, onRewind)}
                          className="vt-btn text-xs py-0.5 px-2"
                        >
                          Rewind to here
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5 text-xs">
                      {d.did && (
                        <div>
                          <span className="vt-label block text-[11px]" style={{ color: 'var(--text-3)' }}>
                            What you did:
                          </span>
                          <p style={{ color: 'var(--text)' }}>{d.did}</p>
                        </div>
                      )}
                      {d.happened && (
                        <div>
                          <span className="vt-label block text-[11px]" style={{ color: 'var(--text-3)' }}>
                            What happened:
                          </span>
                          <p style={{ color: 'var(--text-2)' }}>{d.happened}</p>
                        </div>
                      )}
                      {d.why && (
                        <div>
                          <span className="vt-label block text-[11px]" style={{ color: 'var(--text-3)' }}>
                            Why it matters:
                          </span>
                          <p style={{ color: 'var(--text-2)' }}>{d.why}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Step 4: Certain and wrong, and unscored */}
        <section
          aria-labelledby="section-certain-wrong"
          data-testid="debrief-step-4-predictions"
          className="border"
          style={{ order: 4, borderColor: 'var(--line)', background: 'var(--surface)' }}
        >
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-certain-wrong" className="text-sm font-bold flex items-center gap-2">
              <span>Step 4:</span> Certain and wrong, and unscored
            </h2>
          </div>

          <div className="p-4">
            {confidentErrors.length === 0 && (!unscoredPredictions || unscoredPredictions.length === 0) ? (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                No certain-and-wrong or unscored predictions in this run.
              </p>
            ) : (
              <div className="space-y-3">
                {confidentErrors.map((p, idx) => (
                  <div
                    key={`step4-cw-${idx}`}
                    className="p-3 border space-y-2"
                    style={{ borderColor: 'var(--alarm-high)', background: 'var(--surface-2)' }}
                  >
                    {p.competency && (
                      <div className="flex justify-end">
                        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }} title={p.competency}>
                          {competencyTitle(p.competency)}
                        </span>
                      </div>
                    )}

                    <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                      {p.question}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
                      <div>
                        <span className="block mb-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>Your answer:</span>
                        <span className="font-mono">{formatValue(p.answer)}</span>
                      </div>
                      <div>
                        <span className="block mb-0.5 text-[11px]" style={{ color: 'var(--text-3)' }}>What happened:</span>
                        <span className="font-mono">{formatValue(p.expected)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {unscoredPredictions && unscoredPredictions.map((u, idx) => {
                  const ptDef = caseFile.predictionPoints?.find(pt => pt.id === u.predictionId);
                  const qText = ptDef?.question ?? u.predictionId;
                  return (
                    <div
                      key={`step4-unscored-${idx}`}
                      className="p-3 border space-y-2"
                      style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className="vt-badge font-bold text-xs"
                          style={{ background: 'var(--surface-3)', color: 'var(--text-2)' }}
                        >
                          Unscored
                        </span>
                        {ptDef?.competency && (
                          <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }} title={ptDef.competency}>
                            {competencyTitle(ptDef.competency)}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                        {qText}
                      </p>

                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                        Not scored: the case ended before the effect could be measured.
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Step 5: Takeaway and next */}
        <section
          aria-labelledby="section-takeaway-next"
          data-testid="debrief-step-5-takeaway"
          className="border"
          style={{ order: 5, borderColor: 'var(--line)', background: 'var(--surface)' }}
        >
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-takeaway-next" className="text-sm font-bold flex items-center gap-2">
              <span>Step 5:</span> Takeaway and next
            </h2>
          </div>

          <div className="p-4 space-y-4">
            {caseFile.debrief?.keyPoints && caseFile.debrief.keyPoints.length > 0 ? (
              <div className="space-y-2">
                <ul className="list-disc list-inside space-y-1.5 text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
                  {caseFile.debrief.keyPoints.slice(0, 3).map((pt, idx) => (
                    <li key={idx}>{pt}</li>
                  ))}
                </ul>
                {caseFile.debrief.keyPoints.length > 3 && (
                  <details className="mt-2 text-xs" style={{ color: 'var(--text-2)' }}>
                    <summary className="cursor-pointer font-medium hover:underline py-1" style={{ color: 'var(--act)' }}>
                      More
                    </summary>
                    <ul className="list-disc list-inside space-y-1.5 mt-2 leading-relaxed" style={{ color: 'var(--text)' }}>
                      {caseFile.debrief.keyPoints.slice(3).map((pt, idx) => (
                        <li key={`more-${idx}`}>{pt}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No key points recorded for this case.</p>
            )}

            {onBackToLibrary && (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={onBackToLibrary}
                  className="vt-btn"
                >
                  ← Case Library
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Details (collapsed by default, native <details>) */}
        <details
          data-testid="debrief-details"
          className="border"
          style={{ order: 6, borderColor: 'var(--line)', background: 'var(--surface)' }}
        >
          <summary
            className="p-3 font-bold text-sm cursor-pointer select-none flex items-center justify-between"
            style={{ color: 'var(--text)' }}
          >
            <span>Details</span>
            <span className="text-xs font-normal" style={{ color: 'var(--text-3)' }}>Full rubric, predictions, mistakes, review</span>
          </summary>

          <div className="p-4 space-y-5 border-t" style={{ borderColor: 'var(--line)' }}>
            {/* SECTION 2: Your predictions */}
            <section aria-labelledby="section-predictions" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
          <div className="p-3 border-b flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-predictions" className="text-sm font-bold flex items-center gap-2">
              <span>2.</span> Your Predictions
            </h2>
            {confidentErrorCount > 0 && (
              <span
                className="vt-badge font-bold text-xs"
                style={{ background: 'var(--alarm-high)', color: 'var(--alarm-high-ink)' }}
              >
                {confidentErrorCount} Confident Error{confidentErrorCount > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="p-4">
            {confidentErrorCount > 0 && (
              <div className="mb-4 p-3 border text-xs" style={{ borderColor: 'var(--alarm-high)', background: 'var(--surface-2)', color: 'var(--text)' }}>
                <strong style={{ color: 'var(--alarm-high)' }}>Prioritised Calibration Review:</strong> Confident errors (&ldquo;certain and wrong&rdquo;) are listed at the top. In clinical care, acting with high confidence on an inaccurate mental model is a primary source of preventable harm.
              </div>
            )}

            {sortedPredictions.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No predictions were recorded during this run.</p>
            ) : (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {sortedPredictions.map((p, idx) => {
                  const isConfErr = !p.correct && p.confidence === 'certain';
                  const pointDef = caseFile.predictionPoints?.find(pt => pt.id === p.predictionId);

                  return (
                    <div
                      key={`${p.predictionId || 'prediction'}-${idx}`}
                      className="p-3.5 space-y-2"
                      style={isConfErr ? { background: 'var(--surface-2)', borderLeft: '3px solid var(--alarm-high)' } : { background: 'var(--surface)' }}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="vt-badge font-bold"
                            style={{
                              background: p.correct ? 'var(--ok)' : 'var(--alarm-high)',
                              color: p.correct ? '#000' : '#fff',
                            }}
                          >
                            {p.correct ? 'Correct' : 'Incorrect'}
                          </span>
                          {isConfErr && (
                            <span
                              className="vt-badge font-bold"
                              style={{ background: 'var(--alarm-high)', color: 'var(--alarm-high-ink)' }}
                            >
                              Certain &amp; Wrong
                            </span>
                          )}
                          <span className="text-xs" style={{ color: 'var(--text-2)' }}>
                            Confidence: <strong>{formatConfidence(p.confidence)}</strong>
                          </span>
                        </div>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }} title={p.competency}>
                          {competencyTitle(p.competency)}
                        </span>
                      </div>

                      <p className="text-xs font-semibold">
                        {p.question}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs p-2.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                        <div>
                          <span className="block mb-0.5" style={{ color: 'var(--text-3)' }}>Your answer:</span>
                          <span className="font-mono">{formatValue(p.answer)}</span>
                        </div>
                        <div>
                          <span className="block mb-0.5" style={{ color: 'var(--text-3)' }}>What actually happened:</span>
                          <span className="font-mono">{formatValue(p.expected)}</span>
                        </div>
                      </div>

                      {pointDef?.explanation && (
                        <p className="text-xs p-2 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)', color: 'var(--text-2)' }}>
                          <strong style={{ color: 'var(--text)' }}>Physiology: </strong>
                          {pointDef.explanation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* SECTION 3: Rubric checklist */}
        <section aria-labelledby="section-rubric" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-rubric" className="text-sm font-bold flex items-center gap-2">
              <span>3.</span> Rubric Checklist
            </h2>
          </div>

          <div className="p-4">
            {run.rubric && run.rubric.length > 0 ? (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {run.rubric.map(item => {
                  const def = caseFile.rubric?.find(r => r.id === item.rubricId);
                  const isCritical = Boolean(item.critical || def?.critical);

                  return (
                    <div key={item.rubricId} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-[var(--surface-2)] transition-colors">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-medium">
                            {def?.description ?? (item.competency ? competencyTitle(item.competency) : 'Clinical requirement')}
                          </span>
                          {isCritical && (
                            <span className="vt-badge font-bold" style={{ background: 'var(--alarm-high)', color: 'var(--alarm-high-ink)' }}>
                              Critical
                            </span>
                          )}
                        </div>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }} title={def?.competency ?? item.competency}>
                          Competency: {competencyTitle(def?.competency ?? item.competency)}
                        </span>
                      </div>

                      <div className="self-start sm:self-auto shrink-0">
                        <span className="vt-badge font-semibold" style={{ background: item.met ? 'var(--ok)' : 'var(--surface-3)', color: item.met ? '#000' : 'var(--text-2)' }}>
                          {item.met ? '✓ Met' : '✗ Not Met'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No rubric items evaluated.</p>
            )}
          </div>
        </section>

        {/* SECTION 4: Mistakes */}
        <section aria-labelledby="section-mistakes" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-mistakes" className="text-sm font-bold flex items-center gap-2">
              <span>4.</span> Mistakes
            </h2>
          </div>

          <div className="p-4">
            {run.mistakes && run.mistakes.length > 0 ? (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {run.mistakes.map((m, idx) => {
                  const mistakeDef = mistakesJson.mistakes.find(tax => tax.id === m.mistake);
                  const taxonomyName = mistakeDef?.name ?? m.mistake;
                  const recommendedResponse = mistakeDef?.response ?? 'Review case physiology and clinical guidelines.';

                  return (
                    <div key={idx} className="p-3.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold">
                            {taxonomyName}
                          </span>
                          <span className="vt-badge uppercase font-semibold text-[10px]">
                            {m.severity}
                          </span>
                        </div>
                        <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }} title={m.competency}>
                          {competencyTitle(m.competency)}
                        </span>
                      </div>

                      <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                        {m.detail}
                      </p>

                      <div className="border p-2.5 text-xs" style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}>
                        <span className="font-semibold block mb-0.5" style={{ color: 'var(--act)' }}>
                          Recommended remediation:
                        </span>
                        <span style={{ color: 'var(--text-2)' }}>{recommendedResponse}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No mistakes identified during this run.</p>
            )}
          </div>
        </section>

        {/* SECTION 5: Hidden competencies, now revealed */}
        <section aria-labelledby="section-hidden-competencies" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-hidden-competencies" className="text-sm font-bold flex items-center gap-2">
              <span>5.</span> Hidden Competencies
            </h2>
            <p className="text-xs font-medium mt-0.5" style={{ color: 'var(--text-2)' }}>
              This case also tested ...
            </p>
          </div>

          <div className="p-4">
            {caseFile.hiddenCompetencies && caseFile.hiddenCompetencies.length > 0 ? (
              <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                {caseFile.hiddenCompetencies.map(hid => {
                  const match = allCompetencies.find(c => c.id === hid);
                  return (
                    <div key={hid} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className="text-xs font-mono font-bold" style={{ color: 'var(--act)' }} title={hid}>
                          {getFriendlyCompetencyName(hid) === hid ? competencyTitle(hid) : getFriendlyCompetencyName(hid)}
                        </span>
                        <p className="text-xs font-medium mt-0.5">
                          {match?.name ?? competencyTitle(hid)}
                        </p>
                      </div>
                      {match?.domainName && (
                        <span className="vt-badge text-xs self-start sm:self-auto">{match.domainName}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No hidden competencies in this case.</p>
            )}
          </div>
        </section>

        {/* SECTION 5B: Decision Process & Physiological Trajectory Review */}
        <DecisionReview
          run={run}
          caseFile={caseFile}
          events={events}
          onRewind={onRewind}
          onTrajectoryComparisonReady={(_comp, div) => setReferenceDivergence(div)}
          onDataReady={setReviewData}
        />

        {/* SECTION 6: Orders timeline */}
        <section aria-labelledby="section-timeline" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-timeline" className="text-sm font-bold flex items-center gap-2">
              <span>6.</span> Orders Timeline
            </h2>
          </div>

          <div className="p-4">
            {run.ordersTimeline && run.ordersTimeline.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="vt-table">
                  <thead>
                    <tr>
                      <th style={{ width: '6rem' }}>Sim Time</th>
                      <th>Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.ordersTimeline.map((item, idx) => (
                      <tr key={idx}>
                        <td className="font-mono text-xs num">{formatSimTime(item.simTimeSec)}</td>
                        <td className="text-xs font-medium">{formatOrderName(item.order)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-2)' }}>No orders placed during this run.</p>
            )}
          </div>
        </section>

        {/* SECTION 7: Resources */}
        <section aria-labelledby="section-resources" className="border" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
          <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
            <h2 id="section-resources" className="text-sm font-bold flex items-center gap-2">
              <span>7.</span> References &amp; Resources
            </h2>
          </div>

          <div className="p-4 space-y-4">
            {caseFile.debrief?.resources && caseFile.debrief.resources.length > 0 && (
              <div>
                <h3 className="vt-label uppercase tracking-wider mb-2">
                  References &amp; Resources
                </h3>
                <div className="border divide-y" style={{ borderColor: 'var(--line)' }}>
                  {caseFile.debrief.resources.map((res, idx) => (
                    <div key={idx} className="p-3 text-xs">
                      <p className="font-semibold" style={{ color: 'var(--text)' }}>{res.title}</p>
                      <p className="mt-0.5" style={{ color: 'var(--text-3)' }}>{res.ref}</p>
                      {res.url && (
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-block underline"
                          style={{ color: 'var(--act)' }}
                        >
                          View source ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </details>
  </div>

  {/* Right column: Step 3 (Course chart) and Consultant (TutorPanel) */}
  <div className="debrief-col-right">
    {/* Step 3: Course chart */}
    <section
      aria-labelledby="section-course-chart"
      data-testid="debrief-step-3-chart"
      className="border"
      style={{ order: 3, borderColor: 'var(--line)', background: 'var(--surface)' }}
    >
      <div className="p-3 border-b" style={{ borderColor: 'var(--line)' }}>
        <h2 id="section-course-chart" className="text-sm font-bold flex items-center gap-2">
          <span>Step 3:</span> Course chart
        </h2>
      </div>

      <div className="p-4">
        <CourseChart series={chartSeries} decisionTimes={decisionTimes} />
      </div>
    </section>

    {/* Consultant */}
    <div style={{ order: 7 }}>
      <TutorPanel
        getContext={() => {
          const base = buildDebriefContext(run, caseFile, { referenceDivergence }).contextText;
          return selfCritiqueSubmitted && selfCritiqueText.trim()
            ? `${base}\n\n### Learner Debrief Self-Critique\n${selfCritiqueText.trim()}`
            : base;
        }}
        contextKind="debrief"
        caseId={caseFile.id}
        competencyIds={caseFile.competencies}
        debriefSelfCritiquePending={!selfCritiqueSubmitted}
        getCap={(requestKind, learnerMessage, attempt, tutorMode) =>
          computeHelpLevelCap({
            guidanceLevel: 'guided',
            isProbe: false,
            hasCommittedDecision: true,
            failedAttemptsCount: 0,
            hasConfidentError: false,
            isStuck: false,
            isImmediateDanger: false,
            learnerRequest: requestKind,
            learnerMessage,
            attemptNumberInProblem: attempt?.attemptNumberInProblem ?? 1,
            tutorMode,
            contextKind: 'debrief',
            debriefSelfCritiqueSubmitted: selfCritiqueSubmitted,
          })
        }
        runId={run.runId}
      />
    </div>
  </div>

  {/* Clinical timing caveat banner for ARDS prone positioning (CHAL-2) as footnote */}
  {caseFile.id.startsWith('ards-vent-01') && (
    <footer
      data-testid="clinical-timing-caveat-banner"
      className="debrief-col-span-2 p-2 border text-xs"
      style={{
        order: 8,
        borderColor: 'var(--warn-line)',
        background: 'var(--warn-bg)',
        color: 'var(--text)',
      }}
    >
            <strong style={{ color: 'var(--warn-ink)' }}>Note on Clinical Timing in ARDS Deliberate Practice: </strong>
            <span>
              Time is compressed in this case. In PROSEVA (Guérin, NEJM 2013) patients were proned when P/F stayed under 150 after 12 to 24 hours of stabilisation, for at least 16 hours a day. Do not delay proning once the criteria are met.
            </span>
          </footer>
        )}
      </div>
    </div>
  );
};
