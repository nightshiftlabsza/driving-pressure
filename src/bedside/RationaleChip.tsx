import React from 'react';
import { RATIONALE_REASONS, type RationaleReason } from './rationaleLogic';

export interface RationaleChipProps {
  changeSummary?: string;
  onSelectReason: (reasonId: string) => void;
  onDismiss: () => void;
}

export const RationaleChip: React.FC<RationaleChipProps> = ({
  changeSummary = 'Settings changed',
  onSelectReason,
  onDismiss,
}) => {
  return (
    <div
      className="border rounded-lg p-2.5 text-xs shadow-md flex flex-wrap items-center gap-2 animate-fadeIn"
      style={{
        backgroundColor: 'var(--surface-2, #161e27)',
        borderColor: 'var(--line-strong, #334153)',
        color: 'var(--text, #f0f4f8)',
      }}
      data-testid="rationale-chip-container"
      role="region"
      aria-label="Action rationale prompt"
    >
      <div className="flex items-center gap-1.5 mr-1 font-medium" style={{ color: 'var(--act, #00b4d8)' }}>
        <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--act, #00b4d8)' }} />
        <span>Rationale ({changeSummary}):</span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        {RATIONALE_REASONS.map((r: RationaleReason) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onSelectReason(r.id)}
            title={r.description}
            data-testid={`rationale-option-${r.id}`}
            className="border rounded px-2 py-0.5 text-xs transition-colors"
            style={{
              backgroundColor: 'var(--surface, #11161d)',
              borderColor: 'var(--line, #232d3b)',
              color: 'var(--text, #f0f4f8)',
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss rationale prompt"
        className="px-1.5 py-0.5 rounded text-xs ml-auto"
        style={{ color: 'var(--text-2, #94a3b8)' }}
      >
        &times;
      </button>
    </div>
  );
};
