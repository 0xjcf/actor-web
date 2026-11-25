import type { Assessment, Source } from './evidence.js';

export const synthesisSources = [
  'read_sales',
  'read_promotions',
  'read_weather',
] as const satisfies readonly Source[];
export const synthesisPrompts = ['rule-only', 'one-shot'] as const;
export type SynthesisPrompt = (typeof synthesisPrompts)[number];

// The example uses the output contract but none of the tested finding labels or evidence sources.
const libraryAnswer: Assessment = {
  status: 'supported',
  findings: [
    {
      kind: 'duplicate-records',
      explanation:
        'Two booking rows share an identifier. Reconcile them before treating them as distinct bookings.',
      evidence: ['read_orders'],
    },
  ],
  limitations: [
    'Equipment downtime was zero hours, its usual value. The availability record does not support a recovery.',
  ],
  nextQuestion: 'Does the original booking ledger contain two bookings or one repeated entry?',
  causation: 'not-established',
};
export const workedExample = [
  'Illustrative library equipment-booking audit, not evidence for this assignment:',
  'Input: read_orders reports two bookings with the same booking ID. read_inventory reports zero hours of downtime, the same as its reference.',
  `Output: ${JSON.stringify(libraryAnswer)}`,
].join('\n');
