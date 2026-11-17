# Case Design Note: sbt-fail-01

## 1. Learning Goal
Recognize spontaneous breathing trial (SBT) failure, avoid premature extubation, and restore appropriate ventilatory assistance:
- Identify clinical and objective markers of SBT failure: rapid shallow breathing with RSBI > 105 bpm/L, tachypnoea (RR 34-38 bpm), low tidal volume (Vte 200-240 mL), diaphoresis, and accessory muscle use.
- Understand the pathophysiological basis of SBT failure: load-capacity imbalance between elevated respiratory load (stiff lung, high dead space) and reduced neuromuscular capacity (diaphragmatic weakness, low reserve).
- Avoid the critical error of premature extubation during an unpassed trial, which causes severe post-extubation distress and emergency reintubation.
- Promptly terminate the trial upon failure and restore resting ventilatory assist (e.g. PS >= 12-15 cmH2O or assist-control) to offload the diaphragm and reverse muscular fatigue.

## 2. Parameter Reasoning
- **Compliance (28 mL/cmH2O)**: Markedly impaired static compliance typical of incomplete resolution of ARDS / sepsis-induced acute lung injury with residual dependent consolidation and atelectasis.
- **Dead space fraction (`anatomicDeadSpaceMl: 150`, `alveolarDeadSpaceFraction: 0.30`)**: Elevated total dead space fraction (~0.50-0.55), demanding a high minute ventilation to clear CO2.
- **Neuromuscular weakness & reserve (`respiratoryReserve: 0.25`, `pmusAmplitudeCmH2O: 7.5 cmH2O`)**: ICU-acquired weakness following 6 days of critical illness and septic shock. Diaphragmatic capacity is reduced to $0.25 \times 250 = 62.5$.
- **Rapid shallow breathing progression**:
  - When placed on minimal support (PS 5 cmH2O, PEEP 5 cmH2O), the low total driving pressure ($5\text{ cmH}_2\text{O} \text{ assist} + \approx 6.5\text{ cmH}_2\text{O} P_{mus}$) can only deliver a tidal volume of:
    $$V_T \approx 28\text{ mL/cmH}_2\text{O} \times 8 \approx 220-240\text{ mL}$$
  - With anatomic dead space 150 mL, effective alveolar ventilation per breath is only $70-90\text{ mL} \times (1 - 0.30) \approx 50-60\text{ mL}$.
  - To prevent hypercapnia, central chemoreceptors increase neural drive (`drive` climbs to ~1.30-1.35), driving spontaneous rate up to 34-38 bpm.
  - The resulting RSBI is:
    $$\text{RSBI} = \frac{36\text{ bpm}}{0.22\text{ L}} = 163.6\text{ bpm/L}$$
    This far exceeds the Yang & Tobin cutoff of 105 bpm/L.
- **Fatigue accumulation**:
  - Pressure-time product: $PTP = 7.0 \times 36 \times 0.65 \times 0.5 \approx 81.9$.
  - Work ratio: $81.9 / 62.5 = 1.31 > 1.0$.
  - With ratio > 1.0, fatigue increases at rate $\Delta \text{fatigue} = ((1.31 - 1) / 1800) \times dt$. Over 10-15 minutes, fatigue climbs from baseline 0.32 to > 0.55, producing clinical exhaustion.
- **Recovery upon resuming support**:
  - Titrating pressure support to 15 cmH2O unloads the diaphragm (unloading factor $1 - 0.5 \times (15/20) = 0.625$).
  - Driving pressure increases to $\approx 16-18\text{ cmH}_2\text{O}$, expanding tidal volume to 420-460 mL.
  - Alveolar ventilation increases, PaCO2 normalizes, respiratory rate slows to 20-22 bpm, RSBI drops to ~45-55 bpm/L, and fatigue recovers.

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation:
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0301 \times \text{PaCO}_2}\right)$$

- Starting $\text{PaCO}_2 = 44.0\text{ mmHg}$.
- Baseline $\text{HCO}_3^- = 23.8\text{ mmol/L}$. Acute buffering for $\Delta \text{PaCO}_2 = +4\text{ mmHg}$: $+0.1 \times 4 = +0.4 \implies 24.2\text{ mmol/L}$.
- Denominator: $0.0301 \times 44 = 1.3244$
- Ratio: $24.0 / 1.3244 = 18.12$
- $\log_{10}(18.12) = 1.258$
- Expected starting $\text{pH} = 6.1 + 1.258 = 7.358 \approx 7.36$ (mild acute respiratory acidemia under load).
- Untreated course: As fatigue accumulates and tidal volume collapses below 220 mL, alveolar hypoventilation worsens, driving PaCO2 above 55 mmHg and pH below 7.28.

## 4. The Trap
1. **Premature extubation on a failing trial**: Anxious clinicians or inexperienced trainees sometimes treat the 30-minute timer as a tick-box exercise, extubating the patient because "the trial time is up" despite glaring signs of distress (tachypnoea, RSBI > 140, sweating, retractions). Extubation under these conditions removes the 5 cmH2O PEEP and pneumatic splint, triggering immediate upper airway collapse, exhaustion, and catastrophic reintubation.
2. **Leaving the patient to 'tough it out'**: Assuming tachypnoea is "just agitation" and failing to restore ventilatory assist leads to severe diaphragmatic exhaustion, acute hypercapnic respiratory arrest, and emergency crisis. The correct management is prompt recognition of failure, aborting the SBT, and restoring full ventilatory support to allow muscular rest.

## 5. Sources
- Schmidt GA, Girard TD, Kress JP, et al. Official Executive Summary: Liberation From Mechanical Ventilation in Critically Ill Adults. *CHEST* 2017;151(1):160-165.
- Yang KL, Tobin MJ. A prospective study of indexes predicting the outcome of trials of weaning from mechanical ventilation. *N Engl J Med* 1991;324(21):1445-1450.
- Esteban A, Frutos F, Tobin MJ, et al. A comparison of four methods of weaning patients from mechanical ventilation. *N Engl J Med* 1995;332(6):345-350.
- Ouellette DR, Patel S, Girard TD, et al. Liberation From Mechanical Ventilation in Critically Ill Adults: An Official American College of Chest Physicians/American Thoracic Society Clinical Practice Guideline. *CHEST* 2017;151(1):166-180.

## 6. Changes after testing
- **Patient parameters and fatigue calibration**: Set `complianceMlPerCmH2O: 28`, `respiratoryReserve: 0.25`, and starting `fatigue: 0.32`. This ensures that on PS 5 / PEEP 5, the patient reliably generates small tidal volumes (200-240 mL), tachypnoea (34-38 bpm), RSBI > 130 bpm/L, and fatigue climbing past 0.55 by 15-20 minutes.
- **Support restoration**: Increasing pressure support to 15 cmH2O expands tidal volume above 400 mL and decreases RSBI below 80 within minutes, allowing fatigue to stabilize and recover.
- **Extubation mistake tracking**: Verified that ordering `extubate` records mistake `unsafe_action` (severity `major`) under competency `safety.extubation` and ends the case with `outcome: "deteriorated"`.
