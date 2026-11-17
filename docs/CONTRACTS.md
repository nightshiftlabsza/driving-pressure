# Shared contracts (frozen v1)

These files are the boundary between parallel workstreams. Import them; do not edit them.
A change needs the maintainer, a version bump and a line in the changelog at the bottom.

| File | What it defines |
| --- | --- |
| `src/shared/engineTypes.ts` | Patient parameters, device settings, waveform samples, monitored values, ABG, engine API |
| `src/shared/caseSchema.ts` | Case JSON format (zod), conditions, actions, orders, prediction points, rubric |
| `src/shared/events.ts` | Learner event log and `EventSink` |
| `src/shared/learnerApi.ts` | What the learner model exposes (`LearnerApi`) |
| `src/shared/competencies.json` | 38 competencies in 8 domains, evidence types, status ladder |
| `src/shared/mistakes.json` | Mistake taxonomy (10 types) |
| `src/engine/index.ts` | Engine entry point. Throws until engine v1 lands. Inject `EngineApi`, never import physiology elsewhere |

## Case runtime semantics

The case runtime (maintainer-owned, `src/runtime/`) evaluates conditions against engine output every simulated second.

- **threshold**: `metric op value`. With `forSimSec`, it must hold continuously that long. Blood-gas metrics (`ph`, `paco2`, `pao2`, `pfRatio`) read the engine's true current value, not the last drawn ABG, so endings do not depend on the learner ordering gases. What the learner *sees* is still only what they order.
- **ordered**: the learner placed that order at least `minCount` times (default 1). `withinSimMin` counts from case start.
- **fired**: a trigger with that id has fired.
- **all / any / not**: as named. Each condition object has exactly one key.
- **Triggers** run in file order. `once: true` triggers fire at most once.
- **Rubric items**: with `bySimMin`, met if the condition was true at any moment up to that time. Without it, evaluated when the case ends.
- **Prediction points** pause the clock. `marking: "engine"` compares the learner's direction for each variable with the engine's actual change between the moment of answering and the next blood gas the learner draws (or 60 simulated minutes, whichever is first). A change smaller than the noise band counts as "same": pH 0.02, PaCO2 3 mmHg, PaO2 5 mmHg, SpO2 1%, RR 2/min, HR 5/min, MAP 5 mmHg.
- **orderEffects** run their actions `delaySimMin` after the order. `patientChange` with `rampSimMin` interpolates linearly.
- **Messages** are in-world only (a nurse speaks). They must never be hints.

## Rules that apply to every case

- Synthetic patients only. No real names, no identifiable details.
- No copied text from textbooks, slides or videos. Cite in `evidence`, write your own words.
- Every case must have an evidence entry for each clinical threshold it uses.
- Parameters must stay inside schema ranges; `npm run case:check` enforces this.
- A case may change patient parameters. It may never set an output (SpO2, PaCO2, BP) directly. The engine decides physiology.

## Changelog

- 1.0.0 (2026-11-07): first freeze.
- 1.1.0 (2026-11-07): optional `expFlowLimitationCmH2O` patient parameter (expiratory flow limitation). Additive; existing cases unaffected. `baselineHco3MmolL` defined as standard bicarbonate.
- Case schema 1.0, additive (2026-11-08): evidence `kind` accepts `observational`. Runtime: `intubate` now always puts the patient on a ventilator (`detail.device` or default VC 450/16/PEEP 5/FiO2 1.0); case `orderEffects` for `intubate` apply in addition (previously they replaced the default). `startHold()` and `run.lastManoeuvre` added for holds.
- Phase 2 (2026-11-08): optional `chronicPaco2MmHg` patient parameter (chronic baseline PaCO2 when well, default 40). In chronic hypercapnia, defines chemical drive setpoint and initial renal compensation. Additive; existing cases unaffected.

