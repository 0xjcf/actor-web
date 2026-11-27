import { randomUUID } from 'node:crypto';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { type AgentTraceModel, createLlmProvider } from '@actor-web/agent';
import { createTerminalTraceReporter } from '@actor-web/agent/terminal';
import { evaluateResult, selectionChecks } from './evaluation.js';
import {
  type CaseId,
  caseIds,
  controlCaseIds,
  createDataset,
  createMockPort,
  hybridCaseIds,
  scope,
  selectionCaseIds,
} from './fixtures.js';
import { arm, callCap, gateArms, gateScenarios } from './gate-experiment.js';
import {
  controlStrategies,
  createInvestigator,
  type ReadPrompt,
  readInstructions,
  type Strategy,
  strategies,
} from './investigation.js';
import { scriptedProvider } from './scripted-provider.js';
import { synthesisPrompts, synthesisSources } from './synthesis.js';

const args = process.argv.slice(2);
const valueFlags = new Set([
  '--case',
  '--strategy',
  '--output',
  '--trials',
  '--read-prompt',
  '--max-reads',
]);
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (valueFlags.has(flag)) {
    if (!args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error(`${flag} requires a value.`);
    }
    index++;
  } else if (
    ![
      '--live',
      '--compare',
      '--compare-hybrid',
      '--compare-gate',
      '--compare-selection',
      '--compare-synthesis',
      '--synthesis-gate',
      '--json',
      '--trace-terminal',
      '--color',
      '--no-color',
    ].includes(flag)
  ) {
    throw new Error('Unknown CLI option.');
  }
}
const option = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const live = args.includes('--live');
const extended = args.includes('--compare-hybrid');
const gateExperiment = args.includes('--compare-gate');
const selectionExperiment = args.includes('--compare-selection');
const synthesisExperiment = args.includes('--compare-synthesis');
if ([extended, gateExperiment, selectionExperiment, synthesisExperiment].filter(Boolean).length > 1)
  throw new Error('Choose one comparison matrix.');
const compare =
  extended ||
  gateExperiment ||
  selectionExperiment ||
  synthesisExperiment ||
  args.includes('--compare');
const trials = Number(option('--trials', '1'));
if (!Number.isInteger(trials) || trials < 1 || trials > 2 || (!compare && trials !== 1)) {
  throw new Error('--trials must be 1, or 2 for a comparison.');
}
const json = compare || args.includes('--json');
const traceTerminal = args.includes('--trace-terminal');
const traceStream = traceTerminal ? process.stderr : process.stdout;
const onTrace =
  traceTerminal || !json
    ? createTerminalTraceReporter({
        writeLine: traceTerminal ? console.error : console.log,
        color:
          !args.includes('--no-color') &&
          (args.includes('--color') ||
            (process.env.NO_COLOR === undefined && Boolean(traceStream.isTTY))),
      })
    : undefined;
