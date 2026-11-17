# About Driving Pressure (ICU Respiratory Trainer)

A personal, offline simulator for practising adult ICU respiratory support. It is a fork of
[Open Vent Sim](https://github.com/fedebarra/open-vent-sim) by Federico Lorenzo Barra, extended for
critical care training. It covers invasive mechanical ventilation, non-invasive ventilation (NIV/CPAP)
and high-flow nasal cannula (HFNC). Anaesthesia is out of scope; the original anaesthesia machine is
hidden unless `VITE_SHOW_ANESTHESIA=true` is set.

> **Educational simulation only.** The patients are synthetic and the physiology engine is simplified.
> It is not validated and must not be used for clinical decisions or real patient care.

## Purpose

- Build bedside reasoning for a critical care doctor in training: predict what will happen, act, then
  see the consequence.
- Link every case, lab experiment and practice item to a learner competency, so progress is tracked
  across cases rather than per case.
- Keep the physiology deterministic and inspectable. The app decides physiology; any AI component may
  only phrase suggestions.

## Design

- **Ventilator UI.** Two device skins, Hamilton (C6/C3/C1 style) and Mindray (SV800/SV600/SV300 style),
  in light and dark themes. These are inspired by real devices, not copies, and are not affiliated with
  either manufacturer.
- **Engine.** A single-compartment equation of motion with a recruitable two-compartment lung option,
  expiratory flow limitation, CO2 and O2 kinetics (alveolar gas equation, Severinghaus curve, Riley
  three-compartment model), acid-base, effort and oesophageal-pressure estimates, and mechanistic
  dyssynchrony (double triggering, premature and delayed cycling, flow starvation). Full detail is in
  `docs/ENGINE.md` and `docs/MODEL_CARD.md`.
- **Separation of concerns.** Engine physiology lives in `src/engine/`. UI lives in `src/app/`,
  `src/display/` and `src/screens/`. Shared contracts live in `src/shared/` and are documented in
  `docs/CONTRACTS.md`. Cases may change patient parameters but may never set an output such as SpO2 or
  PaCO2 directly.
- **Storage.** Learner progress is kept in the browser's IndexedDB and can be exported or reset from
  the Progress screen. There is no account or telemetry; the only server is the local dev/preview server, which the optional AI tutor (off by default) uses to reach an AI provider.

## Functionality

- **Cases.** 11 scenarios in `src/cases/library/`, including COPD NIV, pneumonia on HFNC, ARDS, asthma,
  DKA, dyssynchrony, SBT pass and fail, high-pressure alarms and APO/CPAP. Each has prediction points,
  timed triggers, rubric items and a debrief with guideline references.
- **Scoring and debrief.** Predictions are marked against the engine's actual change. The debrief
  shows the rubric, the mistakes made and the teaching points.
- **Learning pathway and Home tab.** Three levels (foundation, acute ARDS and shock, advanced
  dyssynchrony and liberation) unlock in order. The Home tab shows what is next.
- **Physiology lab.** 13 experiments (compliance, resistance, time constants, auto-PEEP, dead space,
  shunt, recruitment, HFNC, PPV and preload) with causal "Why" traces.
- **Practice pack.** Predict-then-reveal and flashcard items with spaced repetition. The item bank was
  written from copyrighted textbooks and course material, so it is kept locally and is **not** in this
  repository; the practice screen is empty in a fresh clone.
- **Drills.** Timed ABG interpretation, alarm troubleshooting and waveform inspection.
- **Bedside view.** Alarms, waveform sweeps, loops, and a 3-minute blood-gas delay.
- **Progress.** Deterministic confidence-weighted, event-sourced competency tracking across 38 competencies in 8 domains, run history, and local backup and restore.
- **AI tutor (status).** An **opt-in** module (`aiTutorEnabled: false` by default, zero network calls when off). The app decides the help level and the model only phrases; nothing in the core application depends on it. Works offline with Ollama, or with optional Groq / Gemini developer keys via the local dev proxy.

## How to run

Windows, from the repository root:

- **Dev server (recommended):** `npm install`, then `npm run dev -- --port 3100`, and open
  `http://localhost:3100/#/trainer`. Needs Node.js 18+.
- **Offline production build:** double-click `start-trainer.bat`. It builds `dist/` on first run and
  serves it at `http://localhost:4173`.

Checks:

```
npm run typecheck
npm test              # Vitest unit, engine and stability tests
npx playwright test   # browser E2E tests
npm run case:check    # case schema and trajectory checks
npm run practice:check
```

## Evidence policy

- Targets and debriefs cite landmark, current guidance: ESICM ARDS 2023, Global ARDS Definition 2023,
  ERS HFNC 2022, ERS/ATS NIV 2017, GOLD 2024, GINA 2024 and ATS/ACCP liberation 2017..
- Textbook and course content informs the design and practice items. It is not reproduced in the repo.
- Independent clinical review is still pending.

## Known limits

- **Modes.** The APVcmv, APVsimv, PRVC and PRVC-SIMV tabs are visible but greyed out ("not simulated
  yet"). Only VC-AC, PC-AC, SIMV-VC, PSV/CPAP, NIV (S/T and CPAP) and HFNC are simulated.
- **Engine simplifications.** No pendelluft, no full circulatory model (cardiac output is
  phenomenological), no sedation or neuromuscular blockade pharmacokinetics, no secretions or ETT
  resistance changes, no sensor artefacts, sea-level pressure only.
- **Recruitment.** Single-compartment PEEP recruitment is phenomenological. Use the two-compartment
  model for the recruitment trade-off.
- **Licence.** MIT, inherited from upstream Open Vent Sim. See `LICENSE` and `NOTICE.md`.
- **Not validated.** Not for clinical decision support.