## Case schema 1.1 addition: `ordered.deviceKind` (QA hunt 2026-11-09)
`ordered` conditions may carry `deviceKind: ("invasive"|"niv"|"hfnc"|"none")[]`. The condition then counts only `change-device` / `intubate` orders that moved the patient onto one of those device families. Use it for rubric items such as "started NIV" so a switch to a simple mask cannot score. Old cases are unaffected.
`finding` actions now replace the static examine/CXR text for later examinations, so a case can show a normal exam first and the crisis after it happens.

## Engine validation (QA hunt 2026-11-09)
`createState`, `setDevice` and `setPatient` now throw `Error` with a plain message for non-finite or out-of-range values (`src/engine/validate.ts`) and for mandatory-breath timing that leaves under 0.2 s to exhale. `cycleProblem()` is shared with the UI so Apply is blocked with the same message. Per-breath monitors (Ppeak, Pmean, VTe, MVe, leak, EtCO2) clear when no breath has arrived for max(15 s, 3 cycles) or the device has no circuit monitor.
- 1.2.0 (2026-11-09): optional additive field `lastManoeuvre?: ManoeuvreResult | null` on `EngineState` to expose the outcome of the most recent diagnostic manoeuvre (Pplat or auto-PEEP) to the bedside screen and tests.
- 1.3.0 (2026-11-09, Phase 4):
  - Additive field `hfncPressureCmH2O?: number | null` on `MonitoredValues` (estimated mouth-open airway pressure on HFNC).
  - Additive metrics `'hfncPressure'`, `'hfncPaw'`, and pattern metrics `alarmActive:<id>` and `alarmSilenced:<id>` in case schema `ThresholdSchema`.
  - Additive fields `priority?: 'high' | 'med' | 'low'` and `timeToAcknowledgeSec?: number` on `alarm` learner event in `src/shared/events.ts`.
  - Shared alarm and display contracts frozen in `src/alarms/types.ts` and `src/display/types.ts`.
- 1.3.0 / Phase 6 additions (2026-11-09, Physiology v2):
  - Additive optional fields on `PatientParams`: `lowVqFraction?: number`, `lowVqRatio?: number`, `lungModel?: 'single' | 'two-compartment'`, `twoCompartmentParams?: TwoCompartmentParams`, `chestWallComplianceMlPerCmH2O?: number`, `reverseTriggerProbability?: number`.
  - Additive optional fields on `InvasiveSettings`: `circuitLeakLpm?: number`, `cycleOffPct?: number`.
  - Additive manoeuvre kind `{ kind: 'occlusion'; maxSec: number }` on `Manoeuvre`.
  - Additive fields on `ManoeuvreResult`: `p01CmH2O?: number`, `deltaPoccCmH2O?: number`, `pmusEstimatedCmH2O?: number`, `deltaPlDynEstimatedCmH2O?: number`.
  - Additive optional fields on `MonitoredValues`: `pesCmH2O?: number | null`, `plEndInspCmH2O?: number | null`, `plEndExpCmH2O?: number | null`, `p01CmH2O?: number | null`, `deltaPoccCmH2O?: number | null`.
  - Additive dyssynchrony markers on `BreathSummary`: `doubleTriggered?`, `prematureCycled?`, `delayedCycled?`, `flowStarved?`, `autoTriggered?`, `reverseTriggered?`.
  - Additive metrics in `src/shared/caseSchema.ts`: `p01`, `deltaPocc`, `plEndInsp`, `plEndExp`, `pes`, `doubleTriggerCount`, `prematureCycleCount`, `delayedCycleCount`, `flowStarvationCount`, `autoTriggerCount`, `reverseTriggerCount`.
- 1.4.0 / Phase 7 additions (2026-11-09):
  - Additive metric in `src/shared/caseSchema.ts`: `rsbi` (rapid shallow breathing index = spontaneous RR / VT in litres; Yang & Tobin 1991). Evaluated in `src/engine/metrics.ts`.
  - Additive competencies in `src/shared/competencies.json`: `modes.dyssynchrony-management` ("Manage patient-ventilator dyssynchrony via settings adjustments rather than sedation") and `safety.extubation` ("Assess extubation readiness, airway patency and post-extubation management").
