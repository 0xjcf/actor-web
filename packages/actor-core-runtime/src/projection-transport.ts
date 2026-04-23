/**
 * @module actor-core/runtime/projection-transport
 * @description Transport health state for host-facing actor projections.
 */

export type ProjectionTransportState =
  | 'local'
  | 'connected'
  | 'replaying'
  | 'degraded'
  | 'disconnected';

export interface ProjectionTransportStatus {
  state: ProjectionTransportState;
  updatedAt: number;
  lastSequence?: number;
  lagMs?: number;
  reason?: string;
}

export function createProjectionTransportStatus(
  state: ProjectionTransportState,
  overrides: Partial<Omit<ProjectionTransportStatus, 'state'>> = { updatedAt: Date.now() }
): ProjectionTransportStatus {
  return {
    state,
    updatedAt: overrides.updatedAt ?? Date.now(),
    ...(overrides.lastSequence !== undefined ? { lastSequence: overrides.lastSequence } : {}),
    ...(overrides.lagMs !== undefined ? { lagMs: overrides.lagMs } : {}),
    ...(overrides.reason !== undefined ? { reason: overrides.reason } : {}),
  };
}
