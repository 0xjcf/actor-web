import type {
  ActorAgentLlmProvider,
  AgentTraceEvent,
  AgentTraceModel,
  AgentTraceProfile,
} from '@actor-web/agent';
import { createAgent } from '@actor-web/agent/portable';
import { createAgentRunner } from '@actor-web/agent/runner';
import { defineTool, structured } from '@actor-web/agent/zod';
import { z } from 'zod';
import { sales, weather } from './fixtures.js';
import { findLargestSalesIncrease } from './sales-analysis.js';

const TaskInput = z.strictObject({ productId: z.literal('P005') });
const DecisionSummary = z
  .string()
  .trim()
  .min(1)
  .max(320)
  .describe(
    'One brief sentence explaining why this tool is the next action, using the task and observed facts. This is a concise decision justification.'
  );
type Task = z.infer<typeof TaskInput>;
type AnalysisRunOptions = { signal?: AbortSignal; runId?: string };
const Sale = z.strictObject({
  date: z.iso.date(),
  product_id: z.string(),
  product_name: z.string(),
  quantity: z.number().int().nonnegative(),
  revenue: z.number().nonnegative(),
});
const Weather = z.strictObject({
  date: z.iso.date(),
  temperature: z.strictObject({ fahrenheit: z.number(), celsius: z.number() }),
  conditions: z.strictObject({
    main: z.string(),
    precipitation: z.string(),
    precipitation_amount: z.number(),
    special_event: z.string().nullable(),
  }),
});
const Analysis = z.strictObject({
  date: z.iso.date(),
  amount_before_increase: z.number().positive(),
  amount_after_increase: z.number().nonnegative(),
  percentage_increase: z.number(),
  causes: z.array(z.string().trim().min(1)).min(1).max(3),
});
export const SalesIncrease = Analysis.omit({ causes: true });
export type AnalystResult = z.infer<typeof Analysis>;
export type Observation = {
  name: string;
  input: unknown;
  output: unknown;
};
export const percentageIncrease = (before: number, after: number) =>
  Math.round(((after - before) / before) * 10_000) / 100;
export function expectedSpike() {
  return sales
    .slice(1)
    .map((after, index) => ({
      date: after.date,
      amount_before_increase: sales[index].quantity,
      amount_after_increase: after.quantity,
      percentage_increase: percentageIncrease(sales[index].quantity, after.quantity),
    }))
    .sort((a, b) => b.percentage_increase - a.percentage_increase)[0];
}

