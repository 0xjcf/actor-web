import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { startSourceReview } from './review.js';

const path = 'src/example.ts';
const provider: ActorAgentLlmProvider = (request) => {
  const last = request.messages.at(-1);
  if (last?.role === 'user') {
    return {
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'read-1', name: 'read_source', input: { path } }],
        },
      },
    };
  }
  if (last?.role === 'tool' && last.toolCallId === 'read-1' && last.toolName === 'read_source') {
    const result: { readonly ok?: unknown; readonly output?: unknown } = JSON.parse(last.content);
    if (result.ok === true && typeof result.output === 'string') {
      return {
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content: JSON.stringify({ path, excerpt: result.output }),
          },
        },
      };
    }
  }
  return {
    ok: false,
    error: { code: 'UNEXPECTED_SCRIPT_STEP', message: 'Expected a source read.' },
  };
};

const review = startSourceReview(
  {
    request: 'Cite the exported greeting.',
    files: [{ path, source: 'export const greeting = "hello";' }],
  },
  { provider },
  { assignmentId: 'demo-review', revision: 1 }
);
console.log(JSON.stringify(await review.result));
console.log(JSON.stringify(review.readEvidence()));
