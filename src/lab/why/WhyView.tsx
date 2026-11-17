import React from 'react';
import { LAB_TEST_IDS, type WhyTraceField } from '../schema';
import {
  type CausalNode,
  type WhySnapshot,
  buildCausalChain,
} from './templates';

export interface WhyViewProps {
  committed: boolean;
  nodes?: CausalNode[];
  causalChainFields?: WhyTraceField[];
  baseline?: WhySnapshot | null;
  after?: WhySnapshot | null;
  ruleBased?: boolean;
  ruleBasedNote?: string;
  className?: string;
}

export const WhyView: React.FC<WhyViewProps> = ({
  committed,
  nodes,
  causalChainFields,
  baseline,
  after,
  ruleBased,
  ruleBasedNote,
  className,
}) => {
  if (!committed) {
    return (
      <div
        data-testid={LAB_TEST_IDS.LAB_WHY_LOCKED}
        className="p-6 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] text-[var(--text-2)] text-center space-y-3"
      >
        <div className="w-10 h-10 mx-auto rounded-full bg-[var(--surface-3)] border border-[var(--line)] flex items-center justify-center text-[var(--text-2)]">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-[var(--text)]">Causal "Why" Trace Locked</h3>
        <p className="text-sm text-[var(--text-2)] max-w-md mx-auto">
          Complete your prediction, run the perturbation, and submit your Stage 3 reflection above to unlock the step-by-step causal mechanism.
        </p>
      </div>
    );
  }

  const chain: CausalNode[] =
    nodes ??
    (causalChainFields && baseline && after
      ? buildCausalChain(causalChainFields, baseline, after, { experimentRuleBased: ruleBased })
      : []);

  return (
    <div
      data-testid={LAB_TEST_IDS.LAB_WHY_VIEW}
      className={`space-y-3 p-4 rounded-xl border border-[var(--line)] bg-[var(--surface)] text-[var(--text)] ${className ?? ''}`}
    >
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-2 mb-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">Causal "Why" Trace</h3>
          <p className="text-xs text-[var(--text-2)]">
            Step-by-step causal cascade observed between baseline and post-intervention steady state.
          </p>
        </div>
        {ruleBased && (
          <div
            data-testid={LAB_TEST_IDS.LAB_RULE_BASED_BADGE}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--warn-bg)] text-[var(--warn-ink)] border border-[var(--warn-line)]"
            title={ruleBasedNote ?? 'Primary mechanism includes rule-based approximations rather than purely mechanistic differential equations.'}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--alarm-med)]" />
            <span>Rule-based approximation</span>
          </div>
        )}
      </div>

      {chain.length === 0 ? (
        <p className="text-sm text-[var(--text-2)] italic">No causal nodes available for this experiment.</p>
      ) : (
        chain.map((node, index) => {
          const isNodeRuleBased = node.ruleBased || (ruleBased === true);

          return (
            <React.Fragment key={node.field}>
              <div
                data-testid={`${LAB_TEST_IDS.LAB_WHY_NODE_PREFIX}${node.field}`}
                className="p-3.5 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--line-strong)] transition-colors space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--text-3)] font-mono">
                      #{index + 1}
                    </span>
                    <span className="font-semibold text-[var(--text)] text-sm">
                      {node.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Numbers: before → after with units */}
                    <span className="font-mono text-xs text-[var(--text-2)] bg-[var(--surface-3)] px-2 py-0.5 rounded border border-[var(--line)]">
                      {node.formattedBefore}
                      {node.unit ? ` ${node.unit}` : ''} → {node.formattedAfter}
                      {node.unit ? ` ${node.unit}` : ''}
                    </span>

                    {/* Direction indicator */}
                    {node.direction === 'up' && (
                      <span
                        aria-label="Increased"
                        className="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--ok-bg)] text-[var(--ok-ink)] border border-[var(--ok-line)] font-bold text-xs"
                      >
                        ↑
                      </span>
                    )}
                    {node.direction === 'down' && (
                      <span
                        aria-label="Decreased"
                        className="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--warn-bg)] text-[var(--warn-ink)] border border-[var(--warn-line)] font-bold text-xs"
                      >
                        ↓
                      </span>
                    )}
                    {node.direction === 'same' && (
                      <span
                        aria-label="Unchanged"
                        className="inline-flex items-center justify-center w-6 h-6 rounded bg-[var(--surface-3)] text-[var(--text-2)] border border-[var(--line)] font-bold text-xs"
                      >
                        =
                      </span>
                    )}
                  </div>
                </div>

                {/* Rule-based link badge */}
                {isNodeRuleBased && (
                  <div className="flex items-center gap-2 pt-0.5">
                    <span
                      data-testid={LAB_TEST_IDS.LAB_RULE_BASED_BADGE}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--warn-bg)] text-[var(--warn-ink)] border border-[var(--warn-line)]"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--alarm-med)]" />
                      Rule-based approximation
                    </span>
                    <span className="text-[11px] text-[var(--warn-ink)] italic">
                      (Empirical rule rather than a mechanistic equation)
                    </span>
                  </div>
                )}

                {/* Deterministic template text */}
                <p className="text-xs text-[var(--text)] leading-relaxed font-sans pt-1">
                  {node.templateText}
                </p>
              </div>

              {/* Connector arrow between sequential nodes */}
              {index < chain.length - 1 && (
                <div
                  className="flex items-center justify-center py-0.5 text-[var(--text-3)] font-bold text-sm select-none"
                  aria-hidden="true"
                >
                  ↓
                </div>
              )}
            </React.Fragment>
          );
        })
      )}
    </div>
  );
};
