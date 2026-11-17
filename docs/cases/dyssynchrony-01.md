# Case Design Note: dyssynchrony-01

## 1. Learning Goal
Diagnose and manage severe patient-ventilator dyssynchrony during Volume Control Assist-Control (VC-AC) mechanical ventilation in recovering acute hypoxemic respiratory failure / ARDS:
- **Recognise double triggering (breath stacking)**: Identify the distinct waveform pattern where two consecutive machine-assisted inspiratory efforts occur in rapid sequence separated by negligible expiratory time, caused by patient neural inspiratory time outlasting ventilator inspiratory time ($T_{i,\text{neural}} > T_{i,\text{vent}}$).
- **Understand the mechanics of double triggering**: When the mechanical breath terminates while diaphragmatic contraction is still ongoing, the continuing negative pleural pressure swing ($\Delta P_{\text{mus}}$) immediately drops airway pressure below the trigger threshold once the expiration refractory period elapses, commanding an immediate second breath on the same neural effort.
- **Appreciate the consequences of breath stacking**: Breath stacking occultly delivers two tidal volumes in rapid succession (e.g. $360 + 360 = 720\text{ mL}$, or $> 12\text{ mL/kg PBW}$ in a $57\text{ kg PBW}$ patient), dramatically driving peak airway pressure ($P_{\text{peak}} \ge 40\text{ cmH}_2\text{O}$), alveolar distension, and transpulmonary pressure swings, accelerating ventilator-induced lung injury (volutrauma/barotrauma) and diaphragmatic fatigue.
- **Avoid the Sedation Trap**: Distinguish true patient-ventilator dyssynchrony from behavioral agitation. Resist the reflexive administration of sedatives or neuromuscular blockers, which blunts recovering spontaneous drive, causes severe hypoventilation and hypotension, deepens ICU delirium, and delays liberation from mechanical ventilation.
- **Correct dyssynchrony mechanically**: Correct the underlying mismatch at the ventilator by prolonging ventilator inspiratory time to match neural inspiratory time (e.g. switching from square flow to a decelerating ramp pattern), meeting patient flow demand ($\ge 60\text{--}70\text{ L/min}$), appropriately titrating tidal volume within lung-protective limits, or transitioning to Pressure Support Ventilation (PSV) where the patient naturally governs inspiratory cycling.

## 2. Parameter Reasoning
- **Patient Profile**: Elena Rostova (synthetic), 48-year-old female, 165 cm height, 62 kg actual weight.
- **Predicted Body Weight (PBW)**:
  $$\text{PBW (female)} = 45.5 + 0.91 \times (\text{height in cm} - 152.4) = 45.5 + 0.91 \times 12.6 = 56.97 \approx 57.0\text{ kg}$$
  Nominal set $V_T = 360\text{ mL} \implies 360 / 57.0 = 6.3\text{ mL/kg PBW}$, which appears lung-protective in isolation but is delivered with inadequate flow and timing for an active patient.
- **Parenchymal Mechanics**:
  - Compliance ($45\text{ mL/cmH}_2\text{O}$): Moderately reduced static compliance typical of resolving ARDS / viral pneumonia.
  - Inspiratory resistance ($8\text{ cmH}_2\text{O/L/s}$) and Expiratory resistance ($10\text{ cmH}_2\text{O/L/s}$): Normal to mildly elevated airway resistance through an 7.5 mm endotracheal tube without acute bronchospasm.
- **Spontaneous Drive & Neuromechanical Timing**:
  - Neural spontaneous rate: $26\text{ bpm}$.
  - Muscular effort amplitude: $P_{\text{mus}} = 16\text{ cmH}_2\text{O}$ with `respiratoryReserve: 0.36`.
  - Neural inspiratory time: $T_{i,\text{neural}} = 1.05\text{ s}$.
