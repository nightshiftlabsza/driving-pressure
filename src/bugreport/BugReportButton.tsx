import React, { useEffect, useRef, useState } from 'react';
import { useModalFocus } from '../shared/useModalFocus';
import { captureScreenshot, type Screenshot } from './capture';
import { collectReport, type BugReport } from './diagnostics';

type Phase =
  | { kind: 'closed' }
  | { kind: 'review'; report: BugReport; shot: Screenshot | null; shotError: string | null }
  | { kind: 'sending'; report: BugReport; shot: Screenshot | null }
  | { kind: 'saved'; id: string; folder: string }
  | { kind: 'fallback'; report: BugReport; shot: Screenshot | null; reason: string };

function download(filename: string, href: string): void {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function localId(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `BR-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-local`;
}

/** Saves the whole report (screenshot included) as one file in the Downloads folder. */
export function exportReport(report: BugReport, shot: Screenshot | null, id = localId()): string {
  const payload = JSON.stringify({ ...report, id, screenshotPngDataUrl: shot?.dataUrl ?? null }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  download(`${id}.json`, url);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (shot) download(`${id}.png`, shot.dataUrl);
  return id;
}

export interface BugReportButtonProps { appVersion: string }

/**
 * "Report a problem": one press takes the screenshot and gathers the diagnostics, a small dialog shows the picture
 * with an optional "What happened?" box, and one more press saves it on this computer.
 */
export const BugReportButton: React.FC<BugReportButtonProps> = ({ appVersion }) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'closed' });
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState('');

  const open = async () => {
    if (busy) return;
    setBusy(true);
    // Diagnostics and picture are taken now, before any dialog is on screen.
    const report = collectReport('', appVersion);
    let shot: Screenshot | null = null;
    let shotError: string | null = null;
    try { shot = await captureScreenshot(); } catch (e) { shotError = e instanceof Error ? e.message : String(e); }
    setDescription('');
    setPhase({ kind: 'review', report, shot, shotError });
    setBusy(false);
  };

  const send = async (report: BugReport, shot: Screenshot | null) => {
    const full: BugReport = { ...report, description: description.trim() };
    setPhase({ kind: 'sending', report: full, shot });
    try {
      const res = await fetch('/api/bug-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: full, screenshotPngBase64: shot?.dataUrl ?? null }),
      });
      const json = (await res.json().catch(() => null)) as { success?: boolean; id?: string; folder?: string; error?: string } | null;
      if (!res.ok || !json?.success || !json.id) throw new Error(json?.error ?? `The local server answered ${res.status}.`);
      setPhase({ kind: 'saved', id: json.id, folder: json.folder ?? 'bug-reports' });
    } catch (e) {
      setPhase({ kind: 'fallback', report: full, shot, reason: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid="bug-report-open"
        className="vt-btn vt-btn--quiet !text-xs !min-h-[28px] !px-2"
        title="Report a problem. Takes a screenshot and the technical details for you."
        aria-label="Report a problem"
        disabled={busy}
        onClick={() => void open()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <ellipse cx="8" cy="9.5" rx="3.2" ry="4" /><path d="M6 5.5a2 2 0 014 0M8 6v7.5M1.8 9.5h3M11.2 9.5h3M2.8 5l2.4 1.8M13.2 5l-2.4 1.8M2.8 14l2.4-1.8M13.2 14l-2.4-1.8" />
        </svg>
        <span className="hidden md:inline">{busy ? 'Capturing…' : 'Report a problem'}</span>
      </button>
      {phase.kind !== 'closed' && (
        <BugReportDialog
          phase={phase}
          description={description}
          onDescription={setDescription}
          onSend={send}
          onClose={() => setPhase({ kind: 'closed' })}
        />
      )}
    </>
  );
};

const BugReportDialog: React.FC<{
  phase: Exclude<Phase, { kind: 'closed' }>;
  description: string;
  onDescription: (v: string) => void;
  onSend: (report: BugReport, shot: Screenshot | null) => void | Promise<void>;
  onClose: () => void;
}> = ({ phase, description, onDescription, onSend, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useModalFocus(ref, onClose);
  useEffect(() => { textRef.current?.focus(); }, []);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setZoomed(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zoomed]);

  return (
    <div className="vt-dialog-backdrop" data-bugreport-ui role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
      <div ref={ref} tabIndex={-1} className="vt-dialog p-4 sm:p-5 !max-w-[44rem] max-h-[92vh] overflow-auto" data-testid="bug-report-dialog">
        <h2 id="bug-report-title" className="text-base font-bold mb-3">Report a problem</h2>

        {(phase.kind === 'review' || phase.kind === 'sending') && (
          <>
            {phase.shot ? (
              <img
                data-testid="bug-report-preview"
                src={phase.shot.dataUrl}
                alt="Screenshot that will be saved with this report"
                className="w-full max-h-[42vh] object-contain border rounded cursor-zoom-in"
                style={{ borderColor: 'var(--line-strong)', background: 'var(--surface-3)' }}
                title="Click to open full size"
                onClick={() => setZoomed(true)}
              />
            ) : (
              <div className="text-sm p-3 border rounded" style={{ borderColor: 'var(--warn-line)', background: 'var(--warn-bg)', color: 'var(--warn-ink)' }}>
                The screenshot could not be taken{phase.kind === 'review' && phase.shotError ? ` (${phase.shotError})` : ''}. The technical details will still be saved.
              </div>
            )}
            {phase.shot && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Click the picture to open it full size.</p>}
            <p className="text-xs mt-2" style={{ color: 'var(--text-2)' }}>
              Saved with it: this screen ({phase.report.section}), your settings and the simulator state, browser and screen size, recent errors and your last few clicks. Nothing you typed elsewhere is included.
            </p>
            <label className="block mt-3 text-sm font-semibold" htmlFor="bug-report-text">What happened? <span className="font-normal" style={{ color: 'var(--text-3)' }}>(optional)</span></label>
            <textarea
              id="bug-report-text"
              ref={textRef}
              data-testid="bug-report-text"
              className="vt-input w-full mt-1 min-h-[4.5rem]"
              placeholder="For example: the pressure waveform did not change when I raised the flow."
              value={description}
              onChange={e => onDescription(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && phase.kind === 'review') void onSend(phase.report, phase.shot); }}
            />
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button type="button" className="vt-btn" onClick={onClose}>Cancel</button>
              <button type="button" data-testid="bug-report-send" className="vt-btn vt-btn--primary" disabled={phase.kind === 'sending'}
                onClick={() => void onSend(phase.report, phase.shot)}>
                {phase.kind === 'sending' ? 'Saving…' : 'Send report'}
              </button>
            </div>
          </>
        )}

        {phase.kind === 'saved' && (
          <div data-testid="bug-report-saved">
            <p className="text-sm"><b style={{ color: 'var(--ok)' }}>Saved.</b> Reference: <b className="num" data-testid="bug-report-id">{phase.id}</b></p>
            <p className="text-xs mt-1 break-all" style={{ color: 'var(--text-2)' }}>It is in {phase.folder} on this computer, with its screenshot. Mention the reference when you ask for a fix.</p>
            <div className="flex justify-end mt-4"><button type="button" className="vt-btn vt-btn--primary" onClick={onClose}>Back to studying</button></div>
          </div>
        )}

        {phase.kind === 'fallback' && (
          <div data-testid="bug-report-fallback">
            <p className="text-sm" style={{ color: 'var(--warn-ink)' }}>The report could not be saved to the app folder ({phase.reason}).</p>
            <p className="text-sm mt-1">Download it instead: one file with all details, plus the screenshot, go to your Downloads folder.</p>
            <div className="flex flex-wrap justify-end gap-2 mt-4">
              <button type="button" className="vt-btn" onClick={onClose}>Close</button>
              <button type="button" data-testid="bug-report-download" className="vt-btn vt-btn--primary"
                onClick={() => { exportReport(phase.report, phase.shot); onClose(); }}>Download report</button>
            </div>
          </div>
        )}
      </div>
      {zoomed && (phase.kind === 'review' || phase.kind === 'sending') && phase.shot && (
        <div
          data-testid="bug-report-zoom"
          role="dialog"
          aria-label="Screenshot, full size"
          className="fixed inset-0 overflow-auto cursor-zoom-out"
          style={{ background: 'rgba(0,0,0,0.85)', zIndex: 10000 }}
          onClick={() => setZoomed(false)}
        >
          <img src={phase.shot.dataUrl} alt="Screenshot, full size (click or press Esc to close)" style={{ width: '100%', height: 'auto', display: 'block' }} />
        </div>
      )}
    </div>
  );
};
