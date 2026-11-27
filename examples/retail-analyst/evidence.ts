import { z } from 'zod';
import { findLargestSalesIncrease, type SalesIncrease } from './sales-analysis.js';

export const TaskInput = z.strictObject({ productId: z.literal('P005') });
export type Task = z.infer<typeof TaskInput>;
export type FactResult<T> = { ok: true; value: T } | { ok: false; code: string };

const Sale = z.object({
  product_id: z.string(),
  date: z.string(),
  quantity: z.number(),
});
const Weather = z.strictObject({
  date: z.iso.date(),
  temperature: z.strictObject({ fahrenheit: z.number(), celsius: z.number() }),
  conditions: z.strictObject({
    main: z.string(),
    precipitation: z.string(),
    precipitation_amount: z.number().nonnegative(),
    special_event: z.string().nullable(),
  }),
});

export type Evidence = {
  productId: Task['productId'];
  increase: SalesIncrease;
  weather: z.infer<typeof Weather>;
  precipitationUnit: 'unspecified';
};

/** Pure policy over observed sales; no imported fixtures or expected-answer oracle. */
export function prepareSales(productId: string, raw: unknown): FactResult<SalesIncrease> {
  const parsed = z.array(Sale).safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_SALES_DATA' };
  if (parsed.data.some((row) => row.product_id !== productId)) {
    return { ok: false, code: 'WRONG_PRODUCT' };
  }
  const maximum = findLargestSalesIncrease(parsed.data);
  return maximum.status === 'found'
    ? { ok: true, value: maximum.increase }
    : { ok: false, code: maximum.code };
}

/** Bind a weather observation to the calculated date, not a model-selected date. */
export function prepareEvidence(
  task: Task,
  increase: SalesIncrease,
  raw: unknown
): FactResult<Evidence> {
  const parsed = Weather.safeParse(raw);
  if (!parsed.success) return { ok: false, code: 'INVALID_WEATHER_DATA' };
  if (parsed.data.date !== increase.date) return { ok: false, code: 'WRONG_WEATHER_DATE' };
  return {
    ok: true,
    value: {
      productId: task.productId,
      increase: { ...increase },
      weather: parsed.data,
      precipitationUnit: 'unspecified',
    },
  };
}

const Reference = z.enum([
  'sales.maximum',
  'weather.conditions',
  'weather.precipitation',
  'weather.temperature',
  'weather.special_event',
]);
export const Advisory = z.strictObject({
  hypotheses: z
    .array(
      z.strictObject({
        explanation: z.string().trim().min(1).max(500),
        evidence: z.array(Reference).min(1).max(5),
      })
    )
    .max(3),
  causation: z.literal('not-established'),
});
export type Advisory = z.infer<typeof Advisory>;

export function evidenceReferences(facts: Evidence): z.infer<typeof Reference>[] {
  return [
    'sales.maximum',
    'weather.conditions',
    'weather.precipitation',
    'weather.temperature',
    ...(facts.weather.conditions.special_event === null ? [] : ['weather.special_event' as const]),
  ];
}

/** Checks reference membership, not whether a cited observation proves the hypothesis. */
export function checkAdvisory(advisory: Advisory, facts: Evidence): string | undefined {
  const available = new Set(evidenceReferences(facts));
  for (const hypothesis of advisory.hypotheses) {
    if (new Set(hypothesis.evidence).size !== hypothesis.evidence.length) {
      return 'Evidence references must be unique.';
    }
    if (hypothesis.evidence.some((reference) => !available.has(reference))) {
      return 'A hypothesis cites unavailable evidence.';
    }
  }
  return undefined;
}
