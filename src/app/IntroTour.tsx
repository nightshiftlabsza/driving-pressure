import React, { useState } from 'react';

/**
 * First-run intro tour: five short steps over the case screen's main areas
 * (waveforms, settings, alarms, patient, consultant). Shown once per browser
 * (localStorage flag), skippable, and reopenable via the header's "Replay intro".
 */

export const INTRO_TOUR_KEY = 'ovs-intro-tour-done';

/** True when the learner has already completed or skipped the tour. Storage blocked: never nag. */
export function introTourSeen(): boolean {
  // Automated browsers (Playwright and friends) never see the tour, so it cannot cover the screen under e2e tests.
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(INTRO_TOUR_KEY) === '1';
  } catch {
    return true;
  }
}

function markIntroTourSeen() {
  try {
    localStorage.setItem(INTRO_TOUR_KEY, '1');
  } catch { /* storage blocked */ }
}

interface IntroTourStep { title: string; text: string }

const STEPS: readonly IntroTourStep[] = [
  {
    title: 'Waveforms',
    text: 'The sweeping traces show airway pressure, flow and volume over the last 10 seconds. Press Freeze to stop the sweep, then click on a trace to read exact values at that moment.',
  },
  {
    title: 'Settings',
    text: 'Under the waveforms are the ventilator controls. Changes take effect at the next breath; the small label by the settings tells you what is still waiting to take effect.',
  },
  {
    title: 'Alarms',
    text: 'The banner between the patient details and the clock shows active alarms. Silence quiets the sound for two minutes; Acknowledge marks that you have seen it.',
  },
  {
    title: 'Patient',
    text: 'The Patient tab holds the referral story, history and examination findings. Blood gases, chest X-rays and other orders are placed in the Orders tab.',
  },
  {
    title: 'Consultant',
    text: 'The Consultant tab is where you can ask questions about this case. Commit your own assessment first — the consultant is a backup, not the answer key.',
  },
];

export const IntroTour: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  const last = step === STEPS.length - 1;
  return (
    <div className="vt-dialog-backdrop" role="dialog" aria-modal="true" aria-label="Intro tour">
      <div className="vt-dialog p-5 max-w-md" data-testid="intro-tour">
        <div className="vt-label mb-1" style={{ color: 'var(--sel)' }}>Welcome · step {step + 1} of {STEPS.length}</div>
        <h2 className="text-lg font-bold mb-2">{current.title}</h2>
        <p className="text-sm leading-relaxed mb-4">{current.text}</p>
        <div className="flex items-center justify-between">
          <div className="flex gap-1" aria-hidden="true" data-testid="intro-tour-dots">
            {STEPS.map((_, i) => (
              <span key={i} className="inline-block w-2 h-2 rounded-full" style={{ background: i === step ? 'var(--act)' : 'var(--line-strong)' }} />
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" className="vt-btn" data-testid="intro-tour-skip" onClick={() => { markIntroTourSeen(); onClose(); }}>Skip</button>
            {step > 0 && (
              <button type="button" className="vt-btn" data-testid="intro-tour-back" onClick={() => setStep(s => s - 1)}>Back</button>
            )}
            <button
              type="button"
              className="vt-btn vt-btn--primary"
              data-testid="intro-tour-next"
              autoFocus
              onClick={() => {
                if (last) { markIntroTourSeen(); onClose(); } else setStep(s => s + 1);
              }}
            >
              {last ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
