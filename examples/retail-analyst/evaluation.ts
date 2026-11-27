import { z } from 'zod';
import { Advisory } from './evidence.js';

const Numbers = z.object({
  date: z.string(),
  amount_before_increase: z.number(),
  amount_after_increase: z.number(),
  percentage_increase: z.number(),
});
const Baseline = Numbers.extend({ causes: z.array(z.string()) });
const Candidate = z.object({ facts: z.object({ increase: Numbers }), advisory: Advisory });
export type Variant = 'baseline' | 'candidate';
export const expectedStages = ['get_sales_data', 'find_largest_sales_increase', 'call_weather_api'];

export const narrativeRubric = {
  grounding:
    '0: unsupported asserted facts; 1: speculative mechanisms beyond evidence; 2: observations and limits accurately separated, no invented facts or units.',
  uncertainty:
    '0: causal certainty; 1: hedging without clear limitation; 2: explicitly states causation is unestablished.',
  usefulness:
    '0: misleading or irrelevant; 1: accurate association/abstention but no discriminating explanation; 2: specific evidence-linked insight or testable next question without fabrication.',
  procedure:
    'Review every full candidate, including rejected outputs. Score each axis separately (0–2), cite text, and do not treat reference membership or regex indicators as semantic quality.',
};

/** Fixed-fixture oracle and mechanical indicators, deliberately not a semantic quality judge. */
export function evaluateAnalysis(
  variant: Variant,
  analysis: unknown,
  observations: readonly { name: string }[]
) {
  const candidate = Candidate.safeParse(analysis);
  const baseline = Baseline.safeParse(analysis);
  const numbers =
    variant === 'candidate'
      ? candidate.success
        ? candidate.data.facts.increase
        : undefined
      : baseline.success
        ? baseline.data
        : undefined;
  const explanations =
    variant === 'candidate'
      ? candidate.success
        ? candidate.data.advisory.hypotheses.map((h) => h.explanation)
        : []
      : baseline.success
        ? baseline.data.causes
        : [];
  const text = explanations.join(' ');
  return {
    numericCorrect:
      numbers !== undefined &&
      numbers.date === '2024-01-12' &&
      numbers.amount_before_increase === 114 &&
      numbers.amount_after_increase === 342 &&
      numbers.percentage_increase === 200,
    requiredStagesInOrder:
      observations.length === expectedStages.length &&
      expectedStages.every((name, index) => observations[index].name === name),
    hypothesesCount: explanations.length,
    abstained: variant === 'candidate' && candidate.success && explanations.length === 0,
    mechanicalIndicators: {
      precipitationUnitMention: /\b(?:inch(?:es)?|millimet(?:er|re)s?|mm)\b/i.test(text),
      customerOrProductMechanismMention:
        /\b(?:stock(?:ing)? up|stockpil\w*|customer\w*|consumer\w*|store\w*|weather.sensitive|umbrella\w*|raincoat\w*|emergency suppl\w*)\b/i.test(
          text
        ),
      uncertaintyLanguage:
        /\b(?:may|might|could|hypothes\w*|unconfirmed|cannot establish|does not establish|not established)\b/i.test(
          text
        ),
    },
    semanticQuality: 'requires-review',
  };
}
