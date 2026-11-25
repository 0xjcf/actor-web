import { calculateSpike, type Observation, recordsOf } from './evidence.js';

/** Project already validated packets, not hidden case labels. Repeated IDs are a signal, not permission to deduplicate sales. */
export function reconcile(observations: readonly Observation[]) {
  const spike = calculateSpike(observations);
  if (spike.status !== 'found') throw new Error('Reconciliation requires a verified sales spike.');
  const { date, amount_before_increase: before, amount_after_increase: after } = spike.increase;
  const sales = recordsOf(observations, 'read_sales').sort((a, b) => a.date.localeCompare(b.date));
  const index = sales.findIndex((r) => r.date === date);
  const prior = sales[index - 1];
  const deltaUnits = after - before;
  const orderPacket = observations.find((o) => o.source === 'read_orders');
  if (!orderPacket) throw new Error('Reconciliation requires an attempted orders read.');
  const rows = recordsOf([orderPacket], 'read_orders').filter((r) => !r.cancelled);
  const day = (key: string) => {
    const matching = rows.filter((r) => r.date === key);
    const distinct = new Set(matching.map((r) => r.orderId)).size;
    return {
      rows: matching.length,
      distinctOrderIds: distinct,
      repeatedIdRows: matching.length - distinct,
      units: matching.reduce((sum, r) => sum + r.units, 0),
      largestOrderRowUnits: matching.reduce((max, r) => Math.max(max, r.units), 0),
    };
  };
  const previous = day(prior.date);
  const current = day(date);
  const salesTotalsMatch = previous.units === before && current.units === after;
  const orders =
    orderPacket.availability === 'unavailable'
      ? { availability: 'unavailable' as const, reason: orderPacket.reason }
      : {
          availability: 'available' as const,
          previous,
          current,
          salesTotalsMatch,
          // A compositional difference, not an estimate of demand without that purchase.
          residualDeltaExcludingLargestRow:
            salesTotalsMatch && current.rows && !current.repeatedIdRows
              ? deltaUnits - current.largestOrderRowUnits
              : null,
        };
  return {
    spike,
    deltaUnits,
    previousDate: prior.date,
    priorUnitPrice: prior.unitPrice,
    spikeUnitPrice: sales[index].unitPrice,
    orders,
  };
}

export type Reconciliation = ReturnType<typeof reconcile>;

/** Initial routing only. A synthesis-only readout describes composition or a data issue, not cause. */
export function synthesisReason(summary: Reconciliation) {
  const { orders } = summary;
  if (
    summary.spikeUnitPrice !== summary.priorUnitPrice ||
    orders.availability !== 'available' ||
    !orders.salesTotalsMatch ||
    !orders.previous.rows ||
    orders.previous.repeatedIdRows !== 0
  )
    return undefined;
  if (orders.current.repeatedIdRows > 0) return 'repeated-spike-day-ids';
  if (
    orders.residualDeltaExcludingLargestRow === 0 &&
    orders.current.largestOrderRowUnits > orders.previous.largestOrderRowUnits &&
    orders.current.largestOrderRowUnits > orders.current.units / 2
  )
    return 'large-order-reconciles-increase';
  return undefined;
}
