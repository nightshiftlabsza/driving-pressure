# Physiology engine v2: what it models and what it does not

**Status: teaching model, not validated against patient data.** The equations are standard textbook physiology. The rule-based parts are tuned by hand so cases behave plausibly, and the tests check direction and rough size, not clinical accuracy.

## Modelled from first principles
| Area | Model |
| --- | --- |
| Breath mechanics | Single compartment baseline or optional recruitable two-compartment lung: Paw - (V/C - Pmus) = R x flow, integrated at 200 Hz. Volume carries over between breaths. |
| Recruitable two-compartment lung (v2) | Two compartments sharing the airway: baseline baby lung compliance plus recruitable compartment opening between closing pressure (default 5 cmH2O) and opening pressure (default 10 cmH2O). Recruitment adds compliance and lowers driving pressure at fixed VT. When volume exceeds overdistension threshold (default 600 mL), compliance falls off non-linearly, elevating driving pressure. Sources: Gattinoni L, et al. N Engl J Med 2006;354:1775-86; Amato MB, et al. N Engl J Med 2015;372:747-55; Grasso S, et al. Intensive Care Med 2016;42:1651-53. |
| V/Q mismatch (v2) | Riley three-compartment model partitioning pulmonary perfusion into ideal (V/Q ~ 1), low V/Q (lowVqFraction, lowVqRatio), and shunt. Low V/Q alveolar PAO2 calculated from steady-state oxygen mass balance with nitrogen washout under high FiO2. Perfusion-weighted arterial mixing via Fick principle. Sources: Riley RL, Cournand A. J Appl Physiol 1949;1:825-47; West JB. Respiratory Physiology: The Essentials, 10th ed., Ch. 5; Nunn's Applied Respiratory Physiology, 8th ed., Ch. 10. |
| Effort monitoring & transpulmonary pressures (v2) | Partitioned elastance: 1/Crs = 1/Cl + 1/Ccw. Esophageal pressure Pes(t) = V(t)/Ccw - Pmus(t). Transpulmonary pressure PL(t) = Paw(t) - Pes(t), with end-inspiratory and end-expiratory values. 100 ms airway occlusion pressure P0.1 reflects neuromuscular drive (Telias 2018). End-expiratory occlusion manoeuvre gives Delta Pocc, estimating Pmus (-0.75 x Delta Pocc) and dynamic transpulmonary pressure (Bertoni 2019). Sources: Mauri T, et al. Intensive Care Med 2016;42:1360-73; Akoumianaki E, et al. Am J Respir Crit Care Med 2014;189:520-31; Telias I, et al. Intensive Care Med 2018;44:1946-49; Bertoni M, et al. Crit Care 2019;23:346. |
| Mechanistic dyssynchronies (v2) | - Double triggering: neural Ti outlasting ventilator Ti with vigorous effort triggers an immediate second breath during early expiration (Thille 2006; de Wit 2009).<br>- Premature cycling: elevated PSV cycle-off percentage cuts inspiration short during ongoing neural effort (Tassaux 2005).<br>- Delayed cycling: low PSV cycle-off percentage in obstructive mechanics prolongs machine inspiration into patient exhalation (Yamada & Du 2000).<br>- Flow starvation: fixed VC flow below patient demand flow with high effort scoops airway pressure below passive trajectory (Marini 1986; MacIntyre 2011).<br>- Leak auto-triggering: circuit leak exceeding flow trigger threshold causes runaway autotriggering without patient effort (Imanaka 2000). |
| Auto-PEEP, breath stacking, ineffective triggering | Emerge from the mechanics (incomplete exhalation, effort that cannot overcome intrinsic PEEP) |
| High-pressure limit (Pmax) | In volume-targeted modes (VC-AC, SIMV-VC mandatory breaths), when Paw reaches operator-set `pmaxCmH2O`, inspiration is cut off and the breath cycles into expiration immediately. Paw is capped at Pmax and delivered tidal volume is truncated (`VTe < Vt_set`), flagged with `pmaxLimited = true`. Sources: Cairo JM, *Pilbeam's Mechanical Ventilation*, 7th ed. Elsevier, 2020 (Ch. 4, pressure limiting/cycling); Hamilton-G5 Operator's Manual (Sec. 4.3 Pmax limitation); Draeger Evita Infinity V500 IFU (Pressure Limitation Pmax). |
| Expiratory flow limitation | Optional waterfall: downstream pressure below the closing pressure does not speed exhalation |
| Modes | VC-AC (square/decelerating), PC-AC, PSV (flow cycling), SIMV-VC + PS, CPAP, NIV S/T, HFNC, low-flow oxygen |
| Holds & Manoeuvres | Inspiratory hold gives Pplat; expiratory hold gives total PEEP; end-expiratory occlusion manoeuvre gives Delta Pocc and estimated Pmus; patient effort invalidates holds |
| CO2 | Alveolar ventilation equation with two stores: arterial/lung (90 s) and tissue (8 min rising, 15 min falling); VA averaged over actual counted breath span; EtCO2 scales down linearly between 2x VD and VD, reaching 0 at/below VD |
| Acid-base | Henderson-Hasselbalch with CO2 solubility factor alpha = 0.0301 mmol/(L*mmHg) (standard clinical blood gas convention; Siggaard-Andersen 1974); acute buffering 0.1/0.2 mmol/L per mmHg relative to chronic PaCO2; standard base excess (SBE) via extracellular Van Slyke formula |
| Oxygen | Full alveolar gas equation (Nunn 8th ed), Severinghaus curve with pH and temperature shift, shunt equation and Riley 3-compartment mixing with mixed venous content floored at 30% of capillary content (critical extraction cap 70%, Fick principle) |

