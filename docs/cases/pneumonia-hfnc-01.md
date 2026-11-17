# Case design note: pneumonia-hfnc-01

## Learning goal
Start high-flow nasal oxygen for hypoxaemic respiratory failure from pneumonia, reassess it properly (RR, SpO2/FiO2, ROX, gas), recognise failure, and intubate in a controlled way before exhaustion. Then set a tidal volume by predicted body weight.

## Parameter reasoning
- Shunt 0.24 rising to 0.32 between 30 and 150 min (course ramp): consolidation that is still evolving despite antibiotics. Recruitability 0.4: partly recruitable with PEEP once intubated.
- Compliance 40, resistance 6/7: stiff but not obstructed lungs.
- Spontaneous rate 32, Pmus 11, baseline HCO3 21.8 mmol/L, reserve 0.5: high drive with limited reserve, so fatigue builds over 2 to 3 hours on HFNC and about 1 hour on the mask. Under CO2 solubility alpha = 0.0301, this ensures non-rebreather dilution (effective FiO2 ~0.60 at high minute ventilation) drives progressive fatigue and hypercapnic acidemia (pH < 7.25 by 60 min).
- Intubation effect: drive lowered (rate 14, Pmus 3) to represent sedation. The default ventilator setting (450 mL) is 8.2 mL/kg PBW for her (PBW 55 kg), which the learner must correct.
- Parameter tuning vs timeline note: Spontaneous rate (32 bpm), respiratory reserve (0.50), baseline HCO3 (21.8 mmol/L), and shunt progression (0.24 to 0.32 over 120 min) were calibrated specifically to enforce the scenario timeline (fatigue and failure within 1 hour on non-rebreather, 2-3 hours on HFNC alone, and stabilising within 20 minutes when lung-protective ventilation is established), rather than being strictly derived from clinical patient narrative.

## Engine behaviour (golden runs)
| Path | Behaviour |
| --- | --- |
| Left on non-rebreather | pH about 7.18 at 60 min, ends "deteriorated" around 70 to 80 min |
| HFNC 50 L/min, FiO2 0.7 | SpO2 93 early, ROX about 3.9 at 30 min, 3.1 at 2 h with RR 40; ends "deteriorated" around 3 h |
| HFNC 60/0.8, intubate at ~2 h, VT 330, PEEP 10, RR 26 | P/F rises from about 90 to 120, pH about 7.3; ends "improved" |
| Intubated on default 450 mL | "high-vt" mistake fires after 20 min |

## The trap
Turning FiO2 up to keep SpO2 acceptable while RR keeps climbing. SpO2 looks reassuring; ROX and RR do not.

## Limitations
HFNC benefit in the engine is FiO2 reliability, a small PEEP (0.05 cmH2O per L/min) and dead-space washout. Comfort and the effect of humidification on secretions are not modelled. The ROX index is not shown on screen; the learner calculates it.
