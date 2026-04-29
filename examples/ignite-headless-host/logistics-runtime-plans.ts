import type {
  DispatcherCommand,
  DriverDirectoryCommand,
  ProviderHqCommand,
  ProviderSignal,
  ProviderSignalCommand,
  RoutePlan,
  ShipmentCommand,
  ShipmentContext,
} from './logistics-contract';
import type { LifecycleMode } from './logistics-provider-hq';
import { providerSignalCommandType } from './logistics-provider-hq';
import { providerShipmentActorId } from './logistics-provider-shipment-behavior';

export interface ShipmentLifecycleInstanceParams {
  shipmentId: string;
}

export interface ProviderShipmentInstanceParams {
  shipmentId: string;
  shipment: ShipmentContext;
}

export interface ShipmentLifecycleDelays {
  labelMs: number;
  packedMs: number;
  shippedMs: number;
  terminalMs: number;
}

export interface ShipmentLifecycleSignalPlan {
  delayMs: number;
  signal: ProviderSignal;
  shipmentId: string;
}

export interface ProviderSyncPlan {
  ensureProviderShipmentActor: boolean;
  providerHqCommand: Extract<ProviderHqCommand, { type: 'UPSERT_PROVIDER_SHIPMENT' }> | null;
}

export function shipmentLifecycleActorId({ shipmentId }: ShipmentLifecycleInstanceParams): string {
  return `logistics-shipment-${shipmentId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export function providerShipmentInstanceId({ shipmentId }: ProviderShipmentInstanceParams): string {
  return providerShipmentActorId(shipmentId);
}

export type ProviderSignalPlan =
  | {
      ok: true;
      shipmentId: string;
      command: ProviderSignalCommand;
    }
  | {
      ok: false;
      reason: string;
    };

export function createProviderSyncPlan(shipment: ShipmentContext): ProviderSyncPlan {
  if (!shipment.shipmentId) {
    return {
      ensureProviderShipmentActor: false,
      providerHqCommand: null,
    };
  }

  return {
    ensureProviderShipmentActor: true,
    providerHqCommand: {
      type: 'UPSERT_PROVIDER_SHIPMENT',
      shipment,
    },
  };
}

export function createShipmentLifecyclePlan(input: {
  mode: LifecycleMode;
  shipmentId: string;
  delays: ShipmentLifecycleDelays;
  terminalSignal: Extract<ProviderSignal, 'DELIVERY_CONFIRMED' | 'RETURN_EXCEPTION'>;
}): ShipmentLifecycleSignalPlan[] {
  if (input.mode === 'manual') {
    return [];
  }

  return [
    {
      delayMs: input.delays.labelMs,
      signal: 'LABEL_SCANNED',
      shipmentId: input.shipmentId,
    },
    {
      delayMs: input.delays.packedMs,
      signal: 'PACKED_INTO_TRUCK',
      shipmentId: input.shipmentId,
    },
    {
      delayMs: input.delays.shippedMs,
      signal: 'OUTBOUND_SCAN',
      shipmentId: input.shipmentId,
    },
    {
      delayMs: input.delays.terminalMs,
      signal: input.terminalSignal,
      shipmentId: input.shipmentId,
    },
  ];
}

export function createProviderSignalPlan(input: {
  signal: ProviderSignal;
  explicitShipmentId?: string;
  selectedShipmentId?: string | null;
  activeShipmentId?: string | null;
  facility?: string;
  loadId?: string;
  note?: string;
}): ProviderSignalPlan {
  const shipmentId =
    input.explicitShipmentId ?? input.selectedShipmentId ?? input.activeShipmentId ?? null;
  if (!shipmentId) {
    return {
      ok: false,
      reason: 'No active shipment is available for provider signal.',
    };
  }

  return {
    ok: true,
    shipmentId,
    command: {
      type: providerSignalCommandType(input.signal),
      shipmentId,
      facility: input.facility,
      loadId: input.loadId,
      note: input.note,
    },
  };
}

export function createDispatchShipmentCommand(input: {
  shipmentId: string;
  destination: string;
  reference?: string;
}): Extract<DispatcherCommand, { type: 'DISPATCH_SHIPMENT' }> {
  return {
    type: 'DISPATCH_SHIPMENT',
    shipmentId: input.shipmentId,
    destination: input.destination,
    reference: input.reference,
  };
}

export function createRoutePlanCommand(input: {
  shipmentId: string;
  destination: string;
  reference?: string;
}): Extract<ShipmentCommand, { type: 'PLAN_ROUTE' }> {
  return {
    type: 'PLAN_ROUTE',
    shipmentId: input.shipmentId,
    destination: input.destination,
    reference: input.reference,
  };
}

export function createDriverAssignmentCommand(input: {
  shipmentId: string;
  plan: RoutePlan;
  destination: string;
}): DriverDirectoryCommand {
  return {
    type: 'ASSIGN_DRIVER',
    shipmentId: input.shipmentId,
    carrier: input.plan.carrier,
    destination: input.destination,
  };
}

export function createRouteAssignmentRecordCommand(input: {
  plan: RoutePlan;
  driverId: string;
}): Extract<DispatcherCommand, { type: 'RECORD_ROUTE_ASSIGNMENT' }> {
  return {
    type: 'RECORD_ROUTE_ASSIGNMENT',
    plan: input.plan,
    driverId: input.driverId,
  };
}