const caseId = option('--case', 'bulk-order') as CaseId;
const strategy = option('--strategy', 'adaptive') as Strategy;
if (!caseIds.includes(caseId) || !strategies.includes(strategy)) {
  throw new Error('Unknown case or strategy. See README for supported values.');
}
if (live && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --live.');
const selectedCases = compare ? (extended ? hybridCaseIds : controlCaseIds) : [caseId];
const selectedStrategies: readonly Strategy[] = compare
  ? extended
    ? strategies
    : controlStrategies
  : [strategy];
const readPrompt = option('--read-prompt', 'standard') as ReadPrompt;
const singleBudget = Number(option('--max-reads', '6'));
if (
  !Number.isInteger(singleBudget) ||
  singleBudget < 2 ||
  singleBudget > 6 ||
  (compare && args.includes('--max-reads'))
) {
  throw new Error('--max-reads accepts 2–6 on single assignments; comparison budgets are fixed.');
}
const gated = args.includes('--synthesis-gate');
if (!Object.hasOwn(readInstructions, readPrompt)) throw new Error('Unknown read prompt.');
if ((gated && strategy !== 'hybrid') || (compare && (gated || args.includes('--read-prompt')))) {
  throw new Error(
    'Use --synthesis-gate with a single hybrid assignment; comparison arms have fixed settings.'
  );
}
const { scenarios, arms } = (() => {
  if (synthesisExperiment)
    return {
      scenarios: (['alert-normal', 'alert-wet'] as const).map((caseId) => ({
        caseId,
        maxReads: synthesisSources.length,
      })),
      arms: synthesisPrompts.map((prompt) => arm('fixed', false, 'standard', prompt)),
    };
  if (selectionExperiment)
    return {
      scenarios: selectionCaseIds.map((caseId) => ({ caseId, maxReads: 3 })),
      arms: [arm('adaptive'), arm('adaptive', false, 'budget-plan')],
    };
  if (gateExperiment) return { scenarios: gateScenarios, arms: gateArms };
  return {
    scenarios: selectedCases.map((caseId) => ({ caseId, maxReads: singleBudget })),
    arms: selectedStrategies.map((s) => arm(s, gated, readPrompt)),
  };
})();
const maxCalls =
  trials *
  scenarios.reduce(
    (n, scenario) => n + arms.reduce((sum, a) => sum + callCap(a.strategy, scenario.maxReads), 0),
    0
  );
let dispatched = 0;
const provider = live
  ? createLlmProvider({
      endpoint: 'https://api.openai.com/v1/chat/completions',
      model: 'gpt-4.1-mini',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeoutMs: 30_000,
      parallelToolCalls: false,
      fetch: (url, init) => {
        if (++dispatched > maxCalls) throw new Error('Call budget exhausted.');
        if (typeof init?.body !== 'string') throw new Error('Expected JSON request.');
        return fetch(url, {
          ...init,
          body: JSON.stringify({
            ...JSON.parse(init.body),
            temperature: 0,
            max_completion_tokens: 900,
          }),
        });
      },
    })
  : scriptedProvider;
const model: AgentTraceModel = {
  provider: live ? 'openai' : 'scripted',
  model: live ? 'gpt-4.1-mini' : 'observation-driven-rules',
  settings: {
    status: 'captured',
    value: live ? { temperature: 0, max_completion_tokens: 900, parallelToolCalls: false } : {},
  },
};
const runs: unknown[] = [];
const outputPath = option('--output', '');
// Reserve the report before any paid calls; an existing file is never overwritten.
const reportFile = outputPath ? openSync(outputPath, 'wx', 0o600) : undefined;
const report = {
  schemaVersion: 1,
  recordedAt: new Date().toISOString(),
  mode: live ? 'live' : 'scripted',
  model,
  bounds: {
    maxCalls,
    maxReadsPerAssignment: Math.max(...scenarios.map((s) => s.maxReads)),
    retries: 0,
  },
  trials,
  limitations: [
    'Synthetic cases on a small fixed dataset; not a statistical or causal benchmark.',
    'Scripted mode uses the same rules for model decisions and rule-directed selection; it tests wiring, not LLM quality.',
    'Strategies have different prompts/tool contexts. Read counts and latency do not establish answer quality.',
    'Fixture status/kind checks are mechanical. Full explanations require independent review.',
    'Unread or unavailable sources are unknown. Hidden scenario intent is not causal evidence.',
    'Model trace excludes host reads; observations, hostReads and attemptedReads capture them separately.',
    'Live mode uses an unpinned model alias. Temperature zero does not guarantee deterministic output.',
  ],
  runs,
};
for (let trial = 1; trial <= trials; trial++) {
  for (const [caseIndex, { caseId: selectedCase, maxReads }] of scenarios.entries()) {
    const first = (caseIndex + trial - 1) % arms.length;
    const order = [...arms.slice(first), ...arms.slice(0, first)];
    for (const condition of order) {
      const selectedStrategy = condition.strategy;
      if (compare && traceTerminal) {
        console.error(`\nEVALUATION · ${selectedCase} · ${condition.id}`);
      }
      const investigator = createInvestigator({
        provider,
        data: createMockPort(createDataset(selectedCase)),
        model,
        onTrace,
      });
      const started = performance.now();
      const run = investigator.start(scope, {
        strategy: selectedStrategy,
        gated: condition.gated,
        readPrompt: condition.readPrompt,
        synthesisPrompt: condition.synthesisPrompt,
        maxReads,
        runId: randomUUID(),
      });
      let outcome: object;
      try {
        const result = await run.result;
        outcome = {
          status: 'accepted',
          facts: result.facts,
          assessment: result.assessment,
          usage: result.metrics?.usage ?? null,
          checks: evaluateResult(selectedCase, result),
        };
      } catch (error) {
        outcome = {
          status: 'rejected',
          usage: run.readTrace()?.metrics.usage ?? null,
          code:
            error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
              ? error.code
              : 'INVESTIGATION_FAILED',
        };
        process.exitCode = 1;
      }
      const observations = run.readObservations();
      const selection = selectionChecks(
        selectedCase,
        observations.map((o) => o.source)
      );
      const summary = {
        mode: report.mode,
        trial,
        caseId: selectedCase,
        strategy: selectedStrategy,
        arm: condition.id,
        ...(condition.synthesisPrompt ? { synthesisPrompt: condition.synthesisPrompt } : {}),
        readPrompt: condition.readPrompt,
        gated: condition.gated,
        synthesisOnlyReason: run.readSynthesisOnlyReason() ?? null,
        maxReads,
        ...outcome,
        ...(selection ? { selection } : {}),
        reads: observations.map((o) => ({ source: o.source, availability: o.availability })),
        ...run.readCounters(),
        hostReads: run.readHostReadCount(),
        modelSelectedReads: run.readCounters().attemptedReads - run.readHostReadCount(),
        durationMs: Math.round(performance.now() - started),
      };
      if (reportFile !== undefined) {
        runs.push({ ...summary, observations, trace: run.readTrace() ?? null });
      }
      console.log(JSON.stringify(summary, null, json ? undefined : 2));
    }
  }
}
if (reportFile !== undefined) {
  writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  closeSync(reportFile);
}
