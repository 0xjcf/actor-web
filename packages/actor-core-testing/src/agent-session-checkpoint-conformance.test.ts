import { describe, expect, it } from 'vitest';
import {
  assertAgentSessionCheckpointConformanceFixture,
  getAgentSessionCheckpointConformanceFixture,
} from './agent-session-checkpoint-conformance.js';

describe('agent session checkpoint conformance fixture', () => {
  it('publishes the accepted checkpoint and rehydration taxonomies', () => {
    const fixture = getAgentSessionCheckpointConformanceFixture();

    expect(fixture.packageName).toBe('@actor-web/testing');
    expect(fixture.packageVersion).toBe('0.2.0');
    expect(fixture.sourceOfTruthOwner).toBe('Actor-Web');
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.readOutcomes).toEqual([
      'missing',
      'present',
      'stale',
      'corrupt',
      'version_mismatch',
      'expired',
      'redacted',
    ]);
    expect(fixture.writeOutcomes).toEqual([
      'stored',
      'replaced',
      'duplicate',
      'too_large',
      'expired',
      'rejected',
    ]);
    expect(fixture.rehydrationOutcomes).toEqual([
      'resumed',
      'deferred_for_reconciliation',
      'manual_recovery_required',
    ]);
  });

  it('keeps the representative checkpoint honest about reconciliation-required resume', () => {
    const result = assertAgentSessionCheckpointConformanceFixture();

    expect(result).toEqual({
      ok: true,
      rehydration: {
        outcome: 'deferred_for_reconciliation',
        envelope: getAgentSessionCheckpointConformanceFixture().representativeCheckpoint,
        reason: 'Irreversible effect intent was recorded without a settled receipt.',
      },
    });
  });

  it('covers the accepted restart, crash, cancellation, reconciliation, and no-duplicate scenarios without claiming exactly-once recovery', () => {
    const fixture = getAgentSessionCheckpointConformanceFixture();

    expect(fixture.scenarios.map((scenario) => scenario.name)).toEqual([
      'clean_restart_identity_continuity',
      'crash_before_attempt',
      'crash_between_attempt_and_receipt',
      'crash_after_receipt_before_checkpoint',
      'cancellation',
      'manual_recovery',
      'reconciliation',
      'no_duplicate_irreversible_effect',
    ]);

    expect(
      fixture.scenarios.find((scenario) => scenario.name === 'clean_restart_identity_continuity')
    ).toMatchObject({
      proofSurface: 'checkpoint_seam',
      outcome: {
        outcome: 'resumed',
        envelope: {
          actor: {
            actorId: 'runtime://agent/session:checkpoint:fixture',
            sessionId: 'session:checkpoint:fixture',
            turnId: 'turn:fixture:001',
            traceId: 'trace:fixture:001',
            commandId: 'command:fixture:001',
            correlationId: 'corr:fixture:001',
            causationId: 'cause:fixture:001',
          },
        },
      },
    });
    expect(
      fixture.scenarios.find((scenario) => scenario.name === 'crash_before_attempt')
    ).toMatchObject({
      outcome: {
        outcome: 'manual_recovery_required',
        reason: 'missing',
      },
    });
    expect(
      fixture.scenarios.find((scenario) => scenario.name === 'crash_between_attempt_and_receipt')
    ).toMatchObject({
      outcome: {
        outcome: 'deferred_for_reconciliation',
        envelope: {
          checkpointId: 'checkpoint:fixture:attempt-without-receipt',
        },
      },
    });
    expect(
      fixture.scenarios.find(
        (scenario) => scenario.name === 'crash_after_receipt_before_checkpoint'
      )
    ).toMatchObject({
      outcome: {
        outcome: 'deferred_for_reconciliation',
        envelope: {
          checkpointId: 'checkpoint:fixture:receipt-ahead-of-checkpoint',
        },
        reason: 'effect_receipt_ahead_of_agent_checkpoint',
      },
    });
    expect(fixture.scenarios.find((scenario) => scenario.name === 'cancellation')).toMatchObject({
      outcome: {
        outcome: 'resumed',
      },
    });
    expect(fixture.scenarios.find((scenario) => scenario.name === 'manual_recovery')).toMatchObject(
      {
        outcome: {
          outcome: 'manual_recovery_required',
          reason: 'corrupt',
        },
      }
    );
    expect(fixture.scenarios.find((scenario) => scenario.name === 'reconciliation')).toMatchObject({
      outcome: {
        outcome: 'deferred_for_reconciliation',
        envelope: {
          checkpointId: 'checkpoint:fixture:reconciliation-cursor',
        },
        reason: 'runtime_reconciliation_cursor_pending',
      },
    });
    expect(
      fixture.scenarios.find((scenario) => scenario.name === 'no_duplicate_irreversible_effect')
    ).toMatchObject({
      outcome: {
        outcome: 'deferred_for_reconciliation',
        envelope: {
          checkpointId: 'checkpoint:fixture:no-duplicate-effect',
        },
        reason: 'verify_irreversible_effect_before_retry',
      },
    });
  });
});
