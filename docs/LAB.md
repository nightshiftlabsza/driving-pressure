# Physiology Lab & Causal "Why" View (`src/lab`)

This document records the architecture, deterministic engine verification, baseline and post-intervention values, causal trace chains, and published physiology comparisons for all 13 guided experiments in the Physiology Lab.

---

## 1. Overview & Architecture

The Physiology Lab (`src/lab/`) teaches respiratory and cardiopulmonary mechanisms one variable at a time:
1. **Baseline & Predict**: The learner observes the baseline patient on the shared ventilator display (`<SharedVentDisplay />`), reads a neutral *"What to look at"* hint that never reveals the direction of change, selects a prediction (`up`, `down`, `same`) for 2–3 key metrics, and commits a confidence level (`guess`, `fairly_sure`, `certain`).
2. **Apply & Observe**: The variable change is applied to the deterministic engine (`src/engine/index.ts`). Waveforms, numerics, and a Before/After comparison table display the measured response and mark the prediction using `LAB_NOISE_BAND`.
3. **Reflect**: The learner answers a clinical reflection question connecting the observation to bedside practice. Both the prediction and reflection are recorded to the learner model (`activity: 'lab'`).
4. **Causal "Why" View (`src/lab/why/`)**: Strictly locked (`data-testid="lab-why-locked"`) until the prediction is committed. Once unlocked (`data-testid="lab-why-view"`), it renders a step-by-step visual causal chain built from `lastTrace(state)` (`EngineTrace` in `src/engine/trace.ts`) and state snapshots (`captureWhySnapshot`), using deterministic templates (`templates.ts`) and flagging rule-based approximations (`data-testid="lab-rule-based-badge"`).

---

## 2. Complete Summary Matrix (Experiments 01 to 13)

