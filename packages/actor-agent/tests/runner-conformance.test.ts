import { describe, expect, it } from 'vitest';
import type { ActorAgentLlmRequest } from '../src/index.js';
import { createAgentRunner } from '../src/runner.js';
import {
  RunnerConformanceViolation,
  type RunnerFactory,
  runnerConformanceCases,
} from './runner-conformance.js';

const carryHistory: RunnerFactory = (options) => {
  let previous: ActorAgentLlmRequest['messages'] = [];
  let latest: ActorAgentLlmRequest['messages'] = [];
  const runner = createAgentRunner({
    ...options,
    provider(request, context) {
      latest = structuredClone(request.messages);
      return options.provider(
        { ...request, messages: [...previous, ...request.messages] },
        context
      );
    },
  });
  return {
    run(turn) {
      previous = latest;
      return runner.run(turn);
    },
  };
};

const widenGrants: RunnerFactory = (options) =>
  createAgentRunner({
    ...options,
    grants: [...new Set([...options.grants, ...options.tools.map(({ name }) => name)])],
  });

const retryAfterFailure: RunnerFactory = (options) =>
  createAgentRunner({
    ...options,
    async provider(request, context) {
      const result = await options.provider(request, context);
      return result.ok ? result : options.provider(request, context);
    },
  });

describe('local actor runner conformance', () => {
  for (const scenario of runnerConformanceCases) {
    it(`${scenario.id}: ${scenario.name}`, () => scenario.run(createAgentRunner));
  }
});

describe.each([
  ['history carryover', carryHistory, 'fresh-history', 'second-assignment-empty-history'],
  ['grant widening', widenGrants, 'grant-intersection', 'ungranted-tool-not-dispatched'],
  ['provider retry', retryAfterFailure, 'provider-failure', 'exactly-one-provider-attempt'],
] as const)('%s mutant', (_label, make, target, checkId) => {
  for (const scenario of runnerConformanceCases) {
    if (scenario.id === target) {
      it(`violates ${target}: ${checkId}`, async () => {
        const outcome = scenario.run(make);
        await expect(outcome).rejects.toBeInstanceOf(RunnerConformanceViolation);
        await expect(outcome).rejects.toMatchObject({ caseId: target, checkId });
      });
    } else {
      it(`still passes ${scenario.id}`, () => scenario.run(make));
    }
  }
});
