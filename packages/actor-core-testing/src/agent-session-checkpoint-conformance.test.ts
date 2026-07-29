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
});