- **Ventilator Timing & Double Trigger Thresholds**:
  - Initial settings: VC-AC, $V_T = 360\text{ mL}$, square flow pattern at $34\text{ L/min} = 0.567\text{ L/s}$.
  - Ventilator inspiratory time:
    $$T_{i,\text{vent}} = \frac{V_T}{\text{Flow}} = \frac{0.360\text{ L}}{0.567\text{ L/s}} = 0.635\text{ s}$$
  - The engine's double trigger criterion checks $T_{i,\text{neural}} \ge 1.4 \times T_{i,\text{vent}}$ and $P_{\text{mus}} \ge 4.0\text{ cmH}_2\text{O}$ upon expiration refractory release ($\text{REFRACTORY\_SEC} = 0.25\text{ s}$).
  - With $1.4 \times 0.635 = 0.889\text{ s} < 1.05\text{ s}$, the duration criterion is firmly met. When the mechanical breath ends at $0.635\text{ s}$ and the $0.25\text{ s}$ refractory window elapses ($t = 0.885\text{ s}$), the patient is $84.3\%$ through their $1.05\text{ s}$ neural effort. Modelled as a half-sine wave, $\sin(\pi \times 0.885 / 1.05) = 0.474$. With assist unloading factor $0.85$ and fatigue around $0.50$ (fatigueFactor $0.70$), effective effort amplitude is $16 \times 0.70 \times 0.85 = 9.52\text{ cmH}_2\text{O}$. Instantaneous muscle pressure at refractory release is $9.52 \times 0.474 = 4.51\text{ cmH}_2\text{O} \ge 4.0\text{ cmH}_2\text{O}$, reliably commanding an immediate stacked second breath.
- **Breath Stacking & Pressure Dynamics**:
  - Incomplete exhalation during the 0.25 s refractory window leaves $> 350\text{ mL}$ trapped. The stacked second breath delivers another $360\text{ mL}$, driving cumulative delivered volume to $> 720\text{ mL}$ above baseline.
  - Airway pressure surges from $12\text{--}14\text{ cmH}_2\text{O}$ on unstacked breaths up to $29.3\text{ cmH}_2\text{O}$ on stacked breaths. In clinical bedside practice, this triggers active high airway pressure alarms (typically set $10\text{ cmH}_2\text{O}$ above baseline at $25\text{--}30\text{ cmH}_2\text{O}$). In the engine runtime, `alarmActive:ppeak-high` checks a fixed $40\text{ cmH}_2\text{O}$ threshold (`mon.ppeakCmH2O >= 40` or `pmaxLimited`), while ARDS compliance ($45\text{ mL/cmH}_2\text{O}$, required to sustain neural demand and avoid assist-induced hypoventilation) yields stacked $P_{\text{peak}} \approx 30\text{ cmH}_2\text{O}$ and monitored average $P_{\text{peak}} \approx 18\text{--}22\text{ cmH}_2\text{O}$.
- **Fatigue Dynamics**:
  - Under VC-AC with square low flow ($34\text{ L/min}$), patient demand is $\approx 41.1\text{ L/min}$, keeping assist unloading limited ($0.85$).
  - High pressure-time product ($PTP \approx 115\text{ cmH}_2\text{O}\cdot\text{s/min}$) against an available capacity of $90$ ($0.36 \times 250$) drives the fatigue ratio $PTP / \text{capacity} = 1.28 > 1.0$.
  - Uncorrected dyssynchrony causes fatigue to climb from $0.48$ to $> 0.52$, exhausting the patient by $\sim 11.9$ minutes (`outcome: "deteriorated"`).

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation (with $\text{CO}_2$ solubility factor $\alpha = 0.0301\text{ mmol/L/mmHg}$):
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0301 \times \text{PaCO}_2}\right)$$

