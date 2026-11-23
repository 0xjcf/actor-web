import { describe, expect, it } from 'vitest';
import { createActorRuntime } from '../src/actor-runtime.js';
import type { ActorAgentLlmRequest } from '../src/index.js';
import {
  ExecutorConformanceViolation,
  type ExecutorFactory,
  executorConformanceCases,
} from './executor-conformance.js';

const carryHistory: ExecutorFactory = (options) => {
  let previous: ActorAgentLlmRequest['messages'] = [];
  let latest: ActorAgentLlmRequest['messages'] = [];
  const runtime = createActorRuntime({
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
      return runtime.run(turn);
    },
  };
};

const widenGrants: ExecutorFactory = (options) =>
  createActorRuntime({
    ...options,
    grants: [...new Set([...options.grants, ...options.tools.map(({ name }) => name)])],
  });

const retryAfterFailure: ExecutorFactory = (options) =>
  createActorRuntime({
    ...options,
    async provider(request, context) {
      const result = await options.provider(request, context);
      return result.ok ? result : options.provider(request, context);
    },
  });

describe('local actor executor conformance', () => {
  for (const scenario of executorConformanceCases) {
    it(`${scenario.id}: ${scenario.name}`, () => scenario.run(createActorRuntime));
  }
});

describe.each([
  ['history carryover', carryHistory, 'fresh-history', 'second-assignment-empty-history'],
  ['grant widening', widenGrants, 'grant-intersection', 'ungranted-tool-not-dispatched'],
  ['provider retry', retryAfterFailure, 'provider-failure', 'exactly-one-provider-attempt'],
] as const)('%s mutant', (_label, make, target, checkId) => {
  for (const scenario of executorConformanceCases) {
    if (scenario.id === target) {
      it(`violates ${target}: ${checkId}`, async () => {
        const outcome = scenario.run(make);
        await expect(outcome).rejects.toBeInstanceOf(ExecutorConformanceViolation);
        await expect(outcome).rejects.toMatchObject({ caseId: target, checkId });
      });
    } else {
      it(`still passes ${scenario.id}`, () => scenario.run(make));
    }
  }
});
