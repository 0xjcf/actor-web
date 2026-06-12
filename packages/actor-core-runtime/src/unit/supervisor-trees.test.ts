/**
 * @file supervisor-trees.test.ts
 * @description Pins for topology supervisor() group semantics in the runtime
 * failure path.
 *
 * The pure tree core (`resolveTreeSupervisionDecision`) widens an
 * already-resolved per-actor decision to a group action:
 *
 * - `pass-through` — no group, one-for-one, non-member path, or a stop/resume
 *   child decision (deliberate containment).
 * - `restart-group` — stop in reverse declaration order, respawn in
 *   declaration order (`one-for-all` = all children, `rest-for-one` = the
 *   failed child and later-declared children).
 * - `give-up-group` — bound exhaustion or group-level escalate stops ALL
 *   children and emits one `actorEscalated`; the system itself never stops.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveTreeSupervisionDecision,
  type SupervisorGroupConfig,
} from '../actor-system-impl.js';

const PATH_A = 'actor://supervisor-trees-test/actor/a';
const PATH_B = 'actor://supervisor-trees-test/actor/b';
const PATH_C = 'actor://supervisor-trees-test/actor/c';

function group(
  strategy: SupervisorGroupConfig['strategy'],
  children: readonly string[] = [PATH_A, PATH_B, PATH_C]
): SupervisorGroupConfig {
  return { key: 'test-group', strategy, children };
}

const RESTART_DECISION = { kind: 'restart', restartCount: 0, maxRestarts: 3 } as const;
const STOP_PERMANENT_DECISION = {
  kind: 'stop-permanent',
  restartCount: 3,
  maxRestarts: 3,
} as const;

describe('resolveTreeSupervisionDecision (pure tree core)', () => {
  it('passes through when the actor belongs to no group', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: undefined,
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });
  });

  it('passes through stop and resume child decisions inside any group', () => {
    for (const childDecision of [{ kind: 'stop' }, { kind: 'resume' }] as const) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision,
          group: group('one-for-all'),
          failedChildPath: PATH_B,
        })
      ).toEqual({ kind: 'pass-through' });
    }
  });

  it('passes through restart decisions in a one-for-one group', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });

    // Per-actor escalate inside a one-for-one group also stays per-actor.
    expect(
      resolveTreeSupervisionDecision({
        childDecision: { kind: 'escalate' },
        group: group('one-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({ kind: 'pass-through' });
  });

  it('one-for-all restart stops all children in reverse declaration order and respawns in declaration order', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-all'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('rest-for-one restart affects the failed child and later-declared children only', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B],
      respawnOrder: [PATH_B, PATH_C],
    });

    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_C,
      })
    ).toEqual({ kind: 'restart-group', stopOrder: [PATH_C], respawnOrder: [PATH_C] });

    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('rest-for-one'),
        failedChildPath: PATH_A,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('gives up the group on stop-permanent: all children stop in reverse order with max-restarts-exceeded', () => {
    for (const strategy of ['one-for-all', 'rest-for-one'] as const) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision: STOP_PERMANENT_DECISION,
          group: group(strategy),
          failedChildPath: PATH_B,
        })
      ).toEqual({
        kind: 'give-up-group',
        stopOrder: [PATH_C, PATH_B, PATH_A],
        reason: 'max-restarts-exceeded',
      });
    }
  });

  it('group strategy escalate gives up the group with supervisor-escalated', () => {
    for (const childDecision of [
      RESTART_DECISION,
      STOP_PERMANENT_DECISION,
      { kind: 'escalate' } as const,
    ]) {
      expect(
        resolveTreeSupervisionDecision({
          childDecision,
          group: group('escalate'),
          failedChildPath: PATH_B,
        })
      ).toEqual({
        kind: 'give-up-group',
        stopOrder: [PATH_C, PATH_B, PATH_A],
        reason: 'supervisor-escalated',
      });
    }
  });

  it('treats a raw escalate decision in a widening group as a group restart', () => {
    // The shell normally substitutes restart bounds before calling; this pins
    // totality if a raw escalate ever reaches the core.
    expect(
      resolveTreeSupervisionDecision({
        childDecision: { kind: 'escalate' },
        group: group('one-for-all'),
        failedChildPath: PATH_B,
      })
    ).toEqual({
      kind: 'restart-group',
      stopOrder: [PATH_C, PATH_B, PATH_A],
      respawnOrder: [PATH_A, PATH_B, PATH_C],
    });
  });

  it('passes through when the failed path is not a group member', () => {
    expect(
      resolveTreeSupervisionDecision({
        childDecision: RESTART_DECISION,
        group: group('one-for-all'),
        failedChildPath: 'actor://supervisor-trees-test/actor/stranger',
      })
    ).toEqual({ kind: 'pass-through' });
  });
});
