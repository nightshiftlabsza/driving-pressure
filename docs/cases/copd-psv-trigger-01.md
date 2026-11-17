# Case Design Note: copd-psv-trigger-01

## 1. Learning Goal
Diagnose and manage patient-ventilator dyssynchrony during Pressure Support Ventilation (PSV) in COPD:
- Recognise ineffective triggering (missed efforts) where neural inspiratory efforts fail to trigger a mechanical breath.
- Understand how intrinsic PEEP (auto-PEEP) acts as an inspiratory threshold load.
- Distinguish true agitation from dyssynchrony-induced distress, avoiding inappropriate sedation that causes hypoventilation.
- Correct dyssynchrony mechanically: titrate extrinsic PEEP (to 70-80% of auto-PEEP) to offload the trigger threshold, and raise expiratory cycle sensitivity (`cyclePctPeakFlow` to 40%) to eliminate delayed cycling.

## 2. Parameter Reasoning
- **Compliance (55 mL/cmH2O)**: Preserved/elevated static compliance typical of emphysematous parenchymal destruction.
- **Inspiratory resistance (14 cmH2O/L/s)**, **Expiratory resistance (30 cmH2O/L/s)**, and **expFlowLimitationCmH2O (10.5 cmH2O)**: Chronic severe airflow obstruction and dynamic small airway collapse. The dynamic closing pressure of 10.5 cmH2O prevents exhalation below this threshold, generating an intrinsic auto-PEEP of 6.5 to 7.5 cmH2O at extrinsic PEEP 4 cmH2O.
- **Intrinsic drive & mechanics**: Spontaneous neural rate is 28 bpm with muscle effort $P_{mus} = 16\text{ cmH}_2\text{O}$ and `respiratoryReserve: 0.38`. With auto-PEEP creating an inspiratory threshold load, the patient must lower alveolar pressure by $(P_{alv} - PEEP)$ plus the flow trigger threshold before flow enters the lungs. Ineffective efforts occur during late exhalation, manifesting as a monitored rate of only 11-18 bpm despite neural tachypnoea, accumulating fatigue to > 0.60. Titrating extrinsic PEEP to 8 cmH2O counterbalances auto-PEEP, restores 1:1 triggering, normalises synchrony, and allows diaphragmatic rest (fatigue < 0.40).
- **Delayed cycling**: Set cycling threshold is 25% of peak flow. In obstructive lungs, flow decelerates slowly, meaning inspiratory flow delivery persists after neural inspiration has ended, promoting air trapping. Raising cycle sensitivity to 40% terminates inspiration earlier.
- **ppvResponse ("unhelpful", severity 0.35)**: Hemodynamics are relatively preserved at these moderate pressures, but hyperinflation increases dead space.
- **baselineHco3MmolL (29.3 mmol/L)** & **chronicPaco2MmHg (55 mmHg)**: Reflects chronic renal retention of bicarbonate defending a chronic setpoint pH ~7.355 (Brackett, Cohen, Schwartz 1965).

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation (with CO2 solubility factor $\alpha = 0.0301$):
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0301 \times \text{PaCO}_2}\right)$$

- Starting $\text{PaCO}_2 = 58\text{ mmHg}$.
- Baseline chronic $\text{HCO}_3^- = 29.3\text{ mmol/L}$. Acute buffering relative to chronic PaCO2 55: $+0.1 \times (58 - 55) = +0.3\text{ mmol/L} \implies 29.6\text{ mmol/L}$ (`initialPhys.hco3MmolL`).
- Denominator: $0.0301 \times 58 = 1.7458$
- Ratio: $29.6 / 1.7458 = 16.955$
- $\log_{10}(16.955) = 1.2293$
- Expected starting $\text{pH} = 6.1 + 1.2293 = 7.329 \approx 7.33$ (acute-on-chronic respiratory acidemia below the 7.355 setpoint).

## 4. The Trap
When the patient appears agitated, sweaty, and tachypnoeic, bedside staff often assume the patient is "fighting the ventilator" and request sedation. Administering sedatives blunts the patient's neural drive, reducing spontaneous tidal volume and causing hypoventilation and apnoea without correcting the underlying trigger threshold load. Similarly, increasing pressure support generates larger breaths, which worsens dynamic hyperinflation and exacerbates ineffective triggering. The solution is mechanical: raise extrinsic PEEP to 8 cmH2O to offset auto-PEEP and increase `cyclePctPeakFlow` to 40%.

## 5. Sources
- Thille AW, et al. Patient-ventilator asynchrony during assisted mechanical ventilation. *Intensive Care Med* 2006;32(10):1515-1522.
- Blanch L, et al. Measurement of air trapping, intrinsic positive end-expiratory pressure, and dynamic hyperinflation in mechanically ventilated patients. *Minerva Anestesiol* 2005;71(6):291-296.
- Chao DC, et al. Patient-ventilator trigger asynchrony in prolonged mechanical ventilation. *Chest* 1997;112(6):1592-1599.

## 6. Changes after engine testing
- **expFlowLimitationCmH2O increased to 10.5 cmH2O & expResistance to 30 cmH2O/L/s**: A closing pressure of 7 cmH2O yielded auto-PEEP of only ~1.4 cmH2O in the engine; elevating the dynamic closing pressure to 10.5 cmH2O reliably creates intrinsic auto-PEEP > 6 cmH2O (6.5-7.5 cmH2O) at extrinsic PEEP 4 cmH2O.
- **Patient effort and drive calibrated (Pmus 16 cmH2O, spontRate 30 bpm, reserve 0.44, chronicPaCO2 55)**: Uncorrected ineffective triggering creates heavy respiratory work that drives fatigue from 0.45 to > 0.60 at 30 min, while extrinsic PEEP (8 cmH2O) and high cycle sensitivity (40%) unloads the diaphragm and lowers fatigue below 0.40 by 35 min.
- **Sedation effect enlarged**: In PSV mode with no backup rate (rrSet 0), administering sedation markedly suppresses rate (spontRate 4 bpm, Pmus 2 cmH2O), producing severe hypoventilation that drives PaCO2 to ~75 mmHg and drops pH < 7.28 by 25 min.
- **Bronchodilator dynamics optimized**: Delay reduced from 5 to 2 min and ramp to 10 min, lowering Re to 18 cmH2O/L/s and closing pressure to 6 cmH2O, supporting sustained synchrony and recovery.
- **Clinical expectations restored**: Maintained auto-PEEP > 6 cmH2O and fatigue > 0.60 as the true clinical benchmarks for uncorrected dyssynchrony.
- **Outcome tracking**: Added `outcome: "improved"` for PEEP/cycle optimization, `outcome: "deteriorated"` for untreated dyssynchrony, and `outcome: "deteriorated"` for inappropriate sedation.
- **Parameter tuning vs timeline note**: Parameters including spontaneous rate (30 bpm), respiratory reserve (0.44), expiratory closing pressure (10.5 cmH2O), and baseline HCO3 (29.3 mmol/L) were calibrated specifically to match the educational case timeline (manifesting severe fatigue and ineffective triggering within 30 minutes, and recovery within 35 minutes upon correct PEEP/cycle titration), rather than being purely derived from clinical patient narrative.
