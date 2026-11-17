# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Critical care fellows, respiratory therapists, intensive care doctors, and trainees learning mechanical ventilation and non-invasive ventilation management.

## Product Purpose
Interactive ICU mechanical ventilation and respiratory therapy training simulator running in the browser and fully usable offline (the optional AI tutor, off by default, is the only feature that needs a network). Trains clinicians in setting titration, arterial blood gas interpretation, pathophysiology prediction, and mode selection.

## Positioning
Real-time, physiologically faithful simulation of respiratory mechanics and gas exchange with authentic ventilator UI layouts (Hamilton and Mindray inspired), offline-first; the optional AI tutor (off by default) calls an AI provider through the dev/preview server, and everything else works offline.

## Operating Context
Bedside training, medical education drills, case simulation runs, ventilator waveform analysis, and competency debriefs.

## Capabilities and Constraints
- Waveforms: pressure, flow, volume sweep traces
- Modes: VC-AC, PC-AC, SIMV-VC, PSV/CPAP, NIV S/T, NIV CPAP, HFNO, PRVC family (APVcmv/APVsimv)
- Device skins: Hamilton C6/C3/C1 style, Mindray SV800/SV600/SV300 Pro style
- Pure TypeScript, client-side offline execution; no network calls unless the optional AI tutor (off by default) is enabled
- Strict separation of engine physiology and UI presentation

## Brand Commitments
Hamilton Medical and Mindray names are trademarks of their owners. Not affiliated. Inspired by, not copies of, the real devices. Teaching simulator, not a medical device.

## Evidence on Hand
Synthetic clinical cases in `src/cases/library/`, physiological test suites in `tests/`, and interactive learner progress tracking.

## Product Principles
1. Physiologically authentic: no fake waveforms or fabricated values outside the simulation engine.
2. Clinical fidelity without noise: dense, professional ICU monitor look without decorative gradients or toy cards.
3. Offline and deterministic: operates reliably in any modern browser without network dependence (the optional AI tutor excepted).
4. Educational accountability: asks for a prediction on scripted steps, a working assessment plus confidence (the commit sheet) on unscripted ventilator changes, and a structured debrief.

## Accessibility & Inclusion
High contrast dark and light modes, keyboard navigation, full ARIA roles and labels on all ventilator control buttons and numeric displays.
