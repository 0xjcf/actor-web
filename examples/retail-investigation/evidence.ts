import { z } from 'zod';
import { findLargestSalesIncrease } from '../retail-analyst/sales-analysis.js';

export const sources = [
  'read_sales',
  'read_promotions',
  'read_inventory',
  'read_weather',
  'read_orders',
  'read_comparison_sales',
] as const;
export const Source = z.enum(sources);
export type Source = z.infer<typeof Source>;
export const Scope = z
  .strictObject({
    productId: z.string().min(1),
    storeId: z.string().min(1),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
  })
  .refine((s) => s.startDate < s.endDate, 'Expected an increasing date range.');
export type Scope = z.infer<typeof Scope>;
const base = {
  id: z.string().min(1),
  productId: z.string().min(1),
  storeId: z.string().min(1),
  date: z.iso.date(),
};
export const Record = z.discriminatedUnion('kind', [
  z.strictObject({
    ...base,
    kind: z.literal('read_sales'),
    units: z.number().int().nonnegative(),
    unitPrice: z.number().nonnegative(),
    revenue: z.number().nonnegative(),
    channel: z.enum(['online', 'store']),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('read_promotions'),
    campaignId: z.string().min(1),
    discountPercent: z.number().min(0).max(100),
    audience: z.string().min(1),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('read_inventory'),
    closingUnits: z.number().int().nonnegative(),
    receivedUnits: z.number().int().nonnegative(),
    stockoutHours: z.number().min(0).max(24),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('read_weather'),
    conditions: z.string().min(1),
    precipitationMm: z.number().nonnegative(),
    referenceDailyPrecipitationMm: z.number().nonnegative(),
    referencePeriod: z.string().min(1),
    temperatureC: z.number(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('read_orders'),
    orderId: z.string().min(1),
    units: z.number().int().positive(),
    cancelled: z.boolean(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('read_comparison_sales'),
    comparisonProductId: z.string().min(1),
    units: z.number().int().nonnegative(),
  }),
]);
export type Record = z.infer<typeof Record>;
export const Packet = z.strictObject({
  source: Source,
  scope: Scope,
  availability: z.enum(['available', 'unavailable']),
  reason: z.string().nullable(),
  records: z.array(Record),
});
export type Packet = z.infer<typeof Packet>;
export type Observation = Packet;
export type DataPort = (source: Source, scope: Scope, signal: AbortSignal) => Promise<unknown>;

export function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.productId === b.productId &&
    a.storeId === b.storeId &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate
  );
}

/** Pure boundary validation. No scenario answer or fixture imports. */
export function validatePacket(raw: unknown, source: Source, scope: Scope): Packet {
  const packet = Packet.parse(raw);
  if (
    packet.source !== source ||
    !sameScope(packet.scope, scope) ||
    packet.records.some(
      (r) =>
        r.kind !== source ||
        r.productId !== scope.productId ||
        r.storeId !== scope.storeId ||
        r.date < scope.startDate ||
        r.date > scope.endDate
    )
  ) {
    throw new Error('DATA_SCOPE_MISMATCH');
  }
  if (packet.availability === 'unavailable' && (!packet.reason || packet.records.length !== 0)) {
    throw new Error('INVALID_UNAVAILABLE_DATA');
  }
  if (new Set(packet.records.map((r) => r.id)).size !== packet.records.length) {
    throw new Error('DUPLICATE_RECORD_ID');
  }
  return packet;
}

export function recordsOf<K extends Source>(
  observations: readonly Observation[],
  source: K
): Extract<Record, { kind: K }>[] {
  return observations
    .filter((o) => o.source === source && o.availability === 'available')
    .flatMap((o) => o.records)
    .filter((r): r is Extract<Record, { kind: K }> => r.kind === source);
}

export function calculateSpike(observations: readonly Observation[]) {
  return findLargestSalesIncrease(
    recordsOf(observations, 'read_sales').map((r) => ({
      date: r.date,
      quantity: r.units,
    }))
  );
}

/** Evidence of a prior constraint and spike-day replenishment, not proof of causation. */
export function hasRecoveryEvidence(
  observations: readonly Observation[],
  spikeDate: string
): boolean {
  const inventory = recordsOf(observations, 'read_inventory');
  return (
    inventory.some((r) => r.date < spikeDate && r.stockoutHours > 0) &&
    inventory.some((r) => r.date === spikeDate && r.receivedUnits > 0)
  );
}

const rainfallReferenceMultiple = 3;
export const weatherEvidenceRequirement = `A weather-association finding requires cited read_weather records with positive spike-day precipitation strictly greater than ${rainfallReferenceMultiple} times the supplied daily reference.`;

/** Eligibility for this example's rainfall label, not a test of causation. */
export function hasWeatherAssociationEvidence(
  observations: readonly Observation[],
  spikeDate: string
): boolean {
  return recordsOf(observations, 'read_weather').some(
    (r) =>
      r.date === spikeDate &&
      r.precipitationMm > 0 &&
      r.precipitationMm > rainfallReferenceMultiple * r.referenceDailyPrecipitationMm
  );
}

export const FindingKind = z.enum([
  'promotion',
  'availability-recovery',
  'order-concentration',
  'duplicate-records',
  'weather-association',
]);
export const Assessment = z.strictObject({
  status: z.enum(['supported', 'confounded', 'insufficient-evidence']),
  findings: z
    .array(
      z.strictObject({
        kind: FindingKind,
        explanation: z.string().trim().min(1).max(600),
        evidence: z.array(Source).min(1).max(6),
      })
    )
    .max(5),
  limitations: z.array(z.string().trim().min(1).max(400)).min(1).max(6),
  nextQuestion: z.string().trim().min(1).max(400),
  causation: z.literal('not-established'),
});
export type Assessment = z.infer<typeof Assessment>;

/** Check citation membership and recovery/weather prerequisites; prose is not verified. */
export function checkAssessment(
  assessment: Assessment,
  observations: readonly Observation[]
): string | undefined {
  const spike = calculateSpike(observations);
  if (spike.status !== 'found' || observations.length < 2) {
    return 'Read sales and at least one investigative source before concluding.';
  }
  const available = new Set(
    observations.filter((o) => o.availability === 'available').map((o) => o.source)
  );
  for (const finding of assessment.findings) {
    if (
      new Set(finding.evidence).size !== finding.evidence.length ||
      finding.evidence.some((id) => !available.has(id))
    ) {
      return 'Citations must be unique observed available sources.';
    }
    if (
      finding.kind === 'availability-recovery' &&
      (!finding.evidence.includes('read_inventory') ||
        !hasRecoveryEvidence(observations, spike.increase.date))
    ) {
      return 'Availability recovery requires cited inventory showing a prior stockout and spike-day replenishment.';
    }
    if (
      finding.kind === 'weather-association' &&
      (!finding.evidence.includes('read_weather') ||
        !hasWeatherAssociationEvidence(observations, spike.increase.date))
    ) {
      return weatherEvidenceRequirement;
    }
  }
  if (new Set(assessment.findings.map((f) => f.kind)).size !== assessment.findings.length) {
    return 'Finding kinds must be unique.';
  }
  if (assessment.status === 'supported' && assessment.findings.length === 0) {
    return 'Supported assessments need a finding.';
  }
  if (assessment.status === 'confounded' && assessment.findings.length < 2) {
    return 'Confounded assessments need at least two competing findings.';
  }
  return undefined;
}
