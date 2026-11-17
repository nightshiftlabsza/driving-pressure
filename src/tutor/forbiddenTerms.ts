/**
 * Trimmed canonical forbidden terms per competency + dynamic Concept-Stem Blocker.
 * Every competency in src/shared/competencies.json retains 3-4 canonical stems.
 */
export const FORBIDDEN_TERMS_BY_COMPETENCY: Record<string, string[]> = {
  // Mechanics
  'mech.eom': [
    'equation of motion',
    'resistive pressure',
    'elastic pressure',
  ],
  'mech.res-vs-comp': [
    'peak to plateau gap',
    'Ppeak minus Pplat',
    'airway resistance versus lung stiffness',
  ],
  'mech.driving-pressure': [
    'driving pressure',
    'Pplat minus PEEP',
    'plateau minus PEEP',
    'delta P',
  ],
  'mech.time-constants': [
    'time constant',
    'resistance times compliance',
    'expiratory time constant',
  ],
  'mech.auto-peep': [
    'auto-PEEP',
    'intrinsic PEEP',
    'PEEPi',
    'dynamic hyperinflation',
  ],

  // Gas exchange
  'gas.oxy-vs-vent': [
    'oxygenation versus ventilation',
    'FiO2 and PEEP for oxygenation',
    'minute ventilation for carbon dioxide',
  ],
  'gas.hypoxaemia-mechanism': [
    'intrapulmonary shunt',
    'V/Q mismatch',
    'hypoventilation',
    'diffusion impairment',
  ],
  'gas.dead-space': [
    'dead space',
    'PaCO2 - EtCO2',
    'alveolar dead space',
  ],
  'gas.alveolar-ventilation': [
    'alveolar ventilation',
    'PaCO2 prediction',
    'minute ventilation adjustment',
  ],
  'gas.acid-base': [
    'respiratory acidosis',
    'respiratory alkalosis',
    'metabolic acidosis',
    'metabolic alkalosis',
  ],

  // Modes
  'modes.vc-vs-pc': [
    'volume control versus pressure control',
    'variable pressure in volume control',
    'variable tidal volume in pressure control',
  ],
  'modes.ps-spont': [
    'pressure support',
    'PSV',
    'pressure support ventilation',
  ],
  'modes.trigger-cycle': [
    'trigger sensitivity',
    'cycle off percentage',
    'expiratory trigger sensitivity',
  ],
  'modes.peep-fio2': [
    'PEEP titration',
    'PEEP-FiO2 table',
    'ARDSNet PEEP ladder',
  ],
  'modes.ie-flow-ti': [
    'I:E ratio',
    'inspiratory time',
    'expiratory time',
  ],
  'modes.dyssynchrony-management': [
    'double triggering',
    'breath stacking',
    'flow starvation',
  ],

  // Waveforms
  'wave.normal': [
    'normal waveform',
    'expected flow morphology',
    'normal pressure curve',
  ],
  'wave.incomplete-exhalation': [
    'incomplete exhalation',
    'flow not returning to zero',
    'expiratory flow truncation',
  ],
  'wave.flow-limitation': [
    'expiratory flow limitation',
    'scooped flow-volume loop',
    'effort-independent expiratory flow',
  ],
  'wave.dyssynchrony': [
    'patient-ventilator dyssynchrony',
    'ineffective triggering',
    'double triggering',
    'flow starvation',
  ],
  'wave.leak': [
    'circuit leak',
    'cuff leak',
    'VTi exceeding VTe',
  ],

  // Disease strategies
  'disease.ards': [
    'lung-protective ventilation',
    'ARDSNet protocol',
    'low tidal volume ventilation',
  ],
  'disease.obstructive': [
    'obstructive ventilation strategy',
    'permissive hypercapnia in asthma',
    'prolonged expiration strategy',
  ],
  'disease.restrictive-nm': [
    'neuromuscular respiratory failure',
    'chest wall restriction',
    'restrictive lung mechanics',
  ],
  'disease.metabolic-acidosis': [
    'respiratory compensation for metabolic acidosis',
    'Winter formula',
    'compensatory hyperventilation',
  ],

  // Noninvasive support
  'niv.selection': [
    'NIV patient selection',
    'NIV contraindications',
    'contraindications to non-invasive ventilation',
  ],
  'niv.titration': [
    'NIV titration',
    'IPAP and EPAP titration',
    'delta IPAP-EPAP',
  ],
  'niv.interface-leak': [
    'mask leak management',
    'oronasal mask fit',
    'unintentional leak management',
  ],
  'niv.hfnc': [
    'HFNC flow titration',
    'pharyngeal dead space washout',
    'ROX index',
  ],
  'niv.failure': [
    'NIV failure',
    'HFNC failure',
    'delayed intubation risk',
  ],

  // Circulation
  'circ.ppv-preload': [
    'positive pressure hemodynamic effects',
    'preload reduction from positive pressure',
    'venous return impairment',
  ],
  'circ.auto-peep-hypotension': [
    'auto-PEEP',
    'intrinsic PEEP',
    'dynamic hyperinflation',
    'auto-PEEP hypotension',
  ],
  'circ.rv-peep': [
    'right ventricular afterload',
    'pulmonary vascular resistance and PEEP',
    'RV failure on ventilator',
  ],

  // Safety & troubleshooting
  'safety.alarm-response': [
    'high peak pressure alarm',
    'low minute volume alarm',
    'ventilator alarm response',
  ],
  'safety.crisis': [
    'DOPE mnemonic',
    'tension pneumothorax on ventilator',
    'displacement obstruction pneumothorax equipment',
  ],
  'safety.reassess': [
    'reassessment after ventilator change',
    'timely blood gas recheck',
    'post-intervention monitoring',
  ],
  'safety.liberation': [
    'spontaneous breathing trial',
    'SBT criteria',
    'rapid shallow breathing index',
  ],
  'safety.extubation': [
    'extubation readiness',
    'cuff leak test',
    'post-extubation stridor',
  ],
};

