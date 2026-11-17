# Writing a case

A case is one JSON file in `src/cases/library/`. The schema is `src/shared/caseSchema.ts`; the runtime rules are in `docs/CONTRACTS.md`. The engine decides all physiology. A case sets the patient's parameters and how they change, never an output such as SpO2 or PaCO2.

## Steps

1. **Copy a similar case.** `copd-niv-01.json` (ward, NIV), `pneumonia-hfnc-01.json` (ED, HFNC then intubation) or `ards-vent-01.json` (ICU, ventilated) are good starting points. Give it a new `id` (same as the file name) and `version` `0.1.0`.
2. **Write the patient.** A synthetic name ending "(synthetic)", the story, and `params` (every field of `PatientParams` in `src/shared/engineTypes.ts`; units are in the field names). `initialPhys` can set the starting PaCO2, measured HCO3 and fatigue.
3. **Pick the orders** the learner may use (`availableOrders`) and what they do (`orderEffects`): a `patientChange` with an optional `rampSimMin`, a `message`, or `endCase`. Intubation always puts the patient on a default ventilator (VC 450 mL, rate 16, PEEP 5, FiO2 1.0); add an effect only for extra changes such as lower drive from sedation.
4. **Add the disease course** (`course`): scheduled patient changes, for example a shunt that worsens over two hours.
5. **Add triggers.** Conditions are checked every simulated second: `threshold` (a metric, optionally held for `forSimSec`), `ordered`, `fired`, and `all` / `any` / `not`. Actions: `message`, `prediction`, `mistake`, `endCase`. Metrics are listed in `METRICS` in the schema. Remember that ventilator metrics (VTe, PEEP, Pplat) are empty when the patient is not on a ventilator or NIV.
6. **Add prediction points.** Use `marking: "engine"` with the `direction` format when the physiology should answer (marked at the next blood gas or after an hour). Use `"fixed"` with an `answerKey` for interpretation or decision questions. The explanation is shown only after the answer is committed.
7. **Add a rubric.** Items with `bySimMin` count if they were ever met before that time; the others are judged at the end. Mark at most one or two items `critical`.
8. **Add evidence** for every clinical threshold you use (guideline, trial or observational study, with year), in your own words. Do not copy text from slides or books.
9. **Write expectations** in `src/cases/expectations/<id>.json`: two to four scenarios (doing nothing, the right management, a common mistake) with orders at set times, expected metric values, the expected `outcome`, and triggers that should or should not have `fired`.
10. **Check it.**

    ```bash
    npm run case:check
    npx vitest run tests/runtime/expectations.test.ts
    ```

    If a scenario fails, change the patient parameters (not the expectation) until the behaviour matches what you would expect at the bedside. Then record what you changed and why in `docs/cases/<id>.md`.

## Calibration tips

- Chronic CO2 retainers: set `chronicPaco2MmHg` (e.g. 55 for moderate-to-severe COPD with baseline HCO3 30). This sets the chemoreflex setpoint ($pH_{\text{set}} = 7.40 - 0.003 \cdot (\text{chronicPaCO}_2 - 40)$) and derives baseline metabolic compensation ($0.35\text{ mmol/L}$ per mmHg above 40) so the patient defends their own compensated baseline rather than 40 mmHg.
- Hypercapnia speed depends on `vco2MlPerMin`, dead space (`anatomicDeadSpaceMl`, `alveolarDeadSpaceFraction`) and how much effort the patient can sustain (`pmusAmplitudeCmH2O`, `respiratoryReserve`, starting `fatigue`).
- Oxygenation depends on `shuntFraction` (true shunt; responds weakly to FiO2) and `recruitability` (how much PEEP above 5 can reverse).
- Blood pressure response to positive pressure is set by `ppvResponse` and `ppvSeverity`.
- A quick way to explore is a scratch script in `.explore/` (git-ignored) run with `npx vite-node .explore/myscript.ts`, calling `engine.createState`, `engine.fastForward` and `engine.drawAbg`.
