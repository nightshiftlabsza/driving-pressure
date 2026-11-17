import React from 'react';
import type { HandoffRecord } from './handoffLoader';

export interface HandoffCardProps {
  handoff: HandoffRecord | null;
  patientNameFallback?: string;
  onTakeOver: () => void;
  /** Whether the card is being viewed as the initial handoff or as a reference review */
  mode?: 'initial' | 'review';
  onClose?: () => void;
}

export const HandoffCard: React.FC<HandoffCardProps> = ({
  handoff,
  patientNameFallback = 'Patient',
  onTakeOver,
  mode = 'initial',
  onClose,
}) => {
  const isInitial = mode === 'initial';

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="handoff-heading"
      data-testid="handoff-card"
    >
      <div
        className="rounded-lg max-w-2xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh] border"
        style={{
          backgroundColor: 'var(--surface, #11161d)',
          borderColor: 'var(--line, #232d3b)',
          color: 'var(--text, #f0f4f8)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between border-b pb-3 mb-4"
          style={{ borderColor: 'var(--line, #232d3b)' }}
        >
          <div>
            <div
              className="text-xs uppercase tracking-wider font-semibold"
              style={{ color: 'var(--act, #00b4d8)' }}
            >
              Bedside Sign-Out &bull; Clinical Handoff
            </div>
            <h2 id="handoff-heading" className="text-xl font-bold mt-1" style={{ color: 'var(--text, #f0f4f8)' }}>
              {handoff?.patientName ?? patientNameFallback}
            </h2>
            {handoff?.location && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-2, #94a3b8)' }}>{handoff.location}</div>
            )}
          </div>
          {!isInitial && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="px-2 py-1 text-sm rounded border"
              style={{
                backgroundColor: 'var(--surface-2, #161e27)',
                borderColor: 'var(--line, #232d3b)',
                color: 'var(--text-2, #94a3b8)',
              }}
              aria-label="Close sign-out"
            >
              &times; Close
            </button>
          )}
        </div>

        {/* Content */}
        <div className="space-y-4 text-sm overflow-y-auto pr-1 flex-1">
          {handoff ? (
            <>
              <div
                className="p-3 rounded border"
                style={{
                  backgroundColor: 'var(--surface-2, #161e27)',
                  borderColor: 'var(--line, #232d3b)',
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide block mb-0.5"
                  style={{ color: 'var(--text-2, #94a3b8)' }}
                >
                  Patient Summary (Who)
                </span>
                <p style={{ color: 'var(--text, #f0f4f8)' }}>{handoff.who}</p>
                {handoff.background && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-2, #94a3b8)' }}>
                    <strong style={{ color: 'var(--text, #f0f4f8)' }}>Background:</strong> {handoff.background}
                  </p>
                )}
              </div>

              <div
                className="p-3 rounded border"
                style={{
                  backgroundColor: 'var(--surface-2, #161e27)',
                  borderColor: 'var(--line, #232d3b)',
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide block mb-0.5"
                  style={{ color: 'var(--text-2, #94a3b8)' }}
                >
                  Why Admitted / Reason for Handover
                </span>
                <p style={{ color: 'var(--text, #f0f4f8)' }}>{handoff.whyAdmitted}</p>
              </div>

              <div
                className="p-3 rounded border"
                style={{
                  backgroundColor: 'var(--surface-2, #161e27)',
                  borderColor: 'var(--line, #232d3b)',
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide block mb-0.5"
                  style={{ color: 'var(--text-2, #94a3b8)' }}
                >
                  What Has Been Done
                </span>
                <p style={{ color: 'var(--text, #f0f4f8)' }}>{handoff.whatHasBeenDone}</p>
              </div>

              <div
                className="p-3 rounded border"
                style={{
                  backgroundColor: 'var(--surface-2, #161e27)',
                  borderColor: 'var(--line, #232d3b)',
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide block mb-0.5"
                  style={{ color: 'var(--text-2, #94a3b8)' }}
                >
                  Current Respiratory Support
                </span>
                <p className="font-mono text-xs sm:text-sm" style={{ color: 'var(--text, #f0f4f8)' }}>
                  {handoff.currentSupport}
                </p>
              </div>

              <div
                className="p-3 rounded border"
                style={{
                  backgroundColor: 'var(--warn-bg)',
                  borderColor: 'var(--warn-bg)',
                  color: 'var(--text, #f0f4f8)',
                }}
              >
                <span
                  className="text-xs font-semibold uppercase tracking-wide block mb-0.5"
                  style={{ color: 'var(--warn-ink)' }}
                >
                  The Worry (Immediate Concern)
                </span>
                <p>{handoff.theWorry}</p>
              </div>
            </>
          ) : (
            <div className="py-6 text-center" style={{ color: 'var(--text-2, #94a3b8)' }}>
              No formal registrar sign-out recorded for this case. Review the bedside vitals and history.
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="mt-6 pt-4 border-t flex items-center justify-between"
          style={{ borderColor: 'var(--line, #232d3b)' }}
        >
          <div className="text-xs" style={{ color: 'var(--text-3, #64748b)' }}>
            {isInitial
              ? 'Simulation clock is paused until you take over the patient.'
              : 'Sign-out reference.'}
          </div>
          <button
            type="button"
            onClick={onTakeOver}
            data-testid="take-over-button"
            className="font-medium px-4 py-2 rounded shadow transition-colors text-sm"
            style={{
              backgroundColor: 'var(--act, #00b4d8)',
              color: 'var(--act-ink, #0f0b00)',
            }}
          >
            {isInitial ? 'Take over the patient' : 'Return to bedside'}
          </button>
        </div>
      </div>
    </div>
  );
};