- Initial $\text{PaCO}_2 = 40.0\text{ mmHg}$.
- Initial $[\text{HCO}_3^-] = 24.0\text{ mmol/L}$.
- Denominator: $0.0301 \times 40.0 = 1.204\text{ mmol/L}$.
- Ratio: $24.0 / 1.204 = 19.9335$.
- $\log_{10}(19.9335) = 1.2996 \approx 1.30$.
- Expected starting $\text{pH} = 6.1 + 1.2996 = 7.3996 \approx 7.40$ (eucapnic, balanced acid-base baseline).

### Sedation Induced Hypoventilation Gas Arithmetic
When the learner falls into the Sedation Trap and orders sedation:
- Spontaneous rate drops from 26 to 2 bpm, leaving only the machine backup rate ($RR_{\text{set}} = 14\text{ bpm}$, $V_T = 360\text{ mL}$).
- Monitored minute ventilation drops to $14 \times 0.360 = 5.04\text{ L/min}$.
- Given anatomic dead space ($V_{D,\text{anat}} = 140\text{ mL}$) and alveolar dead space fraction ($0.30$):
  $$V_{T,\text{alv}} = (360 - 140) \times (1 - 0.30) = 220 \times 0.70 = 154\text{ mL} = 0.154\text{ L}$$
  $$\dot{V}_A = 14 \times 0.154 = 2.156\text{ L/min}$$
- With metabolic $V_{\text{CO}_2} = 230\text{ mL/min}$:
  $$\text{PaCO}_2 \approx \frac{0.863 \times 230}{2.156} \approx 92\text{ mmHg}$$
- As PaCO2 rapidly rises past 65 mmHg within 9–10 minutes, acute buffering ($+1\text{ mmol/L } [\text{HCO}_3^-]$ per $10\text{ mmHg } \Delta\text{PaCO}_2$) produces $[\text{HCO}_3^-] \approx 26.5\text{ mmol/L}$.
- Ratio: $26.5 / (0.0301 \times 65.5) = 26.5 / 1.9715 = 13.44$.
- $\log_{10}(13.44) = 1.128 \implies \text{pH} = 6.1 + 1.128 = 7.228 \approx 7.23 \le 7.28$.
- The patient develops severe respiratory acidemia and cardiovascular depression, ending the case at minute 10 (`outcome: "deteriorated"`).

## 4. The Trap
When an intubated patient exhibits tachypnoea, diaphoresis, and frequent high airway pressure alarms, bedside clinical staff frequently assume the patient is "fighting the ventilator" due to anxiety or insufficient analgesia/sedation. The immediate temptation is to administer a sedative bolus (e.g. propofol or midazolam) to suppress the patient's respiratory drive.

In reality, the patient's agitation is a physiological consequence of ventilator-patient dyssynchrony. The ventilator's inspiratory time (0.64 s) is far shorter than the patient's neural inspiratory demand (1.05 s). Delivering sedation suppresses recovering spontaneous drive, eliminates weaning potential, causes severe hypercapnic respiratory acidosis, and induces significant hypotension ($86/50\text{ mmHg}$).

The correct solution is entirely mechanical:
1. Switch the flow pattern from square to decelerating ramp, which extends ventilator inspiratory time ($T_{i,\text{vent}} \approx 0.85\text{--}0.95\text{ s}$), eliminating premature cycling and abolishing double triggering.
2. Ensure adequate peak inspiratory flow ($\ge 60\text{--}65\text{ L/min}$) to meet neural demand and avoid flow starvation.
3. Optimize tidal volume to $440\text{--}460\text{ mL}$ ($7.7\text{--}8.0\text{ mL/kg PBW}$), or transition to Pressure Support Ventilation (PSV) with appropriate cycle-off criteria.

