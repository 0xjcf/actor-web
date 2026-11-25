import { createAgent, createAgentRunner } from '@actor-web/agent/runner';

export async function smoke(
  createRunner = createAgentRunner,
  makeAgent = createAgent,
  budgetOverrides = {},
  observeSettlement = false
) {
  const spec = {
    purpose: 'review',
    systemPrompt: 'Judge one item.',
    tools: [{ name: 'read', description: 'Read the fixture.', parameters: { type: 'object' } }],
    parse: (text) => ({ text }),
  };
  const options = {
    spec,
    grants: ['read'],
    tools: [
      {
        name: 'read',
        validateInput(input) {
          if (input?.id !== 'fixture') throw new Error('Invalid fixture ID.');
          return { value: { scope: [input.id] } };
        },
        execute: (input) => (input.scope[0] === 'fixture' ? 'offline' : 'unexpected input'),
      },
    ],
    encodeTask: ({ id }) => id,
    provider(request) {
      const last = request.messages.at(-1);
      if (last?.role === 'user' && request.tools.join(',') === 'read') {
        return {
          ok: true,
          value: {
            message: {
              role: 'assistant',
              content: '',
              toolCalls: [{ id: 'call', name: 'read', input: { id: 'fixture' } }],
            },
          },
        };
      }
      if (last?.role === 'tool' && last.toolCallId === 'call') {
        const { ok, output } = JSON.parse(last.content);
        if (ok && output === 'offline') {
          return { ok: true, value: { message: { role: 'assistant', content: 'verified' } } };
        }
      }
      return { ok: false, error: { code: 'UNEXPECTED_STEP', message: 'Unexpected smoke step.' } };
    },
    limits: {
      runTimeoutMs: 2_000,
      askTimeoutMs: 1_000,
      providerTimeoutMs: 500,
      toolTimeoutMs: 500,
      maxToolCallsPerBatch: 1,
      maxModelTurns: 2,
      maxToolAttempts: 1,
      maxPayloadBytes: 4096,
      ...budgetOverrides,
    },
  };
  const signal = new AbortController().signal;
  if (observeSettlement) {
    const runner = createRunner(options);
    const { validateOutput, waitForSettlement, readEvidence } = runner.start(
      { ...spec, task: { id: 'fixture' }, signal },
      { assignmentId: 'smoke-assignment', revision: 0 }
    );
    const [{ text }, settlement] = await Promise.all([
      validateOutput(spec.parse),
      waitForSettlement(2_000),
    ]);
    return {
      text,
      status: settlement.status,
      evidence: readEvidence()?.trace.receipts.map(({ event }) => event.type),
    };
  }
  const agent = makeAgent(options);
  return agent.run({ id: 'fixture', signal });
}
