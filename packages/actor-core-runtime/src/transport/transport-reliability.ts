// Functional core (no I/O, no clock, no timers — machine-enforced via .fas-config.json
// behaviorBoundaries.functionalCore). Pure reliability DECIDERS for the transport core.
//
// Each decider is a pure (state, now, cfg) -> verdict function that returns a
// discriminated-union verdict, mirroring resolveSupervisionDecision
// (actor-system-impl.ts). TransportCore (the shell) holds the mutable peer/pending
// records and the timers/clock; it calls these to DECIDE, then EXECUTES the verdict
// (arm a timer, drop, close the peer). Keeping the decisions pure makes the *logic*
// unit-testable with zero clock/timer mocks; the shell's *scheduling* is tested with
// injected fake timers.

export interface AckRetryState {
  /** How many times the frame has already been re-sent (0 on first arm). */
  readonly attempts: number;
  /** Clock time (ms) the frame was last sent. */
  readonly lastSentAtMs: number;
}

export interface AckRetryConfig {
  readonly ackTimeoutMs: number;
  readonly maxAckRetries: number;
}

export type AckRetryVerdict =
  | { readonly kind: 'wait' }
  | { readonly kind: 'retry' }
  | { readonly kind: 'give-up' };

/**
 * Decide whether to keep waiting for an ack, re-send the frame, or give up.
 *
 * Distilled from browser-...transport.ts:1112,1125-1144 / node-...transport.ts:1269,1282-1301:
 * - retry disabled at construction (ackTimeoutMs <= 0 || maxAckRetries <= 0) => give-up
 *   (the shell maps give-up at arm time to "do not track").
 * - timer not yet elapsed => wait.
 * - timer elapsed AND attempts >= maxAckRetries => give-up (record retry-exhausted).
 * - timer elapsed AND attempts < maxAckRetries => retry (re-enqueue + record retry-scheduled).
 */
export function resolveAckRetry(
  pending: AckRetryState,
  nowMs: number,
  cfg: AckRetryConfig
): AckRetryVerdict {
  if (cfg.ackTimeoutMs <= 0 || cfg.maxAckRetries <= 0) {
    return { kind: 'give-up' };
  }

  if (nowMs - pending.lastSentAtMs < cfg.ackTimeoutMs) {
    return { kind: 'wait' };
  }

  if (pending.attempts >= cfg.maxAckRetries) {
    return { kind: 'give-up' };
  }

  return { kind: 'retry' };
}

export type BackpressureVerdict = { readonly kind: 'enqueue' } | { readonly kind: 'drop' };

/**
 * Decide whether an outbound frame is enqueued or dropped under backpressure.
 *
 * Distilled from browser-...transport.ts:970 / node-...transport.ts:1122:
 * - limit >= 0 && queueDepth >= limit => drop (record dropped + reject the send).
 * - otherwise (limit < 0 unbounded, or depth under limit) => enqueue.
 */
export function resolveBackpressure(queueDepth: number, limit: number): BackpressureVerdict {
  if (limit >= 0 && queueDepth >= limit) {
    return { kind: 'drop' };
  }

  return { kind: 'enqueue' };
}

export interface HeartbeatConfig {
  readonly heartbeatTimeoutMs: number;
}

export type HeartbeatVerdict = { readonly kind: 'alive' } | { readonly kind: 'timed-out' };

/**
 * Decide whether a peer is still alive or has missed its heartbeat deadline.
 * Mechanism-agnostic: it only compares timestamps, never sends a ping.
 *
 * Distilled from browser-...transport.ts:574-591 / node-...transport.ts:1483-1500 and
 * markPeerSeen browser-...transport.ts:604-615:
 * - heartbeatTimeoutMs <= 0 => alive (timeout disabled; never closes).
 * - nowMs - lastSeenAtMs >= heartbeatTimeoutMs => timed-out (record + close peer).
 * - otherwise => alive (a pong/native-alive refreshed lastSeenAt before the deadline).
 */
export function resolveHeartbeat(
  lastSeenAtMs: number,
  nowMs: number,
  cfg: HeartbeatConfig
): HeartbeatVerdict {
  if (cfg.heartbeatTimeoutMs <= 0) {
    return { kind: 'alive' };
  }

  if (nowMs - lastSeenAtMs >= cfg.heartbeatTimeoutMs) {
    return { kind: 'timed-out' };
  }

  return { kind: 'alive' };
}
