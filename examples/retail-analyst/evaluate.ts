import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  type ActorAgentLlmProvider,
  type AgentTraceModel,
  createLlmProvider,
} from '@actor-web/agent';
import { createAnalyst, methodRevision } from './analyst.js';
import { createAnalyst as createBaseline } from './baseline-analyst.js';
import { scriptedProvider as baselineProvider } from './baseline-scripted-provider.js';
import { evaluateAnalysis, narrativeRubric, type Variant } from './evaluation.js';
import { sales, weather } from './fixtures.js';
import { scriptedProvider } from './scripted-provider.js';

const live = process.argv.includes('--live');
const pairs = 3;
const maxCalls = pairs * (12 + 1);
const maxCompletionTokens = 600;
const model = 'gpt-4.1-mini';
const outputIndex = process.argv.indexOf('--output');
const outputPath =
  outputIndex < 0
    ? `edge-evaluation-${live ? 'live' : 'scripted'}.json`
    : process.argv[outputIndex + 1];
if (!outputPath || outputPath.startsWith('--')) throw new Error('--output requires a path.');
if (live && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --live.');
let dispatched = 0;
const liveProvider = live
  ? createLlmProvider({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model,
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeoutMs: 30_000,
      parallelToolCalls: false,
      // Apply identical, explicitly recorded generation controls to both implementations.
      fetch: (url, init) => {
        if (++dispatched > maxCalls) throw new Error('Evaluation call budget exhausted.');
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request body.');
        return fetch(url, {
          ...init,
          body: JSON.stringify({
            ...JSON.parse(init.body),
            temperature: 0,
            max_completion_tokens: maxCompletionTokens,
          }),
        });
      },
    })
  : undefined;
const modelInfo: AgentTraceModel = {
  provider: live ? 'openai' : 'scripted',
  model: live ? model : 'retail-fixture',
  settings: {
    status: 'captured',
    value: live
      ? { temperature: 0, max_completion_tokens: maxCompletionTokens, parallelToolCalls: false }
      : {},
  },
};
const runs: unknown[] = [];
const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  mode: live ? 'live' : 'scripted',
  baselineRevision: 'd616cccc8a1e469e66477e8a91268def9e85c162',
  candidateBaseRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  candidateMethodRevision: methodRevision,
  sourceSha256: Object.fromEntries(
    [
      'analyst.ts',
      'baseline-analyst.ts',
      'evidence.ts',
      'sales-analysis.ts',
      'evaluation.ts',
      'evaluate.ts',
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(`../${name}`, import.meta.url)))
        .digest('hex'),
    ])
  ),
  fixtureSha256: createHash('sha256').update(JSON.stringify({ sales, weather })).digest('hex'),
  model: modelInfo,
  pairs,
  bounds: { maxCalls, maxCompletionTokens, retries: 0 },
  rubric: narrativeRubric,
  limitations: [
    'Three paired trials on one synthetic dataset; not a statistical benchmark.',
    'Unpinned model alias; temperature zero does not guarantee determinism.',
    'Workflow, prompts, tools, context, and output contracts differ intentionally; effects cannot be attributed to architecture alone.',
    'No causal ground truth. Schema/reference validation and mechanical indicators are not semantic quality scores.',
    'Weather is simulated. Model tool counts exclude candidate host-owned reads and pure calculations.',
    'Token usage remains unknown when not reported; durations include runtime and host workflow overhead.',
    'Historical v1–v3 reports are context only, not the controlled baseline.',
  ],
  runs,
};
for (let pair = 1; pair <= pairs; pair++) {
  const order: Variant[] = pair % 2 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
  for (const variant of order) {
    const requests: unknown[] = [];
    const responses: unknown[] = [];
    const delegate = liveProvider ?? (variant === 'baseline' ? baselineProvider : scriptedProvider);
    const provider: ActorAgentLlmProvider = async (request, context) => {
      requests.push(structuredClone(request));
      const reply = await delegate(request, context);
      // Synthetic model output only; never persist adapter errors, credentials, or opaque state.
      responses.push(
        reply.ok
          ? {
              content: reply.value.message.content,
              toolCalls: reply.value.message.toolCalls ?? [],
              usage: reply.value.usage ?? null,
            }
          : { code: reply.error.code }
      );
      return reply;
    };
    const options = { provider, model: modelInfo };
    const analyst = variant === 'baseline' ? createBaseline(options) : createAnalyst(options);
    const started = performance.now();
    const run = analyst.startAnalysis({ productId: 'P005' }, { runId: `pair-${pair}-${variant}` });
    let analysis: unknown;
    let observations: { name: string }[] = [];
    let failure: string | undefined;
    try {
      const result = await run.result;
      analysis = result.analysis;
      observations = result.observations;
    } catch (error) {
      failure =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'ANALYST_FAILED';
    }
    const snapshot = run.readTrace();
    if (failure) {
      observations =
        'readObservations' in run
          ? run.readObservations()
          : (snapshot?.events ?? []).flatMap((event) =>
              event.type === 'tool.observed' ? [{ name: event.payload.name }] : []
            );
    }
    const record = {
      pair,
      variant,
      status: failure ? 'rejected' : 'accepted',
      failure,
      durationMs: Math.round(performance.now() - started),
      analysis,
      observations,
      modelCalls: requests.length,
      modelToolCalls: snapshot?.metrics.toolCalls ?? null,
      hostReads: observations.filter(
        (o) => o.name === 'get_sales_data' || o.name === 'call_weather_api'
      ).length,
      calculations: observations.filter((o) => o.name === 'find_largest_sales_increase').length,
      usage: snapshot?.metrics.usage ?? null,
      checks: evaluateAnalysis(variant, analysis, observations),
      requests,
      responses,
      traceCompleteness: snapshot?.completeness ?? null,
      semanticReview: null,
    };
    runs.push(record);
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(
      JSON.stringify({
        pair,
        variant,
        status: record.status,
        failure,
        durationMs: record.durationMs,
        modelCalls: record.modelCalls,
        modelToolCalls: record.modelToolCalls,
        hostReads: record.hostReads,
        usage: record.usage,
        checks: record.checks,
      })
    );
  }
}
