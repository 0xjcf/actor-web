import type { ActorAgentLlmProvider } from '@actor-web/agent';

/** Protocol fixture, not evidence of live model quality. */
export const scriptedProvider: ActorAgentLlmProvider = () => ({
  ok: true,
  value: {
    message: {
      role: 'assistant',
      content: JSON.stringify({
        hypotheses: [
          {
            explanation:
              'The observed weather may be associated with the sales increase, but these observations cannot establish the reason for the change.',
            evidence: ['sales.maximum', 'weather.conditions'],
          },
        ],
        causation: 'not-established',
      }),
    },
  },
});