/** Host configuration is bound once. Each analysis owns a fresh runner and local observations. */
export function createAnalyst({
  provider,
  toolExampleMode = 'description',
  traceProfile = 'evaluation',
  onTrace,
  model = {
    provider: 'custom',
    model: 'unspecified',
    settings: { status: 'omitted', reason: 'unavailable' },
  },
}: {
  provider: ActorAgentLlmProvider;
  toolExampleMode?: 'off' | 'description';
  traceProfile?: AgentTraceProfile;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
  model?: AgentTraceModel;
}) {
  let runSerial = 0;
  const analyst = {
    startAnalysis(
      task: Task,
      {
        signal = new AbortController().signal,
        runId = `analyst-${++runSerial}`,
      }: AnalysisRunOptions = {}
    ) {
      const assignment = TaskInput.parse(task);
      const observations: Observation[] = [];
      const readSales = defineTool({
        name: 'get_sales_data',
        description: 'Read all daily sales records for the assigned Product 5, sorted by date.',
        input: z.strictObject({ decision_summary: DecisionSummary }),
        output: z.array(Sale),
        examples: [
          {
            input: {
              decision_summary:
                'Retrieve the assigned sales records before comparing daily quantities.',
            },
            result: [
              {
                date: '2020-02-01',
                product_id: 'P005',
                product_name: 'Illustrative Product',
                quantity: 10,
                revenue: 100,
              },
            ],
          },
        ],
        check() {
          if (observations.some((o) => o.name === 'get_sales_data')) {
            throw new Error('Sales have already been read for this run.');
          }
        },
        execute(_input, task: Task) {
          const rows = sales.filter((row) => row.product_id === task.productId);
          return structuredClone(rows);
        },
      });
      const calculate = defineTool({
        name: 'find_largest_sales_increase',
        description:
          'Find the largest positive day-over-day percentage increase across all observed assigned sales. Call once after get_sales_data. Returns the winning date, quantities, and percentage rounded to two decimals; exact ties use the earliest date. No quantities or dates are accepted as input.',
        input: z.strictObject({
          decision_summary: DecisionSummary,
        }),
        output: SalesIncrease,
        examples: [
          {
            input: {
              decision_summary: 'Find the maximum increase across the observed sales records.',
            },
            result: {
              date: '2020-02-02',
              amount_before_increase: 100,
              amount_after_increase: 150,
              percentage_increase: 50,
            },
          },
        ],
        check(_input, _task: Task) {
          if (!observations.some((o) => o.name === 'get_sales_data')) {
            throw new Error('Read the assigned sales before calculating the maximum increase.');
          }
          if (observations.some((o) => o.name === 'find_largest_sales_increase')) {
            throw new Error('The maximum increase has already been calculated.');
          }
        },
        execute(_input, task: Task) {
          const observed = observations.find((o) => o.name === 'get_sales_data');
          const rows = z.array(Sale).parse(observed?.output);
          if (rows.some((row) => row.product_id !== task.productId)) {
            throw new Error('Sales observations must belong to the assigned product.');
          }
          const result = findLargestSalesIncrease(rows);
          if (result.status === 'unavailable') {
            throw Object.assign(new Error('Cannot determine a positive daily sales increase.'), {
              code: result.code,
            });
          }
          return result.increase;
        },
      });
      const readWeather = defineTool({
        name: 'call_weather_api',
        description:
          'Read simulated weather for the date returned by find_largest_sales_increase. Call once after that calculation. This tool makes no network request.',
        input: z.strictObject({ date: z.iso.date(), decision_summary: DecisionSummary }),
        output: Weather,
        examples: [
          {
            input: {
              date: '2020-02-02',
              decision_summary:
                'Check weather on the identified spike date for possible contributing factors.',
            },
            result: {
              date: '2020-02-02',
              temperature: { fahrenheit: 68, celsius: 20 },
              conditions: {
                main: 'Clear',
                precipitation: 'None',
                precipitation_amount: 0,
                special_event: null,
              },
            },
          },
        ],
        check(input, _task: Task) {
          const maximum = observations.find((o) => o.name === 'find_largest_sales_increase');
          const increase = SalesIncrease.safeParse(maximum?.output);
          if (
            !increase.success ||
            increase.data.date !== input.date ||
            observations.some((o) => o.name === 'call_weather_api')
          ) {
            throw new Error('Read weather once, using the observed maximum-increase date.');
          }
        },
        execute(input) {
          const record = weather.find((row) => row.date === input.date);
          if (!record) throw new Error('No weather fixture for this date.');
          return structuredClone(record);
        },
      });
      const tools = [readSales, calculate, readWeather];
      const spec = {
        purpose: 'retail-spike-analysis' as const,
        systemPrompt: [
          'Find the single largest day-over-day percentage increase in quantity sold for the assigned product.',
          'Use native tools one at a time, exactly once each: get_sales_data, then find_largest_sales_increase, then call_weather_api for the date returned by the maximum tool.',
          'The maximum tool compares every daily pair deterministically using the observed sales. Do not calculate individual pairs or supply quantities to it. After weather returns, produce the final answer without more tool calls.',
          'Every tool call must include decision_summary: one brief sentence explaining why the action is needed, using the task and observed facts. It is a required tool argument; separate assistant commentary is optional.',
          'Tool examples are synthetic format illustrations, not observations or assigned quantities. Never use example values as evidence.',
          'Explain possible weather-related causes as hypotheses, explicitly stating that correlation does not establish causation.',
          'Return only the final JSON required by the output schema. Do not output THINK/ACT markers or call a final_answer tool.',
        ].join('\n'),
        tools: tools.map((tool) => tool.declaration),
        output: structured(Analysis, {
          check(result, _task: Task) {
            const expected = expectedSpike();
            if (
              result.date !== expected.date ||
              result.amount_before_increase !== expected.amount_before_increase ||
              result.amount_after_increase !== expected.amount_after_increase ||
              result.percentage_increase !== expected.percentage_increase
            ) {
              return 'The answer does not match the largest spike in the assigned records.';
            }
            const maximum = observations.find((o) => o.name === 'find_largest_sales_increase');
            const observedIncrease = SalesIncrease.safeParse(maximum?.output);
            const calculation =
              observedIncrease.success &&
              observedIncrease.data.date === expected.date &&
              observedIncrease.data.amount_before_increase === expected.amount_before_increase &&
              observedIncrease.data.amount_after_increase === expected.amount_after_increase &&
              observedIncrease.data.percentage_increase === expected.percentage_increase;
            const weatherRead = observations.some(
              (o) =>
                o.name === 'call_weather_api' &&
                (o.input as { date: string }).date === expected.date
            );
            if (!calculation || !weatherRead)
              return 'Required calculation and weather observations are missing.';
          },
        }),
      };
      const runner = createAgentRunner<Task, 'retail-spike-analysis'>({
        spec,
        provider,
        toolExampleMode,
        trace:
          traceProfile === 'off'
            ? { profile: traceProfile }
            : {
                profile: traceProfile,
                methodRevision: 'retail-analyst-v4',
                model,
                createRunId: () => runId,
                case: {
                  datasetId: 'retail-fixtures',
                  datasetRevision: '1',
                  caseId: assignment.productId,
                },
                onEvent: onTrace,
              },
        grants: tools.map((tool) => tool.declaration.name),
        tools: tools.map(({ handler }) => ({
          ...handler,
          async execute(input, task, context) {
            const output = await handler.execute(input, task, context);
            const observation = {
              name: handler.name,
              input: structuredClone(input),
              output: structuredClone(output),
            };
            observations.push(observation);
            return output;
          },
        })),
        // Plain JSON assignments use the runner's default encoding.
        limits: {
          runTimeoutMs: 120_000,
          askTimeoutMs: 110_000,
          providerTimeoutMs: 30_000,
          toolTimeoutMs: 1000,
          maxModelTurns: 12,
          maxToolAttempts: 10,
          maxToolCallsPerBatch: 1,
          maxPayloadBytes: 512 * 1024,
        },
      });
      const agent = createAgent(runner, spec);
      const handle = runner.start(
        {
          purpose: agent.purpose,
          systemPrompt: agent.systemPrompt,
          tools: agent.tools,
          task: assignment,
          signal,
        },
        { assignmentId: runId, revision: 4 }
      );
      const result = handle
        .validateOutput((raw) => spec.output.parse(raw, assignment), {
          id: 'retail-analysis',
          revision: '4',
        })
        .then((analysis) => {
          const snapshot = handle.readTrace();
          return {
            analysis,
            observations,
            trace: snapshot?.events ?? [],
            traceCompleteness: snapshot?.completeness,
            traceTruncated: snapshot?.completeness.status === 'incomplete',
            traceDeliveryFailures: snapshot?.deliveryFailures ?? 0,
            metrics: snapshot?.metrics,
          };
        });
      return {
        result,
        readTrace: handle.readTrace,
      };
    },
    async analyze(task: Task, options?: AnalysisRunOptions) {
      return analyst.startAnalysis(task, options).result;
    },
  };
  return analyst;
}
