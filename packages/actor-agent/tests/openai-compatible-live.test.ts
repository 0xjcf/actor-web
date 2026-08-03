import { describe, expect, it } from 'vitest';

import { createOpenAiCompatibleLlmProvider } from '../src/index.js';

const shouldRunLiveLane = process.env.ACTOR_AGENT_RUN_LIVE_OPENAI_COMPAT === '1';
const liveDescribe = shouldRunLiveLane ? describe : describe.skip;

liveDescribe('openai-compatible live conformance', () => {
  it('verifies an already-running local compatible endpoint without logging credentials', async () => {
    const endpoint = process.env.ACTOR_AGENT_OPENAI_COMPAT_ENDPOINT;
    const model = process.env.ACTOR_AGENT_OPENAI_COMPAT_MODEL;

    expect(endpoint).toBeTruthy();
    expect(model).toBeTruthy();

    const provider = createOpenAiCompatibleLlmProvider({
      endpoint: endpoint as string,
      model: model as string,
      timeoutMs: 15_000,
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
        system: 'You are a concise planner.',
        messages: [{ role: 'user', content: 'Reply with the word ready.' }],
        tools: [],
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
    expect(result.value.message.content.length).toBeGreaterThan(0);
  });
});
