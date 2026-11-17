# Physiology Lab Experiments 01 to 06: Verification & Literature Comparison

This document records the empirical verification of Experiments 01 to 06 running against the deterministic physiology engine (`src/engine/index.ts`). Every experiment conforms strictly to `LabExperimentSchema` (`src/lab/schema.ts`).

---

## 1. Summary of Experiments 01 to 06

| ID | Title | Variable Changed | Predicted Metrics | Baseline | After | Noise Band | Engine Marked | Literature Expectation | Status / Flags |
|---|---|---|---|---|---|---|---|---|---|
| **01** | **RC Time Constant and Exhalation** | `expResistanceCmH2OPerLps`: 10 -> 40 cmH2O/(L/s) | `autoPeep`<br>`endExpFlow`<br>`ppeak` | 0.04 cmH2O<br>0.004 L/s<br>19.0 cmH2O | 3.37 cmH2O<br>0.085 L/s<br>22.4 cmH2O | 1.0 cmH2O<br>0.05 L/s<br>2.0 cmH2O | **UP**<br>**UP**<br>**UP** | **UP** (Tobin 2012)<br>**UP** (Blanch 2005)<br>**UP** (West 2021) | **Agreement** (No flags) |
| **02** | **VC vs PC when Compliance Falls** | `complianceMlPerCmH2O`: 50 -> 25 mL/cmH2O | `ppeak`<br>`pplat`<br>`vte` | 23.0 cmH2O<br>15.0 cmH2O<br>500 mL | 33.0 cmH2O<br>25.0 cmH2O<br>500 mL | 2.0 cmH2O<br>1.0 cmH2O<br>30 mL | **UP**<br>**UP**<br>**SAME** | **UP** (Chatburn 2021)<br>**UP** (Amato 2015)<br>**SAME** (Chatburn 2021) | **Agreement** (No flags) |
| **03** | **PEEP vs Pplat at Fixed VT** | `peep`: 5 -> 12 cmH2O | `pplat`<br>`ppeak`<br>`drivingPressure` | 20.0 cmH2O<br>28.0 cmH2O<br>15.0 cmH2O | 27.0 cmH2O<br>35.0 cmH2O<br>15.0 cmH2O | 1.0 cmH2O<br>2.0 cmH2O<br>1.0 cmH2O | **UP**<br>**UP**<br>**SAME** | **UP** (Bellani 2016)<br>**UP** (West 2021)<br>**SAME** (Bellani 2016) | **Agreement** (No flags) |
| **04** | **RR vs Auto-PEEP in Obstruction** | `rrSetBpm`: 12 -> 24 bpm | `autoPeep`<br>`pplat`<br>`endExpFlow` | 1.05 cmH2O<br>14.05 cmH2O<br>0.030 L/s | 4.93 cmH2O<br>17.93 cmH2O<br>0.141 L/s | 1.0 cmH2O<br>1.0 cmH2O<br>0.05 L/s | **UP**<br>**UP**<br>**UP** | **UP** (Laghi 2012)<br>**UP** (Tuxen 1989)<br>**UP** (Blanch 2005) | **Agreement** (No flags) |
| **05** | **Inspiratory Flow Rate vs Auto-PEEP** | `inspFlowLpm`: 30 -> 75 L/min | `autoPeep`<br>`ppeak`<br>`pplat` | 3.85 cmH2O<br>25.4 cmH2O<br>17.94 cmH2O | 2.53 cmH2O<br>35.4 cmH2O<br>16.62 cmH2O | 1.0 cmH2O<br>2.0 cmH2O<br>1.0 cmH2O | **DOWN**<br>**UP**<br>**DOWN** | **DOWN** (Marini 2011)<br>**UP** (West 2021)<br>**DOWN** (Tobin 2001) | **Agreement** (No flags) |
| **06** | **Dead Space vs PaCO2 & EtCO2 Gap** | `alveolarDeadSpaceFraction`: 0.10 -> 0.45 | `paco2`<br>`etco2`<br>`ph` | 39.89 mmHg<br>36.0 mmHg<br>7.400 | 53.68 mmHg<br>30.0 mmHg<br>7.296 | 3.0 mmHg<br>3.0 mmHg<br>0.02 | **UP**<br>**DOWN**<br>**DOWN** | **UP** (Nuckton 2002)<br>**DOWN** (Verscheure 2016)<br>**DOWN** (West 2021) | **Agreement** (No flags) |

