import type { Assessment, Source } from './evidence.js';
import type { CaseId, SelectionCase } from './fixtures.js';

/** Evaluation-only expectations. Never imported by investigator, policy, or provider. */
export const expectations: {
  [K in CaseId]: { status: Assessment['status']; kinds: Assessment['findings'][number]['kind'][] };
} = {
  promotion: { status: 'supported', kinds: ['promotion'] },
  restocking: { status: 'supported', kinds: ['availability-recovery'] },
  'bulk-order': { status: 'supported', kinds: ['order-concentration'] },
  'data-defect': { status: 'supported', kinds: ['duplicate-records'] },
  confounded: { status: 'confounded', kinds: ['promotion', 'weather-association'] },
  insufficient: { status: 'insufficient-evidence', kinds: [] },
  'mixed-order-promotion': { status: 'supported', kinds: ['order-concentration', 'promotion'] },
  'partial-availability': { status: 'supported', kinds: ['weather-association'] },
  'alert-wet': { status: 'confounded', kinds: ['promotion', 'weather-association'] },
  'volume-offer': { status: 'supported', kinds: ['promotion', 'order-concentration'] },
  'alert-normal': { status: 'supported', kinds: ['promotion'] },
};

// The campaign audience is a lead, not a finding. Even a disconfirmed lead is informative.
const selectionProbe = {
  'alert-wet': 'read_weather',
  'volume-offer': 'read_orders',
  'alert-normal': 'read_weather',
} as const satisfies Record<SelectionCase, Source>;

export function selectionChecks(id: CaseId, reads: readonly Source[]) {
  if (!Object.hasOwn(selectionProbe, id)) return undefined;
  const probe = selectionProbe[id as SelectionCase];
  return {
    probe,
    covered: ['read_sales', 'read_promotions', probe].every((s) => reads.some((r) => r === s)),
    cueThenProbe:
      reads.indexOf('read_promotions') >= 0 &&
      reads.indexOf(probe) > reads.indexOf('read_promotions'),
  };
}

export function evaluateResult(
  caseId: CaseId,
  result: {
    facts: {
      spike: {
        date: string;
        amount_before_increase: number;
        amount_after_increase: number;
        percentage_increase: number;
      };
    };
    assessment: Assessment;
  }
) {
  const expected = expectations[caseId];
  const kinds = result.assessment.findings.map((f) => f.kind).sort();
  const { spike } = result.facts;
  return {
    numericCorrect:
      spike.date === '2025-02-03' &&
      spike.amount_before_increase ===
        (Object.hasOwn(selectionProbe, caseId) ? 80 : caseId === 'restocking' ? 10 : 100) &&
      spike.amount_after_increase === (Object.hasOwn(selectionProbe, caseId) ? 240 : 300) &&
      spike.percentage_increase === (caseId === 'restocking' ? 2900 : 200),
    statusMatchesFixture: result.assessment.status === expected.status,
    findingKindsMatchFixture: JSON.stringify(kinds) === JSON.stringify([...expected.kinds].sort()),
    extraKinds: kinds.filter((k) => !expected.kinds.includes(k)),
    missedKinds: expected.kinds.filter((k) => !kinds.includes(k)),
    semanticQuality: 'requires-review',
  };
}
