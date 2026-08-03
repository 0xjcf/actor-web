import { describe, expect, it } from 'vitest';

import { createOpenAiCompatibleLlmProvider } from '../src/index.js';

const LIVE_PROVIDER_TIMEOUT_MS = 15_000;
const LIVE_TEST_TIMEOUT_MS = 20_000;
const REPORT_READY_TOOL = {
  name: 'report_ready',
  description: 'Report that the configured model is ready for tool-call conformance.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['ready'],
      },
    },
    required: ['status'],
    additionalProperties: false,
  },
} as const;

const shouldRunLiveLane = process.env.ACTOR_AGENT_RUN_LIVE_OPENAI_COMPAT === '1';
const liveDescribe = shouldRunLiveLane ? describe : describe.skip;

liveDescribe('openai-compatible live conformance', () => {
  it(
    'verifies a single harmless tool-call response without logging credentials or executing a capability',
    async () => {
      const endpoint = process.env.ACTOR_AGENT_OPENAI_COMPAT_ENDPOINT;
      const model = process.env.ACTOR_AGENT_OPENAI_COMPAT_MODEL;

      expect(endpoint).toBeTruthy();
      expect(model).toBeTruthy();

      const provider = createOpenAiCompatibleLlmProvider({
        endpoint: endpoint as string,
        model: model as string,
        timeoutMs: LIVE_PROVIDER_TIMEOUT_MS,
        headers:
          process.env.ACTOR_AGENT_OPENAI_COMPAT_AUTH_HEADER &&
          process.env.ACTOR_AGENT_OPENAI_COMPAT_AUTH_VALUE
            ? {
                [process.env.ACTOR_AGENT_OPENAI_COMPAT_AUTH_HEADER]:
                  process.env.ACTOR_AGENT_OPENAI_COMPAT_AUTH_VALUE,
              }
            : undefined,
        credentials:
          process.env.ACTOR_AGENT_OPENAI_COMPAT_CREDENTIALS === 'include' ||
          process.env.ACTOR_AGENT_OPENAI_COMPAT_CREDENTIALS === 'omit' ||
          process.env.ACTOR_AGENT_OPENAI_COMPAT_CREDENTIALS === 'same-origin'
            ? process.env.ACTOR_AGENT_OPENAI_COMPAT_CREDENTIALS
            : undefined,
      });

      const result = await provider(
        {
          system:
            'You are a concise planner. Call the report_ready tool exactly once with status set to ready. Do not answer with plain text.',
          messages: [
            {
              role: 'user',
              content: 'Use the report_ready tool exactly once with {"status":"ready"}.',
            },
          ],
          tools: [REPORT_READY_TOOL.name],
          toolDefinitions: [REPORT_READY_TOOL],
        },
        {
          actorId: 'actor://local/live-conformance',
          nodeAddress: 'local',
          signal: new AbortController().signal,
        }
      );

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }
      expect(result.value.message.role).toBe('assistant');
      expect(result.value.message.toolCalls).toEqual([
        {
          id: expect.any(String),
          name: 'report_ready',
          input: { status: 'ready' },
        },
      ]);
    },
    LIVE_TEST_TIMEOUT_MS
  );
});