---

## 2. Detailed Verification by Experiment

### Experiment 01: RC Time Constant and Exhalation
- **File**: `src/lab/experiments/01-rc-time-constant-exhalation.json`
- **Competencies**: `mech.time-constants`, `wave.incomplete-exhalation`
- **Setup**: Deeply sedated patient on VC-AC (VT 500 mL, RR 16 bpm, Ti 1.0 s, PEEP 5 cmH2O). Baseline $R_{exp} = 10\text{ cmH}_2\text{O/(L/s)}$, $C_{rs} = 50\text{ mL/cmH}_2\text{O}$ ($\tau = 0.50\text{ s}$, available $T_e = 2.75\text{ s} > 5\tau$).
- **Intervention**: Expiratory airway resistance increased to $40\text{ cmH}_2\text{O/(L/s)}$ ($\tau = 2.0\text{ s}$, requiring $6\text{--}10\text{ s}$ to empty; available $T_e = 2.75\text{ s} = 1.38\tau$).
- **Causal Chain Trace Progression**:
  1. `expResistance`: $10 \rightarrow 40\text{ cmH}_2\text{O/(L/s)}$
  2. `timeConstant`: $0.50\text{ s} \rightarrow 2.00\text{ s}$
  3. `endExpFlow`: $0.004\text{ L/s} \rightarrow 0.085\text{ L/s}$
  4. `trappedVolume`: $2.0\text{ mL} \rightarrow 168.6\text{ mL}$
  5. `autoPeep`: $0.04\text{ cmH}_2\text{O} \rightarrow 3.37\text{ cmH}_2\text{O}$
- **Literature Reference**: Tobin MJ. *Principles and Practice of Mechanical Ventilation*, 3rd ed., 2012; Blanch L, et al. *Minerva Anestesiol.* 2005;71(6):245-257.
- **Engine Agreement**: Full agreement. The engine's single-compartment model accurately captures incomplete passive emptying with non-zero end-expiratory flow and trapped gas generating intrinsic PEEP.

---

### Experiment 02: VC versus PC when Compliance Falls
- **File**: `src/lab/experiments/02-vc-vs-pc-compliance.json`
- **Competencies**: `modes.vc-vs-pc`, `mech.res-vs-comp`
- **Setup**: Passive patient on VC-AC (VT 500 mL, RR 15 bpm, PEEP 5 cmH2O, Flow 60 L/min square). Baseline $C_{rs} = 50\text{ mL/cmH}_2\text{O}$.
- **Intervention**: Compliance drops to $25\text{ mL/cmH}_2\text{O}$ (e.g. pneumothorax, pulmonary edema, chest wall splinting).
- **Causal Chain Trace Progression**:
  1. `compliance`: $50 \rightarrow 25\text{ mL/cmH}_2\text{O}$
  2. `drivingPressure`: $10.0 \rightarrow 20.0\text{ cmH}_2\text{O}$ ($\Delta P = V_T / C_{rs}$)
  3. `pplat`: $15.0 \rightarrow 25.0\text{ cmH}_2\text{O}$ ($P_{plat} = PEEP + \Delta P$)
  4. `ppeak`: $23.0 \rightarrow 33.0\text{ cmH}_2\text{O}$
  5. `vte`: $500 \rightarrow 500\text{ mL}$ (guaranteed by VC mode)
- **Literature Reference**: Chatburn RL, Volsko TA. In: *Respiratory Care: Principles and Practice*, 4th ed., 2021; Amato MB, et al. *N Engl J Med.* 2015;372(8):747-755.
- **Engine Agreement**: Full agreement. Volume is preserved while elastic pressures double.

---

