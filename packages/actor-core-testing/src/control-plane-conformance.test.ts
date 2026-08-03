import { describe, expect, it } from 'vitest';
import {
  assertControlPlaneConformanceFixture,
  getControlPlaneConformanceFixture,
  listControlPlaneConformanceScenarios,
} from './index.js';

describe('control-plane conformance fixture', () => {
  it('publishes the versioned neutral composed fixture for consumer-owned control-plane integrations', () => {
    const fixture = getControlPlaneConformanceFixture();

    expect(assertControlPlaneConformanceFixture(fixture)).toEqual({ ok: true });
    expect(fixture.packageName).toBe('@actor-web/testing');
    expect(fixture.packageVersion).toBe('0.2.0');
    expect(fixture.sourceOfTruthOwner).toBe('Actor-Web');
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.contractVersion).toBe(1);
    expect(fixture.composition).toEqual({
      executionTrace: 'required',
      checkpointRecovery: 'required',
      reconciliationProjection: 'required',
      auditTrail: 'required',
    });
  });

  it('covers the required control-plane scenarios without embedding FAS vocabulary in the runtime contract', () => {
    expect(listControlPlaneConformanceScenarios().map((scenario) => scenario.name)).toEqual([
      'success',
      'rejection',
      'interruption_resume',
      'duplicate_suppression',
      'stale_projection',
      'operator_reconciliation',
    ]);
  });
});
