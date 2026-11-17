import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseFile } from '../shared/caseSchema';
import type { EngineApi } from '../shared/engineTypes';
import type { LearnerApi, RunSummary } from '../shared/learnerApi';
import type { RunState } from '../runtime/caseRuntime';
import { EVENT_SCHEMA_VERSION, type GuidanceLevel } from '../shared/events';
import { newId } from '../shared/eventSink';
import { engine as defaultEngine } from '../engine/index';
import { createLearner } from '../learner/learner';
import { CaseLibrary } from '../screens/CaseLibrary';
import { ErrorBoundary } from './ErrorBoundary';
import { Debrief } from '../screens/Debrief';
import { Progress } from '../screens/Progress';
import { loadAllCasesWithVariants, type CaseCatalogResult, type FullCaseCatalogResult } from '../screens/caseCatalog';
import { DrillRunner } from '../drills/DrillRunner';
import { allDrillSets } from '../drills/content';
import type { DrillSet } from '../drills/types';
import {
  ALL_LAB_EXPERIMENTS,
  LAB_TEST_IDS,
  LabCatalog,
  LabRunnerView,
  type LabExperiment,
} from '../lab';
import { Home } from '../screens/Home';
import { Practice } from '../screens/Practice';
import { CaseRunner } from './CaseRunner';
import { IntroTour, introTourSeen } from './IntroTour';
import { TutorLab } from '../tutor/TutorLab';
import type { VentSkin } from './vent/settings';
import { BugReportButton } from '../bugreport/BugReportButton';
import { installDiagnostics, logNavigation, registerBugContext } from '../bugreport/diagnostics';
import './vent/vent.css';

type Theme = 'light' | 'hybrid' | 'dark';
function initialTheme(): Theme {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('theme');
      if (q === 'light' || q === 'hybrid' || q === 'dark') return q;
      if (window.location.hash.includes('?')) {
        const hq = new URLSearchParams(window.location.hash.split('?')[1]).get('theme');
        if (hq === 'light' || hq === 'hybrid' || hq === 'dark') return hq;
      }
    }
    const t = localStorage.getItem('vt-theme');
    if (t === 'light' || t === 'hybrid' || t === 'dark') return t;
  } catch { /* storage blocked */ }
  return 'light';
}

function initialSkin(): VentSkin {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('skin');
      if (q === 'hamilton' || q === 'mindray') return q;
      if (window.location.hash.includes('?')) {
        const hq = new URLSearchParams(window.location.hash.split('?')[1]).get('skin');
        if (hq === 'hamilton' || hq === 'mindray') return hq;
      }
    }
    const s = localStorage.getItem('vt-skin');
    if (s === 'hamilton' || s === 'mindray') return s;
  } catch { /* storage blocked */ }
  return 'hamilton';
}

export const APP_VERSION = '0.1.0-icu-trainer';

type View =
  | { kind: 'home' }
  | { kind: 'cases' }
  | { kind: 'case'; caseFile: CaseFile; initialRunState?: RunState }
  | { kind: 'debrief'; run: RunSummary; caseFile: CaseFile }
  | { kind: 'drills' }
  | { kind: 'drill'; set: DrillSet; runKey: string }
  | { kind: 'labs' }
  | { kind: 'lab'; experiment: LabExperiment; runKey: string }
  | { kind: 'practice' }
  | { kind: 'progress' }
  | { kind: 'tutor-lab' };

export interface TrainerAppProps {
  /** Injected in tests; defaults to IndexedDB-backed learner, the real engine and the bundled case library. */
  learner?: LearnerApi;
  engine?: EngineApi;
  catalog?: CaseCatalogResult;
  onExit?: () => void;
  defaultTab?: 'home' | 'cases' | 'drills' | 'labs' | 'practice' | 'progress';
}