### Experiment 03: PEEP versus Pplat at a Fixed Tidal Volume
- **File**: `src/lab/experiments/03-peep-vs-pplat.json`
- **Competencies**: `mech.driving-pressure`, `mech.eom`
- **Setup**: Moderate ARDS patient with non-recruitable stiff lungs ($C_{rs} = 30\text{ mL/cmH}_2\text{O}$) on VC-AC ($V_T = 450\text{ mL}$, RR 15 bpm, baseline PEEP 5 cmH2O).
- **Intervention**: PEEP increased from $5\text{ cmH}_2\text{O}$ to $12\text{ cmH}_2\text{O}$.
- **Causal Chain Trace Progression**:
  1. `setPeep`: $5 \rightarrow 12\text{ cmH}_2\text{O}$
  2. `pplat`: $20.0 \rightarrow 27.0\text{ cmH}_2\text{O}$ ($+7\text{ cmH}_2\text{O}$)
  3. `ppeak`: $28.0 \rightarrow 35.0\text{ cmH}_2\text{O}$ ($+7\text{ cmH}_2\text{O}$)
  4. `drivingPressure`: $15.0 \rightarrow 15.0\text{ cmH}_2\text{O}$ ($\Delta P = P_{plat} - PEEP = 450 / 30 = 15\text{ cmH}_2\text{O}$)
- **Literature Reference**: Bellani G, et al. *Intensive Care Med.* 2016;42(10):1647-1650; West JB, Luks AM. *West's Respiratory Physiology*, 11th ed., 2021.
- **Engine Agreement**: Full agreement. Demonstrates the equation of motion and verifies that driving pressure reflects distending elastic recoil independent of set baseline PEEP.

---

### Experiment 04: Respiratory Rate versus Auto-PEEP in Airflow Obstruction
- **File**: `src/lab/experiments/04-rr-vs-auto-peep.json`
- **Competencies**: `mech.auto-peep`, `disease.obstructive`
- **Setup**: Severe obstructive lung disease ($R_{exp} = 35\text{ cmH}_2\text{O/(L/s)}$, $C_{rs} = 60\text{ mL/cmH}_2\text{O}$, $\tau = 2.10\text{ s}$) on VC-AC ($V_T = 480\text{ mL}$, baseline RR 12 bpm, $T_e = 4.52\text{ s}$).
- **Intervention**: Mandatory rate increased to 24 bpm, cutting total cycle time to 2.5 s and expiratory time to $T_e = 2.02\text{ s} < 1\tau$.
- **Causal Chain Trace Progression**:
  1. `setRr`: $12 \rightarrow 24\text{ bpm}$
  2. `teSec`: $4.52 \rightarrow 2.02\text{ s}$
  3. `endExpFlow`: $0.030 \rightarrow 0.141\text{ L/s}$
  4. `trappedVolume`: $63.1 \rightarrow 295.8\text{ mL}$
  5. `autoPeep`: $1.05 \rightarrow 4.93\text{ cmH}_2\text{O}$ ($+3.88\text{ cmH}_2\text{O}$)
  6. `pplat`: $14.05 \rightarrow 17.93\text{ cmH}_2\text{O}$ ($+3.88\text{ cmH}_2\text{O}$)
- **Literature Reference**: Laghi F, Goyal A. *Minerva Anestesiol.* 2012;78(2):201-215; Tuxen DV. *Am Rev Respir Dis.* 1989;140(1):5-9.
- **Engine Agreement**: Full agreement. Confirms why tachypnea worsens breath-stacking in obstructive pulmonary mechanics.

---

