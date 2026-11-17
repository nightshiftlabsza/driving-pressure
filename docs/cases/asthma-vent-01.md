# Case Design Note: asthma-vent-01

## 1. Learning Goal
Master the management of invasively ventilated life-threatening asthma:
- Recognise that high airway resistance prolongs the expiratory time constant, creating severe dynamic hyperinflation (breath stacking) and auto-PEEP when respiratory rate is set too high.
- Understand the cardiovascular pathophysiology of auto-PEEP (`ppvResponse: "clean-kill"`): high intrathoracic pressure halts venous return and causes obstructive shock.
- Execute an obstructive ventilation strategy: reduce respiratory rate (10-12 bpm), shorten inspiratory time by increasing peak flow (70-80 L/min), accept permissive hypercapnia, and perform emergency ventilator disconnection (apnoea trial) for severe hypotension.

## 2. Parameter Reasoning
- **Compliance (65 mL/cmH2O)**: Normal lung parenchymal compliance; there is no alveolar consolidation or fibrosis.
- **Inspiratory resistance (20 cmH2O/L/s)** and **Expiratory resistance (60 cmH2O/L/s)**: Severe bronchospasm, mucosal oedema, and intraluminal mucus dramatically increase resistance, with expiratory resistance higher due to dynamic airway compression during expiration.
- **Time constant calculation**: Expiratory time constant $\tau = R_{exp} \times C = 60 \times 0.065 = 3.90\text{ seconds}$. Complete exhalation (3-4 time constants) requires 12 to 16 seconds. At the ED setting of RR 22 bpm (total breath cycle 2.73s, Ti 0.67s, Te 2.06s) and VT 500 mL, exhalation is violently truncated, generating massive auto-PEEP (11.5 cmH2O).
- **ppvResponse ("clean-kill", severity 0.75)**: Patient baseline unloaded blood pressure is normal (`sbpBaselineMmHg: 115`, `dbpBaselineMmHg: 75`). Pressurised trapped alveolar air transmits to the pleural space, compressing the vena cava and right atrium. Preload collapses under high auto-PEEP (11.5 cmH2O), dropping displayed SBP to 80-83 mmHg. Restoring expiratory time or disconnecting the circuit relieves hyperinflation and naturally restores SBP to > 100 mmHg without vasopressors.
- **baselineHco3MmolL (22 mmol/L)**: Reflects mild metabolic lactic acidosis from prolonged work of breathing prior to intubation.

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation:
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0307 \times \text{PaCO}_2}\right)$$

- Starting $\text{PaCO}_2 = 68\text{ mmHg}$.
- Baseline metabolic $\text{HCO}_3^- = 22.0\text{ mmol/L}$. Acute buffering adds $+0.1\text{ mmol/L}$ per mmHg $\text{PaCO}_2$ above 40: $22.0 + 0.1 \times (68 - 40) = 24.8\text{ mmol/L}$ (`initialPhys.hco3MmolL`).
- Denominator: $0.0307 \times 68 = 2.0876$
- Ratio: $24.8 / 2.0876 = 11.8797$
- $\log_{10}(11.8797) = 1.0748$
- Expected starting $\text{pH} = 6.1 + 1.0748 = 7.175 \approx 7.17 - 7.18$.

## 4. The Trap
Seeing high $\text{PaCO}_2$ (68 mmHg) and acidaemia (pH 7.17), novice clinicians reflexively increase the set rate or tidal volume. In severe obstructive lung disease, this shortens expiratory time further, accelerates breath stacking, elevates auto-PEEP above 15 cmH2O, and precipitates pulseless electrical activity (PEA) arrest. The correct physiological response is counterintuitive: slow the ventilator down, accept the acidosis (permissive hypercapnia), and disconnect the ventilator if hemodynamics crash.

- Leatherman J. Mechanical ventilation for severe asthma. *Chest* 2015;147(6):1671-1680.
- Tuxen DV. Detrimental effects of positive end-expiratory pressure during controlled mechanical ventilation of patients with severe airflow obstruction. *Am Rev Respir Dis* 1989;140(1):5-9.
- Oddo M, et al. Management of mechanical ventilation in acute severe asthma. *Intensive Care Med* 2006;32:501-510.

## 6. Changes after engine testing
- **Expiratory resistance raised to 60 cmH2O/L/s and VT set to 500 mL**: At Re 52 and VT 480, auto-PEEP reached only 8.6 cmH2O; tuning to Re 60 and VT 500 produces the clinically intended auto-PEEP > 10 cmH2O (11.5 cmH2O) at 15 min under default ED ventilation.
- **ppvResponse severity calibrated to 0.75**: Produces severe auto-PEEP hypotension (SBP < 85 mmHg) during breath stacking, while allowing expiratory prolongation and bronchodilation to reliably restore SBP > 95 mmHg by 35 min.
- **Bronchodilator onset accelerated**: Delay reduced from 5 to 3 min, ramp from 20 to 15 min, and target Re lowered to 28 cmH2O/L/s, reflecting prompt beta-agonist effect in releasing trapped gas.
- **Outcome tracking**: Added `outcome: "improved"` to the obstructive ventilation scenario and `outcome: "deteriorated"` to untreated hyperinflation.
- **Auto-PEEP warning calibrated to >= 11 cmH2O**: Triggers clinical nursing notification when auto-PEEP exceeds 11 cmH2O to prompt diagnostic expiratory hold.
- **Citation corrected**: Updated Oddo et al. to *Intensive Care Med* 2006;32:501-510 in both evidence and debrief resources; removed irrelevant Surviving Sepsis citation.
