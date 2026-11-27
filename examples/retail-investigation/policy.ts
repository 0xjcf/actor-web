import {
  type Assessment,
  calculateSpike,
  hasRecoveryEvidence,
  hasWeatherAssociationEvidence,
  type Observation,
  recordsOf,
  type Source,
} from './evidence.js';
import type { Reconciliation } from './reconciliation.js';

/** Transparent illustrative rules, not a causal model or an evaluation oracle. */
export function assessEvidence(
  observations: readonly Observation[],
  compact?: Reconciliation
): Assessment {
  const findings: Assessment['findings'] = [];
  const spike = compact?.spike ?? calculateSpike(observations);
  if (spike.status === 'found') {
    const { date, amount_after_increase: after } = spike.increase;
    const orders = recordsOf(observations, 'read_orders').filter(
      (r) => r.date === date && !r.cancelled
    );
    const summary = compact?.orders.availability === 'available' ? compact.orders : undefined;
    if (
      summary
        ? summary.current.repeatedIdRows > 0
        : new Set(orders.map((r) => r.orderId)).size < orders.length
    ) {
      findings.push({
        kind: 'duplicate-records',
        explanation:
          'Repeated order identifiers inflate the recorded total. Reconcile these rows before interpreting the spike as demand.',
        evidence: ['read_sales', 'read_orders'],
      });
    } else if (
      summary
        ? summary.salesTotalsMatch && summary.current.largestOrderRowUnits > after / 2
        : orders.some((r) => r.units > after / 2)
    ) {
      findings.push({
        kind: 'order-concentration',
        explanation:
          'One order accounts for more than half the spike-day units; broad customer demand is not established.',
        evidence: ['read_sales', 'read_orders'],
      });
    }
    if (hasRecoveryEvidence(observations, date)) {
      findings.push({
        kind: 'availability-recovery',
        explanation:
          'Replenishment followed recorded stockouts. Restored availability is a possible explanation, not proof of increased underlying demand.',
        evidence: ['read_sales', 'read_inventory'],
      });
    }
    const sales = recordsOf(observations, 'read_sales');
    const price = sales.find((r) => r.date === date)?.unitPrice;
    if (
      recordsOf(observations, 'read_promotions').some(
        (r) => r.date === date && r.discountPercent > 0
      ) &&
      (compact
        ? compact.spikeUnitPrice < compact.priorUnitPrice
        : price !== undefined && sales.some((r) => r.date < date && r.unitPrice > price))
    ) {
      findings.push({
        kind: 'promotion',
        explanation:
          'A campaign and lower unit price coincide with the spike. This supports a promotion hypothesis, not a causal estimate.',
        evidence: ['read_sales', 'read_promotions'],
      });
    }
    if (hasWeatherAssociationEvidence(observations, date)) {
      findings.push({
        kind: 'weather-association',
        explanation:
          'Rainfall exceeds three times the supplied daily reference and coincides with the spike; a demand mechanism is unknown.',
        evidence: ['read_sales', 'read_weather'],
      });
    }
  }
  const confounded =
    findings.some((f) => f.kind === 'promotion') &&
    findings.some((f) => f.kind === 'weather-association');
  const unavailable = observations.filter((o) => o.availability === 'unavailable');
  return {
    status: confounded ? 'confounded' : findings.length ? 'supported' : 'insufficient-evidence',
    findings,
    limitations: [
      'Observational synthetic records do not establish causal effects. Unread sources remain unknown.',
      ...(confounded ? ['Promotion and weather contributions cannot be separated here.'] : []),
      ...(unavailable.length || compact?.orders.availability === 'unavailable'
        ? ['Some requested sources were unavailable, not negative evidence.']
        : []),
    ],
    nextQuestion: findings.some((f) => f.kind === 'duplicate-records')
      ? 'Can the order owner reconcile duplicate identifiers against the original transactions?'
      : 'Can matched untreated stores or a controlled comparison distinguish the competing explanations?',
    causation: 'not-established',
  };
}

/** Scripted candidate policy for offline wiring only. The live model owns the follow-up decision. */
export function nextHybridSource(
  compact: Reconciliation,
  followups: readonly Observation[]
): Source | undefined {
  const seen = new Set(followups.map((o) => o.source));
  const priceDrop = compact.spikeUnitPrice < compact.priorUnitPrice;
  if (priceDrop && !seen.has('read_promotions')) return 'read_promotions';
  const { findings } = assessEvidence(followups, compact);
  if (findings.some((f) => f.kind === 'promotion') && !seen.has('read_weather'))
    return 'read_weather';
  if (findings.length) return undefined;
  return (['read_inventory', 'read_promotions', 'read_weather'] as const).find((s) => !seen.has(s));
}

/** Rules stop on direct order or availability evidence; this may miss coexisting explanations. */
export function nextSource(observations: readonly Observation[]): Source | undefined {
  const seen = new Set(observations.map((o) => o.source));
  if (!seen.has('read_sales')) return 'read_sales';
  if (!seen.has('read_orders')) return 'read_orders';
  const assessment = assessEvidence(observations);
  if (
    assessment.findings.some((f) =>
      ['duplicate-records', 'order-concentration', 'availability-recovery'].includes(f.kind)
    )
  ) {
    return undefined;
  }
  return (
    ['read_inventory', 'read_promotions', 'read_weather', 'read_comparison_sales'] as const
  ).find((source) => !seen.has(source));
}
