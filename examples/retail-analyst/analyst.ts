import type {
  ActorAgentLlmProvider,
  AgentRunTraceSnapshot,
  AgentTraceEvent,
  AgentTraceModel,
  AgentTraceProfile,
} from '@actor-web/agent';
import { createAgent as bindAgent } from '@actor-web/agent/portable';
import { AgentRunnerError, createAgentRunner } from '@actor-web/agent/runner';
import { structured } from '@actor-web/agent/zod';
import {
  Advisory,
  checkAdvisory,
  type Evidence,
  evidenceReferences,
  type FactResult,
  prepareEvidence,
  prepareSales,
  type Task,
  TaskInput,
} from './evidence.js';
import { sales, weather } from './fixtures.js';

export const methodRevision = 'retail-analyst-v5-edge';
export type AnalystResult = { facts: Evidence; advisory: Advisory };
export type Observation = { name: string; input: unknown; output: unknown };

/** Explicit data ports. Expected adapter failures are facts; the core validates raw data. */
export interface AnalystDataPorts {
  readSales: (productId: string, signal: AbortSignal) => Promise<FactResult<unknown>>;
  readWeather: (date: string, signal: AbortSignal) => Promise<FactResult<unknown>>;
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new AgentRunnerError('RUN_ABORTED', 'The assignment was aborted.');
}

export const fixtureDataPorts: AnalystDataPorts = {
  async readSales(productId) {
    return {
      ok: true,
      value: structuredClone(sales.filter((row) => row.product_id === productId)),
    };
  },
  async readWeather(date) {
    const record = weather.find((row) => row.date === date);
    return record
      ? { ok: true, value: structuredClone(record) }
      : { ok: false, code: 'WEATHER_UNAVAILABLE' };
  },
};

const output = structured(Advisory, { check: checkAdvisory });
const spec = {
  purpose: 'retail-evidence-explanation' as const,
  systemPrompt: [
    'Suggest up to three concise, nonredundant hypotheses about the observed sales increase.',
    'The application already calculated the increase and retrieved weather. Do not choose actions, call tools, or recalculate facts.',
    'Use only the supplied evidence. Cite the supplied reference IDs for every hypothesis.',
    'Describe possible relationships, never established causes. Correlation does not establish causation.',
    'The product category, customer behavior, store availability, promotions, and supply conditions are unknown. Do not invent them.',
    'The precipitation amount has no supplied unit. Do not assign inches, millimeters, or another unit.',
    'Do not imply weather conditions are unusual without a comparison. Weather and sales alone cannot explain why demand changed.',
    'Return an empty hypotheses array if no useful hypothesis is supported. Output only the requested JSON.',
  ].join('\n'),
  tools: [],
  output,
};

export type AnalystOptions = {
  provider: ActorAgentLlmProvider;
  data?: AnalystDataPorts;
  traceProfile?: AgentTraceProfile;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
  model?: AgentTraceModel;
};

function requireFact<T>(result: FactResult<T>): T {
  if (!result.ok) throw new AgentRunnerError(result.code, 'The analyst data step failed.');
  return result.value;
}

/** A timed or cancelled read may still settle later; it cannot advance this workflow. */
async function readPort(
  read: (signal: AbortSignal) => Promise<FactResult<unknown>>,
  signal: AbortSignal
): Promise<unknown> {
  checkAbort(signal);
  const control = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort = () => {};
  const interrupted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      control.abort(signal.reason);
      reject(new AgentRunnerError('RUN_ABORTED', 'The assignment was aborted.'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      control.abort();
      reject(new AgentRunnerError('DATA_TIMEOUT', 'The data read timed out.'));
    }, 1000);
  });
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => {
        checkAbort(control.signal);
        return read(control.signal);
      }),
      interrupted,
    ]);
    checkAbort(signal);
    return requireFact(result);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Application-owned ordering; the LLM is a one-shot advisory I/O adapter. */
export function createAnalyst({
  provider,
  data = fixtureDataPorts,
  traceProfile = 'evaluation',
  onTrace,
  model = {
    provider: 'custom',
    model: 'unspecified',
    settings: { status: 'omitted', reason: 'unavailable' },
  },
}: AnalystOptions) {
  let runSerial = 0;
  const analyst = {
    startAnalysis(
      task: Task,
      {
        signal = new AbortController().signal,
        runId = `analyst-${++runSerial}`,
      }: { signal?: AbortSignal; runId?: string } = {}
    ) {
      const observations: Observation[] = [];
      let readTrace: () => AgentRunTraceSnapshot | undefined = () => undefined;
      const result = (async () => {
        checkAbort(signal);
        const assignment = TaskInput.parse(task);
        const rows = await readPort(
          (signal) => data.readSales(assignment.productId, signal),
          signal
        );
        const increase = requireFact(prepareSales(assignment.productId, rows));
        observations.push(
          {
            name: 'get_sales_data',
            input: { productId: assignment.productId },
            output: structuredClone(rows),
          },
          { name: 'find_largest_sales_increase', input: {}, output: { ...increase } }
        );
        const record = await readPort((signal) => data.readWeather(increase.date, signal), signal);
        const facts = requireFact(prepareEvidence(assignment, increase, record));
        observations.push({
          name: 'call_weather_api',
          input: { date: increase.date },
          output: structuredClone(record),
        });
        signal.throwIfAborted();
        const runner = createAgentRunner<Evidence, typeof spec.purpose>({
          spec,
          provider,
          grants: [],
          tools: [],
          encodeTask: (facts) =>
            JSON.stringify({ facts, availableReferences: evidenceReferences(facts) }),
          limits: {
            runTimeoutMs: 35_000,
            askTimeoutMs: 32_000,
            providerTimeoutMs: 30_000,
            toolTimeoutMs: 1000,
            maxModelTurns: 1,
            maxToolAttempts: 0,
            maxToolCallsPerBatch: 1,
            maxPayloadBytes: 64 * 1024,
          },
          trace:
            traceProfile === 'off'
              ? { profile: 'off' }
              : {
                  profile: traceProfile,
                  methodRevision,
                  model,
                  createRunId: () => runId,
                  case: {
                    datasetId: 'retail-fixtures',
                    datasetRevision: '1',
                    caseId: assignment.productId,
                  },
                  onEvent: onTrace,
                },
        });
        const agent = bindAgent(runner, spec);
        const handle = runner.start(
          {
            purpose: agent.purpose,
            systemPrompt: agent.systemPrompt,
            tools: agent.tools,
            task: facts,
            signal,
          },
          { assignmentId: runId, revision: 5 }
        );
        readTrace = handle.readTrace;
        const advisory = await handle.validateOutput((raw) => output.parse(raw, facts), {
          id: 'retail-advisory',
          revision: '5',
        });
        signal.throwIfAborted();
        const snapshot = readTrace();
        return {
          analysis: { facts, advisory } satisfies AnalystResult,
          observations,
          hostReads: 2,
          calculations: 1,
          trace: snapshot?.events ?? [],
          traceCompleteness: snapshot?.completeness,
          traceTruncated: snapshot?.completeness.status === 'incomplete',
          traceDeliveryFailures: snapshot?.deliveryFailures ?? 0,
          metrics: snapshot?.metrics,
        };
      })();
      return {
        result,
        readTrace: () => readTrace(),
        readObservations: () => structuredClone(observations),
      };
    },
    async analyze(task: Task, options?: { signal?: AbortSignal; runId?: string }) {
      return analyst.startAnalysis(task, options).result;
    },
  };
  return analyst;
}
