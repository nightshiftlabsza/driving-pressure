import React, { useRef } from 'react';
import { useModalFocus } from '../shared/useModalFocus';

export const CONTRACT_VERSION = 'v2';

export const CONTRACT_SECTION_TITLE = 'ICU Consultant Rounding Contract';

export const CONTRACT_ACCEPT_BUTTON_LABEL = 'Accept Consultant Rounding Rules';

export interface ContractModalProps {
  isOpen: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export const ContractModal: React.FC<ContractModalProps> = ({ isOpen, ...rest }) =>
  isOpen ? <ContractModalBody {...rest} /> : null;

const ContractModalBody: React.FC<Omit<ContractModalProps, 'isOpen'>> = ({
  onAccept,
  onCancel,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(dialogRef, onCancel);

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tutor-contract-heading"
      data-testid="tutor-contract-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div
        className="max-w-xl w-full border rounded-lg shadow-2xl p-5 space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--act)', color: 'var(--text)' }}
      >
        <h2
          id="tutor-contract-heading"
          className="text-base font-bold border-b pb-2"
          style={{ color: 'var(--act)', borderColor: 'var(--line)' }}
        >
          {CONTRACT_SECTION_TITLE}
        </h2>

        <div className="space-y-3 text-xs leading-relaxed max-h-[65vh] overflow-y-auto pr-1" style={{ color: 'var(--text-2)' }}>
          <p>
            <strong style={{ color: 'var(--text)' }}>Purpose of This System</strong>: This tutor is designed to build autonomous
            bedside clinical judgment in respiratory failure and mechanical ventilation. An AI that
            explains physiology effortlessly can create an illusion of competence while weakening
            independent diagnostic skill. Success is measured by one metric: the clinician&apos;s ability
            to interpret waveforms, anticipate physiological consequences, and stabilize critically
            ill patients <em>without</em> AI assistance.
          </p>

          <p>
            <strong style={{ color: 'var(--text)' }}>Clinician Commitments</strong>: (1) <em>Think Before Asking</em>: Formulate an
            observation, a physiological mechanism, a directional prediction, and a confidence rating
            before requesting tutor input. (2) <em>Defend Mechanisms, Not Labels</em>: Explain{' '}
            <em>how</em> pressures, flows, and gas exchange interact physically rather than relying on
            diagnostic buzzwords. (3) <em>Calibrate Uncertainty</em>: Mark guesses honestly as
            guesses and treat high-confidence errors as high-yield diagnostic blind spots. (4){' '}
            <em>Reconstruct Unaided</em>: Whenever a worked explanation is provided, close the
            explanation and reconstruct the causal chain independently from memory.
          </p>

          <p>
            <strong style={{ color: 'var(--text)' }}>Consultant Tutor Commitments</strong>: (1){' '}
            <em>Respectful Intellectual Rigor</em>: The tutor will challenge incomplete logic,
            highlight unaccounted physiological data, and withhold premature answers—without generic
            praise or punitive judgment. (2) <em>Deterministic Physiological Truth</em>: All patient
            trajectories are governed strictly by the physiological engine; the tutor will never
            alter simulation outcomes. (3) <em>Adaptation to Fatigue Without Lowering Standards</em>:
            When post-call fatigue or cognitive overload is detected, the tutor will narrow visual
            complexity and decompose problems into manageable steps while keeping the standard for
            independent mastery intact.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--line)' }}>
          <button
            type="button"
            data-testid="tutor-contract-cancel-btn"
            onClick={onCancel}
            className="px-3 py-1.5 rounded border text-xs"
            style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
          >
            Keep Tutor Off
          </button>
          <button
            type="button"
            data-testid="tutor-contract-accept-btn"
            onClick={onAccept}
            className="px-4 py-1.5 rounded text-xs font-semibold"
            style={{ backgroundColor: 'var(--act)', color: 'var(--act-ink)' }}
          >
            {CONTRACT_ACCEPT_BUTTON_LABEL}
          </button>
        </div>
      </div>
    </div>
  );
};
