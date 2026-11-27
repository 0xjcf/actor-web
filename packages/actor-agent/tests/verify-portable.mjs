import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { z } from 'zod';

const require = createRequire(import.meta.url);
for (const entry of [
  await import('@actor-web/agent/terminal'),
  require('@actor-web/agent/terminal'),
]) {
  assert.equal(typeof entry.formatTerminalTraceEvent, 'function');
  assert.equal(typeof entry.createTerminalTraceReporter(), 'function');
}
for (const entry of [await import('@actor-web/agent'), require('@actor-web/agent')]) {
  assert.equal(typeof entry.createLlmToolRegistry, 'function');
  assert.equal(entry.createLlmToolRegistry, entry.createActorAgentToolRegistry);
  assert.equal(entry.AGENT_TRACE_SCHEMA_VERSION, 1);
  const summary = {
    runId: 'fixture',
    completeness: { status: 'incomplete', reasons: ['byte-limit'] },
    deliveryFailures: 0,
    metrics: { modelCalls: 1, toolCalls: 0, usage: null },
  };
  assert.deepEqual(JSON.parse(entry.serializeAgentTraceJsonl({ ...summary, events: [] })), {
    type: 'agent.trace.summary',
    schemaVersion: 1,
    ...summary,
  });
}
for (const [portable, codec] of [
  [await import('@actor-web/agent/portable'), await import('@actor-web/agent/zod')],
  [require('@actor-web/agent/portable'), require('@actor-web/agent/zod')],
]) {
  const agent = portable.createAgent(
    { run: async ({ task }) => JSON.stringify({ id: task.id }) },
    {
      purpose: 'test',
      systemPrompt: 'Inspect one item.',
      tools: [],
      output: codec.structured(z.strictObject({ id: z.string() })),
    }
  );
  assert.deepEqual(await agent.run({ id: 'item', signal: new AbortController().signal }), {
    id: 'item',
  });
}
