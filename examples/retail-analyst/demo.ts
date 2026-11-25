import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import {
  type ActorAgentLlmProvider,
  type AgentTraceProfile,
  createLlmProvider,
  serializeAgentTraceJsonl,
} from '@actor-web/agent';
import { createAnalyst } from './analyst.js';
import { scriptedProvider } from './scripted-provider.js';
import { formatTrace } from './trace.js';

const args = process.argv.slice(2);
const live = args.includes('--live');
const json = args.includes('--json');
const summary = args.includes('--reasoning-summary');
const responses = summary || args.includes('--responses');
const exampleMode = args.includes('--no-tool-examples') ? 'off' : 'description';
const profileIndex = args.indexOf('--trace-profile');
const requestedProfile = profileIndex < 0 ? 'evaluation' : args[profileIndex + 1];
if (
  requestedProfile !== 'off' &&
  requestedProfile !== 'metadata' &&
  requestedProfile !== 'evaluation'
) {
  throw new Error('--trace-profile requires off, metadata, or evaluation.');
}
const traceProfile: AgentTraceProfile = requestedProfile;
const traceFileIndex = args.indexOf('--trace-file');
const traceFile = traceFileIndex < 0 ? undefined : args[traceFileIndex + 1];
if (traceFileIndex >= 0 && (!traceFile || traceFile.startsWith('--')))
  throw new Error('--trace-file requires a path.');
if (traceFile && traceProfile === 'off') {
  throw new Error('--trace-file requires an enabled trace profile.');
}
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
  traceProfile,
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
  onTrace: json ? undefined : (event) => console.log(formatTrace(event, { color })),
});
const started = performance.now();
let durationMs: number | undefined;
try {
  const run = analyst.startAnalysis({ productId: 'P005' }, { runId });
  const result = await run.result.finally(() => {
    durationMs = Math.round(performance.now() - started);
    if (!json && !traceFile) return;
    const snapshot = run.readTrace();
    if (!snapshot) return;
    const trace = serializeAgentTraceJsonl(snapshot);
    if (traceFile) {
      try {
        appendFileSync(traceFile, trace, { mode: 0o600 });
      } catch {
        // File delivery is separate from runner capture and analysis acceptance.
        console.error(
          JSON.stringify({
            type: 'analyst.trace_export_failed',
            runId,
            code: 'TRACE_FILE_WRITE_FAILED',
          })
        );
      }
    }
    if (json) process.stdout.write(trace);
  });
  const report = {
    type: 'analyst.result',
    runId,
    mode: live ? 'live' : 'scripted',
    model: live ? model : null,
    toolExampleMode: exampleMode,
    traceProfile,
    analysis: result.analysis,
    ...result.metrics,
    durationMs,
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
      durationMs: durationMs ?? Math.round(performance.now() - started),
    })
  );
  process.exitCode = 1;
}
