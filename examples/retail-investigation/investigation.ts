import type {
  ActorAgentLlmProvider,
  AgentRunTraceSnapshot,
  AgentTraceModel,
  AgentTraceOptions,
  AgentTraceProfile,
} from '@actor-web/agent';
import { createAgent as bindAgent } from '@actor-web/agent/portable';
import { AgentRunnerError, createAgentRunner } from '@actor-web/agent/runner';
import { defineTool, structured } from '@actor-web/agent/zod';
import { z } from 'zod';
import {
  Assessment,
  calculateSpike,
  checkAssessment,
  type DataPort,
  type Observation,
  Packet,
  Scope,
  type Source,
  sources,
  validatePacket,
} from './evidence.js';
import { nextSource } from './policy.js';
import { investigationSystemPrompt } from './prompts.js';
import { type Reconciliation, reconcile, synthesisReason } from './reconciliation.js';
import { type SynthesisPrompt, synthesisPrompts, synthesisSources } from './synthesis.js';

export const controlStrategies = ['fixed', 'rules', 'adaptive'] as const;
export const strategies = [...controlStrategies, 'hybrid'] as const;
export type Strategy = (typeof strategies)[number];
export const readInstructions = {
  standard:
    'Choose follow-up reads based on what could distinguish explanations. Do not follow a mandatory checklist.',
  discriminate:
    'Start from the observed evidence. Request a read only if a plausible result would change your finding or status. In the tool reason name the open question and the distinguishing observation. If no such read is available, return the assessment now. Do not narrate intermediate reasoning.',
  'budget-plan':
    'After sales, allocate the remainingReads slots before spending one. In the next tool reason briefly name the source to read now and the provisional source for any remaining slot. After each receipt revise that choice: spend the last read testing a specific independent explanation suggested by the new records, not a generic checklist. Call only the next tool; do not narrate intermediate reasoning.',
} as const;
export type ReadPrompt = keyof typeof readInstructions;
const ReadInput = z.strictObject({ reason: z.string().trim().min(1).max(240) });
export type Assignment = {
  objective: string;
  scope: Scope;
  observations: Observation[];
  spike: ReturnType<typeof calculateSpike> | null;
  remainingReads: number;
  reconciliation?: Reconciliation;
};
const descriptions: { [K in Source]: string } = {
  read_sales:
    'Daily units, unit prices, revenue, and channel. Required first; also calculates the maximum daily increase.',
  read_promotions:
    'Daily campaign records, discount percentages, and audience. An empty available result means no recorded campaign.',
  read_inventory:
    'Daily closing inventory, deliveries, and stockout hours. Distinguish availability recovery from increased demand.',
  read_weather:
    'Daily conditions, precipitation in mm, temperature in Celsius, and an explicit historical precipitation reference.',
  read_orders:
    'Individual order rows with order IDs, quantities, and cancellation flags. Check concentration and duplicate identifiers.',
  read_comparison_sales:
    'Daily units for a comparison product in the assigned store. Comparison suitability is not established.',
};

function fail(code: string): never {
  throw new AgentRunnerError(code, 'The investigation could not complete within its policy.');
}
function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) fail('RUN_ABORTED');
}

/** A read deadline invalidates late results even when an adapter ignores its signal. */
async function boundedRead(
  port: DataPort,
  source: Source,
  scope: Scope,
  signal: AbortSignal
): Promise<unknown> {
  checkAbort(signal);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      controller.abort();
      reject(new AgentRunnerError('RUN_ABORTED', 'The investigation was aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      reject(new AgentRunnerError('DATA_TIMEOUT', 'The evidence read timed out.'));
    }, 1000);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        checkAbort(controller.signal);
        return port(source, structuredClone(scope), controller.signal);
      }),
      interrupted,
    ]);
    checkAbort(signal);
    return result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

