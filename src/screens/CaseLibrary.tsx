import React, { useState, useEffect, useMemo } from 'react';
import type { CaseFile } from '../shared/caseSchema';
import type { LearnerEvent } from '../shared/events';
import type { LearnerApi, ActivityCandidate, Recommendation } from '../shared/learnerApi';
import competenciesJson from '../shared/competencies.json';
import { getTierForCase } from '../adaptive/entrustment';
import { readLearnerEvents } from '../adaptive/learnerEvents';
import { rankCasesUnified } from '../adaptive/progression';
import { deriveReTestSchedule } from '../adaptive/schedule';
import type { CaseVariantMetadata } from '../cases/variants/loader';

export interface CaseLibraryProps {
  cases: CaseFile[];
  learner: LearnerApi;
  onStart: (caseId: string) => void;
  variants?: CaseFile[];
  variantsMeta?: Record<string, CaseVariantMetadata>;
}

interface DomainInfo {
  id: string;
  name: string;
}

/**
 * Returns only the visible domains for a case.
 * CRITICAL: Hidden competencies are filtered out so they are never announced before playback.
 */
function getVisibleDomains(c: CaseFile): DomainInfo[] {
  const hidden = new Set(c.hiddenCompetencies ?? []);
  const visible = (c.competencies ?? []).filter(id => !hidden.has(id));
  const domains: DomainInfo[] = [];
  const seenDomainIds = new Set<string>();

  for (const compId of visible) {
    const domain = competenciesJson.domains.find(d =>
      d.competencies.some(comp => comp.id === compId)
    );
    if (domain && !seenDomainIds.has(domain.id)) {
      seenDomainIds.add(domain.id);
      domains.push({ id: domain.id, name: domain.name });
    }
  }

  return domains;
}

/**
 * Derives presentation-style titles that do not reveal the diagnosis prior to completion.
 * Only after a case has been completed once is the confirmed diagnosis revealed.
 */
export function getPresentationTitle(c: CaseFile, hasCompleted: boolean): string {
  if (hasCompleted) {
    return c.title;
  }
  const title = c.title;
  if (/^pneumonia\s+/i.test(title)) {
    return title.replace(/^pneumonia\s+/i, 'Severe hypoxaemia ');
  }
  return title;
}

/**
 * Ensures recommendation reasons never accidentally leak any hidden competency
 * (by id or descriptive name) before a case is played.
 */
function filterRecommendationReasons(reasons: string[], c: CaseFile): string[] {
  if (!c.hiddenCompetencies || c.hiddenCompetencies.length === 0) return reasons;
  const hiddenTerms: string[] = [];
  for (const hid of c.hiddenCompetencies) {
    hiddenTerms.push(hid.toLowerCase());
    const compDef = competenciesJson.domains
      .flatMap(d => d.competencies)
      .find(comp => comp.id === hid);
    if (compDef) {
      hiddenTerms.push(compDef.name.toLowerCase());
    }
  }
  return reasons.filter(reason => {
    const lower = reason.toLowerCase();
    return !hiddenTerms.some(term => term.length > 0 && lower.includes(term));
  });
}

function formatDifficulty(caseId: string, diff: number): string {
  const tier = getTierForCase(caseId) ?? diff;
  switch (tier) {
    case 1:
      return 'Tier 1 · Single Problem';
    case 2:
      return 'Tier 2 · Interacting Physiology';
    case 3:
      return 'Tier 3 · Dynamic Crisis';
    default:
      return `Tier ${tier}`;
  }
}

function formatSetting(setting: string): string {
  switch (setting.toLowerCase()) {
    case 'ed':
      return 'Emergency Dept';
    case 'ward':
      return 'Ward';
    case 'hdu':
      return 'High Dependency';
    case 'icu':
      return 'Intensive Care';
    default:
      return setting.toUpperCase();
  }
}

const EMPTY_CASES: CaseFile[] = [];
const EMPTY_VARIANTS_META: Record<string, CaseVariantMetadata> = {};

