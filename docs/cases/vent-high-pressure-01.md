# Case Design Note: vent-high-pressure-01

## 1. Learning Goal
Master crisis response and mechanical troubleshooting for sudden high airway pressure alarms and cardiovascular collapse:
- Execute the DOPE mnemonic (Displacement, Obstruction, Pneumothorax, Equipment) systematically.
- Differentiate loss of compliance (simultaneous rise in Ppeak and Pplat) from increased resistance (rise in Ppeak with preserved normal Pplat).
- Recognize tension pneumothorax as an immediate clinical diagnosis requiring emergency needle decompression without waiting for radiological confirmation in an unstable patient.

## 2. Parameter Reasoning
- **Baseline parameters**: A 58-year-old with resolving right lower lobe pneumonia has baseline compliance of 42 mL/cmH2O, normal airway resistance (8 cmH2O/L/s), baseline $\text{HCO}_3^-$ of 24 mmol/L, and normal hemodynamics (BP 124/78 mmHg).
- **Crisis insult (simMin 5)**: Alveolar rupture into the closed pleural space creates a one-way ball-valve tension pneumothorax.
  - **Compliance collapse (42 $\implies$ 11 mL/cmH2O)**: The expanding hemithorax compresses the lung parenchyma and restricts chest wall movement. For a set tidal volume of 420 mL, plateau pressure spikes to ~46 cmH2O and peak airway pressure spikes to ~54 cmH2O.
  - **Shunt fraction (0.20 $\implies$ 0.48)**: Complete atelectatic collapse of the right lung with persistent perfusion creates massive intrapulmonary shunt, driving down $\text{SpO}_2$.
  - **ppvResponse ("clean-kill", severity 0.95)**: Massive positive intrapleural pressure kinks the vena cava and shifts the mediastinum, obliterating venous return. SBP drops precipitously from 124 to 72 mmHg with tachycardia (138 bpm), progressing rapidly toward pulseless electrical activity (PEA) arrest.
- **Decompression response**: Immediate needle decompression in the second intercostal space vents trapped pleural air, instantly restoring compliance to 38 mL/cmH2O, lowering peak pressure to 26 cmH2O, reducing shunt to 0.22, and restoring venous return (SBP rebounds to 118 mmHg).

## 3. Expected Starting Gas & Arithmetic
Under the Henderson-Hasselbalch equation:
$$\text{pH} = 6.1 + \log_{10}\left(\frac{[\text{HCO}_3^-]}{0.0307 \times \text{PaCO}_2}\right)$$

- Baseline starting $\text{PaCO}_2 = 40\text{ mmHg}$, $\text{PaO}_2 = 85\text{ mmHg}$.
- Baseline standard $\text{HCO}_3^- = 24.0\text{ mmol/L}$ (`initialPhys.hco3MmolL`).
- Denominator: $0.0307 \times 40 = 1.2280$
- Ratio: $24.0 / 1.2280 = 19.5440$
- $\log_{10}(19.5440) = 1.2910$
- Expected starting $\text{pH} = 6.1 + 1.2910 = 7.391 \approx 7.40$ (normal baseline arterial blood gas).

## 4. The Trap
When high peak airway pressures alarm simultaneously with acute hypotension, inexperienced clinicians often misdiagnose airway obstruction (mucus plugging, tube kinking) or bronchospasm, losing valuable minutes passing suction catheters or giving nebulisers. More dangerously, clinicians frequently order an emergent chest X-ray and stand by waiting for the radiographer. In a ventilated patient in obstructive shock, tension pneumothorax is a clinical diagnosis; waiting for radiological imaging is fatal. The DOPE algorithm mandates immediate clinical examination and needle decompression.

## 5. Sources
- Leigh-Smith S, Harris T. Tension pneumothorax--time for a re-think? *Emerg Med J* 2005;22(1):8-16.
- Roberts DJ, et al. Clinical presentation and immediate management of tension pneumothorax. *Ann Surg* 2015;261(6):1068-1078.
- Hess DR. Respiratory mechanics in the mechanically ventilated patient. *Respir Care* 2014;59(11):1773-1794.
- MacDuff A, et al. Management of spontaneous pneumothorax: British Thoracic Society pleural disease guideline 2010. *Thorax* 2010;65 Suppl 2:ii18-31.

## 6. Changes after engine testing
- **All scenarios passed on initial draft**: Verified that sudden compliance collapse from 42 to 11 mL/cmH2O under scheduled course at 5 min accurately triggers peak and plateau pressure alarms (Ppeak > 45, Pplat > 40) and tension obstructive shock (SBP < 80).
- **Needle decompression response verified**: Ordering `needle-decompression` instantly relieves the tension pneumothorax, restoring compliance to 38 mL/cmH2O, lowering Ppeak to < 32 cmH2O, and restoring SBP > 105 mmHg within 2 minutes.
- **Incorrect suction scenario verified**: Ordering suction without decompression leaves compliance collapsed and results in case deterioration.
