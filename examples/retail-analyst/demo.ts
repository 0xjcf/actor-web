import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { type ActorAgentLlmProvider, createLlmProvider } from '@actor-web/agent';
import { createAnalyst } from './analyst.js';
import { scriptedProvider } from './scripted-provider.js';
import { formatTrace } from './trace.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const json = args.includes('--json');
const summary = args.includes('--reasoning-summary');
const responses = summary || args.includes('--responses');
const exampleMode = args.includes('--no-tool-examples') ? 'off' : 'description';
const traceFileIndex = args.indexOf('--trace-file');
const traceFile = traceFileIndex < 0 ? undefined : args[traceFileIndex + 1];
if (traceFileIndex >= 0 && (!traceFile || traceFile.startsWith('--')))
  throw new Error('--trace-file requires a path.');
const color =
  !json &&
  !args.includes('--no-color') &&
  (args.includes('--color') ||
    (process.env.NO_COLOR === undefined && Boolean(process.stdout.isTTY)));
const model = process.env.OPENAI_ANALYST_MODEL ?? 'gpt-4.1-mini';
if (live && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --live.');
if (live && summary && model.startsWith('gpt-4.1'))
  throw new Error(
    'Select a reasoning-capable model for --reasoning-summary. GPT-4.1 has no native reasoning summary.'
  );
const provider: ActorAgentLlmProvider = live
  ? createLlmProvider({
      endpoint: responses
        ? 'https://api.openai.com/v1/responses'
        : 'https://api.openai.com/v1/chat/completions',
      model,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeoutMs: 30_000,
      parallelToolCalls: false,
      ...(summary ? { reasoningSummary: 'auto' as const } : {}),
    })
  : scriptedProvider;
const runId = randomUUID();
const analyst = createAnalyst({
  provider,
  toolExampleMode: exampleMode,
  model: {
    provider: live ? 'openai' : 'scripted',
    model: live ? model : 'retail-fixture',
    settings: {
      status: 'captured',
      value: live
        ? {
            api: responses ? 'responses' : 'chat-completions',
            parallelToolCalls: false,
            reasoningSummary: summary ? 'auto' : null,
          }
        : {},
    },
  },
  onTrace(event) {
    const record = { ...event, model: live ? model : null, mode: live ? 'live' : 'scripted' };
    if (traceFile) appendFileSync(traceFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    console.log(json ? JSON.stringify(record) : formatTrace(event, { color }));
  },
});
const started = performance.now();
try {
  const result = await analyst.analyze({ productId: 'P005' }, { runId });
  const report = {
    type: 'analyst.result',
    runId,
    mode: live ? 'live' : 'scripted',
    model: live ? model : null,
    toolExampleMode: exampleMode,
    analysis: result.analysis,
    ...result.metrics,
    durationMs: Math.round(performance.now() - started),
    traceTruncated: result.traceTruncated,
    traceDeliveryFailures: result.traceDeliveryFailures,
    traceCompleteness: result.traceCompleteness,
  };
  console.log(
    json
      ? JSON.stringify(report)
      : `\n${'═'.repeat(76)}\nRUN METRICS\n${JSON.stringify(report, null, 2)}\n${'═'.repeat(76)}`
  );
} catch (error) {
  // No provider headers, opaque continuation state, or raw SDK errors are printed.
  console.error(
    JSON.stringify({
      type: 'analyst.failed',
      runId,
      code: error && typeof error === 'object' && 'code' in error ? error.code : 'ANALYST_FAILED',
      durationMs: Math.round(performance.now() - started),
    })
  );
  process.exitCode = 1;
}