export function createInvestigator({
  provider,
  data,
  traceProfile = 'evaluation',
  onTrace,
  model = {
    provider: 'custom',
    model: 'unspecified',
    settings: { status: 'omitted', reason: 'unavailable' },
  },
}: {
  provider: ActorAgentLlmProvider;
  data: DataPort;
  traceProfile?: AgentTraceProfile;
  onTrace?: AgentTraceOptions['onEvent'];
  model?: AgentTraceModel;
}) {
  let serial = 0;
  return {
    start(
      scopeInput: Scope,
      {
        strategy = 'adaptive',
        maxReads = 6,
        signal = new AbortController().signal,
        runId = `investigation-${++serial}`,
        gated = false,
        readPrompt = 'standard',
        synthesisPrompt,
      }: {
        strategy?: Strategy;
        maxReads?: number;
        signal?: AbortSignal;
        runId?: string;
        gated?: boolean;
        readPrompt?: ReadPrompt;
        synthesisPrompt?: SynthesisPrompt;
      } = {}
    ) {
      const observations: Observation[] = [];
      const attempted = new Set<Source>();
      let modelCalls = 0;
      let hostReads = 0;
      let synthesisOnlyReason: ReturnType<typeof synthesisReason>;
      let readTrace: () => AgentRunTraceSnapshot | undefined = () => undefined;
      const result = (async () => {
        checkAbort(signal);
        const scope = Object.freeze(Scope.parse(scopeInput));
        if (!strategies.includes(strategy)) fail('INVALID_STRATEGY');
        if ((gated && strategy !== 'hybrid') || !Object.hasOwn(readInstructions, readPrompt))
          fail('INVALID_EXPERIMENT_OPTION');
        if (
          synthesisPrompt !== undefined &&
          (!synthesisPrompts.includes(synthesisPrompt) ||
            strategy !== 'fixed' ||
            maxReads !== synthesisSources.length ||
            readPrompt !== 'standard')
        )
          fail('INVALID_EXPERIMENT_OPTION');
        if (!Number.isSafeInteger(maxReads) || maxReads < 2 || maxReads > 6) {
          fail('INVALID_READ_BUDGET');
        }
        const authorize = (source: Source) => {
          if (attempted.has(source)) fail('REPEATED_READ');
          if (source !== 'read_sales' && !observations.some((o) => o.source === 'read_sales')) {
            fail('SALES_REQUIRED');
          }
          if (attempted.size >= maxReads) fail('READ_BUDGET_EXHAUSTED');
        };
        const read = async (source: Source, readSignal: AbortSignal, origin: 'host' | 'model') => {
          checkAbort(signal);
          checkAbort(readSignal);
          authorize(source);
          attempted.add(source);
          if (origin === 'host') hostReads++;
          const raw = await boundedRead(data, source, scope, readSignal);
          checkAbort(signal);
          checkAbort(readSignal);
          let packet: Observation;
          try {
            packet = validatePacket(raw, source, scope);
          } catch {
            return fail('INVALID_EVIDENCE');
          }
          if (source === 'read_sales') {
            const spike = calculateSpike([packet]);
            if (spike.status !== 'found') fail(spike.code);
          }
          observations.push(packet);
          return {
            evidence: structuredClone(packet),
            spike: calculateSpike(observations),
            remainingReads: maxReads - attempted.size,
          };
        };
        const hybrid = strategy === 'hybrid';
        if (hybrid) {
          for (const source of ['read_sales', 'read_orders'] as const) {
            await read(source, signal, 'host');
          }
        } else if (strategy !== 'adaptive') {
          while (attempted.size < maxReads) {
            const source =
              strategy === 'fixed'
                ? (synthesisPrompt ? synthesisSources : sources).find(
                    (source) => !attempted.has(source)
                  )
                : nextSource(observations);
            if (!source) break;
            await read(source, signal, 'host');
          }
        }
        const reconciliation = hybrid ? reconcile(observations) : undefined;
        synthesisOnlyReason = gated && reconciliation ? synthesisReason(reconciliation) : undefined;
        const modelReadBudget =
          !synthesisOnlyReason && (strategy === 'adaptive' || hybrid)
            ? maxReads - attempted.size
            : 0;
        const tools =
          modelReadBudget > 0
            ? sources
                .filter((source) => !attempted.has(source))
                .map((source) =>
                  defineTool({
                    name: source,
                    description: `${descriptions[source]} Pass only a reason. The host supplies the assigned product, store, and full date range. Read once. Unavailable is unknown, not evidence of absence.`,
                    input: ReadInput,
                    output: z.strictObject({
                      evidence: Packet,
                      spike: z.unknown(),
                      remainingReads: z.number().int().nonnegative(),
                    }),
                    check() {
                      authorize(source);
                    },
                    execute(_input, _task: Assignment, context) {
                      return read(source, context.signal, 'model');
                    },
                  })
                )
            : [];
        const output = structured(Assessment, {
          check: (assessment) => checkAssessment(assessment, observations),
        });
        const spec = {
          purpose: 'retail-spike-investigation' as const,
          systemPrompt: investigationSystemPrompt(
            strategy === 'adaptive' || strategy === 'hybrid'
              ? { mode: strategy, readInstruction: readInstructions[readPrompt] }
              : { mode: 'synthesize', oneShot: synthesisPrompt === 'one-shot' }
          ),
          tools: tools.map((t) => t.declaration),
          output,
        };
        const methodVersion = synthesisPrompt || hybrid ? 2 : strategy === 'adaptive' ? 4 : 3;
        const runner = createAgentRunner<Assignment, typeof spec.purpose>({
          spec,
          provider: (request, context) => {
            modelCalls++;
            return provider(request, context);
          },
          grants: tools.map((t) => t.declaration.name),
          tools: tools.map((t) => t.handler),
          limits: {
            runTimeoutMs: 120_000,
            askTimeoutMs: 125_000,
            providerTimeoutMs: 30_000,
            toolTimeoutMs: 2000,
            maxModelTurns: modelReadBudget + 1,
            maxToolAttempts: modelReadBudget,
            maxToolCallsPerBatch: 1,
            maxPayloadBytes: 1024 * 1024,
          },
          trace:
            traceProfile === 'off'
              ? { profile: 'off' }
              : {
                  profile: traceProfile,
                  onEvent: onTrace,
                  methodRevision: synthesisPrompt
                    ? `retail-synthesis-v${methodVersion}-${synthesisPrompt}`
                    : `retail-investigation-v${methodVersion}-${strategy}${gated ? '-gate1' : ''}${readPrompt === 'standard' ? '' : `-${readPrompt}1`}`,
                  model,
                  createRunId: () => runId,
                },
        });
        const agent = bindAgent(runner, spec);
        const task: Assignment = {
          objective:
            'Assess which explanations the records support for the largest daily sales increase in the assigned scope.',
          scope,
          observations: hybrid ? [] : structuredClone(observations),
          spike: !hybrid && observations.length ? calculateSpike(observations) : null,
          ...(reconciliation ? { reconciliation } : {}),
          remainingReads: maxReads - attempted.size,
        };
        const handle = runner.start(
          {
            purpose: agent.purpose,
            systemPrompt: agent.systemPrompt,
            tools: agent.tools,
            task,
            signal,
          },
          { assignmentId: runId, revision: methodVersion }
        );
        readTrace = handle.readTrace;
        const assessment = await handle.validateOutput((raw) => output.parse(raw, task), {
          id: 'retail-investigation-citations',
          revision: '3',
        });
        checkAbort(signal);
        const spike = calculateSpike(observations);
        if (spike.status !== 'found') return fail('SPIKE_REQUIRED');
        const trace = readTrace();
        return {
          facts: { scope, spike: spike.increase },
          assessment,
          observations: structuredClone(observations),
          strategy,
          attemptedReads: attempted.size,
          completedReads: observations.length,
          modelCalls,
          metrics: trace?.metrics,
        };
      })();
      return {
        result,
        readTrace: () => readTrace(),
        readObservations: () => structuredClone(observations),
        readHostReadCount: () => hostReads,
        readSynthesisOnlyReason: () => synthesisOnlyReason,
        readCounters: () => ({ attemptedReads: attempted.size, modelCalls }),
      };
    },
  };
}