/**
 * Concept-stem blocker dictionary for active physiological abnormalities.
 * Blocks naming an active abnormality before the learner describes or identifies it.
 */
export const ABNORMALITY_CONCEPT_STEMS: Record<
  string,
  { label: string; stems: string[]; learnerDescriptors: string[] }
> = {
  auto_peep: {
    label: 'auto-PEEP / dynamic hyperinflation',
    stems: [
      'auto-peep',
      'autopeep',
      'intrinsic peep',
      'peepi',
      'dynamic hyperinflation',
      'air trapping',
      'gas trapping',
      'incomplete exhalation',
    ],
    learnerDescriptors: [
      'auto-peep',
      'autopeep',
      'intrinsic peep',
      'peepi',
      'trapping',
      'hyperinflation',
      'incomplete exhalation',
      'flow does not reach zero',
      'not returning to zero',
      'expiratory flow',
    ],
  },
  double_trigger: {
    label: 'double triggering / breath stacking / inspiratory flow-time mismatch',
    stems: [
      'double trigger',
      'double triggering',
      'breath stacking',
      'inspiratory flow mismatch',
      'short ti triggering secondary breath',
      'neural ti exceeds vent ti',
    ],
    learnerDescriptors: [
      'double trigger',
      'breath stack',
      'two breaths stacked',
      'persistent inspiratory effort',
      'inspiratory flow mismatch',
      'short ti',
      'neural ti',
      'secondary breath',
      'cycling mismatch',
    ],
  },
  flow_starvation: {
    label: 'flow starvation',
    stems: ['flow starvation', 'flow starved', 'insufficient inspiratory flow'],
    learnerDescriptors: [
      'flow starvation',
      'flow starved',
      'scalloped pressure',
      'scooped pressure',
      'pulling down pressure',
    ],
  },
  premature_cycling: {
    label: 'premature cycling',
    stems: ['premature cycling', 'prematurely cycled'],
    learnerDescriptors: ['premature cycl', 'ti shorter than neural', 'neural ti'],
  },
  ineffective_triggering: {
    label: 'ineffective triggering',
    stems: ['ineffective trigger', 'ineffective effort', 'missed trigger'],
    learnerDescriptors: ['ineffective', 'failed to trigger', 'missed trigger', 'untriggered'],
  },
  circuit_leak: {
    label: 'circuit / cuff leak',
    stems: ['circuit leak', 'cuff leak', 'airway leak'],
    learnerDescriptors: ['leak', 'vti exceeds vte', 'volume not returning'],
  },
};

export function getForbiddenTermsForCompetencies(competencyIds: string[]): string[] {
  const terms = new Set<string>();
  for (const id of competencyIds) {
    const list = FORBIDDEN_TERMS_BY_COMPETENCY[id];
    if (list) {
      for (const term of list) {
        terms.add(term);
      }
    } else {
      terms.add(id);
    }
  }
  return Array.from(terms);
}

export function normalizeForLeakage(str: string): string {
  return str.toLowerCase().replace(/[\s\-_]/g, '');
}

export function checkTextForForbiddenTerms(
  text: string,
  forbiddenPhrases: string[]
): { hasLeakage: boolean; matchedTerms: string[] } {
  if (!text || !forbiddenPhrases || forbiddenPhrases.length === 0) {
    return { hasLeakage: false, matchedTerms: [] };
  }

  const normalizedText = normalizeForLeakage(text);
  const matched: string[] = [];

  for (const phrase of forbiddenPhrases) {
    const trimmed = phrase.trim();
    if (!trimmed || trimmed.length < 2) continue;

    const normalizedPhrase = normalizeForLeakage(trimmed);
    if (normalizedPhrase.length >= 3 && normalizedText.includes(normalizedPhrase)) {
      matched.push(phrase);
    }
  }

  return {
    hasLeakage: matched.length > 0,
    matchedTerms: matched,
  };
}

export function learnerDescribedAbnormality(learnerText: string, abnormalityId: string): boolean {
  const entry = ABNORMALITY_CONCEPT_STEMS[abnormalityId];
  if (!entry || !learnerText.trim()) return false;
  const lower = learnerText.toLowerCase();
  const norm = normalizeForLeakage(learnerText);
  return entry.learnerDescriptors.some(
    d => lower.includes(d.toLowerCase()) || norm.includes(normalizeForLeakage(d))
  );
}

export function checkConceptStemLeakage(
  tutorText: string,
  activeAbnormalities: string[],
  learnerAttemptText: string = ''
): { hasLeakage: boolean; matchedStems: string[] } {
  if (!tutorText || activeAbnormalities.length === 0) {
    return { hasLeakage: false, matchedStems: [] };
  }

  const normalizedTutor = normalizeForLeakage(tutorText);
  const matched: string[] = [];

  for (const abnId of activeAbnormalities) {
    if (learnerDescribedAbnormality(learnerAttemptText, abnId)) {
      continue; // Learner already described it; tutor may name/discuss it
    }
    const entry = ABNORMALITY_CONCEPT_STEMS[abnId];
    if (!entry) continue;
    for (const stem of entry.stems) {
      if (normalizedTutor.includes(normalizeForLeakage(stem))) {
        matched.push(stem);
      }
    }
  }

  return {
    hasLeakage: matched.length > 0,
    matchedStems: matched,
  };
}