### Experiment 05: Inspiratory Flow Rate versus Auto-PEEP
- **File**: `src/lab/experiments/05-insp-flow-vs-auto-peep.json`
- **Competencies**: `modes.ie-flow-ti`, `mech.auto-peep`
- **Setup**: Obstructed patient ($R_{exp} = 35\text{ cmH}_2\text{O/(L/s)}$, $R_{insp} = 15\text{ cmH}_2\text{O/(L/s)}$, $C_{rs} = 55\text{ mL/cmH}_2\text{O}$) on VC-AC ($V_T = 500\text{ mL}$, RR 18 bpm). Baseline square flow rate is low at $30\text{ L/min}$ ($0.5\text{ L/s}$), taking $T_i = 1.0\text{ s}$ and leaving only $T_e = 2.34\text{ s}$.
- **Intervention**: Inspiratory flow rate increased to $75\text{ L/min}$ ($1.25\text{ L/s}$), shortening $T_i$ to $0.40\text{ s}$ and expanding $T_e$ to $2.93\text{ s}$.
- **Causal Chain Trace Progression**:
  1. `setInspFlow`: $30 \rightarrow 75\text{ L/min}$
  2. `tiSec`: $1.00 \rightarrow 0.40\text{ s}$
  3. `teSec`: $2.34 \rightarrow 2.93\text{ s}$ ($+0.59\text{ s}$ extra emptying time)
  4. `trappedVolume`: $211.5 \rightarrow 139.1\text{ mL}$ ($-72.4\text{ mL}$)
  5. `autoPeep`: $3.85 \rightarrow 2.53\text{ cmH}_2\text{O}$ ($-1.32\text{ cmH}_2\text{O}$)
  6. `pplat`: $17.94 \rightarrow 16.62\text{ cmH}_2\text{O}$ ($-1.32\text{ cmH}_2\text{O}$)
  7. `ppeak`: $25.4 \rightarrow 35.4\text{ cmH}_2\text{O}$ ($+10.0\text{ cmH}_2\text{O}$ resistive component)
- **Literature Reference**: Marini JJ. *Am J Respir Crit Care Med.* 2011;184(7):756-762; Tobin MJ. *N Engl J Med.* 2001;344(26):1986-1996.
- **Engine Agreement**: Full agreement. Shows the classic ICU trade-off: higher inspiratory flow reduces dynamic hyperinflation and intrinsic PEEP by lengthening expiratory time, even though peak airway pressure increases due to resistive pressure drop ($Flow \times R_{insp}$).

---

### Experiment 06: Dead Space versus PaCO2 and the PaCO2 - EtCO2 Gap
- **File**: `src/lab/experiments/06-dead-space-vs-paco2.json`
- **Competencies**: `gas.dead-space`, `gas.alveolar-ventilation`
- **Setup**: Ventilated postoperative patient on VC-AC ($V_T = 450\text{ mL}$, RR 14 bpm, PEEP 5 cmH2O). Baseline alveolar dead space fraction is normal ($0.10$).
- **Intervention**: Alveolar dead space fraction increased to $0.45$ (simulating acute pulmonary embolism or microvascular hypoperfusion).
- **Causal Chain Trace Progression**:
  1. `deadSpaceFraction`: $0.10 \rightarrow 0.45$
  2. `alveolarVentilation`: $4.03 \rightarrow 2.46\text{ L/min}$
  3. `steadyPaco2Target`: $39.1 \rightarrow 55.3\text{ mmHg}$
  4. `paco2`: $39.9 \rightarrow 53.7\text{ mmHg}$ ($+13.8\text{ mmHg}$)
  5. `ph`: $7.400 \rightarrow 7.296$ ($-0.104$, acute respiratory acidosis)
  6. `etco2`: $36.0 \rightarrow 30.0\text{ mmHg}$ ($-6.0\text{ mmHg}$, widening $PaCO_2 - EtCO_2$ gap from $3.9$ to $23.7\text{ mmHg}$)
- **Literature Reference**: Nuckton TJ, et al. *N Engl J Med.* 2002;346(17):1281-1286; Verscheure S, et al. *Curr Opin Crit Care.* 2016;22(3):216-221.
- **Engine Agreement**: Full agreement. Alveolar dead space impairs CO2 clearance (arterial PaCO2 rises) while unperfused ventilated units dilute exhaled gas with CO2-free air (end-tidal EtCO2 drops), markedly widening the gradient.

---

## 3. Determinism Verification

Each of the 6 experiments was executed 3 times from clean initial state against the engine:
- All baseline and post-intervention metric snapshots match identically across runs.
- All direction predictions ('up', 'down', 'same') match identically across runs.
- Determinism check: **PASSED (100% deterministic across 3/3 runs)**.