| # | Experiment ID | Title | Variable Changed | Predicted Metrics | Baseline Values | After Values | Engine Marked Key | Literature Consensus | Agreement / Flags |
|---|---|---|---|---|---|---|---|---|---|
| **01** | `01-rc-time-constant-exhalation` | RC Time Constant and Exhalation | `expResistanceCmH2OPerLps`: 10 -> 40 cmH2O/(L/s) | `autoPeep`, `endExpFlow`, `ppeak` | 0.04 cmH2O, 0.004 L/s, 19.0 cmH2O | 3.37 cmH2O, 0.085 L/s, 22.4 cmH2O | `up`, `up`, `up` | `up`, `up`, `up` (Tobin 2012; Blanch 2005) | **Agreement** (No flags) |
| **02** | `02-vc-vs-pc-compliance` | VC versus PC when Compliance Falls | `complianceMlPerCmH2O`: 50 -> 25 mL/cmH2O | `ppeak`, `pplat`, `vte` | 23.0 cmH2O, 15.0 cmH2O, 500 mL | 33.0 cmH2O, 25.0 cmH2O, 500 mL | `up`, `up`, `same` | `up`, `up`, `same` (Chatburn 2021; Amato 2015) | **Agreement** (No flags) |
| **03** | `03-peep-vs-pplat` | PEEP versus Pplat at a Fixed VT | `peep`: 5 -> 12 cmH2O | `pplat`, `ppeak`, `drivingPressure` | 20.0 cmH2O, 28.0 cmH2O, 15.0 cmH2O | 27.0 cmH2O, 35.0 cmH2O, 15.0 cmH2O | `up`, `up`, `same` | `up`, `up`, `same` (Bellani 2016; West 2021) | **Agreement** (No flags) |
| **04** | `04-rr-vs-auto-peep` | RR versus Auto-PEEP in Obstruction | `rrSetBpm`: 12 -> 24 bpm | `autoPeep`, `pplat`, `endExpFlow` | 1.05 cmH2O, 14.05 cmH2O, 0.030 L/s | 4.93 cmH2O, 17.93 cmH2O, 0.141 L/s | `up`, `up`, `up` | `up`, `up`, `up` (Laghi 2012; Tuxen 1989) | **Agreement** (No flags) |
| **05** | `05-insp-flow-vs-auto-peep` | Inspiratory Flow Rate versus Auto-PEEP | `inspFlowLpm`: 30 -> 75 L/min | `autoPeep`, `ppeak`, `pplat` | 3.85 cmH2O, 25.4 cmH2O, 17.94 cmH2O | 2.53 cmH2O, 35.4 cmH2O, 16.62 cmH2O | `down`, `up`, `down` | `down`, `up`, `down` (Marini 2011; Tobin 2001) | **Agreement** (No flags) |
| **06** | `06-dead-space-vs-paco2` | Dead Space versus PaCO2 & EtCO2 Gap | `alveolarDeadSpaceFraction`: 0.10 -> 0.45 | `paco2`, `etco2`, `ph` | 39.89 mmHg, 36.0 mmHg, 7.40 | 53.68 mmHg, 30.0 mmHg, 7.30 | `up`, `down`, `down` | `up`, `down`, `down` (Nuckton 2002; Verscheure 2016) | **Agreement** (No flags) |
| **07** | `07-vt-vs-rr-minute-ventilation` | VT vs RR at Same Minute Ventilation | `vtSetMl`: 500 -> 250 mL (`rrSetBpm`: 12 -> 24 bpm) | `minuteVent`, `paco2`, `ph` | 6.0 L/min, 41.35 mmHg, 7.39 | 6.1 L/min, 57.41 mmHg, 7.27 | `same`, `up`, `down` | `same`, `up`, `down` (West 2016; Nunn 2017) | **Agreement** (No flags) |
| **08** | `08-fio2-vs-pao2-high-shunt` | FiO2 versus PaO2 with High Shunt | `fio2`: 0.40 -> 1.00 | `pao2`, `spo2`, `paco2` | 45.22 mmHg, 81%, 39.43 mmHg | 55.30 mmHg, 89%, 37.91 mmHg | `up`, `up`, `same` | `up` (modest), `up`, `same` (West 2016; Petersson 2014) | **Agreement** (No flags) |
| **09** | `09-peep-vs-shunt-recruitment` | PEEP versus Recruitment of Shunt *(Rule-based)* | `peep`: 5 -> 14 cmH2O | `pao2`, `pfRatio`, `pplat` | 49.60 mmHg, 99.2 mmHg, 18.13 cmH2O | 95.74 mmHg, 191.5 mmHg, 27.13 cmH2O | `up`, `up`, `up` | `up`, `up`, `up` (Briel 2010; Papazian 2019) | **Agreement** (Rule-based recruitment) |
| **10** | `10-ps-level-vs-vt-rr` | Pressure Support vs VT & PaCO2 *(Rule-based)* | `psAbovePeep`: 5 -> 16 cmH2O | `vte`, `ppeak`, `paco2` | 455 mL, 10.0 cmH2O, 38.17 mmHg | 732 mL, 21.0 cmH2O, 30.73 mmHg | `up`, `up`, `down` | `up`, `up`, `down` (Brochard 2013; MacIntyre 2005) | **Agreement** (Rule-based unloading) |
| **11** | `11-trigger-sensitivity-missed-triggers` | Trigger Sensitivity vs Missed Triggers | `triggerFlowLpm`: 2.0 -> 8.0 L/min | `ineffectiveEfforts`, `rrTotal`, `minuteVent` | 0, 18 bpm, 8.3 L/min | 2, 10 bpm, 4.9 L/min | `up`, `down`, `down` | `up`, `down`, `down` (Chao 1997; Epstein 2011) | **Agreement** (No flags) |
| **12** | `12-hfnc-flow-vs-fio2-high-demand` | HFNC Flow vs Delivered FiO2 *(Rule-based)* | `flowLpm`: 20 -> 60 L/min | `fio2`, `pao2`, `hfncPressure` | 0.41, 74.85 mmHg, 1.0 cmH2O | 0.80, 107.29 mmHg, 3.0 cmH2O | `up`, `up`, `up` | `up`, `up`, `up` (Nishimura 2015; Ritchie 2011) | **Agreement** (Rule-based HFNC) |
| **13** | `13-ppv-vs-bp-preload-dependent` | Positive Pressure vs BP in Preload Dependency *(Rule-based)* | `peep`: 5 -> 16 cmH2O | `pmean`, `sbp`, `hr` | 7.0 cmH2O, 110 mmHg, 90 bpm | 18.0 cmH2O, 75 mmHg, 102 bpm | `up`, `down`, `up` | `up`, `down`, `up` (Pinsky 2007; Jardin 1981) | **Agreement** (Rule-based circulation) |

