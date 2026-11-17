# Physiology Lab Experiments (Part 2: Experiments 07 to 13)

This document records the design, physiological justification, engine execution results, and literature verification for Experiments 07 through 13 in the Physiology Lab.

All experiments were executed against the frozen deterministic engine (`src/engine/index.ts`) and validated against `LabExperimentSchema` (`src/lab/schema.ts`). Noise bands from `LAB_NOISE_BAND` govern the categorical directional marking (`up`, `down`, `same`).

---

## Summary Matrix of Experiments 07–13

| ID | Title | Variable Changed | Primary Predicted Metrics | Engine Marked Direction | Literature Consensus | Engine vs Lit Agreement |
|---|---|---|---|---|---|---|
| **07** | VT vs RR at same minute ventilation | `vtSetMl`: 500 $\to$ 250 mL ($V_E$ 6.0 L/min) | `minuteVent`, `paco2`, `ph` | `same`, `up`, `down` | `same`, `up`, `down` | **Full agreement** |
| **08** | FiO2 vs PaO2 with high shunt | `fio2`: 0.40 $\to$ 1.00 | `pao2`, `spo2`, `paco2` | `up`, `up`, `same` | `up` (modest), `up`, `same` | **Full agreement** |
| **09** | PEEP vs shunt recruitment | `peep`: 5 $\to$ 14 cmH2O | `pao2`, `pfRatio`, `pplat` | `up`, `up`, `up` | `up`, `up`, `up` | **Full agreement** |
| **10** | Pressure support level vs VT and RR | `psAbovePeep`: 5 $\to$ 16 cmH2O | `vte`, `ppeak`, `paco2` | `up`, `up`, `down` | `up`, `up`, `down` | **Full agreement** |
| **11** | Trigger sensitivity vs missed triggers | `triggerFlowLpm`: 2.0 $\to$ 8.0 L/min | `ineffectiveEfforts`, `rrTotal`, `minuteVent` | `up`, `down`, `down` | `up`, `down`, `down` | **Full agreement** |
| **12** | HFNC flow vs delivered FiO2 | `flowLpm`: 20 $\to$ 60 L/min | `fio2`, `pao2`, `hfncPressure` | `up`, `up`, `up` | `up`, `up`, `up` | **Full agreement** |
| **13** | Positive pressure vs BP in preload-dependent | `peep`: 5 $\to$ 16 cmH2O | `pmean`, `sbp`, `hr` | `up`, `down`, `up` | `up`, `down`, `up` | **Full agreement** |

---

## Detailed Experiment Reports

