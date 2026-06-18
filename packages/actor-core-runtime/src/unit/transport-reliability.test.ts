import { describe, expect, it } from 'vitest';
import {
  type AckRetryConfig,
  resolveAckRetry,
  resolveBackpressure,
  resolveHeartbeat,
} from '../transport/transport-reliability.js';

// Pure reliability decider specs (engineering brief §2, cases 1-3). Each decider is a
// pure (state, now, cfg) -> verdict function, mirroring resolveSupervisionDecision; the
// shell supplies now() and executes the verdict. No timers, no clock here.

describe('resolveAckRetry', () => {
  const cfg: AckRetryConfig = { ackTimeoutMs: 1000, maxAckRetries: 2 };

  it('waits before the timeout elapses', () => {
    expect(resolveAckRetry({ attempts: 0, lastSentAtMs: 0 }, 500, cfg)).toEqual({ kind: 'wait' });
  });

  it('retries at the timeout when attempts are under maxAckRetries', () => {
    expect(resolveAckRetry({ attempts: 0, lastSentAtMs: 0 }, 1000, cfg)).toEqual({ kind: 'retry' });
    expect(resolveAckRetry({ attempts: 1, lastSentAtMs: 0 }, 2000, cfg)).toEqual({ kind: 'retry' });
  });

  it('gives up at or over maxAckRetries once the timer elapsed', () => {
    expect(resolveAckRetry({ attempts: 2, lastSentAtMs: 0 }, 1000, cfg)).toEqual({
      kind: 'give-up',
    });
    expect(resolveAckRetry({ attempts: 3, lastSentAtMs: 0 }, 5000, cfg)).toEqual({
      kind: 'give-up',
    });
  });

  it('gives up when retry is disabled at construction', () => {
    expect(
      resolveAckRetry({ attempts: 0, lastSentAtMs: 0 }, 9999, { ackTimeoutMs: 0, maxAckRetries: 2 })
    ).toEqual({ kind: 'give-up' });
    expect(
      resolveAckRetry({ attempts: 0, lastSentAtMs: 0 }, 9999, { ackTimeoutMs: 1000, maxAckRetries: 0 })
    ).toEqual({ kind: 'give-up' });
  });
});

describe('resolveBackpressure', () => {
  it('enqueues under the limit', () => {
    expect(resolveBackpressure(0, 1024)).toEqual({ kind: 'enqueue' });
    expect(resolveBackpressure(1023, 1024)).toEqual({ kind: 'enqueue' });
  });

  it('drops at the limit', () => {
    expect(resolveBackpressure(1024, 1024)).toEqual({ kind: 'drop' });
    expect(resolveBackpressure(2000, 1024)).toEqual({ kind: 'drop' });
  });

  it('enqueues when the limit is negative (unbounded)', () => {
    expect(resolveBackpressure(999_999, -1)).toEqual({ kind: 'enqueue' });
  });
});

describe('resolveHeartbeat', () => {
  it('reports alive before the timeout', () => {
    expect(resolveHeartbeat(0, 500, { heartbeatTimeoutMs: 1000 })).toEqual({ kind: 'alive' });
  });

  it('reports timed-out at or after the timeout', () => {
    expect(resolveHeartbeat(0, 1000, { heartbeatTimeoutMs: 1000 })).toEqual({ kind: 'timed-out' });
    expect(resolveHeartbeat(0, 5000, { heartbeatTimeoutMs: 1000 })).toEqual({ kind: 'timed-out' });
  });

  it('reports alive when the timeout is disabled', () => {
    expect(resolveHeartbeat(0, 999_999, { heartbeatTimeoutMs: 0 })).toEqual({ kind: 'alive' });
  });
});
