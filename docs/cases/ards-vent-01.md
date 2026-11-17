# Case design note: ards-vent-01

## Learning goal
Convert an injurious ED setting into lung-protective ventilation: calculate predicted body weight, cut tidal volume to about 6 mL/kg, measure plateau and driving pressure with a hold, raise PEEP and rate, accept moderate hypercapnia, and prone for P/F below 150.

## Parameter reasoning
- Male, 170 cm, 98 kg: PBW 66 kg. The ED set 650 mL by eye ("big man"), which is 9.8 mL/kg PBW.
- Compliance 24 mL/cmH2O: severe ARDS baby lung. At 650 mL Pplat is 32 and driving pressure 27.
- Shunt 0.38, recruitability 0.5: P/F about 83 on PEEP 5 and FiO2 0.7; PEEP 12 brings it to about 125, prone (shunt 0.27) to about 175.
- Alveolar dead space 0.35, VCO2 260: at 400 mL the rate must reach about 30 to keep pH at 7.2 or more.
- Paralysed (no spontaneous effort) so hold measurements are valid.

## Engine behaviour (golden runs)
| Settings | Pplat | DP | pH | P/F |
| --- | --- | --- | --- | --- |
| 650 x 16, PEEP 5, FiO2 0.7 (arrival) | 32 | 27 | 7.29 | 83 |
| 400 x 16, PEEP 5 | 22 | 17 | 7.07 | 101 |
| 400 x 28, PEEP 12 | 29 | 17 | 7.25 | 126 |
| 400 x 30, PEEP 12, then prone | 29 | 17 | 7.27 | 174 |
| 400 x 30, PEEP 16 | 33 | 17 | | higher |

## The trap
Setting tidal volume by actual weight, and cutting VT without raising the rate.

## Limitations
Single compartment: PEEP does not change compliance, so driving pressure only falls by lowering VT (about 360 mL for DP 15). Real recruitment and overdistension are not modelled, and VILI exposure is counted for the debrief but does not worsen the lungs. The rubric item `r-dp` allows meeting either driving pressure ≤ 15 cmH2O or tidal volume ≤ 6.5 mL/kg PBW, because with fixed compliance of 24 mL/cmH2O, standard 6 mL/kg PBW ventilation (400 mL) yields a driving pressure of ~17 cmH2O. To be revisited in Phase 6.