---

## 3. Detailed Experiment Verification (01 to 06)

### Experiment 01: RC Time Constant and Exhalation (`01-rc-time-constant-exhalation`)
- **Competencies**: `mech.time-constants`, `wave.incomplete-exhalation`
- **Setup**: Passive patient on VC-AC ($V_T = 500\text{ mL}$, RR 16 bpm, $T_i = 1.0\text{ s}$, PEEP 5 cmH2O). Baseline $R_{exp} = 10\text{ cmH}_2\text{O/(L/s)}$, $C_{rs} = 50\text{ mL/cmH}_2\text{O}$ ($\tau = 0.50\text{ s}$, available $T_e = 2.75\text{ s} > 5\tau$).
- **Intervention**: Expiratory airway resistance increased to $40\text{ cmH}_2\text{O/(L/s)}$ ($\tau = 2.0\text{ s}$; available $T_e = 2.75\text{ s} = 1.38\tau$).
- **Causal Chain Trace Progression**:
  1. `expResistance`: $10 \rightarrow 40\text{ cmH}_2\text{O/(L/s)}$
  2. `timeConstant`: $0.50\text{ s} \rightarrow 2.00\text{ s}$
  3. `endExpFlow`: $0.004\text{ L/s} \rightarrow 0.085\text{ L/s}$
  4. `trappedVolume`: $2.0\text{ mL} \rightarrow 168.6\text{ mL}$
  5. `autoPeep`: $0.04\text{ cmH}_2\text{O} \rightarrow 3.37\text{ cmH}_2\text{O}$
- **Citations**: Tobin MJ (2012); Blanch L et al. (2005).

### Experiment 02: VC versus PC when Compliance Falls (`02-vc-vs-pc-compliance`)
- **Competencies**: `modes.vc-vs-pc`, `mech.res-vs-comp`
- **Setup**: Passive patient on VC-AC ($V_T = 500\text{ mL}$, RR 15 bpm, PEEP 5 cmH2O, Flow 60 L/min square). Baseline $C_{rs} = 50\text{ mL/cmH}_2\text{O}$.
- **Intervention**: Compliance drops to $25\text{ mL/cmH}_2\text{O}$ (with an additional option to compare PC-AC at the same reduced compliance).
- **Causal Chain Trace Progression**:
  1. `compliance`: $50 \rightarrow 25\text{ mL/cmH}_2\text{O}$
  2. `drivingPressure`: $10.0 \rightarrow 20.0\text{ cmH}_2\text{O}$
  3. `pplat`: $15.0 \rightarrow 25.0\text{ cmH}_2\text{O}$
  4. `ppeak`: $23.0 \rightarrow 33.0\text{ cmH}_2\text{O}$
  5. `vte`: $500 \rightarrow 500\text{ mL}$
- **Citations**: Chatburn RL & Volsko TA (2021); Amato MB et al. (2015).

### Experiment 03: PEEP versus Pplat at a Fixed Tidal Volume (`03-peep-vs-pplat`)
- **Competencies**: `mech.driving-pressure`, `mech.eom`
- **Setup**: Non-recruitable stiff lung ($C_{rs} = 30\text{ mL/cmH}_2\text{O}$) on VC-AC ($V_T = 450\text{ mL}$, RR 15 bpm, PEEP 5 cmH2O).
- **Intervention**: Set PEEP raised from 5 to 12 cmH2O.
- **Causal Chain Trace Progression**:
  1. `setPeep`: $5 \rightarrow 12\text{ cmH}_2\text{O}$
  2. `pplat`: $20.0 \rightarrow 27.0\text{ cmH}_2\text{O}$
  3. `ppeak`: $28.0 \rightarrow 35.0\text{ cmH}_2\text{O}$
  4. `drivingPressure`: $15.0 \rightarrow 15.0\text{ cmH}_2\text{O}$
- **Citations**: Bellani G et al. (2016); West JB & Luks AM (2021).

