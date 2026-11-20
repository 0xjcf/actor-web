import portable = require('@actor-web/agent/portable');
import codec = require('@actor-web/agent/zod');

import { z } from 'zod';

declare const runtime: portable.AgentRuntime<{ request: string }, 'build'>;
const builder = portable.createAgent(runtime, {
  purpose: 'build',
  systemPrompt: 'Implement the assignment.',
  tools: [],
  output: codec.structured(z.strictObject({ summary: z.string() })),
});
const result: Promise<{ summary: string }> = builder.run({
  request: 'Update the component.',
  signal: new AbortController().signal,
});
void result;
