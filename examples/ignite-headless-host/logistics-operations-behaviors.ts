import { defineActor } from '@actor-core/runtime/browser';
import {
  createInitialDispatcherContext,
  createInitialDriverDirectoryContext,
  createInitialLogisticsSupervisorContext,
  type DispatcherCommand,
  type DispatcherEvent,
  type DriverDirectoryCommand,
  type DriverDirectoryEvent,
  type LogisticsSupervisorCommand,
  type LogisticsSupervisorEvent,
} from './logistics-contract';

function driverIdForShipment(shipmentId: string): string {
  const suffix =
    shipmentId
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-5)
      .toUpperCase() || '00000';
  return `driver-${suffix}`;
}

export function createLogisticsSupervisorBehavior() {
  return defineActor<LogisticsSupervisorCommand, LogisticsSupervisorEvent>()
    .withContext(createInitialLogisticsSupervisorContext())
    .onMessage(({ context, message }) => {
      if (message.type === 'OBSERVE_SHIPMENT_CREATED') {
        const decision = `Supervisor accepted shipment ${message.shipmentId} into active operations.`;
        return {
          context: {
            ...context,
            activeShipments: context.activeShipments + 1,
            lastDecision: decision,
          },
          emit: [{ type: 'LOGISTICS_SUPERVISOR_DECISION_RECORDED', decision }],
        };
      }

      if (message.type === 'OBSERVE_SHIPMENT_EXCEPTION') {
        const decision = `Supervisor escalated ${message.shipmentId}: ${message.reason}`;
        return {
          context: {
            ...context,
            exceptions: context.exceptions + 1,
            lastDecision: decision,
          },
          emit: [{ type: 'LOGISTICS_SUPERVISOR_DECISION_RECORDED', decision }],
        };
      }

      if (message.type === 'OBSERVE_SHIPMENT_COMPLETED') {
        const decision = `Supervisor closed active operations for ${message.shipmentId}.`;
        return {
          context: {
            ...context,
            activeShipments: Math.max(0, context.activeShipments - 1),
            lastDecision: decision,
          },
          emit: [{ type: 'LOGISTICS_SUPERVISOR_DECISION_RECORDED', decision }],
        };
      }

      return undefined;
    })
    .build();
}

export function createDispatcherBehavior() {
  return defineActor<DispatcherCommand, DispatcherEvent>()
    .withContext(createInitialDispatcherContext())
    .onMessage(({ context, message }) => {
      if (message.type === 'DISPATCH_SHIPMENT') {
        return {
          context: {
            ...context,
            lastShipmentId: message.shipmentId,
          },
          emit: [
            {
              type: 'SHIPMENT_DISPATCH_REQUESTED',
              shipmentId: message.shipmentId,
              destination: message.destination,
            },
          ],
        };
      }

      if (message.type === 'RECORD_ROUTE_ASSIGNMENT') {
        return {
          context: {
            ...context,
            assignedShipments: context.assignedShipments + 1,
            lastShipmentId: message.plan.shipmentId,
            lastCarrier: message.plan.carrier,
            lastDriverId: message.driverId,
          },
          emit: [
            {
              type: 'SHIPMENT_DRIVER_ASSIGNED',
              shipmentId: message.plan.shipmentId,
              driverId: message.driverId,
              carrier: message.plan.carrier,
            },
          ],
        };
      }

      return undefined;
    })
    .build();
}

export function createDriverDirectoryBehavior() {
  return defineActor<DriverDirectoryCommand, DriverDirectoryEvent>()
    .withContext(createInitialDriverDirectoryContext())
    .onMessage(({ context, message }) => {
      const driverId = driverIdForShipment(message.shipmentId);
      return {
        context: {
          assignedDrivers: {
            ...context.assignedDrivers,
            [message.shipmentId]: driverId,
          },
          lastDriverId: driverId,
        },
        reply: { driverId },
        emit: [{ type: 'DRIVER_ASSIGNED', shipmentId: message.shipmentId, driverId }],
      };
    })
    .build();
}
