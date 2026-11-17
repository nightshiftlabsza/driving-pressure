import { describe, it, expect } from 'vitest';
import { validateTutorResponse } from '../../src/tutor/validate';
import type { TutorResponse } from '../../src/tutor/types';

describe('Tutor Response Validation & Leakage Filter', () => {
  const validSample: TutorResponse = {
    message: 'Observe the difference between peak and plateau pressure during the hold.',
    help_level_used: 1,
    question: 'What does this difference reflect about airway resistance?',
    needs_clarification: false,
    reasoning_grade: 'wrong_conclusion_sound_parts',
    misconception_ids: ['faulty_model'],
    claims: [
      {
        text: 'Peak pressure reflects airway resistance plus respiratory system elastance.',
        evidence_level: 'physiology',
      },
    ],
    confidence: 0.9,
  };

  it('passes a fully valid response within cap', () => {
    const res = validateTutorResponse(validSample, {
      helpLevelCap: 1,
      forbiddenPhrases: ['ARDS', 'auto-PEEP'],
    });

    expect(res.valid).toBe(true);
    expect(res.sanitizedResponse?.message).toBe(validSample.message);
  });

  it('fails if help_level_used exceeds the allowed cap', () => {
    const res = validateTutorResponse(validSample, {
      helpLevelCap: 0,
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('exceeds allowed cap');
  });

  it('fails if misconception ID is not in mistakes.json', () => {
    const invalid = {
      ...validSample,
      misconception_ids: ['unknown_made_up_misconception'],
    };

    const res = validateTutorResponse(invalid, {
      helpLevelCap: 2,
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Invalid misconception ID');
  });

  it('fails if evidence_level is invalid', () => {
    const invalid = {
      ...validSample,
      claims: [
        {
          text: 'Some claim',
          evidence_level: 'anecdote' as any,
        },
      ],
    };

    const res = validateTutorResponse(invalid, {
      helpLevelCap: 2,
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toMatch(/invalid_enum_value|Invalid claim evidence_level/i);
  });

  it('fails if response contains generic praise', () => {
    const praised = {
      ...validSample,
      message: 'Great job! You noticed the pressure difference.',
    };

    const res = validateTutorResponse(praised, {
      helpLevelCap: 2,
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('generic praise');
  });

  it.each([
    'almost there', 'Nearly there', "You're close", 'you\u2019re close', 'You are close',
    'so close', 'one more step', 'on the right track', 'ALMOST THERE',
  ])('rejects closeness phrase: %s', phrase => {
    const res = validateTutorResponse(
      { ...validSample, message: `Compare the two pressures; ${phrase} on this one.` },
      { helpLevelCap: 2 }
    );
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('how close');
  });

  it('does not reject the bare word nearly when quoting numbers', () => {
    const res = validateTutorResponse(
      { ...validSample, message: 'PEEP is nearly 10 on the screen; compare it with the plateau.' },
      { helpLevelCap: 2 }
    );
    expect(res.valid).toBe(true);
  });

  it('rejects an exclamation mark in message or question', () => {
    const inMessage = validateTutorResponse(
      { ...validSample, message: 'Look at the hold again!' },
      { helpLevelCap: 2 }
    );
    expect(inMessage.valid).toBe(false);
    expect(inMessage.reason).toContain('exclamation');
    const inQuestion = validateTutorResponse(
      { ...validSample, question: 'What changed!' },
      { helpLevelCap: 2 }
    );
    expect(inQuestion.valid).toBe(false);
  });

  it('blocks response and flags leakage if hidden competency or diagnosis is revealed', () => {
    const leaked = {
      ...validSample,
      message: 'The patient has severe auto-PEEP causing high peak pressure.',
    };

    const res = validateTutorResponse(leaked, {
      helpLevelCap: 2,
      forbiddenPhrases: ['auto-PEEP', 'dynamic hyperinflation'],
    });

    expect(res.valid).toBe(false);
    expect(res.blockedByLeakage).toBe(true);
    expect(res.leakageMatches).toContain('auto-PEEP');
  });

  it('forbids questions when learner requested an explanation', () => {
    const withQuestion = {
      ...validSample,
      question: 'What do you think is happening?',
    };

    const res = validateTutorResponse(withQuestion, {
      helpLevelCap: 3,
      requestKind: 'explain',
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Questions are forbidden when learner requested explanation');
  });

  it('rejects more than one question per turn', () => {
    const multipleQuestions = {
      ...validSample,
      question: 'What is the compliance? And what is the resistance?',
    };

    const res = validateTutorResponse(multipleQuestions, {
      helpLevelCap: 2,
    });

    expect(res.valid).toBe(false);
    expect(res.reason).toContain('At most one question allowed');
  });

  it('checks every hidden competency across library cases has >=3 terms and blocks sample messages', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const { FORBIDDEN_TERMS_BY_COMPETENCY, getForbiddenTermsForCompetencies } = await import(
      '../../src/tutor/forbiddenTerms'
    );

    const casesDir = path.resolve(__dirname, '../../src/cases/library');
    const caseFiles = fs.readdirSync(casesDir).filter((f: string) => f.endsWith('.json'));

    expect(caseFiles.length).toBeGreaterThan(0);

    for (const file of caseFiles) {
      const content = JSON.parse(fs.readFileSync(path.join(casesDir, file), 'utf8'));
      const hidden: string[] = content.hiddenCompetencies || [];

      for (const compId of hidden) {
        const terms = FORBIDDEN_TERMS_BY_COMPETENCY[compId];
        expect(
          terms,
          `Hidden competency "${compId}" in "${file}" must be defined in FORBIDDEN_TERMS_BY_COMPETENCY`
        ).toBeDefined();
        expect(
          terms.length,
          `Hidden competency "${compId}" in "${file}" must have at least 3 terms`
        ).toBeGreaterThanOrEqual(3);

        const forbiddenPhrases = getForbiddenTermsForCompetencies([compId]);

        // Test each term in a sample message
        for (const term of terms) {
          const sample = {
            ...validSample,
            message: `Clinical evaluation: the patient demonstrates ${term} on assessment.`,
          };

          const res = validateTutorResponse(sample, {
            helpLevelCap: 2,
            forbiddenPhrases,
          });

          expect(
            res.valid,
            `Expected message with term "${term}" (from competency "${compId}") to be blocked`
          ).toBe(false);
          expect(res.blockedByLeakage).toBe(true);
        }

        // Test case-insensitivity and hyphen/space variations (e.g. term without hyphens or spaces)
        const firstTerm = terms[0];
        const variations = [
          firstTerm.toUpperCase(),
          firstTerm.toLowerCase(),
          firstTerm.replace(/[-\s]/g, ''),
        ];
        for (const variant of variations) {
          if (variant.length < 3) continue;
          const sampleVariant = {
            ...validSample,
            message: `Reviewing mechanics: ${variant} appears here.`,
          };
          const resVar = validateTutorResponse(sampleVariant, {
            helpLevelCap: 2,
            forbiddenPhrases,
          });
          expect(resVar.blockedByLeakage, `Expected variant "${variant}" to be blocked`).toBe(true);
        }
      }
    }
  });

  describe('Phase 9A Item 4: Numeric Cross-Check, Concept-Stem Blocker & Jargon Detector', () => {
    it('rejects a response citing a number that contradicts engine truth and triggers regeneration in client', async () => {
      const { sendTutorRequest } = await import('../../src/tutor/client');
      const verifiedNumbers = { C_stat: 22, P_plat: 28, SpO2: 91 };

      // Direct validator check: 45 vs 22 (>5% contradiction)
      const contradicted = {
        ...validSample,
        message: 'Static compliance is 45 mL/cmH2O based on this hold.',
        claims: [
          {
            text: 'C_stat is 45 mL/cmH2O.',
            evidence_level: 'physiology' as const,
            numeric_values_cited: { C_stat: 45 },
          },
        ],
      };
      const badRes = validateTutorResponse(contradicted, {
        helpLevelCap: 2,
        verifiedEngineNumbers: verifiedNumbers,
      });
      expect(badRes.valid).toBe(false);
      expect(badRes.blockedByNumericContradiction).toBe(true);

      // Within 5% tolerance passes (22.5 vs 22)
      const accurate = {
        ...validSample,
        message: 'Check the plateau pressure of 28 cmH2O.',
        claims: [
          {
            text: 'Static compliance is 22 mL/cmH2O.',
            evidence_level: 'physiology' as const,
            numeric_values_cited: { C_stat: 22 },
          },
        ],
      };
      expect(
        validateTutorResponse(accurate, {
          helpLevelCap: 2,
          verifiedEngineNumbers: verifiedNumbers,
        }).valid
      ).toBe(true);

      // Client regenerates once when numeric contradiction is returned on call 1
      let calls = 0;
      const origFetch = global.fetch;
      global.fetch = (async () => {
        calls++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: calls === 1 ? contradicted : accurate,
            provider: 'ollama',
            model: 'qwen3:8b',
            latencyMs: 50,
            promptVersion: 'v2',
          }),
        } as unknown as Response;
      }) as typeof fetch;

      try {
        const clientRes = await sendTutorRequest(
          { contextKind: 'active_case', helpLevelCap: 2, contextText: 'C_stat: 22' },
          { helpLevelCap: 2, verifiedEngineNumbers: verifiedNumbers }
        );
        expect(calls).toBe(2);
        expect(clientRes.success).toBe(true);
        if (clientRes.success) {
          expect(clientRes.data.message).toBe(accurate.message);
        }
      } finally {
        global.fetch = origFetch;
      }
    });

    it('rejects naming an active abnormality (auto-PEEP, double trigger, flow starvation) before the learner describes it', () => {
      const learnerAttempt = {
        observation: 'Peak pressure is 42 and blood pressure is dropping.',
        mechanismHypothesis: 'Maybe the patient has bronchospasm raising circuit pressure.',
        confidence: 'fairly_sure' as const,
        maneuversPerformed: [],
        attemptNumberInProblem: 1,
        latencyMs: 12000,
      };

      for (const [abn, leakedWord] of [
        ['auto_peep', 'auto-PEEP'],
        ['double_trigger', 'double triggering'],
        ['flow_starvation', 'flow starvation'],
      ] as const) {
        const res = validateTutorResponse(
          {
            ...validSample,
            message: `Look at the flow waveform, which shows ${leakedWord}.`,
          },
          {
            helpLevelCap: 1,
            activeAbnormalities: [abn],
            learnerAttempt,
          }
        );
        expect(res.valid).toBe(false);
        expect(res.blockedByLeakage).toBe(true);
      }

      // Allowed once learner describes it
      const describedAttempt = {
        ...learnerAttempt,
        observation: 'Expiratory flow does not reach zero before next breath causing auto-PEEP.',
      };
      const allowedRes = validateTutorResponse(
        {
          ...validSample,
          message: 'Your observation about auto-PEEP aligns with the incomplete emptying.',
        },
        {
          helpLevelCap: 1,
          activeAbnormalities: ['auto_peep'],
          learnerAttempt: describedAttempt,
        }
      );
      expect(allowedRes.valid).toBe(true);
    });

    it('downgrades correct_justified to correct_superficial when learner uses jargon without causal connector', () => {
      const jargonAttempt = {
        observation: 'Plateau pressure is 34 cmH2O with tidal volume 550 mL.',
        mechanismHypothesis: 'Lower tidal volume to prevent biotrauma, atelectrauma, and pendelluft.',
        confidence: 'certain' as const,
        maneuversPerformed: ['inspiratory_hold' as const],
        attemptNumberInProblem: 1,
        latencyMs: 15000,
      };

      const res = validateTutorResponse(
        {
          ...validSample,
          reasoning_grade: 'correct_justified',
          message: 'Clarify how tidal volume affects alveolar wall stress.',
        },
        {
          helpLevelCap: 1,
          learnerAttempt: jargonAttempt,
        }
      );

      expect(res.valid).toBe(true);
      expect(res.jargonDowngraded).toBe(true);
      expect(res.sanitizedResponse?.reasoning_grade).toBe('correct_superficial');
      expect(res.sanitizedResponse?.needs_clarification).toBe(true);
    });

    it('rejects structural sycophancy on flawed learner reasoning and requires check question at v2 Level 3', () => {
      const sycoRes = validateTutorResponse(
        {
          ...validSample,
          reasoning_grade: 'wrong_conclusion_sound_parts',
          message: 'You nailed it with spot-on reasoning, though check the flow trace.',
        },
        {
          helpLevelCap: 1,
          learnerPredictionCorrect: false,
        }
      );
      expect(sycoRes.valid).toBe(false);
      expect(sycoRes.reason).toContain('Structural sycophancy');

      const l3NoQ = validateTutorResponse(
        {
          ...validSample,
          help_level_used: 3,
          question: null,
        },
        {
          helpLevelCap: 3,
          requestKind: 'explain',
          promptVersion: 'v2',
        }
      );
      expect(l3NoQ.valid).toBe(false);
      expect(l3NoQ.reason).toContain('Level 3 responses in v2 must include');
    });
  });
});

describe('Tutor v3 persona worked examples', () => {
  const base = {
    help_level_used: 0 as const,
    needs_clarification: false,
    reasoning_grade: null,
    misconception_ids: [],
    claims: [],
    confidence: 0.9,
  };
  const examples: Array<[string, string]> = [
    [
      'Separating peak from plateau was the right move, and it tells you the problem is not resistance. You then said compliance has fallen.',
      'Which number on the screen supports that?',
    ],
    [
      'You tied the rising CO2 to the lower rate, which is correct arithmetic. Look at the flow trace at end-expiration before you raise the rate again.',
      'What does it tell you about the next breath?',
    ],
  ];
  it.each(examples)('accepts specific acknowledgement: %s', (message, question) => {
    const res = validateTutorResponse({ ...base, message, question }, { helpLevelCap: 3 });
    expect(res.valid).toBe(true);
  });
});