### Experiment 04: Respiratory Rate versus Auto-PEEP in Obstruction (`04-rr-vs-auto-peep`)
- **Competencies**: `mech.auto-peep`, `disease.obstructive`
- **Setup**: Severe obstruction ($R_{exp} = 35\text{ cmH}_2\text{O/(L/s)}$, $C_{rs} = 60\text{ mL/cmH}_2\text{O}$, $\tau = 2.10\text{ s}$) on VC-AC ($V_T = 480\text{ mL}$, RR 12 bpm, $T_e = 4.52\text{ s}$).
- **Intervention**: Mandatory RR raised from 12 to 24 bpm ($T_e$ cut to $2.02\text{ s}$).
- **Causal Chain Trace Progression**:
  1. `setRr`: $12 \rightarrow 24\text{ bpm}$
  2. `teSec`: $4.52 \rightarrow 2.02\text{ s}$
  3. `endExpFlow`: $0.030 \rightarrow 0.141\text{ L/s}$
  4. `trappedVolume`: $63.1 \rightarrow 295.8\text{ mL}$
  5. `autoPeep`: $1.05 \rightarrow 4.93\text{ cmH}_2\text{O}$
  6. `pplat`: $14.05 \rightarrow 17.93\text{ cmH}_2\text{O}$
- **Citations**: Laghi F & Goyal A (2012); Tuxen DV (1989).

### Experiment 05: Inspiratory Flow Rate versus Auto-PEEP (`05-insp-flow-vs-auto-peep`)
- **Competencies**: `modes.ie-flow-ti`, `mech.auto-peep`
- **Setup**: Obstructed patient ($R_{exp} = 35$, $R_{insp} = 15$, $C_{rs} = 55$) on VC-AC ($V_T = 500\text{ mL}$, RR 18 bpm, square flow 30 L/min).
- **Intervention**: Inspiratory flow raised from 30 to 75 L/min ($T_i$ drops from $1.00\text{ s}$ to $0.40\text{ s}$, $T_e$ rises from $2.34\text{ s}$ to $2.93\text{ s}$).
- **Causal Chain Trace Progression**:
  1. `setInspFlow`: $30 \rightarrow 75\text{ L/min}$
  2. `tiSec`: $1.00 \rightarrow 0.40\text{ s}$
  3. `teSec`: $2.34 \rightarrow 2.93\text{ s}$
  4. `trappedVolume`: $211.5 \rightarrow 139.1\text{ mL}$
  5. `autoPeep`: $3.85 \rightarrow 2.53\text{ cmH}_2\text{O}$
  6. `pplat`: $17.94 \rightarrow 16.62\text{ cmH}_2\text{O}$
  7. `ppeak`: $25.4 \rightarrow 35.4\text{ cmH}_2\text{O}$
- **Citations**: Marini JJ (2011); Tobin MJ (2001).

### Experiment 06: Dead Space versus PaCO2 and EtCO2 Gap (`06-dead-space-vs-paco2`)
- **Competencies**: `gas.dead-space`, `gas.alveolar-ventilation`
- **Setup**: Ventilated patient on VC-AC ($V_T = 450\text{ mL}$, RR 14 bpm, PEEP 5 cmH2O). Baseline `alveolarDeadSpaceFraction` = 0.10.
- **Intervention**: Alveolar dead space fraction raised to 0.45.
- **Causal Chain Trace Progression**:
  1. `deadSpaceFraction`: $0.10 \rightarrow 0.45$
  2. `alveolarVentilation`: $4.03 \rightarrow 2.46\text{ L/min}$
  3. `steadyPaco2Target`: $39.1 \rightarrow 55.3\text{ mmHg}$
  4. `paco2`: $39.9 \rightarrow 53.7\text{ mmHg}$
  5. `ph`: $7.400 \rightarrow 7.296$
- **Citations**: Nuckton TJ et al. (2002); Verscheure S et al. (2016).

---

## 4. Detailed Experiment Verification (07 to 13)

### Experiment 07: VT versus RR at the Same Minute Ventilation (`07-vt-vs-rr-minute-ventilation`)
- **Competencies**: `gas.alveolar-ventilation`, `gas.dead-space`
- **Setup**: VC-AC with $V_T = 500\text{ mL}$, RR 12 bpm ($V_E = 6.0\text{ L/min}$; anatomic dead space 150 mL).
- **Intervention**: Shallow rapid pattern ($V_T = 250\text{ mL}$, RR 24 bpm, $V_E = 6.0\text{ L/min}$).
- **Causal Chain Trace Progression**:
  1. `setVt`: $500 \rightarrow 250\text{ mL}$
  2. `setRr`: $12 \rightarrow 24\text{ bpm}$
  3. `minuteVent`: $6.0 \rightarrow 6.1\text{ L/min}$
  4. `alveolarVentilation`: $3.78 \rightarrow 2.25\text{ L/min}$
  5. `steadyPaco2Target`: $43.4 \rightarrow 63.3\text{ mmHg}$
  6. `paco2`: $41.4 \rightarrow 57.4\text{ mmHg}$
  7. `ph`: $7.39 \rightarrow 7.27$