const CURRICULUM_CASE_ORDER = [
  'copd-niv-01',
  'apo-cpap-01',
  'pneumonia-hfnc-01',
  'ards-vent-01',
  'dka-intubated-01',
  'dyssynchrony-01',
  'copd-psv-trigger-01',
  'sbt-pass-01',
  'sbt-fail-01',
  'asthma-vent-01',
  'vent-high-pressure-01',
];

export const CaseLibrary: React.FC<CaseLibraryProps> = ({
  cases,
  learner,
  onStart,
  variants = EMPTY_CASES,
  variantsMeta = EMPTY_VARIANTS_META,
}) => {
  const [selectedSetting, setSelectedSetting] = useState<string>('all');
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [unlockAllProbes, setUnlockAllProbes] = useState<boolean>(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [events, setEvents] = useState<LearnerEvent[]>([]);
  const [completedCaseIds, setCompletedCaseIds] = useState<Set<string>>(new Set());
  /** Activity ids (including variant ids) that have a finished, non-abandoned run. */
  const [finishedActivityIds, setFinishedActivityIds] = useState<Set<string>>(new Set());
  const [learnerError, setLearnerError] = useState<string | null>(null);

  const safeCases = useMemo(() => (Array.isArray(cases) ? cases : []), [cases]);
  const allSelectableCases = useMemo(() => {
    const seen = new Set(safeCases.map(c => c.id));
    return [...safeCases, ...variants.filter(v => !seen.has(v.id))];
  }, [safeCases, variants]);

  useEffect(() => {
    let isMounted = true;
    if (!learner) {
      setRecommendations([]);
      setEvents([]);
      setLearnerError('Learner service unavailable');
      return;
    }

    learner
      .listRuns()
      .then(runs => {
        if (!isMounted) return;
        const completed = new Set<string>();
        const finished = new Set<string>();
        for (const r of runs) {
          if (r.outcome && r.outcome !== 'abandoned' && r.activityId) {
            finished.add(r.activityId);
            completed.add(r.activityId);
            if (r.activityId.includes('--')) {
              completed.add(r.activityId.split('--')[0]!);
            }
          }
        }
        setCompletedCaseIds(completed);
        setFinishedActivityIds(finished);
      })
      .catch(() => {
        /* optional runs lookup */
      });

    void readLearnerEvents(learner).then(evs => {
      if (isMounted) setEvents(evs);
    });

    if (allSelectableCases.length === 0) {
      setRecommendations([]);
      return;
    }

    const candidates: ActivityCandidate[] = allSelectableCases.map(c => ({
      activity: 'case',
      id: c.id,
      competencies: c.competencies,
      hiddenCompetencies: c.hiddenCompetencies ?? [],
      contextTags: c.contextTags ?? [],
      difficulty: c.difficulty,
    }));

    learner
      .recommend(candidates)
      .then(recs => {
        if (isMounted) {
          setRecommendations(recs);
          setLearnerError(null);
        }
      })
      .catch(err => {
        if (isMounted) {
          setLearnerError(err instanceof Error ? err.message : 'Failed to load recommendations');
        }
      });

    return () => {
      isMounted = false;
    };
  }, [learner, allSelectableCases]);

  const unified = useMemo(
    () =>
      rankCasesUnified({
        cases: allSelectableCases,
        events,
        learnerRecommendations: recommendations,
        variantsMeta,
      }),
    [allSelectableCases, events, recommendations, variantsMeta]
  );

  const suggestedNextCase = unified.topCase;

  const topRecommendation = useMemo(() => {
    if (!recommendations || recommendations.length === 0) return null;
    if (unified.rankedRecommendations.length > 0) {
      return unified.rankedRecommendations[0]!;
    }
    return recommendations[0]!;
  }, [recommendations, unified.rankedRecommendations]);

  const availableSettings = useMemo(() => {
    const set = new Set<string>();
    safeCases.forEach(c => set.add(c.setting.toLowerCase()));
    return Array.from(set).sort();
  }, [safeCases]);

  const filteredCases = useMemo(() => {
    const list = safeCases.filter(c => {
      if (selectedSetting !== 'all' && c.setting.toLowerCase() !== selectedSetting.toLowerCase()) {
        return false;
      }
      if (selectedDomain !== 'all') {
        const visibleDomains = getVisibleDomains(c);
        if (!visibleDomains.some(d => d.id === selectedDomain)) {
          return false;
        }
      }
      return true;
    });

    return [...list].sort((a, b) => {
      const tierA = getTierForCase(a.id) ?? 2;
      const tierB = getTierForCase(b.id) ?? 2;
      if (tierA !== tierB) return tierA - tierB;
      const baseA = a.id.includes('--') ? a.id.split('--')[0]! : a.id;
      const baseB = b.id.includes('--') ? b.id.split('--')[0]! : b.id;
      const idxA = CURRICULUM_CASE_ORDER.indexOf(baseA);
      const idxB = CURRICULUM_CASE_ORDER.indexOf(baseB);
      if (idxA !== idxB) {
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
      }
      return a.id.localeCompare(b.id);
    });
  }, [safeCases, selectedSetting, selectedDomain]);

  return (
    <div className="w-full min-h-screen p-4 md:p-6" style={{ background: 'var(--bg)', color: 'var(--text)' }}>
      <div className="vt-page space-y-5">
        <header className="border-b pb-4" style={{ borderColor: 'var(--line)' }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">Case Library</h1>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                Interactive clinical simulations for mechanical ventilation and acute respiratory support.
              </p>
            </div>
          </div>

          {learnerError && (
            <div
              role="alert"
              className="mt-3 p-3 border text-xs"
              style={{
                borderColor: 'var(--alarm-med)',
                background: 'var(--surface-2)',
                color: 'var(--alarm-med)',
              }}
            >
              Learner recommendations currently unavailable ({learnerError}). Case browsing remains fully functional.
            </div>
          )}

          {/* Filters */}
          <section aria-label="Case filters" className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="setting-filter" className="vt-label">
                Setting:
              </label>
              <select
                id="setting-filter"
                value={selectedSetting}
                onChange={e => setSelectedSetting(e.target.value)}
                className="vt-select"
              >
                <option value="all">All Settings</option>
                {availableSettings.map(s => (
                  <option key={s} value={s}>
                    {formatSetting(s)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="domain-filter" className="vt-label">
                Domain:
              </label>
              <select
                id="domain-filter"
                value={selectedDomain}
                onChange={e => setSelectedDomain(e.target.value)}
                className="vt-select"
              >
                <option value="all">All Domains</option>
                {competenciesJson.domains.map(d => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {(selectedSetting !== 'all' || selectedDomain !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSelectedSetting('all');
                  setSelectedDomain('all');
                }}
                className="vt-btn vt-btn--quiet text-xs"
              >
                Reset filters
              </button>
            )}
          </section>
        </header>

        {/* Suggested Next Unified Hero Banner */}
        {suggestedNextCase && (() => {
          const sc = suggestedNextCase.caseFile;
          const scDone = completedCaseIds.has(sc.id);
          const scTitle = getPresentationTitle(sc, scDone);
          const tierStatus = unified.entrustment[unified.targetTier];
          const heroSubtext =
            suggestedNextCase.kind === 'retest'
              ? (filterRecommendationReasons([suggestedNextCase.learnerReason], sc)[0] ??
                'Due for spaced re-test')
              : `Target Tier ${unified.targetTier} (${tierStatus.level}) · Unified bedside progression`;

          return (
            <section
              aria-label="Suggested Next Case"
              data-testid="suggested-next-card"
              className="border p-4 sm:p-5"
              style={{
                borderColor: 'var(--sel)',
                background: 'var(--surface)',
              }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-xs"
                      style={{
                        background: 'var(--sel)',
                        color: 'var(--primary-ink)',
                      }}
                    >
                      Suggested Next
                    </span>
                    <span className="text-xs font-mono text-[var(--text-3)]">{formatSetting(sc.setting)} · {formatDifficulty(sc.id, sc.difficulty)}</span>
                  </div>
                  <h2 className="text-base sm:text-lg font-bold tracking-tight" style={{ color: 'var(--text)' }}>
                    Next: {scTitle}
                  </h2>
                  <p className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
                    {heroSubtext}
                  </p>
                </div>

                <div className="shrink-0">
                  <button
                    type="button"
                    aria-label={`Start suggested next case: ${scTitle}`}
                    onClick={() => onStart(sc.id)}
                    className="vt-btn vt-btn--primary min-w-[7rem]"
                  >
                    Start Suggested →
                  </button>
                </div>
              </div>
            </section>
          );
        })()}

        {/* Main Content: Dense list with rules between rows */}
        <main>
          {safeCases.length === 0 ? (
            <div
              className="border p-8 text-center text-xs"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text-2)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--text)' }}>No cases available in the library.</p>
              <p className="mt-1">Please ensure case definitions exist in the library catalog.</p>
            </div>
          ) : filteredCases.length === 0 ? (
            <div
              className="border p-8 text-center text-xs"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)', color: 'var(--text-2)' }}
            >
              <p className="font-semibold" style={{ color: 'var(--text)' }}>No cases match the selected filters.</p>
              <p className="mt-1">Try clearing or adjusting the setting and domain filters.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedSetting('all');
                  setSelectedDomain('all');
                }}
                className="vt-btn mt-3"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div
              className="border"
              style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
              role="list"
              aria-label="Available cases"
            >
              <div className="divide-y vt-list-cols" style={{ borderColor: 'var(--line)' }}>
                {filteredCases.map(c => {
                  const hasCompleted = completedCaseIds.has(c.id);
                  const presentationTitle = getPresentationTitle(c, hasCompleted);
                  const isTop =
                    topRecommendation?.id === c.id ||
                    (topRecommendation?.id.startsWith(`${c.id}--`) ?? false);
                  const visibleDomains = getVisibleDomains(c);
                  const sanitizedReasons = isTop && topRecommendation
                    ? filterRecommendationReasons(topRecommendation.reasons ?? [], c)
                    : [];

                  return (
                    <article
                      key={c.id}
                      role="listitem"
                      tabIndex={0}
                      onClick={() => onStart(c.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onStart(c.id);
                        }
                      }}
                      className="p-3.5 sm:p-4 hover:bg-[var(--surface-2)] transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-[var(--focus)]"
                      style={isTop ? { borderLeft: '3px solid var(--sel)' } : undefined}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 mb-1">
                            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                              {presentationTitle}
                            </span>
                            {isTop && (
                              <span
                                className="text-[10px] font-mono uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-xs"
                                style={{
                                  background: 'var(--info-bg)',
                                  color: 'var(--sel)',
                                  border: '1px solid var(--sel)',
                                }}
                              >
                                Recommended
                              </span>
                            )}
                            {hasCompleted && (
                              <span
                                className="text-[11px] font-semibold flex items-center gap-1"
                                style={{ color: 'var(--ok)' }}
                              >
                                ✓ Completed
                              </span>
                            )}
                            <span className="text-[11px] text-[var(--text-3)]">
                              {formatSetting(c.setting)} · {formatDifficulty(c.id, c.difficulty)}
                            </span>
                          </div>

                          {hasCompleted && presentationTitle !== c.title && (
                            <span className="text-xs font-medium block mb-1" style={{ color: 'var(--ok)' }}>
                              Confirmed diagnosis: {c.title}
                            </span>
                          )}

                          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            {c.summary}
                          </p>

                          {/* Recommendation explanation if this case is top */}
                          {isTop && sanitizedReasons.length > 0 && (
                            <div
                              className="mt-2 p-2 text-xs border"
                              style={{
                                background: 'var(--surface-3)',
                                borderColor: 'var(--line)',
                                color: 'var(--text)',
                              }}
                            >
                              <span className="font-semibold block mb-0.5" style={{ color: 'var(--sel)' }}>Why recommended:</span>
                              <ul className="list-disc list-inside space-y-0.5" style={{ color: 'var(--text-2)' }}>
                                {sanitizedReasons.map((reason, idx) => (
                                  <li key={idx}>{reason}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Competency Domains: Clean inline string */}
                          {visibleDomains.length > 0 && (
                            <div className="mt-2 text-xs" style={{ color: 'var(--text-2)' }}>
                              <span className="text-[10px] uppercase tracking-wider font-semibold mr-1.5" style={{ color: 'var(--text-3)' }}>
                                Domains:
                              </span>
                              <span>{visibleDomains.map(d => d.name).join(' · ')}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0" style={{ borderColor: 'var(--line)' }}>
                          <span className="text-xs" style={{ color: 'var(--text-3)' }}>
                            Max time: <span className="num font-semibold">{c.maxSimMin}</span> sim min
                          </span>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onStart(c.id);
                            }}
                            aria-label={`Start case: ${presentationTitle}`}
                            className="vt-btn vt-btn--primary min-w-[6.5rem]"
                          >
                            Start Case →
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {/* Phase 9C: Unaided Far-Transfer Variant Probes */}
          {variants.length > 0 && (() => {
            const retestItems = deriveReTestSchedule(events);
            const transferDueComps = new Set(
              retestItems.filter(it => it.isTransferRetest && it.isDue).map(it => it.competencyId)
            );
            return (
              <section
                aria-label="Transfer Probes (Unaided)"
                data-testid="case-library-transfer-variants"
                className="mt-6 border p-4 space-y-3"
                style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-2" style={{ borderColor: 'var(--line)' }}>
                  <div>
                    <h2 className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                      Far-Transfer Probes (Unaided · Exam-Silent Mode)
                    </h2>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>
                      Patient-variant challenges verify autonomous transfer before mastery. Failed probes demote one tier and schedule a 5-day retest.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setUnlockAllProbes(p => !p)}
                    className="vt-btn vt-btn--secondary !text-xs !min-h-[28px] self-start sm:self-auto"
                    data-testid="toggle-unlock-all-probes"
                  >
                    {unlockAllProbes ? 'Lock Uncompleted Probes' : 'Unlock All Probes'}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {variants.map(v => {
                    const meta = variantsMeta[v.id];
                    const baseCaseId = meta?.baseCaseId || (v.id.includes('--') ? v.id.split('--')[0]! : v.id);
                    const isBaseCompleted = completedCaseIds.has(baseCaseId);
                    const isLocked = !unlockAllProbes && !isBaseCompleted;
                    const hasFailedRetest = v.competencies.some(cid => transferDueComps.has(cid));
                    return (
                      <div
                        key={v.id}
                        data-testid={`transfer-variant-card-${v.id}`}
                        className={`border p-3 flex flex-col justify-between gap-2 ${isLocked ? 'opacity-60' : ''}`}
                        style={{ borderColor: 'var(--line)', background: 'var(--surface-2)' }}
                      >
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold" style={{ color: 'var(--text)' }}>
                              {v.title}
                            </span>
                            <span className="vt-badge text-[10px]">Exam-Silent Probe</span>
                            {isLocked && (
                              <span className="vt-badge text-[10px]" data-testid="locked-probe-badge" style={{ color: 'var(--text-3)', borderColor: 'var(--line)' }}>
                                Complete base case first
                              </span>
                            )}
                            {hasFailedRetest && (
                              <span className="vt-badge text-[10px]" style={{ color: 'var(--alarm-high)', borderColor: 'var(--alarm-high)' }}>
                                5-Day Retest Due
                              </span>
                            )}
                          </div>
                          {meta?.rationale && finishedActivityIds.has(v.id) && (
                            <p className="text-[11px]" style={{ color: 'var(--text-2)' }}>
                              {meta.rationale}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between pt-1">
                          <span className="text-[10px] font-mono" style={{ color: 'var(--text-3)' }}>
                            {v.id}
                          </span>
                          <button
                            type="button"
                            disabled={isLocked}
                            onClick={() => onStart(v.id)}
                            className="vt-btn vt-btn--confirm !text-xs !min-h-[28px] disabled:opacity-40 disabled:cursor-not-allowed"
                            data-testid={`start-probe-${v.id}`}
                          >
                            Start Transfer Probe →
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}
        </main>
      </div>
    </div>
  );
};
