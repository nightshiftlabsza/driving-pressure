import React, { useMemo } from 'react';
import autoPeepData from '../../tests/tutor/fixtures/autoPeepFixture.json';
import { buildTutorContext, type ActiveCaseSnapshotData } from './context';
import { TutorPanel } from './TutorPanel';

export interface TutorLabProps {
  onBack?: () => void;
}

export const TutorLab: React.FC<TutorLabProps> = ({ onBack }) => {
  const fixture = autoPeepData as unknown as ActiveCaseSnapshotData;

  const builtContext = useMemo(() => {
    return buildTutorContext(fixture, 'active_case');
  }, [fixture]);

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
      <header
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
      >
        <div className="flex items-center gap-3">
          <span className="font-semibold" style={{ color: 'var(--act)' }}>Tutor Lab</span>
          <span className="text-xs" style={{ color: 'var(--text-2)' }}>Standalone AI Tutor Test Screen</span>
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs border px-3 py-1 rounded"
            style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text)' }}
          >
            ← Back to Trainer
          </button>
        )}
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main scenario inspector */}
        <main className="flex-1 p-4 overflow-y-auto space-y-4">
          <div
            className="border rounded p-4"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
              Active Fixture: {fixture.caseFile?.title}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
              {fixture.caseFile?.patient?.presentingStory}
            </p>
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2 rounded border" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                <span className="block text-[10px]" style={{ color: 'var(--text-2)' }}>MODE & VT</span>
                <span className="font-semibold" style={{ color: 'var(--text)' }}>VC 500 mL, PEEP 4</span>
              </div>
              <div className="p-2 rounded border" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                <span className="block text-[10px]" style={{ color: 'var(--text-2)' }}>RESP RATE</span>
                <span className="font-semibold" style={{ color: 'var(--warn-ink)' }}>Set 22 /min</span>
              </div>
              <div className="p-2 rounded border" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                <span className="block text-[10px]" style={{ color: 'var(--text-2)' }}>PRESSURES</span>
                <span className="font-semibold" style={{ color: 'var(--alarm-high)' }}>Ppeak {fixture.engine?.monitored?.ppeakCmH2O ?? 38} cmH2O</span>
              </div>
              <div className="p-2 rounded border" style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)' }}>
                <span className="block text-[10px]" style={{ color: 'var(--text-2)' }}>FLOW WAVEFORM</span>
                <span className="font-semibold" style={{ color: 'var(--warn-ink)' }}>Expiratory flow ≠ 0</span>
              </div>
            </div>
          </div>

          <div
            className="border rounded p-4 text-xs space-y-2"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text)' }}>Policy & Probe Constraints</h3>
            <ul className="list-disc list-inside space-y-1" style={{ color: 'var(--text-2)' }}>
              <li>
                <strong>Cap Level:</strong> 1 (Principle only). Level 2 or 3 is strictly forbidden.
              </li>
              <li>
                <strong>Hidden Probe:</strong> Dynamic hyperinflation / Auto-PEEP recognition.
              </li>
              <li>
                <strong>Forbidden terms:</strong> "auto-PEEP", "intrinsic PEEP", "dynamic hyperinflation", rate change numbers.
              </li>
              <li>
                <strong>Sample learner message:</strong> &quot;I think the rising airway pressure is due to worsening bronchospasm. I would increase inspiratory pressure.&quot;
              </li>
            </ul>
          </div>

          <div
            className="border rounded p-4 text-xs"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--line)' }}
          >
            <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text)' }}>Simulated Context Sent to AI</h3>
            <pre
              className="border p-3 rounded text-[11px] overflow-x-auto whitespace-pre-wrap"
              style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--line)', color: 'var(--text-2)' }}
            >
              {builtContext.contextText}
            </pre>
          </div>
        </main>

        {/* Mounted Tutor Panel */}
        <TutorPanel
          contextText={builtContext.contextText}
          contextKind="active_case"
          helpLevelCap={1}
          forbiddenPhrases={builtContext.forbiddenPhrases}
          withheldDiagnosis={builtContext.withheldDiagnosis}
        />
      </div>
    </div>
  );
};
