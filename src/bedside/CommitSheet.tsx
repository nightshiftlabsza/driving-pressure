import React, { useRef, useState } from 'react';
import { useModalFocus } from '../shared/useModalFocus';
import type { Confidence } from '../shared/events';
import { GENERIC_ASSESSMENTS, type AssessmentOption } from './assessmentLoader';

export interface CommitSheetProps {
  /** If the commit was triggered by an attempted action, describe it to the learner */
  pendingActionDescription?: string;
  isRevision?: boolean;
  initialAssessments?: string[];
  initialConfidence?: Confidence;
  onCommit: (assessments: string[], confidence: Confidence) => void;
  onCancel?: () => void;
}

const CONFIDENCE_OPTIONS: { id: Confidence; label: string; desc: string }[] = [
  { id: 'guess', label: 'Guess', desc: 'Working hunch / exploring' },
  { id: 'fairly_sure', label: 'Fairly sure', desc: 'Supported by clues' },
  { id: 'certain', label: 'Certain', desc: 'Definitive features present' },
];

export const CommitSheet: React.FC<CommitSheetProps> = ({
  pendingActionDescription,
  isRevision = false,
  initialAssessments = [],
  initialConfidence,
  onCommit,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, () => onCancel?.());
  const [selected, setSelected] = useState<string[]>(initialAssessments);
  const [confidence, setConfidence] = useState<Confidence | null>(initialConfidence ?? null);

  const toggleAssessment = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id);
      }
      if (prev.length >= 2) {
        // Keep at most 2, replace oldest or keep last clicked
        return [prev[1], id];
      }
      return [...prev, id];
    });
  };

  const canCommit = selected.length >= 1 && selected.length <= 2 && confidence !== null;

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canCommit || !confidence) return;
    onCommit(selected, confidence);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="commit-sheet-title"
      data-testid="commit-sheet"
    >
      <div
        className="rounded-xl max-w-xl w-full p-5 shadow-2xl flex flex-col max-h-[92vh] border"
        style={{
          backgroundColor: 'var(--surface, #11161d)',
          borderColor: 'var(--line-strong, #334153)',
          color: 'var(--text, #f0f4f8)',
        }}
      >
        {/* Header */}
        <div className="border-b pb-3 mb-3" style={{ borderColor: 'var(--line, #232d3b)' }}>
          <div className="flex items-center justify-between">
            <span
              className="text-xs uppercase tracking-wider font-semibold"
              style={{ color: 'var(--act, #00b4d8)' }}
            >
              {isRevision ? 'Re-evaluate Assessment' : 'Bedside Commit • Look before touching'}
            </span>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="text-sm px-2 py-0.5 rounded border"
                style={{
                  backgroundColor: 'var(--surface-2, #161e27)',
                  borderColor: 'var(--line, #232d3b)',
                  color: 'var(--text-2, #94a3b8)',
                }}
                aria-label="Dismiss sheet"
              >
                Cancel
              </button>
            )}
          </div>
          <h2 id="commit-sheet-title" className="text-lg font-bold mt-1" style={{ color: 'var(--text, #f0f4f8)' }}>
            {isRevision
              ? 'Update your working assessment'
              : 'What is your working assessment of this patient?'}
          </h2>
          <p className="text-xs mt-1" style={{ color: 'var(--text-2, #94a3b8)' }}>
            {pendingActionDescription ? (
              <span>
                Before executing <strong style={{ color: 'var(--act, #00b4d8)' }}>{pendingActionDescription}</strong>, commit to your working hypothesis (1 or 2 options).
              </span>
            ) : (
              'Select 1 or 2 working assessments and your confidence level.'
            )}
          </p>
        </div>

        {/* Assessment selection (tap 1 or 2) */}
        <div className="overflow-y-auto pr-1 flex-1 space-y-1.5 my-2">
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-2, #94a3b8)' }}>
            Working assessment (select 1 or 2):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="Working assessments">
            {GENERIC_ASSESSMENTS.map((item: AssessmentOption) => {
              const isSelected = selected.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleAssessment(item.id)}
                  aria-pressed={isSelected}
                  data-testid={`assessment-option-${item.id}`}
                  className="text-left p-2.5 rounded-lg border text-xs transition-all flex flex-col justify-between"
                  style={{
                    backgroundColor: isSelected ? 'var(--surface-3, #1e2835)' : 'var(--surface-2, #161e27)',
                    borderColor: isSelected ? 'var(--act, #00b4d8)' : 'var(--line, #232d3b)',
                    color: isSelected ? 'var(--text, #f0f4f8)' : 'var(--text-2, #94a3b8)',
                    boxShadow: isSelected ? '0 0 0 1px var(--act, #00b4d8)' : undefined,
                  }}
                >
                  <div className="font-semibold" style={{ color: isSelected ? 'var(--text, #f0f4f8)' : undefined }}>
                    {item.label}
                  </div>
                  <div className="text-[11px] mt-1 leading-tight" style={{ color: 'var(--text-3, #64748b)' }}>
                    {item.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Confidence selection (tap 2) */}
        <div className="pt-3 border-t" style={{ borderColor: 'var(--line, #232d3b)' }}>
          <div className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-2, #94a3b8)' }}>
            How confident are you?
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Confidence level">
            {CONFIDENCE_OPTIONS.map(opt => {
              const isSelected = confidence === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setConfidence(opt.id)}
                  data-testid={`confidence-option-${opt.id}`}
                  className="p-2 rounded border text-center transition-colors text-xs"
                  style={{
                    backgroundColor: isSelected ? 'var(--act, #00b4d8)' : 'var(--surface-2, #161e27)',
                    borderColor: isSelected ? 'var(--act, #00b4d8)' : 'var(--line, #232d3b)',
                    color: isSelected ? 'var(--act-ink, #0f0b00)' : 'var(--text-2, #94a3b8)',
                  }}
                >
                  <div className="text-xs font-semibold">{opt.label}</div>
                  <div className="text-[10px] opacity-80 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Commit action (tap 3) */}
        <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--line, #232d3b)' }}>
          <div className="text-[11px]" style={{ color: 'var(--text-3, #64748b)' }}>
            Simulation clock paused while committing &bull; Max 3 taps
          </div>
          <button
            type="button"
            disabled={!canCommit}
            onClick={() => handleSubmit()}
            data-testid="commit-button"
            className="font-medium px-4 py-2 rounded-lg text-sm shadow transition-all cursor-pointer disabled:cursor-not-allowed border"
            style={{
              backgroundColor: canCommit ? 'var(--act, #00b4d8)' : 'var(--surface-2, #161e27)',
              borderColor: canCommit ? 'var(--act, #00b4d8)' : 'var(--line, #232d3b)',
              color: canCommit ? 'var(--act-ink, #0f0b00)' : 'var(--text-3, #64748b)',
            }}
          >
            {isRevision ? 'Save revised assessment' : 'Commit & Proceed'}
          </button>
        </div>
      </div>
    </div>
  );
};
