# Case Design Note: apo-cpap-01

## 1. Learning Goal
Master non-invasive ventilatory management of acute cardiogenic pulmonary oedema (ACPO):
- Recognize that ACPO is the definitive condition where positive pressure ventilation is cardioprotective and clinically "helpful" (`ppvResponse: "helpful"`).
- Understand the dual cardiopulmonary mechanism: alveolar recruitment shrinks right-to-left intrapulmonary shunt, while positive intrathoracic pressure lowers left ventricular transmural pressure (reducing LV afterload) and eases excessive venous return (reducing preload).
- Initiate and titrate CPAP (8-10 cmH2O) with medical afterload/preload reducers to avoid invasive mechanical ventilation.

## 2. Parameter Reasoning
- **Compliance (35 mL/cmH2O)**: Severely reduced compliance due to alveolar fluid flooding, dilution of surfactant, and interstitial engorgement.
- **Airway resistance (Insp 10, Exp 12 cmH2O/L/s)**: Mildly elevated secondary to peribronchial cuffing and reflex bronchoconstriction ("cardiac asthma").
- **Shunt fraction (0.32) and Recruitability (0.50)**: Flooded alveoli create a large intrapulmonary shunt ($V/Q = 0$). Unlike pneumonia with cellular consolidation, transudative alveolar fluid can be rapidly displaced into the interstitium by continuous positive airway pressure, rendering the shunt highly recruitable.
- **Drive and fatigue**: Neural rate is 28 bpm with strong effort ($P_{mus} = 20\text{ cmH}_2\text{O}$). Without support, muscle fatigue (`respiratoryReserve: 0.75`, `fatigue: 0.25`) steadily accumulates toward respiratory arrest.
- **Anatomic dead space (110 mL)**: For a 74-year-old female (PBW 52.4 kg), normal conducting airway dead space is ~110 mL ($2.2\text{ mL/kg}$).
- **ppvResponse ("helpful", severity 0.85)**: In acute left ventricular failure with high systemic vascular resistance and elevated filling pressures, positive intrathoracic pressure reduces LV afterload by lowering LV transmural systolic pressure ($P_{transmural} = P_{LV} - P_{pleural}$). It also attenuates excessive preload, decreasing pulmonary venous congestion.
- **Circulation**: Marked hypertension (198/108 mmHg) and tachycardia (124 bpm) driven by an intense compensatory adrenergic crisis. Loop diuretics lower baseline systemic pressure toward 150/85 mmHg and decongest the lungs, allowing compliance to improve and work of breathing to settle.

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation:
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0307 \times \text{PaCO}_2}\right)$$

- Starting $\text{PaCO}_2 = 36\text{ mmHg}$, $\text{PaO}_2 = 52\text{ mmHg}$ on face mask.
- Baseline standard $\text{HCO}_3^- = 22.0\text{ mmol/L}$ (`initialPhys.hco3MmolL`).
- Denominator: $0.0307 \times 36 = 1.1052$
- Ratio: $22.0 / 1.1052 = 19.9059$
- $\log_{10}(19.9059) = 1.2990$
- Expected starting $\text{pH} = 6.1 + 1.2990 = 7.399 \approx 7.40$ (normal acid-base balance with severe shunt-induced hypoxaemia).

## 4. The Trap
Two clinical errors are common: (1) delaying non-invasive positive pressure by persisting with simple low-flow masks while the patient exhausts their respiratory reserve; or (2) rushing into invasive endotracheal intubation. CPAP (8-10 cmH2O) coupled with intravenous loop diuretics and afterload reduction rapidly reverses alveolar flooding and cardiac strain, averting intubation in > 85% of cases.

## 5. Sources
- Masip J, et al. Noninvasive ventilation in acute cardiogenic pulmonary edema: systematic review and meta-analysis. *JAMA* 2005;294(24):3124-3130.
- Gray A, et al. Noninvasive ventilation in acute cardiogenic pulmonary edema. *N Engl J Med* 2008;359(2):142-151.
- Ponikowski P, et al. 2016 ESC Guidelines for the diagnosis and treatment of acute and chronic heart failure. *Eur Heart J* 2016;37(27):2129-2200.

## 6. Changes after engine testing
- **Outcome tracking**: Added `outcome: "improved"` for CPAP titration + diuretic, `outcome: "deteriorated"` for untreated pulmonary oedema, and `outcome: "escalated"` for premature invasive intubation.
- **Oxygenation response verified**: With recruitability 0.50, CPAP 10 cmH2O recruits transudative alveolar shunt within minutes, reliably lifting SpO2 to ≥ 92% by 20 min and settling tachypnoea and hypertensive stress without intubation.
- **Diuretic rate calibration**: Adjusted post-diuretic spontaneous rate target to 16 bpm (with 15 min ramp) so chemoreflex-adjusted respiratory rate drops below 25 bpm (~19-20 bpm), aligning with the nursing observation and meeting `r-reassess-work-of-breathing`.
- **Premature intubation expressed as outcome**: Replaced metric checks with `outcome: "escalated"` per the runtime contract for early intubation in ACPO.
