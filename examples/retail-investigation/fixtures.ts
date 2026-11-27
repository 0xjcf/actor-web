import type { DataPort, Packet, Record, Scope, Source } from './evidence.js';
import { sources } from './evidence.js';

export const controlCaseIds = [
  'promotion',
  'restocking',
  'bulk-order',
  'data-defect',
  'confounded',
  'insufficient',
] as const;
export const hybridCaseIds = [
  ...controlCaseIds,
  'mixed-order-promotion',
  'partial-availability',
] as const;
export const selectionCaseIds = ['alert-wet', 'volume-offer', 'alert-normal'] as const;
export type SelectionCase = (typeof selectionCaseIds)[number];
export const caseIds = [...hybridCaseIds, ...selectionCaseIds] as const;
export type CaseId = (typeof caseIds)[number];
export const scope: Scope = {
  productId: 'P005',
  storeId: 'S001',
  startDate: '2025-02-01',
  endDate: '2025-02-03',
};
const dates = ['2025-02-01', '2025-02-02', '2025-02-03'];
export type Dataset = { [K in Source]: Packet };

/** Synthetic records only. Case selection is host configuration, never model task content. */
export function createDataset(caseId: CaseId): Dataset {
  const dataset = Object.fromEntries(
    sources.map((source): [Source, Packet] => [
      source,
      { source, scope: { ...scope }, availability: 'available', reason: null, records: [] },
    ])
  ) as Dataset;
  const add = (record: Record) => dataset[record.kind].records.push(record);
  const alert = caseId === 'alert-wet' || caseId === 'alert-normal';
  const volume = caseId === 'volume-offer';
  const selection = alert || volume;
  const promotion =
    selection ||
    caseId === 'promotion' ||
    caseId === 'confounded' ||
    caseId === 'mixed-order-promotion';
  const storm =
    caseId === 'confounded' || caseId === 'partial-availability' || caseId === 'alert-wet';
  const before = caseId === 'restocking' ? 10 : selection ? 80 : 100;
  const after = selection ? 240 : 300;
  for (const [index, date] of dates.entries()) {
    const spikeDay = index === 2;
    const units = spikeDay ? after : before;
    const unitPrice = selection ? (spikeDay ? 9 : 12) : spikeDay && promotion ? 8 : 10;
    const common = { productId: scope.productId, storeId: scope.storeId, date };
    add({
      ...common,
      kind: 'read_sales',
      id: `sales-${index}`,
      units,
      unitPrice,
      revenue: units * unitPrice,
      channel: 'store',
    });
    add({
      ...common,
      kind: 'read_inventory',
      id: `inventory-${index}`,
      closingUnits: caseId === 'restocking' && !spikeDay ? 0 : 500,
      receivedUnits: caseId === 'restocking' && spikeDay ? 800 : units,
      stockoutHours: caseId === 'restocking' && !spikeDay ? 8 : 0,
    });
    add({
      ...common,
      kind: 'read_weather',
      id: `weather-${index}`,
      conditions: storm && spikeDay ? 'Heavy rain' : 'Light rain',
      precipitationMm: storm && spikeDay ? 50 : 2,
      referenceDailyPrecipitationMm: 2,
      referencePeriod: 'Synthetic prior 30 days',
      temperatureC: 15,
    });
    add({
      ...common,
      kind: 'read_comparison_sales',
      id: `comparison-${index}`,
      comparisonProductId: 'P006',
      units: 100,
    });
    if (spikeDay && promotion) {
      add({
        ...common,
        kind: 'read_promotions',
        id: 'campaign-row',
        campaignId: 'C042',
        discountPercent: selection ? 25 : 20,
        audience: alert
          ? 'Subscribers to local heavy-rain alerts'
          : volume
            ? 'Trade accounts purchasing in pallet quantities'
            : 'All store customers',
      });
    }
    const orderUnits =
      spikeDay && (volume || caseId === 'bulk-order' || caseId === 'mixed-order-promotion')
        ? [...Array<number>(before / 10).fill(10), after - before]
        : Array<number>(units / 10).fill(10);
    for (const [orderIndex, orderQuantity] of orderUnits.entries()) {
      add({
        ...common,
        kind: 'read_orders',
        id: `order-row-${index}-${orderIndex}`,
        orderId: `order-${index}-${spikeDay && caseId === 'data-defect' ? orderIndex % 10 : orderIndex}`,
        units: orderQuantity,
        cancelled: false,
      });
    }
  }
  for (const source of sources) {
    if (
      (caseId === 'insufficient' && source !== 'read_sales') ||
      (caseId === 'partial-availability' &&
        (source === 'read_orders' || source === 'read_inventory'))
    ) {
      dataset[source] = {
        ...dataset[source],
        availability: 'unavailable',
        reason: 'Records were not retained for the requested period.',
        records: [],
      };
    }
  }
  return dataset;
}

/** Detached per-assignment snapshots; scope enforcement remains in application policy. */
export function createMockPort(dataset: Dataset): DataPort {
  const snapshot = structuredClone(dataset);
  return async (source, _scope, signal) => {
    signal.throwIfAborted();
    return structuredClone(snapshot[source]);
  };
}
