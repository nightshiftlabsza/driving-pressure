export const TUTOR_JSON_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    help_level_used: { type: 'integer', enum: [0, 1, 2, 3] },
    question: { type: ['string', 'null'] },
    needs_clarification: { type: 'boolean' },
    reasoning_grade: {
      type: ['string', 'null'],
      enum: [
        'correct_justified',
        'correct_superficial',
        'correct_conclusion_wrong_reasoning',
        'wrong_conclusion_sound_parts',
        'unsupported_assumption',
        'specific_misconception',
        'too_ambiguous',
        null,
      ],
    },
    misconception_ids: {
      type: 'array',
      items: { type: 'string' },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          evidence_level: {
            type: 'string',
            enum: ['physiology', 'guideline', 'trial', 'expert_opinion', 'uncertain'],
          },
        },
        required: ['text', 'evidence_level'],
      },
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: [
    'message',
    'help_level_used',
    'needs_clarification',
    'misconception_ids',
    'claims',
    'confidence',
  ],
};

export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    message: { type: 'STRING' },
    help_level_used: { type: 'INTEGER' },
    question: { type: 'STRING', nullable: true },
    needs_clarification: { type: 'BOOLEAN' },
    reasoning_grade: { type: 'STRING', nullable: true },
    misconception_ids: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    claims: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          text: { type: 'STRING' },
          evidence_level: { type: 'STRING' },
        },
        required: ['text', 'evidence_level'],
      },
    },
    confidence: { type: 'NUMBER' },
  },
  required: [
    'message',
    'help_level_used',
    'needs_clarification',
    'misconception_ids',
    'claims',
    'confidence',
  ],
};
