import {
  TutorResponseSchema,
  VALID_MISCONCEPTION_IDS,
  EVIDENCE_LEVELS,
  type HelpLevel,
  type LearnerRequestKind,
  type StructuredLearnerAttempt,
  type TutorResponse,
} from './types';
import { checkConceptStemLeakage, checkTextForForbiddenTerms } from './forbiddenTerms';

export interface ValidationOptions {
  helpLevelCap: HelpLevel;
  forbiddenPhrases?: string[];
  requestKind?: LearnerRequestKind;
  isDebrief?: boolean;
  verifiedEngineNumbers?: Record<string, number>;
  activeAbnormalities?: string[];
  learnerAttempt?: StructuredLearnerAttempt;
  learnerPredictionCorrect?: boolean;
  promptVersion?: string;
  /** Optional word limit supplied by caller (left un-hardcoded; image149/image146 NEEDS-CONFIRM). */
  maxWords?: number;
}

export interface ValidationResult {
  valid: boolean;
  sanitizedResponse?: TutorResponse;
  reason?: string;
  blockedByLeakage?: boolean;
  leakageMatches?: string[];
  blockedByNumericContradiction?: boolean;
  numericViolations?: string[];
  jargonDowngraded?: boolean;
}

const PRAISE_PATTERNS = [
  /\bgreat job\b/i,
  /\bgood job\b/i,
  /\bwell done\b/i,
  /\bnice work\b/i,
  /\bexcellent\b/i,
  /\bgreat work\b/i,
  /\bthat is correct\b/i,
  /\bthat's correct\b/i,
  /\byou got it\b/i,
  /\bfantastic\b/i,
  /\bbravo\b/i,
];

