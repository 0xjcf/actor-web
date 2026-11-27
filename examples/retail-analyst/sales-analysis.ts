export type SalesIncrease = {
  date: string;
  amount_before_increase: number;
  amount_after_increase: number;
  percentage_increase: number;
};

export type MaximumSalesIncrease =
  | { status: 'found'; increase: SalesIncrease }
  | {
      status: 'unavailable';
      code:
        | 'INSUFFICIENT_SALES_DATA'
        | 'INVALID_SALES_DATA'
        | 'NON_CONSECUTIVE_SALES_DATES'
        | 'ZERO_SALES_BASELINE'
        | 'NO_SALES_INCREASE';
    };

/** Compare all daily pairs without mutating input; exact ratio ties keep the earliest date. */
export function findLargestSalesIncrease(
  records: readonly { date: string; quantity: number }[]
): MaximumSalesIncrease {
  if (records.length < 2) return { status: 'unavailable', code: 'INSUFFICIENT_SALES_DATA' };
  for (const row of records) {
    const timestamp = Date.parse(row.date);
    if (
      !Number.isSafeInteger(row.quantity) ||
      row.quantity < 0 ||
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== row.date
    ) {
      return { status: 'unavailable', code: 'INVALID_SALES_DATA' };
    }
  }
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  let best: { before: number; after: number; date: string } | undefined;
  for (let index = 1; index < sorted.length; index++) {
    const before = sorted[index - 1];
    const after = sorted[index];
    if (Date.parse(after.date) - Date.parse(before.date) !== 86_400_000) {
      return { status: 'unavailable', code: 'NON_CONSECUTIVE_SALES_DATES' };
    }
    if (before.quantity === 0) return { status: 'unavailable', code: 'ZERO_SALES_BASELINE' };
    if (after.quantity <= before.quantity) continue;
    // Compare integer ratios before rounding, avoiding ties introduced by display precision.
    if (
      !best ||
      BigInt(after.quantity - before.quantity) * BigInt(best.before) >
        BigInt(best.after - best.before) * BigInt(before.quantity)
    ) {
      best = { before: before.quantity, after: after.quantity, date: after.date };
    }
  }
  if (!best) return { status: 'unavailable', code: 'NO_SALES_INCREASE' };
  return {
    status: 'found',
    increase: {
      date: best.date,
      amount_before_increase: best.before,
      amount_after_increase: best.after,
      percentage_increase: Math.round(((best.after - best.before) / best.before) * 10_000) / 100,
    },
  };
}