### Experiment 07: VT versus RR at the Same Minute Ventilation
- **File**: `src/lab/experiments/07-vt-vs-rr-minute-ventilation.json`
- **Competencies**: `gas.alveolar-ventilation`, `gas.dead-space`
- **Rule-based**: `false` (governed strictly by mass balance and Bohr/Fowler dead-space principles)
- **Intervention**: Tidal volume halved from 500 mL to 250 mL while respiratory rate doubled from 12 bpm to 24 bpm, holding total minute ventilation constant at 6.0 L/min.
- **Physiological Mechanism**: Conducting anatomic dead space ($V_D = 150\text{ mL}$) is cleared on each breath before fresh gas enters alveoli. Doubling the breathing frequency doubles the volume wasted in dead space per minute ($150 \times 24 = 3.6\text{ L/min}$ vs $150 \times 12 = 1.8\text{ L/min}$), cutting alveolar ventilation from 3.78 L/min down to 2.25 L/min. PaCO2 rises sharply and arterial pH falls, while minute ventilation remains within the noise band.

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (180s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `minuteVent` (L/min) | 6.00 | 6.10 | +0.10 | 0.50 | **`same`** |
| `paco2` (mmHg) | 41.35 | 57.41 | +16.07 | 3.00 | **`up`** |
| `ph` | 7.39 | 7.27 | -0.11 | 0.02 | **`down`** |
| *Trace:* `setVt` (mL) | 500 | 250 | -250 | — | — |
| *Trace:* `setRr` (bpm) | 12 | 24 | +12 | — | — |
| *Trace:* `alveolarVentilation` (L/min) | 3.78 | 2.25 | -1.53 | — | — |
| *Trace:* `steadyPaco2Target` (mmHg) | 43.42 | 63.26 | +19.84 | — | — |

- **Literature Comparison**:
  - West JB, Luks AM. *West's Respiratory Physiology: The Essentials*. 10th ed. Wolters Kluwer; 2016:15-28.
  - Nunn's Applied Respiratory Physiology. 8th ed. Elsevier; 2017:135-152.
- **Literature Agreement**: Perfect. Literature confirms that rapid shallow breathing dramatically increases $V_D / V_T$, reducing alveolar ventilation and causing hypercapnic respiratory acidosis at constant minute ventilation.
- **Flags**: None.

---

### Experiment 08: FiO2 versus PaO2 with High Shunt
- **File**: `src/lab/experiments/08-fio2-vs-pao2-high-shunt.json`
- **Competencies**: `gas.hypoxaemia-mechanism`, `modes.peep-fio2`
- **Rule-based**: `false` (governed by alveolar gas equation and Berggren shunt equation)
- **Intervention**: Inspired oxygen fraction increased from 0.40 to 1.00 in a patient with severe alveolar consolidation (shunt fraction 0.45).
- **Physiological Mechanism**: Blood traversing non-ventilated alveoli (true shunt) never comes into contact with alveolar gas. Capillary blood from ventilated alveoli is already nearly 100% saturated at $FiO_2 = 0.40$. Increasing $FiO_2$ to 1.00 raises alveolar $P_A O_2$ dramatically (from 239 mmHg to 670 mmHg), but this adds only a modest quantity of dissolved oxygen ($0.0031 \times \Delta P O_2 \approx 1.3\text{ mL O}_2/\text{dL}$). When this mixed end-capillary blood recombines with 45% desaturated mixed venous blood, arterial PaO2 increases only modestly (from 45.2 to 55.3 mmHg), demonstrating classic shunt refractoriness. PaCO2 is unchanged.

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (120s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `pao2` (mmHg) | 45.22 | 55.30 | +10.08 | 5.00 | **`up`** |
| `spo2` (%) | 81.00 | 89.00 | +8.00 | 1.00 | **`up`** |
| `paco2` (mmHg) | 39.43 | 37.91 | -1.52 | 3.00 | **`same`** |
| *Trace:* `setFio2` | 0.40 | 1.00 | +0.60 | — | — |
| *Trace:* `fio2Effective` | 0.40 | 1.00 | +0.60 | — | — |
| *Trace:* `pao2Alveolar` (mmHg) | 239.43 | 670.28 | +430.85 | — | — |
| *Trace:* `shuntUsed` | 0.45 | 0.45 | 0.00 | — | — |

- **Literature Comparison**:
  - West JB, Luks AM. *West's Respiratory Physiology: The Essentials*. 10th ed. Wolters Kluwer; 2016:63-78.
  - Petersson J, Glenny RW. Gas exchange and ventilation-perfusion relationships in the lung. *Eur Respir J* 2014; 44(4):1023-1041.
- **Literature Agreement**: Perfect. Highlights the hallmark clinical distinction between V/Q mismatch (readily corrected by supplemental oxygen) and true shunt (refractory to oxygenation without PEEP/recruitment).
- **Flags**: None.

---

### Experiment 09: PEEP versus Recruitment of Shunt
- **File**: `src/lab/experiments/09-peep-vs-shunt-recruitment.json`
- **Competencies**: `modes.peep-fio2`, `disease.ards`
- **Rule-based**: `true` (`ruleBasedNote`: "Lung recruitment as a function of end-expiratory pressure is a rule-based teaching approximation in Engine v1.")
- **Intervention**: PEEP titrated from 5 cmH2O to 14 cmH2O in recruitable ARDS ($recruitability = 0.75$, $shunt = 0.40$, $C = 32\text{ mL/cmH}_2\text{O}$).
- **Physiological Mechanism**: At low PEEP (5 cmH2O), unstable dependent alveoli collapse at end-expiration. Elevating PEEP to 14 cmH2O exceeds critical alveolar opening pressure and prevents cyclical collapse. Over a time constant of $\tau = 120\text{ s}$, recruited fraction increases to 0.78, slashing effective shunt from 0.40 to 0.166. Arterial PaO2 nearly doubles and P/F ratio rises from 99 to 191 mmHg. Static plateau pressure increases by the change in PEEP ($\Delta Pplat \approx 9\text{ cmH}_2\text{O}$).

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (240s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `pao2` (mmHg) | 49.60 | 95.74 | +46.14 | 5.00 | **`up`** |
| `pfRatio` (mmHg) | 99.21 | 191.48 | +92.27 | 15.00 | **`up`** |
| `pplat` (cmH2O) | 18.13 | 27.13 | +9.00 | 1.00 | **`up`** |
| *Trace:* `setPeep` (cmH2O) | 5.00 | 14.00 | +9.00 | — | — |
| *Trace:* `recruitedFraction` | 0.00 | 0.78 | +0.78 | — | — |
| *Trace:* `shuntUsed` | 0.40 | 0.17 | -0.23 | — | — |

- **Literature Comparison**:
  - Briel M, Meade M, Mercat A, et al. Higher vs lower positive end-expiratory pressure in patients with acute lung injury and acute respiratory distress syndrome: systematic review and meta-analysis. *JAMA* 2010; 303(9):865-873.
  - Papazian L, Aubron C, Brochard L, et al. Formal guidelines: management of acute respiratory distress syndrome. *Ann Intensive Care* 2019; 9(1):69.
- **Literature Agreement**: Perfect. Clinical ARDS trials demonstrate that in patients with recruitable lung tissue, titrating PEEP improves oxygenation and reduces shunt fraction while increasing airway plateau pressure.
- **Flags**: None.

---

### Experiment 10: Pressure Support Level versus VT and RR in a Spontaneous Patient
- **File**: `src/lab/experiments/10-ps-level-vs-vt-rr.json`
- **Competencies**: `modes.ps-spont`
- **Rule-based**: `true` (`ruleBasedNote`: "Effort unloading by pressure support is a rule-based relationship in Engine v1.")
- **Intervention**: Pressure support above PEEP increased from 5 to 16 cmH2O in a spontaneously breathing patient recovering from lung injury.
- **Physiological Mechanism**: In PSV, the ventilator pressurizes the airway to $PEEP + PS$ upon detecting patient effort. Raising PS increases the transpulmonary pressure swing, driving higher inspiratory flow and inflating the lungs to a significantly larger tidal volume ($V_{TE}$ rises from 455 to 732 mL). Peak airway pressure rises from 10 to 21 cmH2O. Mechanical support unloads respiratory muscles (unloading factor changes from 0.875 to 0.60), boosting alveolar ventilation and lowering PaCO2 from 38.2 to 30.7 mmHg. Lower PaCO2 slightly reduces chemoreflex drive.

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (90s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `vte` (mL) | 455.00 | 732.00 | +277.00 | 30.00 | **`up`** |
| `ppeak` (cmH2O) | 10.00 | 21.00 | +11.00 | 2.00 | **`up`** |
| `paco2` (mmHg) | 38.17 | 30.73 | -7.44 | 3.00 | **`down`** |
| *Trace:* `setPs` (cmH2O) | 5.00 | 16.00 | +11.00 | — | — |
| *Trace:* `unloading` | 0.88 | 0.60 | -0.28 | — | — |
| *Trace:* `alveolarVentilation` (L/min) | 5.94 | 9.61 | +3.67 | — | — |
| *Trace:* `drive` | 0.97 | 0.80 | -0.17 | — | — |

- **Literature Comparison**:
  - Brochard L. Pressure support ventilation. In: Tobin MJ, ed. *Principles and Practice of Mechanical Ventilation*. 3rd ed. McGraw-Hill; 2013:227-248.
  - MacIntyre NR. Respiratory mechanics in the patient-ventilator system. *Respir Care* 2005; 50(2):238-245.
- **Literature Agreement**: Perfect. Pressure support unloads respiratory muscles and enlarges tidal volume, decreasing PaCO2 and relieving patient work of breathing.
- **Flags**: None.

---

### Experiment 11: Trigger Sensitivity versus Missed Triggers
- **File**: `src/lab/experiments/11-trigger-sensitivity-missed-triggers.json`
- **Competencies**: `modes.trigger-cycle`, `wave.dyssynchrony`
- **Rule-based**: `false` (governed by mechanical flow threshold vs expiratory recoil and inspiratory muscle effort)
- **Intervention**: Flow trigger sensitivity threshold increased (desensitized) from 2.0 L/min to 8.0 L/min in a patient with severe COPD, dynamic hyperinflation (auto-PEEP ~1.9 cmH2O), and weak inspiratory muscle effort ($P_{mus} = 7\text{ cmH}_2\text{O}$).
- **Physiological Mechanism**: To trigger an assisted breath, the patient's inspiratory effort must first overcome the intrinsic elastic recoil of auto-PEEP to reduce alveolar pressure below circuit PEEP, and then draw sufficient inspiratory flow to satisfy the trigger threshold. At 2.0 L/min, patient effort triggers successfully (total rate 18 bpm, $V_E = 8.3\text{ L/min}$, 0 ineffective efforts). When the trigger is desensitized to 8.0 L/min, the patient's weak effort during exhalation cannot reach 8 L/min against high airway resistance. The efforts fail to trigger (ineffective efforts rise to 2 per breath cycle), total rate drops to the ventilator backup rate of 10 bpm, and minute ventilation drops from 8.3 to 4.9 L/min.

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (90s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `ineffectiveEfforts` | 0.00 | 2.00 | +2.00 | 0.50 | **`up`** |
| `rrTotal` (bpm) | 18.00 | 10.00 | -8.00 | 2.00 | **`down`** |
| `minuteVent` (L/min) | 8.30 | 4.90 | -3.40 | 0.50 | **`down`** |
| *Trace:* `setTriggerFlow` (L/min) | 2.00 | 8.00 | +6.00 | — | — |
| *Trace:* `autoPeep` (cmH2O) | 1.90 | 1.06 | -0.84 | — | — |
| *Trace:* `alveolarVentilation` (L/min) | 4.34 | 2.75 | -1.59 | — | — |
| *Trace:* `paco2` (mmHg) | 39.81 | 47.29 | +7.48 | — | — |

- **Literature Comparison**:
  - Chao DC, Scheinhorn DJ, Steg-Davis M. Patient-ventilator trigger asynchrony in prolonged mechanical ventilation. *Chest* 1997; 112(6):1592-1599.
  - Epstein SK. How to identify and manage patient-ventilator dyssynchrony. *Respir Care* 2011; 56(1):25-38.
- **Literature Agreement**: Perfect. Demonstrates how insensitive triggers interact with dynamic hyperinflation to cause ineffective triggering, pseudo-hypoventilation, and dyssynchrony.
- **Flags**: None.

---

### Experiment 12: HFNC Flow versus Delivered FiO2 at High Inspiratory Demand
- **File**: `src/lab/experiments/12-hfnc-flow-vs-fio2-high-demand.json`
- **Competencies**: `niv.hfnc`
- **Rule-based**: `true` (`ruleBasedNote`: "HFNC room-air dilution, dead-space washout (up to 50 mL), and continuous airway pressure (0.05 cmH2O per L/min) are rule-based approximations in Engine v1.")
- **Intervention**: Cannula gas flow increased from 20 L/min to 60 L/min in a tachypnoeic patient ($RR = 28\text{ bpm}$, $P_{mus} = 18\text{ cmH}_2\text{O}$, generating peak inspiratory flow > 50 L/min) receiving high-flow nasal cannula at blender $FiO_2 = 0.80$.
- **Physiological Mechanism**: In open-system nasal prongs, whenever patient peak inspiratory flow exceeds delivered gas flow, the deficit is drawn from ambient room air ($FiO_2 = 0.21$) around the prongs and through the mouth. At 20 L/min flow, heavy room-air dilution reduces effective delivered FiO2 to ~0.41. Escalating cannula flow to 60 L/min meets or exceeds patient peak demand, eliminating room-air entrainment and restoring effective FiO2 to the set 0.80. Alveolar $P_A O_2$ and arterial PaO2 rise significantly (PaO2 from 74.8 to 107.3 mmHg). Additionally, continuous positive airway pressure increases from 1.0 to 3.0 cmH2O ($0.05\text{ cmH}_2\text{O} \times flow$).

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (90s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `fio2` (effective) | 0.41 | 0.80 | +0.39 | 0.02 | **`up`** |
| `pao2` (mmHg) | 74.85 | 107.29 | +32.44 | 5.00 | **`up`** |
| `hfncPressure` (cmH2O) | 1.00 | 3.00 | +2.00 | 0.20 | **`up`** |
| *Trace:* `setHfncFlow` (L/min) | 20.00 | 60.00 | +40.00 | — | — |
| *Trace:* `fio2Effective` | 0.41 | 0.80 | +0.39 | — | — |
| *Trace:* `pao2Alveolar` (mmHg) | 245.39 | 533.25 | +287.86 | — | — |

- **Literature Comparison**:
  - Nishimura M. High-flow nasal cannula oxygen therapy in adults. *J Intensive Care* 2015; 3:15.
  - Ritchie JE, Williams AB, Gerard C, Hockey H. Evaluation of a humidified nasal high-flow oxygen system, using normal volunteers. *Intensive Care Med* 2011; 37(5):780-786.
- **Literature Agreement**: Perfect. Clinically observed phenomena of flow-dependent FiO2 delivery, low-level PEEP generation, and dead-space washout on high-flow nasal cannula are accurately reproduced.
- **Flags**: None.

---

### Experiment 13: Positive Pressure versus BP in a Preload-Dependent Patient
- **File**: `src/lab/experiments/13-ppv-vs-bp-preload-dependent.json`
- **Competencies**: `circ.ppv-preload`
- **Rule-based**: `true` (`ruleBasedNote`: "Hemodynamic response to mean alveolar pressure (ppvResponse = clean-kill) is a rule-based circulation model, not a mechanistic cardiovascular simulation.")
- **Intervention**: PEEP increased from 5 to 16 cmH2O in a hypovolemic patient with distributive shock exhibiting extreme preload dependency (`ppvResponse: "clean-kill"`, `ppvSeverity: 0.9`).
- **Physiological Mechanism**: Systemic venous return depends on the pressure gradient between mean systemic filling pressure (MSFP) and right atrial pressure (RAP): $VR = (MSFP - RAP) / R_{VR}$. In hypovolemia, MSFP is low. Increasing PEEP transmits positive pressure to the pericardium and right atrium. Mean airway pressure rises from 7.0 to 18.0 cmH2O. This marked increase in intrathoracic pressure compresses the venae cavae, narrows the venous return pressure gradient, and drastically diminishes right ventricular stroke volume. Systolic blood pressure drops precipitously from 110 to 75 mmHg (MAP drops from 80 to 55 mmHg), and arterial baroreceptors elicit compensatory tachycardia (HR increases from 90 to 102 bpm).

#### Engine Quantitative Results
| Metric / Trace Field | Baseline Value | After Value (90s) | Delta ($\Delta$) | Noise Band | Engine Marked Direction |
|---|---|---|---|---|---|
| `pmean` (cmH2O) | 7.00 | 18.00 | +11.00 | 0.50 | **`up`** |
| `sbp` (mmHg) | 110.00 | 75.00 | -35.00 | 5.00 | **`down`** |
| `hr` (bpm) | 90.00 | 102.00 | +12.00 | 5.00 | **`up`** |
| *Trace:* `setPeep` (cmH2O) | 5.00 | 16.00 | +11.00 | — | — |
| *Trace:* `circulationMultiplier` | 0.95 | 0.65 | -0.30 | — | — |
| *Trace:* `map` (mmHg) | 80.00 | 55.00 | -25.00 | — | — |

- **Literature Comparison**:
  - Pinsky MR. Cardiopulmonary interactions: the basics. *Curr Opin Crit Care* 2007; 13(1):3-10.
  - Jardin F, Farcot JC, Boisnante L, et al. Influence of positive end-expiratory pressure on left ventricular performance. *N Engl J Med* 1981; 304(7):387-392.
- **Literature Agreement**: Perfect. Accurately reflects classic heart-lung interactions where positive pressure ventilation induces severe hemodynamic collapse in hypovolemic, preload-dependent patients.
- **Flags**: None.