- **Citations**: West JB & Luks AM (2016); Nunn's Applied Respiratory Physiology (2017).

### Experiment 08: FiO2 versus PaO2 with High Shunt (`08-fio2-vs-pao2-high-shunt`)
- **Competencies**: `gas.hypoxaemia-mechanism`, `modes.peep-fio2`
- **Setup**: Severe true shunt ($Q_s/Q_t = 0.45$) on VC-AC (PEEP 5, $FiO_2 = 0.40$).
- **Intervention**: $FiO_2$ raised from 0.40 to 1.00.
- **Causal Chain Trace Progression**:
  1. `setFio2`: $40\% \rightarrow 100\%$
  2. `fio2Effective`: $40\% \rightarrow 100\%$
  3. `pao2Alveolar`: $239.4 \rightarrow 670.3\text{ mmHg}$
  4. `shuntUsed`: $0.45 \rightarrow 0.45$
  5. `pao2`: $45.2 \rightarrow 55.3\text{ mmHg}$
  6. `spo2`: $81\% \rightarrow 89\%$
- **Citations**: West JB & Luks AM (2016); Petersson J & Glenny RW (2014).

### Experiment 09: PEEP versus Recruitment of Shunt (`09-peep-vs-shunt-recruitment`)
- **Competencies**: `modes.peep-fio2`, `disease.ards`
- **Rule-based**: `true` (Lung recruitment as a function of end-expiratory pressure is a rule-based teaching approximation in Engine v1).
- **Setup**: Recruitable ARDS (`shuntFraction`: 0.40, `recruitability`: 0.75) on VC-AC (PEEP 5, $FiO_2 = 0.50$).
- **Intervention**: PEEP raised from 5 to 14 cmH2O.
- **Causal Chain Trace Progression**:
  1. `setPeep`: $5 \rightarrow 14\text{ cmH}_2\text{O}$
  2. `recruitedFraction`: $0.00 \rightarrow 0.78$ *(Rule-based)*
  3. `shuntUsed`: $0.40 \rightarrow 0.17$ *(Rule-based)*
  4. `pao2`: $49.6 \rightarrow 95.7\text{ mmHg}$
  5. `spo2`: $85\% \rightarrow 97\%$
  6. `pplat`: $18.1 \rightarrow 27.1\text{ cmH}_2\text{O}$
- **Citations**: Briel M et al. (2010); Papazian L et al. (2019).

### Experiment 10: Pressure Support Level versus VT and RR (`10-ps-level-vs-vt-rr`)
- **Competencies**: `modes.ps-spont`
- **Rule-based**: `true` (Effort unloading by pressure support is a rule-based relationship in Engine v1).
- **Setup**: Spontaneous patient (`spontRateBpm`: 22, `pmusAmplitudeCmH2O`: 12) on PSV (PS 5, PEEP 5).
- **Intervention**: PS above PEEP raised from 5 to 16 cmH2O.
- **Causal Chain Trace Progression**:
  1. `setPs`: $5 \rightarrow 16\text{ cmH}_2\text{O}$
  2. `unloading`: $0.88 \rightarrow 0.60$ *(Rule-based)*
  3. `vte`: $455 \rightarrow 732\text{ mL}$
  4. `alveolarVentilation`: $5.94 \rightarrow 9.61\text{ L/min}$
  5. `paco2`: $38.2 \rightarrow 30.7\text{ mmHg}$
  6. `drive`: $0.97 \rightarrow 0.80$
- **Citations**: Brochard L (2013); MacIntyre NR (2005).

