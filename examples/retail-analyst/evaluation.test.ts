import { describe, expect, it } from 'vitest';
import { evaluateAnalysis, expectedStages } from './evaluation.js';
import { checkAdvisory, prepareEvidence, prepareSales } from './evidence.js';
import { sales, weather } from './fixtures.js';

describe('pure evidence and evaluation', () => {
  it('replays observed facts deterministically without mutating inputs', () => {
    const original = structuredClone(sales);
    const first = prepareSales('P005', original);
    expect(first).toEqual(prepareSales('P005', original));
    expect(original).toEqual(sales);
    if (!first.ok) throw new Error('Expected fixture increase.');
    const evidence = prepareEvidence({ productId: 'P005' }, first.value, weather[2]);
    expect(evidence).toEqual(prepareEvidence({ productId: 'P005' }, first.value, weather[2]));
    if (!evidence.ok) throw new Error('Expected fixture evidence.');
    expect(
      checkAdvisory({ hypotheses: [], causation: 'not-established' }, evidence.value)
    ).toBeUndefined();
  });

  it('distinguishes numeric accuracy and completed steps from semantic quality', () => {
    const analysis = {
      date: '2024-01-12',
      amount_before_increase: 114,
      amount_after_increase: 342,
      percentage_increase: 200,
      causes: ['Customers bought umbrellas because of 2.7 inches of rain.'],
    };
    const checks = evaluateAnalysis(
      'baseline',
      analysis,
      expectedStages.map((name) => ({ name }))
    );
    expect(checks).toMatchObject({
      numericCorrect: true,
      requiredStagesInOrder: true,
      semanticQuality: 'requires-review',
      mechanicalIndicators: {
        precipitationUnitMention: true,
        customerOrProductMechanismMention: true,
        uncertaintyLanguage: false,
      },
    });
  });

  it('does not give failed runs or missing observations a passing score', () => {
    expect(evaluateAnalysis('candidate', undefined, [])).toMatchObject({
      numericCorrect: false,
      requiredStagesInOrder: false,
      abstained: false,
    });
  });
});