## Rule-based (tuned by hand)
| Area | Rule |
| --- | --- |
| Reverse triggering (v2) | Empirical neuromechanical coupling: mandatory ventilator breath elicits entrained diaphragmatic effort starting 100-300 ms post-trigger when `reverseTriggerProbability > 0` (Akoumianaki 2013). |
| PEEP recruitment | Recruitable shunt falls as end-expiratory pressure rises from 5 to 15; derecruits below 5 |
| Respiratory drive | Chemoreflex drive defends chronic setpoint pH (pHset = 7.40 - 0.003 * (chronicPaCO2 - 40)), scaling rate and effort with acute deviation and hypoxaemia |
| Unloading | Patient effort falls up to 50% under positive pressure assistance; in VC-AC, unloading scales with flow adequacy and drops under flow starvation |
| Fatigue | Accumulates when the patient's pressure-time product exceeds a capacity set by `respiratoryReserve`; weakens effort |
| Circulation | Blood pressure and heart rate respond to true mean alveolar pressure (accumulating V/C - Pmus) by phenotype (`ppvResponse`), plus hypoxaemia, hypercapnia and severe acidosis |
| HFNC | About 0.5 cmH2O PEEP per 10 L/min, washout of about 50 mL dead space, room-air entrainment when flow is below the patient's peak inspiratory flow. Estimated airway pressure (`hfncPressureCmH2O`) uses 0.05 cmH2O per L/min (Parke 2009; Groves & Tobin 2007); this is an empirical mouth-open rule, not a circuit measurement. |
| NIV leak | Leak grows with poor fit and pressure; poor fit lowers delivered pressure |
| Low-flow oxygen / NRB | Nominal FiO2 by device and flow; NRB delivers ~0.80 at 15 L/min with normal VE, diluted when VE exceeds delivered flow (Wagstaff & Soni 2007; BTS Guideline 2017) |

## Not modelled in v2
Pendelluft between asynchronous lung units, altitude, chronic renal metabolic compensation dynamics during acute runs, cardiac output as a full closed-loop circulation model, sedation PK/PD, secretions, and monitor noise/artefacts.

## How it is tested
`tests/engine/`: mechanics, two-compartment lung recruitment and overdistension, V/Q mismatch vs shunt refractoriness, effort monitoring ($P_{es}$, $P_L$, $P_{0.1}$, $\Delta P_{occ}$), dyssynchrony detection, 24-hour fast-forward stability across all presets and cases, and step(0.1) execution benchmarks.

`tests/benchmarks.test.ts`: automated benchmark suite evaluating 42 reference behaviors from published physiology literature (`tests/benchmarks/*.json`) covering mechanics, recruitment/overdistension, gas exchange, acid-base, non-invasive interfaces, effort monitoring, and dyssynchrony (38 passing, 4 tracked `EXPECTED_FAIL` simplifications: `drive-02-chronic-retainer-baseline`, `drive-03-acute-on-chronic-copd`, `gas-07-dead-space-hypercapnia`, `mech-06-ineffective-triggering`).

## Model card and causal trace
- **Model Card**: See [docs/MODEL_CARD.md](MODEL_CARD.md) for plain-language overview, intended use, and limitations.
- **Causal Trace**: Intermediate quantities computed in `slowUpdate` (alveolar ventilation, dead-space fraction, steady-state target, PaCO2 change, pH, shunt used, recruited fraction, FiO2 effective, PAO2, PaO2, chemoreflex drive, unloading, PTP, fatigue change, circulation multiplier) are recorded in `state.internal.trace` and exported via `lastTrace(state): EngineTrace | null`.
