import { describe, expect, it } from 'vitest';
import {
  type AgentExecutionConformanceFixtureName,
  assertAgentExecutionConformanceFixture,
  getAgentExecutionConformanceFixture,
  listAgentExecutionConformanceFixtures,
} from './agent-execution-conformance.js';

describe('agent execution conformance fixtures', () => {
  it('publishes the required deterministic provider-neutral scenarios', () => {
    expect(
      listAgentExecutionConformanceFixtures().map((fixture) => fixture.name)
    ).toStrictEqual<AgentExecutionConformanceFixtureName[]>([
      'success',
      'schema-rejection',
      'domain-rejection',
      'authorization-rejection',
      'timeout-retry-success',
      'duplicate-suppression',
      'interrupted',
      'stale-projection',
    ]);
  });

  it('keeps every fixture valid, JSON-safe, and self-describing', () => {
    for (const fixture of listAgentExecutionConformanceFixtures()) {
      expect(assertAgentExecutionConformanceFixture(fixture)).toEqual({ ok: true });
      expect(fixture.packageName).toBe('@actor-web/testing');
      expect(fixture.packageVersion).toBe('0.2.0');
      expect(fixture.sourceOfTruthOwner).toBe('Actor-Web');
      expect(fixture.supportedVersions).toEqual([1]);
      expect(fixture.joinKeys).toContain('traceId');
      expect(fixture.joinKeys).toContain('effectAttemptId');
      expect(fixture.redactionRules.secretKeys).toContain('authorization');
      expect(fixture.redactionRules.promptKeys).toContain('prompt');
    }
  });

  it('distinguishes the three rejection stages without collapsing them into execution success', () => {
    expect(getAgentExecutionConformanceFixture('schema-rejection').trace.receipts[0]).toMatchObject({
      admissionStage: 'schema-admitted',
      status: 'rejected',
    });
    expect(getAgentExecutionConformanceFixture('domain-rejection').trace.receipts[0]).toMatchObject({
      admissionStage: 'domain-accepted',
      status: 'rejected',
    });
    expect(
      getAgentExecutionConformanceFixture('authorization-rejection').trace.receipts[0]
    ).toMatchObject({
      admissionStage: 'execution-authorized',
      status: 'rejected',
    });
  });

  it('captures retry, duplicate suppression, interruption, and stale projection as durable facts', () => {
    expect(getAgentExecutionConformanceFixture('timeout-retry-success').trace.status).toBe(
      'succeeded'
    );
    expect(getAgentExecutionConformanceFixture('duplicate-suppression').trace.status).toBe(
      'reconciled'
    );
    expect(getAgentExecutionConformanceFixture('interrupted').trace.status).toBe('cancelled');
    expect(getAgentExecutionConformanceFixture('stale-projection').trace.status).toBe(
      'stale_projection'
    );
  });
});