export const TrainerApp: React.FC<TrainerAppProps> = ({
  learner: injectedLearner,
  engine = defaultEngine,
  catalog: injectedCatalog,
  onExit,
  defaultTab,
}) => {
  const learner = useMemo(() => injectedLearner ?? createLearner(), [injectedLearner]);
  const catalog = useMemo<FullCaseCatalogResult>(() => {
    if (injectedCatalog) {
      return {
        ...injectedCatalog,
        baseCases: injectedCatalog.cases,
        variants: [],
        variantsMeta: {},
      };
    }
    return loadAllCasesWithVariants();
  }, [injectedCatalog]);
  const allSelectableCases = useMemo(() => [...catalog.baseCases, ...catalog.variants], [catalog]);
  const sessionId = useMemo(() => newId(), []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__ovsLearner = learner;
    }
  }, [learner]);

  const initialView = useMemo<View>(() => {
    try {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        const caseId = params.get('case');
        if (caseId) {
          const c = allSelectableCases.find(x => x.id === caseId);
          if (c) return { kind: 'case', caseFile: c };
        }
        const labId = params.get('lab');
        if (labId) {
          const exp = ALL_LAB_EXPERIMENTS.find(x => x.id === labId);
          if (exp) return { kind: 'lab', experiment: exp, runKey: newId() };
        }
        const v = params.get('view');
        if (v === 'home') return { kind: 'home' };
        if (v === 'cases') return { kind: 'cases' };
        if (v === 'drills') return { kind: 'drills' };
        if (v === 'lab' || v === 'labs') return { kind: 'labs' };
        if (v === 'practice') return { kind: 'practice' };
        if (v === 'progress') return { kind: 'progress' };
        if (v === 'tutor-lab') return { kind: 'tutor-lab' };

        const hash = window.location.hash;
        if (hash === '#tutor-lab' || hash.includes('tutor-lab')) return { kind: 'tutor-lab' };
        if (hash.includes('?')) {
          const hashParams = new URLSearchParams(hash.split('?')[1]);
          const caseId = hashParams.get('case');
          if (caseId) {
            const c = allSelectableCases.find(x => x.id === caseId);
            if (c) return { kind: 'case', caseFile: c };
          }
          const labId = hashParams.get('lab');
          if (labId) {
            const exp = ALL_LAB_EXPERIMENTS.find(x => x.id === labId);
            if (exp) return { kind: 'lab', experiment: exp, runKey: newId() };
          }
          const hv = hashParams.get('view');
          if (hv === 'home') return { kind: 'home' };
          if (hv === 'cases') return { kind: 'cases' };
          if (hv === 'drills') return { kind: 'drills' };
          if (hv === 'lab' || hv === 'labs') return { kind: 'labs' };
          if (hv === 'practice') return { kind: 'practice' };
          if (hv === 'progress') return { kind: 'progress' };
          if (hv === 'tutor-lab') return { kind: 'tutor-lab' };
        }
      }
    } catch { /* ignore */ }
    if (defaultTab) {
      if (defaultTab === 'home') return { kind: 'home' };
      if (defaultTab === 'cases') return { kind: 'cases' };
      if (defaultTab === 'drills') return { kind: 'drills' };
      if (defaultTab === 'labs') return { kind: 'labs' };
      if (defaultTab === 'practice') return { kind: 'practice' };
      if (defaultTab === 'progress') return { kind: 'progress' };
    }
    return { kind: 'home' };
  }, [catalog, defaultTab, injectedCatalog]);
  const [view, setView] = useState<View>(initialView);
  // First-run intro tour: shown once (localStorage flag), on the Home screen, skippable.
  const [showTour, setShowTour] = useState<boolean>(() => initialView.kind === 'home' && !introTourSeen());
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => { installDiagnostics(); }, []);
  const viewLabel = view.kind === 'case' ? `case:${view.caseFile.id}` : view.kind === 'lab' ? `lab:${view.experiment.id}` : view.kind === 'drill' ? `drill:${view.set.id}` : view.kind === 'debrief' ? `debrief:${view.caseFile.id}` : view.kind;
  useEffect(() => { logNavigation(viewLabel); }, [viewLabel]);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [skin, setSkin] = useState<VentSkin>(initialSkin);
  const [guidanceMap, setGuidanceMap] = useState<Record<string, GuidanceLevel> | undefined>(undefined);
  useEffect(() => { try { localStorage.setItem('vt-theme', theme); } catch { /* storage blocked */ } }, [theme]);
  useEffect(() => registerBugContext('app', () => ({ section: viewLabel, theme, ventilatorLabels: skin, sessionId })), [viewLabel, theme, skin, sessionId]);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof getComputedStyle !== 'function') return;
    const bg = getComputedStyle(el).getPropertyValue('--bg').trim();
    if (bg) { document.documentElement.style.background = bg; document.body.style.background = bg; }
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }, [theme]);
  // Leaving the trainer hands the page background back to the original simulator.
  useEffect(() => () => { document.documentElement.style.background = ''; document.body.style.background = ''; document.documentElement.style.colorScheme = ''; }, []);
  useEffect(() => { try { localStorage.setItem('vt-skin', skin); } catch { /* storage blocked */ } }, [skin]);

  useEffect(() => {
    void learner.record({ v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION, id: newId(), wallTime: new Date().toISOString(), sessionId, type: 'session_start', appVersion: APP_VERSION })
      .catch(e => setNotice(`Progress is not being saved on this device: ${e instanceof Error ? e.message : String(e)}`));
  }, [learner, sessionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const states = await learner.getCompetencyStates();
        if (cancelled) return;
        const map: Record<string, GuidanceLevel> = {};
        for (const s of states) map[s.competency] = s.guidance;
        setGuidanceMap(map);
      } catch { /* storage blocked */ }
    })();
    return () => { cancelled = true; };
  }, [learner, view.kind]);

  // A case that was left (closed tab, refresh, Back) has run_start but no run_end. Mark it abandoned so the
  // history is complete (QA5-002). Never while a case is open: that one is still running.
  useEffect(() => {
    if (view.kind === 'case') return;
    let cancelled = false;
    void (async () => {
      try {
        const runs = await learner.listRuns(200);
        for (const r of runs) {
          if (cancelled) return;
          if (r.activity !== 'case' || r.endedAt !== null) continue;
          await learner.record({ v: EVENT_SCHEMA_VERSION as typeof EVENT_SCHEMA_VERSION, id: newId(), wallTime: new Date().toISOString(), sessionId, runId: r.runId, activity: 'case', activityId: r.activityId, activityVersion: r.activityVersion, type: 'run_end', outcome: 'abandoned' });
        }
      } catch { /* storage unavailable: the banner above already says so */ }
    })();
    return () => { cancelled = true; };
  }, [learner, sessionId, view.kind]);

  const navButton = (label: string, active: boolean, onClick: () => void, testId?: string) => (
    <button type="button" onClick={onClick} data-testid={testId} aria-current={active ? 'page' : undefined} className="vt-tab" aria-selected={active}>{label}</button>
  );
  const inCase = view.kind === 'case';
  const go = (v: View) => {
    if (inCase && !window.confirm('Leave this case? It will not be scored.')) return;
    setView(v);
  };

  const themeEl = (
        <div className="flex items-center gap-1.5" role="group" aria-label="Colour theme">
          <span className="hidden sm:inline text-[11px] font-mono uppercase tracking-wider font-bold mr-1" style={{ color: 'var(--text-3)' }}>
            Theme
          </span>
          <div className="inline-flex rounded-sm p-0.5 border" style={{ borderColor: 'var(--line)', background: 'var(--surface-3)' }}>
            <button
              type="button"
              className={`px-2 py-0.5 text-xs font-medium rounded-xs transition-colors ${theme === 'light' ? 'bg-[var(--surface)] text-[var(--text)] font-semibold shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
              aria-pressed={theme === 'light'}
              data-testid="theme-light"
              onClick={() => setTheme('light')}
            >
              Light
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 text-xs font-medium rounded-xs transition-colors ${theme === 'hybrid' ? 'bg-[var(--surface)] text-[var(--text)] font-semibold shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
              aria-pressed={theme === 'hybrid'}
              data-testid="theme-hybrid"
              onClick={() => setTheme('hybrid')}
            >
              Light, dark waveforms
            </button>
            <button
              type="button"
              className={`px-2 py-0.5 text-xs font-medium rounded-xs transition-colors ${theme === 'dark' ? 'bg-[var(--surface)] text-[var(--text)] font-semibold shadow-xs' : 'text-[var(--text-2)] hover:text-[var(--text)]'}`}
              aria-pressed={theme === 'dark'}
              data-testid="theme-dark"
              onClick={() => setTheme('dark')}
            >
              Dark
            </button>
          </div>
        </div>
  );
  const skinEl = (
        <div className="flex items-center gap-1" role="group" aria-label="Ventilator style" data-testid="skin-picker" title="Changes the names of modes and settings on the ventilator to match this brand. The physiology is the same.">
          <span className="hidden sm:inline text-[11px] font-mono uppercase tracking-wider font-bold" style={{ color: 'var(--text-3)' }}>Ventilator labels</span>
          <button type="button" className={`px-2 py-0.5 text-xs rounded-sm border ${skin === 'hamilton' ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'}`} style={{ borderColor: skin === 'hamilton' ? 'var(--line-strong)' : 'var(--line)' }} aria-pressed={skin === 'hamilton'} onClick={() => setSkin('hamilton')}>Hamilton</button>
          <button type="button" className={`px-2 py-0.5 text-xs rounded-sm border ${skin === 'mindray' ? 'bg-[var(--surface)] font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'}`} style={{ borderColor: skin === 'mindray' ? 'var(--line-strong)' : 'var(--line)' }} aria-pressed={skin === 'mindray'} onClick={() => setSkin('mindray')}>Mindray</button>
        </div>
  );

  return (
    <div ref={rootRef} className={`vt min-h-screen flex flex-col${inCase ? ' vt-app--case' : ''}`} data-theme={theme} data-skin={skin}>
      <header className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-4 py-1 border-b min-h-12" style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <div className="flex items-center gap-2 mr-4">
          <span className="text-sm font-bold tracking-tight">ICU Respiratory Trainer</span>
        </div>
        {inCase ? (
          <button type="button" className="vt-btn !min-h-[28px] !text-xs" data-testid="exit-case" onClick={() => go({ kind: 'cases' })}>Exit case</button>
        ) : (
          <nav className="flex items-center gap-1 min-w-0 max-w-full overflow-x-auto" aria-label="Trainer Navigation">
            {navButton('Home', view.kind === 'home', () => go({ kind: 'home' }), 'tab-home')}
            {navButton('Cases', view.kind === 'cases' || view.kind === 'debrief', () => go({ kind: 'cases' }), 'tab-cases')}
            {navButton('Drills', view.kind === 'drills' || view.kind === 'drill', () => go({ kind: 'drills' }), 'tab-drills')}
            {navButton('Lab', view.kind === 'labs' || view.kind === 'lab', () => go({ kind: 'labs' }), LAB_TEST_IDS.TAB_LAB)}
            {navButton('Practice', view.kind === 'practice', () => go({ kind: 'practice' }), 'tab-practice')}
            {navButton('Progress', view.kind === 'progress', () => go({ kind: 'progress' }), 'tab-progress')}
          </nav>
        )}
        <span className="ml-auto" />
        {inCase ? (
          <details className="relative mr-2" data-testid="settings-menu">
            <summary className="vt-btn vt-btn--quiet !min-h-[28px] !text-xs cursor-pointer list-none">Settings</summary>
            <div className="absolute right-0 top-full mt-1 z-40 p-3 flex flex-col gap-3 rounded border shadow-lg w-max max-w-[90vw]" style={{ background: 'var(--surface)', borderColor: 'var(--line-strong)' }}>
              {themeEl}
              {skinEl}
            </div>
          </details>
        ) : <div className="mr-2">{themeEl}</div>}
        <BugReportButton appVersion={APP_VERSION} />
        {!inCase && <button
          type="button"
          className="vt-btn vt-btn--quiet !text-xs"
          data-testid="replay-intro"
          title="Show the short intro tour again"
          onClick={() => setShowTour(true)}
        >
          Replay intro
        </button>}
        {onExit && (
          <button
            type="button"
            className="vt-btn vt-btn--quiet !text-xs ml-1 text-[var(--text-3)] hover:text-[var(--text)]"
            title="Return to Standalone Simulator"
            onClick={() => { if (!inCase || window.confirm('Leave this case? It will not be scored.')) onExit(); }}
          >
            Standalone ↗
          </button>
        )}
      </header>
      {notice && <div className="text-sm px-4 py-2 font-semibold" style={{ background: 'var(--alarm-med)', color: 'var(--alarm-med-ink)' }}>{notice}</div>}

      <main className="flex-1">
      <ErrorBoundary key={view.kind} onHome={() => { window.location.hash = '#/trainer?view=home'; setView({ kind: 'home' }); }}>
        {view.kind === 'home' && (
          <Home
            learner={learner}
            catalogCases={allSelectableCases}
            drillSets={allDrillSets}
            labExperiments={ALL_LAB_EXPERIMENTS}
            variantsMeta={catalog.variantsMeta}
            onStartCase={c => setView({ kind: 'case', caseFile: c })}
            onStartDrill={s => setView({ kind: 'drill', set: s, runKey: newId() })}
            onStartLab={exp => setView({ kind: 'lab', experiment: exp, runKey: newId() })}
          />
        )}

        {view.kind === 'cases' && (

          <>
            {catalog.invalid.length + catalog.failures.length > 0 && (
              <div className="mx-4 mt-3 text-sm" style={{ color: 'var(--warn-ink)' }}>
                {catalog.invalid.length + catalog.failures.length} case file(s) failed validation and are hidden. Run <code>npm run case:check</code> for details.
              </div>
            )}
            <CaseLibrary
              cases={catalog.baseCases}
              variants={catalog.variants}
              variantsMeta={catalog.variantsMeta}
              learner={learner}
              onStart={id => { const c = allSelectableCases.find(x => x.id === id); if (c) setView({ kind: 'case', caseFile: c }); }} />
          </>
        )}

        {view.kind === 'case' && (
          <CaseRunner key={view.caseFile.id + (view.initialRunState ? `-${view.initialRunState.runId}` : '')} caseFile={view.caseFile} engine={engine} sink={learner} sessionId={sessionId} skin={skin} initialRunState={view.initialRunState} guidanceMap={guidanceMap}
            onFinished={async runId => {
              const run = await learner.getRun(runId);
              if (run) setView({ kind: 'debrief', run, caseFile: view.caseFile });
              else { setNotice('The run finished but its summary could not be loaded.'); setView({ kind: 'cases' }); }
            }} />
        )}

        {view.kind === 'debrief' && (
          <Debrief
            run={view.run}
            caseFile={view.caseFile}
            unscoredPredictions={(view.run as any)?.unscoredPredictions}
            onBackToLibrary={() => setView({ kind: 'cases' })}
            onRewind={state => setView({ kind: 'case', caseFile: view.caseFile, initialRunState: state })}
          />
        )}

        {view.kind === 'drills' && (
          <div className="vt-page p-4 sm:p-6 space-y-5">
            <div className="border-b pb-4" style={{ borderColor: 'var(--line)' }}>
              <h1 className="text-xl md:text-2xl font-bold tracking-tight">Clinical Drills</h1>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-2)' }}>
                Rapid-fire pattern recognition, waveform interpretation, and emergency protocol drills.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {allDrillSets.map(s => (
                <div
                  key={s.id}
                  data-testid={`drill-card-${s.id}`}
                  className="p-4 border flex flex-col justify-between gap-4 hover:border-[var(--line-strong)] transition-colors"
                  style={{ borderColor: 'var(--line)', background: 'var(--surface)' }}
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono uppercase tracking-wider font-semibold" style={{ color: 'var(--sel)' }}>
                        {s.id.toUpperCase()}
                      </span>
                      <span className="vt-badge num">{s.items.length} items</span>
                    </div>
                    <h3 className="font-bold text-sm tracking-tight" style={{ color: 'var(--text)' }}>
                      {s.title}
                    </h3>
                    <p className="text-xs leading-relaxed" style={{ color: 'var(--text-2)' }}>
                      {s.description}
                    </p>
                  </div>
                  <div className="pt-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--line)' }}>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-3)' }}>
                      ~{Math.ceil(s.items.length * 1.5)} min
                    </span>
                    <button
                      type="button"
                      aria-label="Start"
                      className="vt-btn vt-btn--primary min-w-[5.5rem]"
                      onClick={() => setView({ kind: 'drill', set: s, runKey: newId() })}
                    >
                      Start
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view.kind === 'drill' && (
          <div className="p-4">
            <DrillRunner key={view.runKey} items={view.set.items} sink={learner} engine={engine} sessionId={sessionId} drillId={view.set.id}
              onFinish={() => setView({ kind: 'drills' })} />
          </div>
        )}

        {view.kind === 'labs' && (
          <LabCatalog
            experiments={ALL_LAB_EXPERIMENTS}
            learner={learner}
            onSelectExperiment={exp => setView({ kind: 'lab', experiment: exp, runKey: newId() })}
          />
        )}

        {view.kind === 'lab' && (
          <LabRunnerView
            key={view.runKey}
            experiment={view.experiment}
            engine={engine}
            learner={learner}
            onBack={() => setView({ kind: 'labs' })}
          />
        )}

        {view.kind === 'practice' && (
          <Practice
            learner={learner}
            onNavigateToCase={(caseId) => {
              const c = allSelectableCases.find(x => x.id === caseId);
              if (c) setView({ kind: 'case', caseFile: c });
            }}
            onNavigateToLab={(labId) => {
              const exp = ALL_LAB_EXPERIMENTS.find(x => x.id === labId);
              if (exp) setView({ kind: 'lab', experiment: exp, runKey: newId() });
            }}
          />
        )}

        {view.kind === 'progress' && <Progress learner={learner} onBackToLibrary={() => setView({ kind: 'cases' })} />}

        {view.kind === 'tutor-lab' && (
          <TutorLab onBack={() => { window.location.hash = '#/trainer?view=home'; setView({ kind: 'home' }); }} />
        )}
      </ErrorBoundary>
      </main>
      {showTour && <IntroTour onClose={() => setShowTour(false)} />}
      <footer className="text-[11px] px-4 py-2.5 border-t mt-auto flex flex-col sm:flex-row items-center justify-between gap-2" style={{ color: 'var(--text-3)', borderColor: 'var(--line)', background: 'var(--surface)' }}>
        <span>Teaching simulator with synthetic patients. The physiology is a simplified model and has not been validated for clinical decisions.</span>
        <span>Hamilton Medical and Mindray names are trademarks of their owners. Not affiliated. Inspired by, not copies of, real devices.</span>
      </footer>
    </div>
  );
};

export default TrainerApp;
