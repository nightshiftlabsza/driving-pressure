# Case Design Note: sbt-pass-01

## 1. Learning Goal
Evaluate readiness for liberation and safely execute endotracheal extubation following a successful Spontaneous Breathing Trial (SBT):
- Recognize clinical and physiological criteria defining a passed SBT on low pressure support (PS 5 cmH2O, PEEP 5 cmH2O).
- Measure and interpret the Rapid Shallow Breathing Index (RSBI = f / VT): understand that an RSBI < 105 bpm/L (and particularly 35-55 bpm/L) indicates adequate respiratory muscle strength and endurance.
- Confirm adequate gas exchange, stable hemodynamics, and absence of excessive diaphragmatic fatigue during the trial.
- Perform timely extubation once SBT criteria are met, avoiding unnecessary delays that prolong intubation risk.
- Avoid inappropriate sedation during spontaneous breathing trials that blunts central respiratory drive.

## 2. Parameter Reasoning
- **Compliance (48 mL/cmH2O)**: Markedly improved respiratory system compliance following resolution of acute bacterial pneumonia (consolidations resolved with residual resolving interstitial changes).
- **Airway resistance (Insp 7, Exp 8 cmH2O/L/s)**: Low resistance in an adult female without underlying reactive airway disease or chronic obstructive pulmonary disease.
- **Respiratory drive and muscle reserve (`spontRateBpm: 18`, `pmusAmplitudeCmH2O: 8 cmH2O`, `respiratoryReserve: 0.60`)**: Strong respiratory reserve and low baseline fatigue (`initialPhys.fatigue: 0.12`). On PS 5 / PEEP 5, pressure augmentation of 5 cmH2O combined with a modest muscle effort ($P_{mus} \approx 6.5\text{ cmH}_2\text{O}$) generates driving pressure $\approx 10-11\text{ cmH}_2\text{O}$, producing consistent tidal volumes of 420-480 mL ($7.4-8.4\text{ mL/kg}$ PBW).
- **RSBI stability**: With spontaneous breathing rate 18 bpm and tidal volume 0.45 L, the Rapid Shallow Breathing Index is:
  $$\text{RSBI} = \frac{18\text{ bpm}}{0.45\text{ L}} = 40.0\text{ bpm/L}$$
  This remains well below the critical 105 bpm/L threshold (typically between 38 and 46 bpm/L throughout the trial).
- **Fatigue dynamics**: With high reserve (`0.60`), capacity is $0.60 \times 250 = 150$. Pressure-time product is $PTP = 6.5 \times 18 \times 0.8 \times 0.5 = 46.8$. Ratio is $46.8 / 150 = 0.312 < 1.0$. Because the ratio is well below 1.0, the diaphragm does not fatigue; fatigue stays low ($< 0.20$), and work of breathing is easily tolerated.
- **Gas exchange (`shuntFraction: 0.08`, `recruitability: 0.10`, `vco2MlPerMin: 190`)**: Minimal residual intrapulmonary shunt yields a PaO2 of ~88 mmHg on FiO2 0.30 and PEEP 5 cmH2O ($P/F \text{ ratio} \approx 293$). Alveolar ventilation of $\approx 5.3\text{ L/min}$ matches metabolic CO2 production, maintaining PaCO2 at 39-41 mmHg and arterial pH at 7.39-7.41.

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation (with CO2 solubility $\alpha = 0.0301$):
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0301 \times \text{PaCO}_2}\right)$$

- Starting $\text{PaCO}_2 = 40.0\text{ mmHg}$.
- Baseline $\text{HCO}_3^- = 24.2\text{ mmol/L}$.
- Denominator: $0.0301 \times 40 = 1.204$
- Ratio: $24.2 / 1.204 = 20.10$
- $\log_{10}(20.10) = 1.303$
- Expected starting $\text{pH} = 6.1 + 1.303 = 7.403 \approx 7.40$ (eucapnic, normal acid-base balance).
- Alveolar gas equation ($P_B = 760\text{ mmHg}$, $P_{H2O} = 47\text{ mmHg}$, $R = 0.8$):
  $$P_A\text{O}_2 = 0.30 \times (760 - 47) - \frac{40}{0.8} = 213.9 - 50 = 163.9\text{ mmHg}$$
  With shunt 0.08 and normal cardiac output, PaO2 equilibrates near 88 mmHg.

## 4. The Trap
Two common errors arise in weaning cases:
1. **Delayed liberation / failure to extubate**: Bedside clinicians often hesitate to extubate a stable patient who has passed an SBT, requesting additional hours or days of low support "to be safe". Prolonging invasive ventilation unnecessarily exposes patients to ventilator-associated pneumonia (VAP), tracheal injury, and ICU delirium. Once a 30-minute SBT confirms physiological readiness and airway criteria are met, extubation should be executed without undue delay.
2. **Inappropriate sedation during SBT**: Administering sedatives or opioids during a trial to "treat anxiety" blunts central chemoreceptor sensitivity and respiratory drive. In a pressure-support mode with no backup rate, suppressing spontaneous efforts leads rapidly to hypoventilation, hypercapnic acidosis, and trial failure.

## 5. Sources
- Schmidt GA, Girard TD, Kress JP, et al. Official Executive Summary: Liberation From Mechanical Ventilation in Critically Ill Adults. *CHEST* 2017;151(1):160-165.
- Ouellette DR, Patel S, Girard TD, et al. Liberation From Mechanical Ventilation in Critically Ill Adults: An Official American College of Chest Physicians/American Thoracic Society Clinical Practice Guideline. *CHEST* 2017;151(1):166-180.
- Yang KL, Tobin MJ. A prospective study of indexes predicting the outcome of trials of weaning from mechanical ventilation. *N Engl J Med* 1991;324(21):1445-1450.
- Esteban A, Frutos F, Tobin MJ, et al. A comparison of four methods of weaning patients from mechanical ventilation. *N Engl J Med* 1995;332(6):345-350.

## 6. Changes after testing
- **Extubation trigger and outcome**: Tested successful extubation order effect; verified transition to `outcome: "improved"` with clear resolution messages.
- **Sedation suppression calibration**: Verified that administering sedation drops spontaneous rate to 2 bpm, raising PaCO2 past 50 mmHg and triggering `t-sedation-deterioration` (`outcome: "deteriorated"`).
- **Delayed weaning trigger**: Calibrated `t-delayed-weaning` at simMin 35 to prompt the learner when extubation is inappropriately delayed despite stable RSBI (< 50 bpm/L) and low fatigue.
