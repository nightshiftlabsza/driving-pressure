import React, { useEffect, useMemo, useState } from 'react';
import type { LabExperiment } from '../schema';
import { LAB_TEST_IDS } from '../schema';
import { toActivityCandidate } from '../runner';
import type { LearnerApi, Recommendation } from '../../shared/learnerApi';

export interface LabCatalogProps {
  experiments: LabExperiment[];
  onSelectExperiment: (exp: LabExperiment) => void;
  learner?: LearnerApi;
}

export const LabCatalog: React.FC<LabCatalogProps> = ({
  experiments,
  onSelectExperiment,
  learner,
}) => {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [filterDifficulty, setFilterDifficulty] = useState<number | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const safeExperiments = useMemo(
    () => (Array.isArray(experiments) ? experiments : []),
    [experiments]
  );

  useEffect(() => {
    let isMounted = true;
    if (!learner || safeExperiments.length === 0) {
      setRecommendations([]);
      return;
    }

    const candidates = safeExperiments.map(toActivityCandidate);
    learner
      .recommend(candidates)
      .then((recs) => {
        if (isMounted) {
          setRecommendations(recs);
        }
      })
      .catch((err) => {
        console.warn('Failed to load lab recommendations:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [learner, safeExperiments]);

  const topRecommendation = useMemo(() => {
    if (!recommendations || recommendations.length === 0) return null;
    return recommendations[0];
  }, [recommendations]);

  const recommendationMap = useMemo(() => {
    const map = new Map<string, Recommendation>();
    for (const r of recommendations) {
      map.set(r.id, r);
    }
    return map;
  }, [recommendations]);

  const filteredExperiments = useMemo(() => {
    return safeExperiments.filter((exp) => {
      if (filterDifficulty !== 'all' && exp.difficulty !== filterDifficulty) {
        return false;
      }
      if (searchTerm.trim() !== '') {
        const query = searchTerm.toLowerCase();
        const matchesTitle = exp.title.toLowerCase().includes(query);
        const matchesSubtitle = exp.subtitle.toLowerCase().includes(query);
        const matchesComp = exp.competencies.some((c) => c.toLowerCase().includes(query));
        const matchesTags = exp.contextTags.some((t) => t.toLowerCase().includes(query));
        if (!matchesTitle && !matchesSubtitle && !matchesComp && !matchesTags) {
          return false;
        }
      }
      return true;
    });
  }, [safeExperiments, filterDifficulty, searchTerm]);

  return (
    <div className="flex flex-col w-full h-full bg-[var(--bg)] text-[var(--text)] overflow-y-auto p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div className="vt-page mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--line)] pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)] flex items-center gap-2">
              <span className="text-[var(--sel)]">🔬</span> Physiology & Ventilator Lab
            </h1>
            <p className="text-sm text-[var(--text-2)] mt-1">
              Active learning through guided hypothesis testing. Predict the physiological response,
              observe live changes, and explore the underlying causal chain.
            </p>
          </div>

          {/* Quick Filters */}
          <div className="flex items-center gap-3">
            <input
              type="text"
              placeholder="Search experiments..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded text-xs text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-[var(--info-line)] w-48"
            />
            <select
              value={filterDifficulty}
              onChange={(e) =>
                setFilterDifficulty(e.target.value === 'all' ? 'all' : Number(e.target.value))
              }
              aria-label="Filter by difficulty"
              className="px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--line)] rounded text-xs text-[var(--text)] focus:outline-none focus:border-[var(--info-line)]"
            >
              <option value="all">All Difficulties</option>
              <option value={1}>Level 1 · Basic</option>
              <option value={2}>Level 2 · Intermediate</option>
              <option value={3}>Level 3 · Advanced</option>
            </select>
          </div>
        </div>
      </div>

      {/* Experiment Cards Grid */}
      <div className="vt-page">
        {filteredExperiments.length === 0 ? (
          <div className="p-8 text-center bg-[var(--surface)] rounded-lg border border-[var(--line)] text-[var(--text-2)] text-sm">
            No experiments found matching the current criteria.
          </div>
        ) : (
          <div
            data-testid={LAB_TEST_IDS.LAB_LIST}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 min-[2200px]:grid-cols-4 min-[3000px]:grid-cols-5 gap-4"
          >
            {filteredExperiments.map((exp) => {
              const isTopRec = topRecommendation?.id === exp.id;
              const rec = recommendationMap.get(exp.id);

              return (
                <div
                  key={exp.id}
                  data-testid={`${LAB_TEST_IDS.LAB_CARD_PREFIX}${exp.id}`}
                  className={`flex flex-col bg-[var(--surface)] rounded-lg border transition-all hover:border-[var(--info-line)] p-4 ${
                    isTopRec ? 'border-[var(--info-line)] shadow-lg ring-1 ring-[var(--sel)]' : 'border-[var(--line)]'
                  }`}
                >
                  {/* Top Bar with Number, Badges */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[var(--surface-3)] text-[var(--sel)]">
                        LAB #{exp.number}
                      </span>
                      <span className="text-[10px] text-[var(--text-3)] font-mono">
                        Level {exp.difficulty}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {isTopRec && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--ok-bg)] text-[var(--ok-ink)] border border-[var(--ok-line)]">
                          Recommended
                        </span>
                      )}
                      {exp.ruleBased && (
                        <span
                          data-testid={LAB_TEST_IDS.LAB_RULE_BASED_BADGE}
                          title={exp.ruleBasedNote ?? 'Demonstrates rule-based clinical physiology'}
                          className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--warn-bg)] text-[var(--warn-ink)] border border-[var(--warn-line)]"
                        >
                          Rule-based
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Title & Subtitle */}
                  <h2 className="text-base font-bold text-[var(--text)] mb-1 leading-snug">
                    {exp.title}
                  </h2>
                  <p className="text-xs text-[var(--text-2)] mb-3 flex-1">
                    {exp.subtitle}
                  </p>

                  {/* Recommendation Reasons if recommended */}
                  {isTopRec && rec && rec.reasons && rec.reasons.length > 0 && (
                    <div className="mb-3 p-2 rounded bg-[var(--info-bg)] border border-[var(--info-line)] text-[11px] text-[var(--sel)]">
                      <span className="font-semibold text-[var(--sel)]">Why recommended: </span>
                      {rec.reasons.join(' · ')}
                    </div>
                  )}

                  {/* Rule-based note */}
                  {exp.ruleBased && exp.ruleBasedNote && (
                    <div className="mb-3 text-[11px] text-[var(--warn-ink)] italic">
                      Note: {exp.ruleBasedNote}
                    </div>
                  )}

                  {/* Competencies */}
                  <div className="flex flex-wrap gap-1 mb-4">
                    {exp.competencies.map((comp) => (
                      <span
                        key={comp}
                        className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface-3)] border border-[var(--line)] text-[var(--text-2)] font-mono"
                      >
                        {comp}
                      </span>
                    ))}
                  </div>

                  {/* Action Button */}
                  <button
                    type="button"
                    onClick={() => onSelectExperiment(exp)}
                    className="w-full mt-auto py-2 px-3 vt-btn vt-btn--primary font-semibold text-xs rounded transition-colors flex items-center justify-center gap-1.5"
                  >
                    <span>Start Experiment</span>
                    <span>→</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