// Phrases that tell the learner how close they are to the answer.
const PROGRESS_HINT_PATTERNS = [
  /\balmost there\b/i,
  /\bnearly there\b/i,
  /\byou(?:'|\u2019)re close\b/i,
  /\byou are close\b/i,
  /\bso close\b/i,
  /\bone more step\b/i,
  /\bon the right track\b/i,
];

const STRUCTURAL_SYCOPHANCY_PATTERNS = [
  /\byou nailed\b/i,
  /\bspot-on reasoning\b/i,
  /\bcompletely sound reasoning\b/i,
  /\bexact(?:ly)? right reasoning\b/i,
  /\btotally right\b/i,
  /\bgreat insight\b/i,
  /\bbrilliant deduction\b/i,
];

const SETTING_PRESCRIPTION_PATTERN =
  /\b(?:set|change|adjust|increase|decrease|lower|raise|dial)\s+(?:the\s+)?(?:rr|respiratory rate|peep|vt|tidal volume|fio2|ps|pressure support|ipap|epap)\s+(?:to|at)\s+\d+/i;

const ADVANCED_JARGON_TERMS = [
  'pendelluft',
  'atelectrauma',
  'barotrauma',
  'biotrauma',
  'ergotrauma',
  'time constant',
  'shunt',
  'west zone',
  'mechanotransduction',
  'neuro-ventilatory coupling',
  'campbell diagram',
  'transpulmonary',
  'laplace',
];

const CAUSAL_CONNECTORS = [
  /\bbecause\b/i,
  /\bcauses?\b/i,
  /\bleads?\s+to\b/i,
  /\bresults?\s+in\b/i,
  /\bincreas(?:e|es|ing)\b/i,
  /\bdecreas(?:e|es|ing)\b/i,
  /\breduc(?:e|es|ing)\b/i,
  /\brais(?:e|es|ing)\b/i,
  /\btherefore\b/i,
  /\bsince\b/i,
  /\bdue\s+to\b/i,
  /->|→/,
];

export function hasJargonWithoutCausalLink(text: string): boolean {
  const lower = text.toLowerCase();
  const hasJargon = ADVANCED_JARGON_TERMS.some(term => lower.includes(term));
  if (!hasJargon) return false;
  const hasConnector = CAUSAL_CONNECTORS.some(rx => rx.test(text));
  return !hasConnector;
}

function normalizeMetricKey(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const PROSE_METRIC_PATTERNS: Array<{ canonicalKeys: string[]; pattern: RegExp }> = [
  {
    canonicalKeys: ['c_stat', 'static_compliance'],
    pattern: /\b(?:c_?stat|static compliance)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['c_dyn', 'dynamic_compliance'],
    pattern: /\b(?:c_?dyn|dynamic compliance)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['p_plat', 'pplat', 'plateau_pressure'],
    pattern: /\b(?:p_?plat|plateau pressure)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['p_peak', 'ppeak', 'peak_pressure'],
    pattern: /\b(?:p_?peak|peak pressure)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['delta_p', 'driving_pressure'],
    pattern: /\b(?:delta_?p|driving pressure)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['r_aw', 'airway_resistance'],
    pattern: /\b(?:r_?aw|airway resistance)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['peep_i', 'auto_peep', 'intrinsic_peep'],
    pattern: /\b(?:peep_?i|auto-?peep|intrinsic peep)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['paco2'],
    pattern: /\bpaco2\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['pao2'],
    pattern: /\bpao2\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['spo2'],
    pattern: /\bspo2\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['ph'],
    pattern: /\bph\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['hco3'],
    pattern: /\b(?:hco3|bicarbonate)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['map'],
    pattern: /\bmap\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['peep', 'set_peep'],
    pattern: /\b(?:set\s+peep|external\s+peep|peep)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['vte', 'tidal_volume', 'v_t'],
    pattern: /\b(?:tidal\s+volume|v_?te?|vt)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)\s*ml\b/gi,
  },
  {
    canonicalKeys: ['fio2_pct'],
    pattern: /\bfio2\s*(?:is|of|=|:|was)?\s*(\d+(?:\.\d+)?)\s*%/gi,
  },
  {
    canonicalKeys: ['pf_ratio', 'PF_ratio'],
    pattern: /\b(?:p\/f\s*ratio|pf\s*ratio|pao2\/fio2(?:\s*ratio)?)\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['aa_gradient', 'Aa_gradient'],
    pattern: /\ba-?a\s+gradient\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['anion_gap', 'AG'],
    pattern: /\banion\s+gap\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
  {
    canonicalKeys: ['winters_paco2', 'Winters_PaCO2'],
    pattern: /\bwinter(?:'s)?\s+(?:expected\s+)?paco2\s*(?:is|of|=|:|was)?\s*(-?\d+(?:\.\d+)?)/gi,
  },
];

function findTruthValue(
  keyCandidates: string[],
  verifiedEngineNumbers: Record<string, number>
): { key: string; truth: number } | null {
  const normMap = new Map<string, { origKey: string; val: number }>();
  for (const [k, v] of Object.entries(verifiedEngineNumbers)) {
    normMap.set(normalizeMetricKey(k), { origKey: k, val: v });
  }
  for (const cand of keyCandidates) {
    const found = normMap.get(normalizeMetricKey(cand));
    if (found) return { key: found.origKey, truth: found.val };
  }
  return null;
}

function withinTolerance(key: string, cited: number, truth: number): boolean {
  const norm = normalizeMetricKey(key);
  if (norm === 'ph') {
    return Math.abs(cited - truth) <= 0.05;
  }
  const floor = norm === 'fio2' ? 0.05 : 0.5;
  const tol = Math.max(Math.abs(truth) * 0.05, floor);
  return Math.abs(cited - truth) <= tol;
}

export function verifyNumericClaimsAgainstContext(
  res: TutorResponse,
  verifiedEngineNumbers?: Record<string, number>
): { ok: boolean; violations: string[] } {
  if (!verifiedEngineNumbers || Object.keys(verifiedEngineNumbers).length === 0) {
    return { ok: true, violations: [] };
  }

  const violations: string[] = [];

  // 1. Structured numeric_values_cited inside claims[]
  for (const claim of res.claims) {
    if (!claim.numeric_values_cited) continue;
    for (const [metricKey, citedVal] of Object.entries(claim.numeric_values_cited)) {
      const match = findTruthValue([metricKey], verifiedEngineNumbers);
      if (match && !withinTolerance(match.key, citedVal, match.truth)) {
        violations.push(`${metricKey}: cited ${citedVal}, engine truth ${match.truth}`);
      }
    }
  }

  // 2. Free-text metric-value checks in message + question
  const text = `${res.message} ${res.question ?? ''}`;
  for (const entry of PROSE_METRIC_PATTERNS) {
    const matchTruth = findTruthValue(entry.canonicalKeys, verifiedEngineNumbers);
    if (!matchTruth) continue;

    entry.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = entry.pattern.exec(text)) !== null) {
      const citedNum = Number(m[1]);
      if (Number.isFinite(citedNum) && !withinTolerance(matchTruth.key, citedNum, matchTruth.truth)) {
        violations.push(`${matchTruth.key}: prose cited ${citedNum}, engine truth ${matchTruth.truth}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

export function validateTutorResponse(
  raw: unknown,
  options: ValidationOptions
): ValidationResult {
  // 1. Schema check with Zod
  const parseResult = TutorResponseSchema.safeParse(raw);
  if (!parseResult.success) {
    return {
      valid: false,
      reason: `Schema validation failed: ${parseResult.error.message}`,
    };
  }

  let res: TutorResponse = { ...parseResult.data };

  // 2. Help level cap check
  if (res.help_level_used > options.helpLevelCap) {
    return {
      valid: false,
      reason: `Help level used (${res.help_level_used}) exceeds allowed cap (${options.helpLevelCap})`,
    };
  }

  // 3. Misconception IDs check
  const validMisconceptionSet = new Set<string>(VALID_MISCONCEPTION_IDS);
  for (const mid of res.misconception_ids) {
    if (!validMisconceptionSet.has(mid)) {
      return {
        valid: false,
        reason: `Invalid misconception ID "${mid}"; must exist in mistakes taxonomy`,
      };
    }
  }

  // 4. Evidence level check on claims
  const validEvidenceSet = new Set<string>(EVIDENCE_LEVELS);
  for (const claim of res.claims) {
    if (!validEvidenceSet.has(claim.evidence_level)) {
      return {
        valid: false,
        reason: `Invalid claim evidence_level "${claim.evidence_level}"`,
      };
    }
  }

  // 5. Question constraints:
  // v2 Level 3 REQUIRES a counterfactual or retrieval check question;
  // v1 / Level < 3 forbids questions on explain/worked_example requests.
  if (res.help_level_used === 3 && options.promptVersion === 'v2') {
    if (!res.question || !res.question.includes('?')) {
      return {
        valid: false,
        reason: 'Level 3 responses in v2 must include a counterfactual or retrieval check question',
      };
    }
  } else if (
    res.help_level_used < 3 &&
    (options.requestKind === 'explain' || options.requestKind === 'worked_example')
  ) {
    if (res.question !== null && res.question.trim().length > 0) {
      return {
        valid: false,
        reason: 'Questions are forbidden when learner requested explanation/worked example',
      };
    }
  }

  if (res.question) {
    const qCount = (res.question.match(/\?/g) || []).length;
    if (qCount > 1) {
      return {
        valid: false,
        reason: `At most one question allowed per tutor turn, found ${qCount}`,
      };
    }
  }

  // Optional word cap check (only when explicitly supplied by caller)
  if (typeof options.maxWords === 'number' && options.maxWords > 0) {
    const words = res.message.trim().split(/\s+/).filter(Boolean).length;
    if (words > options.maxWords) {
      return {
        valid: false,
        reason: `Message word count (${words}) exceeds maxWords (${options.maxWords})`,
      };
    }
  }

  // 6. Praise & structural sycophancy checks
  const fullText = `${res.message} ${res.question ?? ''}`;
  for (const pattern of PRAISE_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        valid: false,
        reason: `Response contains generic praise or encouragement: "${pattern.source}"`,
      };
    }
  }

  for (const pattern of PROGRESS_HINT_PATTERNS) {
    if (pattern.test(fullText)) {
      return {
        valid: false,
        reason: `Response tells the learner how close they are: "${pattern.source}"`,
      };
    }
  }

  if (fullText.includes('!')) {
    return {
      valid: false,
      reason: 'Response contains an exclamation mark, which the tutor prompt bans',
    };
  }

  const flawedReasoning =
    options.learnerPredictionCorrect === false ||
    res.reasoning_grade === 'wrong_conclusion_sound_parts' ||
    res.reasoning_grade === 'specific_misconception' ||
    res.reasoning_grade === 'unsupported_assumption' ||
    res.reasoning_grade === 'correct_conclusion_wrong_reasoning';

  if (flawedReasoning) {
    for (const pattern of STRUCTURAL_SYCOPHANCY_PATTERNS) {
      if (pattern.test(fullText)) {
        return {
          valid: false,
          reason: `Structural sycophancy detected: affirming flawed reasoning ("${pattern.source}")`,
        };
      }
    }
  }

  // 7. Setting target prescription check during active case below Level 3
  if (!options.isDebrief && res.help_level_used < 3 && SETTING_PRESCRIPTION_PATTERN.test(fullText)) {
    return {
      valid: false,
      blockedByLeakage: true,
      leakageMatches: ['exact_ventilator_setting_target'],
      reason: 'Response states an exact target ventilator setting before Level 3/debrief',
    };
  }

  // 8. Numeric cross-check against engine truth (±5% tolerance)
  const numericCheck = verifyNumericClaimsAgainstContext(res, options.verifiedEngineNumbers);
  if (!numericCheck.ok) {
    return {
      valid: false,
      blockedByNumericContradiction: true,
      numericViolations: numericCheck.violations,
      reason: `Numeric contradiction against engine state: ${numericCheck.violations.join('; ')}`,
    };
  }

  // 9. Static forbidden terms + dynamic Concept-Stem Blocker
  if (!options.isDebrief && options.forbiddenPhrases && options.forbiddenPhrases.length > 0) {
    const { hasLeakage, matchedTerms } = checkTextForForbiddenTerms(fullText, options.forbiddenPhrases);
    if (hasLeakage) {
      return {
        valid: false,
        blockedByLeakage: true,
        leakageMatches: matchedTerms,
        reason: `Leakage detected: withheld diagnosis, hidden competency or answer found: [${matchedTerms.join(', ')}]`,
      };
    }
  }

  if (!options.isDebrief && options.activeAbnormalities && options.activeAbnormalities.length > 0) {
    const learnerText = options.learnerAttempt
      ? `${options.learnerAttempt.observation} ${options.learnerAttempt.mechanismHypothesis}`
      : '';
    const stemCheck = checkConceptStemLeakage(fullText, options.activeAbnormalities, learnerText);
    if (stemCheck.hasLeakage) {
      return {
        valid: false,
        blockedByLeakage: true,
        leakageMatches: stemCheck.matchedStems,
        reason: `Concept-stem leakage: named active abnormality before learner described it: [${stemCheck.matchedStems.join(', ')}]`,
      };
    }
  }

  // 10. Jargon-Without-Link Detector: deterministically downgrade correct_justified -> correct_superficial
  let jargonDowngraded = false;
  if (
    options.learnerAttempt?.mechanismHypothesis &&
    res.reasoning_grade === 'correct_justified' &&
    hasJargonWithoutCausalLink(options.learnerAttempt.mechanismHypothesis)
  ) {
    res = {
      ...res,
      reasoning_grade: 'correct_superficial',
      needs_clarification: true,
    };
    jargonDowngraded = true;
  }

  return {
    valid: true,
    sanitizedResponse: res,
    jargonDowngraded,
  };
}
