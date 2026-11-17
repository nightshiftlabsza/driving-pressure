# Case Design Note: dka-intubated-01

## 1. Learning Goal
Master ventilatory and hemodynamic management of the intubated patient with severe metabolic acidosis (Diabetic Ketoacidosis):
- Recognize that deep, rapid spontaneous breathing (Kussmaul respiration) is essential respiratory compensation to prevent lethal acidaemia.
- Apply Winter's formula to calculate the physiological target $\text{PaCO}_2$.
- Prevent post-intubation arrest by programming high minute ventilation (18 L/min or more, e.g. RR 32 bpm and protective tidal volume) to match metabolic demand.
- Manage severe hypovolaemia under positive pressure ventilation (`ppvResponse: "clean-kill"`).

## 2. Parameter Reasoning
- **Normal lung mechanics**: Compliance is 50 mL/cmH2O, and airway resistance is 4 cmH2O/L/s. The lungs are healthy; the disorder is purely systemic and metabolic.
- **$\text{VCO}_2$ (250 mL/min)**: Moderately elevated carbon dioxide production driven by metabolic stress, circulating catecholamines, and uninhibited lipolysis/ketogenesis (normal basal ~220 mL/min for 65 kg).
- **$\text{anatomicDeadSpaceMl}$ (130 mL)** and **$\text{alveolarDeadSpaceFraction}$ (0.05)**: With an endotracheal tube in place, upper airway dead space is bypassed, yielding ~130 mL anatomic dead space and negligible alveolar dead space in healthy lungs.
- **$\text{baselineHco3MmolL}$ (8.0 mmol/L)**: Severe metabolic ketoacidosis from beta-hydroxybutyrate and acetoacetate accumulation.
- **ppvResponse ("clean-kill", severity 0.85)**: Osmotic diuresis causes an acute 5 to 8 litre fluid deficit. In profound hypovolaemia, positive intrathoracic pressure sharply compresses the vena cava and halts venous return, precipitating profound hypotension and cardiac arrest unless rapid crystalloid resuscitation is delivered. Unloaded baseline blood pressure is normal (`sbpBaselineMmHg: 115`, `dbpBaselineMmHg: 72`). Under PPV and acidemic vasoplegia (pH < 7.1), displayed SBP drops to ~75-80 mmHg until fluid boluses restore intravascular volume.
- **Ventilator settings**: The ED team initiated "standard adult" settings (RR 12 bpm, VT 450 mL $\implies$ minute ventilation 5.4 L/min). Given an anatomical dead space of 130 mL, alveolar ventilation is only 3.6 L/min, allowing $\text{PaCO}_2$ to surge from its pre-intubation level of 18 mmHg up toward 35-50 mmHg.

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation:
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0307 \times \text{PaCO}_2}\right)$$

- Target $\text{PaCO}_2$ by Winter's formula: $1.5 \times [\text{HCO}_3^-] + 8 \pm 2 = 1.5 \times 8 + 8 = 20\text{ mmHg}$ (range 18-22 mmHg).
- At case start (10-15 minutes post-intubation on RR 12), $\text{PaCO}_2$ has risen to $35\text{ mmHg}$ with measured $[\text{HCO}_3^-] = 7.7\text{ mmol/L}$ (`initialPhys.hco3MmolL`).
- Denominator: $0.0307 \times 35 = 1.0745$
- Ratio: $7.7 / 1.0745 = 7.1661$
- $\log_{10}(7.1661) = 0.8553$
- Expected starting $\text{pH} = 6.1 + 0.8553 = 6.955 \approx 6.95$ (severe mixed metabolic and acute post-intubation respiratory acidaemia).
- With correct compensatory hyperventilation (RR 32 bpm, VT 580 mL), alveolar ventilation reaches > 10 L/min, $\text{PaCO}_2$ drops to 20-24 mmHg, and pH recovers to 7.07-7.14, preventing acidemic cardiac arrest.

## 4. The Trap
Clinicians routinely order "default" ventilator settings (rate 12-14, VT 450 mL) for newly intubated adults, unaware that this suddenly halts the patient's spontaneous compensatory hyperventilation. When $\text{PaCO}_2$ rises from 18 to 35+ mmHg with a fixed bicarbonate of 8, pH plummets from 7.18 down to < 6.85, triggering refractory vasoplegia, myocardial depression, wide-complex dysrhythmias, and PEA arrest. The correct management is to set high minute ventilation (RR 28-30 bpm, VT 500-520 mL) immediately and administer large-volume crystalloid boluses.

## 5. Sources
- Albert MS, Dell RB, Winters RW. Quantitative displacement of acid-base equilibrium in metabolic acidosis. *Ann Intern Med* 1967;66(2):312-322.
- Mosier JM, et al. The physiologically difficult airway in critical illness. *West J Emerg Med* 2015;16(7):1109-1117.
- Dhatariya KK, et al. Joint British Diabetes Societies for Inpatient Care guideline for the management of diabetic ketoacidosis. *Diabet Med* 2022;39(6):e14888.
- Adrogué HJ, Madias NE. Management of life-threatening acid-base disorders: First of two parts. *N Engl J Med* 1998;338(1):26-34.

## 6. Changes after engine testing
- **VCO2 adjusted to 250 mL/min**: Lowered from initial 340 mL/min to realistic ketoacidotic hypermetabolism for 65 kg; 340 mL/min prevented PaCO2 reduction below 35 mmHg despite RR 28 x VT 520.
- **Realistic acute target pH (≥ 7.05)**: With standard bicarbonate 8 mmol/L and non-renal buffering, reaching pH ≥ 7.20 in 25 min would mathematically require PaCO2 ~13 mmHg; raising pH from 6.95 toward 7.08 with PaCO2 20-24 mmHg safely arrests the lethal spiral.
- **Rubrics aligned with realistic targets**: Synchronized `r-target-paco2` (`paco2 <= 26`) and `r-reversal-of-acidaemia` (`ph >= 7.05`) with the clinical stabilization thresholds so learners completing correct management achieve full marks.
- **Early crystalloid resuscitation required**: High RR and intrathoracic pressure sharply curtail venous return under `clean-kill`; crystalloid bolus at 3 min is clinically essential and successfully prevents hemodynamic collapse.
- **Outcome tracking**: Added `outcome: "improved"` to the correct management scenario and `outcome: "deteriorated"` to scenarios where ventilation was uncorrected.
- **Citations corrected**: Updated Winters citation to Albert, Dell & Winters (1967) and Mosier et al. to West J Emerg Med (2015) in both evidence and debrief resources.