### Experiment 11: Trigger Sensitivity versus Missed Triggers (`11-trigger-sensitivity-missed-triggers`)
- **Competencies**: `modes.trigger-cycle`, `wave.dyssynchrony`
- **Setup**: Severe COPD with auto-PEEP (~1.9 cmH2O) and weak effort ($P_{mus} = 7\text{ cmH}_2\text{O}$) on VC-AC (backup RR 10 bpm, flow trigger 2.0 L/min).
- **Intervention**: Flow trigger threshold raised (desensitized) from 2.0 to 8.0 L/min.
- **Causal Chain Trace Progression**:
  1. `setTriggerFlow`: $2.0 \rightarrow 8.0\text{ L/min}$
  2. `autoPeep`: $1.90 \rightarrow 1.06\text{ cmH}_2\text{O}$
  3. `ineffectiveEfforts`: $0 \rightarrow 2$
  4. `minuteVent`: $8.3 \rightarrow 4.9\text{ L/min}$
  5. `alveolarVentilation`: $4.34 \rightarrow 2.75\text{ L/min}$
  6. `paco2`: $39.8 \rightarrow 47.3\text{ mmHg}$
- **Citations**: Chao DC et al. (1997); Epstein SK (2011).

### Experiment 12: HFNC Flow versus Delivered FiO2 (`12-hfnc-flow-vs-fio2-high-demand`)
- **Competencies**: `niv.hfnc`
- **Rule-based**: `true` (HFNC room-air dilution, dead-space washout, and continuous airway pressure `0.05 * flowLpm` are rule-based approximations in Engine v1).
- **Setup**: Tachypnoeic high-demand patient (RR 28, $P_{mus} = 18\text{ cmH}_2\text{O}$) on HFNC at flow 20 L/min, set $FiO_2 = 0.80$.
- **Intervention**: HFNC flow raised from 20 to 60 L/min.
- **Causal Chain Trace Progression**:
  1. `setHfncFlow`: $20 \rightarrow 60\text{ L/min}$
  2. `fio2Effective`: $41\% \rightarrow 80\%$ *(Rule-based)*
  3. `pao2Alveolar`: $245.4 \rightarrow 533.3\text{ mmHg}$
  4. `pao2`: $74.8 \rightarrow 107.3\text{ mmHg}$
  5. `spo2`: $95\% \rightarrow 98\%$
  6. `hfncPressure`: $1.0 \rightarrow 3.0\text{ cmH}_2\text{O}$ *(Rule-based)*
- **Citations**: Nishimura M (2015); Ritchie JE et al. (2011).

### Experiment 13: Positive Pressure versus BP in a Preload-Dependent Patient (`13-ppv-vs-bp-preload-dependent`)
- **Competencies**: `circ.ppv-preload`
- **Rule-based**: `true` (Hemodynamic response to mean alveolar pressure with `ppvResponse = "clean-kill"` is a rule-based circulation model, not a mechanistic cardiovascular simulation).
- **Setup**: Hypovolemic preload-dependent patient (`ppvResponse: "clean-kill"`, `ppvSeverity: 0.9`, baseline BP 115/68 mmHg, HR 88 bpm) on VC-AC (PEEP 5 cmH2O).
- **Intervention**: PEEP raised from 5 to 16 cmH2O.
- **Causal Chain Trace Progression**:
  1. `setPeep`: $5 \rightarrow 16\text{ cmH}_2\text{O}$
  2. `pmean`: $7.0 \rightarrow 18.0\text{ cmH}_2\text{O}$
  3. `circulationMultiplier`: $0.95 \rightarrow 0.65$ *(Rule-based)*
  4. `map`: $80 \rightarrow 55\text{ mmHg}$ *(Rule-based)*
  5. `sbp`: $110 \rightarrow 75\text{ mmHg}$ *(Rule-based)*
  6. `hr`: $90 \rightarrow 102\text{ bpm}$ *(Rule-based)*
- **Citations**: Pinsky MR (2007); Jardin F et al. (1981).

---

## 5. Determinism & Literature Disagreement Check

- **3-Run Determinism Check**: Tested in `src/lab/experiments.test.ts` across all 13 experiments (3 consecutive headless runs per experiment = 39 full runs). Every baseline metric, post-intervention metric, engine-marked direction key (`answerKey`), and causal trace chain (`buildCausalChain`) is 100% identical across all runs.
- **Literature Disagreements**: **0 disagreements** across all 13 experiments. Every rule-based link (Experiments 09, 10, 12, 13) is explicitly flagged at both the experiment level and the individual causal node level (`LAB_RULE_BASED_BADGE`).