## 5. Sources
- **Thille AW, Rodriguez P, Cabello B, et al.** Patient-ventilator asynchrony during assisted mechanical ventilation. *Intensive Care Med* 2006;32(10):1515-1522.
- **Beitler JR, Sands SA, Loring SH, et al.** Breath stacking increases the risk of higher tidal volumes and transpulmonary pressures in ARDS. *Crit Care Med* 2016;44(11):2071-2081.
- **Telias I, Brochard L, Goligher EC.** Dyssynchrony and patient-ventilator interaction. *Intensive Care Med* 2018;44(2):193-205.
- **de Haro C, Lopez-Aguilar J, Magrans R, et al.** Double cycling during mechanical ventilation: frequency, determinants, and outcome. *Intensive Care Med* 2018;44(11):1885-1895.

## 6. Changes after engine testing
- **Inspiratory flow calibrated to 34 L/min (square)**: At $40\text{ L/min}$, square flow delivered 360 mL in $0.54\text{ s}$; lowering flow to $34\text{ L/min}$ sets $T_{i,\text{vent}} = 0.635\text{ s}$. Patient demand is $41.14\text{ L/min}$, which maintains assist unloading at $0.85$ (preventing excessive unloading that would blunt effort) while ensuring the neural-to-ventilator inspiratory ratio ($1.05 / 0.635 = 1.65 > 1.4$) is maintained so double triggering occurs consistently on almost every spontaneous effort.
- **Muscle effort and reserve calibrated ($P_{\text{mus}} = 16\text{ cmH}_2\text{O}$, `respiratoryReserve: 0.36`)**: Uncorrected dyssynchrony produces high pressure-time product that exceeds diaphragmatic capacity ($PTP / \text{capacity} = 1.28$), driving fatigue from 0.48 to $> 0.52$ within 10 minutes. When settings are corrected with decelerating flow ($65\text{ L/min}$) and $V_T = 460\text{ mL}$, full assist unloading ($0.50$) and restored alveolar ventilation reduce $PTP$ below diaphragmatic capacity ($PTP / \text{capacity} = 0.53$), allowing fatigue to steadily decline below $0.35$ by 45–50 minutes.
- **Removal of `not: { ordered: { order: "change-settings" } }` logic flaw**: The previous version included a check blocking deterioration if any `change-settings` order had been placed. This caused cases to hang indefinitely without resolution if a learner placed an ineffective setting change (e.g. altering FiO2 or backup rate without addressing flow or volume). Removing this condition allows `t-deteriorated-fatigue` to properly evaluate physiological state (fatigue $\ge 0.52$ for 120s with $\ge 25$ double triggers), cleanly deteriorating whenever dyssynchrony is uncorrected.
- **Prediction point variables updated (`["fatigue", "ppeak", "rrTotal"]`)**: The original direction prediction included `vte`, which barely changed between baseline (monitored average $431\text{ mL}$ due to stacked $637\text{ mL}$ exhalations) and post-correction ($461\text{ mL}$), remaining within `NOISE_BAND['vte']` ($30\text{ mL}$) and evaluating as `'same'`. Replacing `vte` with `rrTotal` provides an unequivocal physiological marker: resolving breath-stacking resolves occult breath doubling, dropping monitored rate from $36\text{--}42\text{ bpm}$ to $20\text{--}26\text{ bpm}$ (`down`), alongside falling `ppeak` (`down`) and falling `fatigue` (`down`), all correctly verified by the engine.
- **Expectation scenarios calibrated to active simulation timeline**:
  - *Scenario 1 (No changes)*: Verified double triggering ($\ge 10$ at min 5, $\ge 50$ at min 11), fatigue progression ($\ge 0.50$ at min 10), and outcome `deteriorated` at min 11.9.
  - *Scenario 2 (Correct settings adjustment)*: Decelerating flow with optimized $V_T$ eliminates double triggering ($\le 50$ at min 10), drops fatigue ($< 0.45$ at min 20, $\le 0.35$ at min 50), and achieves outcome `improved` with full rubric score (9/9).
  - *Scenario 3 (Sedation trap)*: Sedation blunts drive, causes severe hypoventilation (total $RR \le 18$ at min 6, $\text{pH} \le 7.28$ at min 9), and ends in `deteriorated` at min 10.0.

