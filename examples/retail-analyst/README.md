# Retail demand analyst

A `createAnalyst({ provider })` example of the Udacity Lesson 2, Part II sales-spike investigation. The application owns data retrieval and arithmetic; a fresh local Actor-Web session asks the LLM only for advisory hypotheses. The previous model-directed v4 workflow remains available as an explicit comparison baseline.

<!-- Public analyst factory and result shape from analyst.ts; evidence and advisory contracts from evidence.ts. -->

```ts
const analyst = createAnalyst({ provider });
const { analysis, observations } = await analyst.analyze({ productId: 'P005' });
console.log(analysis.facts.increase); // Application-calculated numeric facts.
console.log(analysis.advisory); // Model hypotheses, not established causes.
```

## Run

<!-- Build, demo, live, and evaluation scripts from package.json; CLI flags from demo.ts and evaluate.ts. -->

From the Actor-Web root, install the workspace and build the public packages:

```sh
pnpm install --offline
pnpm --filter @actor-web/runtime build
pnpm --filter @actor-web/agent build
pnpm examples:analyst
```

The default is a scripted provider with no network or credentials. Its final result is January 12, 2024: 114 to 342 units, a 200% increase. It demonstrates execution, not model quality.

For a bounded live run, reuse the existing `OPENAI_API_KEY` in the root `.env.local`:

```sh
pnpm examples:analyst:live
```

The Node host loads that file without copying or printing its contents. It calls OpenAI Chat Completions with `gpt-4.1-mini`; `OPENAI_ANALYST_MODEL` overrides the demo model. The new workflow grants no model tools and allows exactly one provider attempt, with a 30-second provider timeout and a 35-second runner deadline. Each of its two data reads has a one-second deadline. Cancellation prevents later steps and late acceptance; it does not prove a remote read stopped. Failure exits nonzero. No implicit retries or repair are added.

Use `node examples/retail-analyst/dist/demo.js --baseline` for the previous scripted workflow, or add `--baseline --live` when running the Node entry with the environment file loaded. The baseline retains its original limits: 12 model turns, 10 tool attempts, and 120 seconds.

## LLM at the edge

<!-- Application-owned ordering and explicit data ports from analyst.ts; pure policy from evidence.ts and sales-analysis.ts. -->

`retail-analyst-v5-edge` executes:

1. Read sales through the `AnalystDataPorts.readSales` port.
2. Validate product scope and calculate the maximum with the pure `findLargestSalesIncrease`.
3. Read weather through `readWeather` for the calculated date and validate its schema/date.
4. Send the evidence to a no-tools, one-turn Actor-Web runner.
5. Validate the advisory schema and evidence-reference membership, then return `{ facts, advisory }`.

`data` can supply alternative read adapters. Defaults return detached synthetic fixtures, not network weather. The core does not consult the fixture's expected answer: changing valid sales changes the result deterministically. Expected data failures are `{ ok: false, code }` at the port; the async application facade rejects them. The sequential coordinator is an imperative shell, not a pure function or a new workflow actor. The model session is actor-hosted; business policy remains pure and external effects use explicit ports.

The LLM cannot choose the next operation, override numeric fact fields, or acquire tool grants. Its hypotheses include explicit evidence references and `causation: 'not-established'`; an empty list is allowed. These structural checks **do not prove narrative truth**. A valid reference can still accompany an unsupported explanation. The regression suite deliberately demonstrates this limitation.

The model trace covers the advisory session, not earlier data reads. `observations` / `readObservations()` describe successful host stages separately; `hostReads` counts successful data reads and `calculations` counts the pure maximum calculation. Zero model tool calls does not mean zero I/O. A failure before model startup has no model trace. Read timeout/abort invalidates this assignment but is not a cleanup receipt for an uncooperative adapter.

## Controlled v4 versus v5 comparison

<!-- Paired evaluation protocol from evaluate.ts; mechanical checks and narrative rubric from evaluation.ts; recorded outcomes in edge-evaluation-live.json and edge-evaluation-review.json. -->

Run from the repository root:

```sh
pnpm --filter @actor-web/example-retail-analyst evaluate
pnpm --filter @actor-web/example-retail-analyst evaluate:live
```

The live command makes paid API calls. Each comparison runs three pairs in alternating order, with the same fixtures, `gpt-4.1-mini` alias, temperature 0, disabled parallel tool calls, and 600 maximum completion tokens per response. It allows at most 39 API calls, with no retries. The model alias is intentionally fixed for this comparison; the demo's model override does not change it. Results are written after every attempt, including failures. Each file records source/fixture hashes, prompts, responses, usage, observations, structural checks, and an unfilled semantic-review field.

Default output files are `edge-evaluation-scripted.json` and `edge-evaluation-live.json` in the example directory; rerunning replaces that mode's report. To preserve a new trial separately, run the built CLI with `--output /path/to/new-report.json`. Do not silently combine a rerun with the recorded results.

The recorded live pilot used 15 calls total. All three runs per variant were accepted, numerically correct, and completed both reads and the calculation:

| Mean per assignment | v4 baseline | v5 edge |
| --- | ---: | ---: |
| Model calls | 4 | 1 |
| Model-selected tool executions | 3 | 0 |
| Successful data reads | 2 | 2 |
| Pure maximum calculations | 1 | 1 |
| Reported input tokens | 5,545.3 | 452 |
| Reported output tokens | 184 | 144 |
| End-to-end elapsed time | 4,715 ms | 1,759 ms |

That is 75% fewer model calls, 91.8% fewer reported input tokens, and 62.7% lower mean elapsed time **in this small pilot**. Output tokens fell 21.7%. Numerical correctness tied; no reliability-rate improvement is established by three successes per variant.

**Explanatory quality did not clearly improve.** Baseline outputs speculated about customers moving indoors and stockpiling. Candidate outputs added explicit citations and uncertainty metadata, but still described unitless precipitation as “substantial” and temperature as “relatively low” without a comparison. Those comparative claims are not supported by the supplied evidence. Neither variant invented precipitation units in these fresh trials; that failure occurred in an older v2 result. See `edge-evaluation-review.json` for an author, non-blinded review of all six outputs against the declared rubric.

This compares a bundled workflow/context/prompt/output-contract change, not architecture alone. The data is synthetic, the model alias is unpinned, and there is no causal ground truth. Mechanical indicators and accepted schemas are not semantic scores. The v1–v3 reports below are historical context, not the controlled baseline. No prompts were tuned between the recorded live pairs.

## Preserved baseline flow

<!-- Tool order, observed-input checks, and method revision from baseline-analyst.ts; calculation policy from sales-analysis.ts. -->

`retail-analyst-v4` uses `get_sales_data` → `find_largest_sales_increase` → `call_weather_api` → final answer. The successful scripted path takes three tool calls and four model turns. The prompt requests this order, and tool checks enforce it: each tool runs at most once, the maximum requires a successful sales observation, and weather must use the returned winning date. Out-of-order or repeated requests fail rather than being silently repaired.

The maximum tool accepts only `decision_summary`, not quantities, dates, product IDs, or replacement sales data. It computes from the assigned product's observed sales result. It sorts a copy, compares every consecutive daily pair using unrounded ratios, selects the earliest date on exact ties, and rounds the winning percentage to two decimals. Invalid quantities/dates, duplicate or missing daily dates, fewer than two records, a zero baseline, and no positive increase produce explicit failure codes rather than a fabricated winner.

The scripted provider chooses weather and final numeric output from the maximum tool observation, not from a fixture-answer shortcut. Final validation still independently checks the fixture's expected numeric result and requires matching maximum and weather observations. Earlier v3 traces remain available for comparison; no new live performance or model-quality claim is implied by the scripted run.

## Compare the actual notebook

`fixtures.ts` copies Product 5 and weather from the notebook's synthetic `lesson_2_lib.py`. Both approaches use quantity sold, not revenue. Weather retrieval remains local simulated data in both approaches; only model inference is live.

Run `compare-notebook.py` with the notebook environment's Python interpreter:

```sh
/path/to/notebook-repo/.venv/bin/python examples/retail-analyst/compare-notebook.py \
  --notebook /path/to/notebook-repo/lesson-2-chain-of-thought-and-react-prompting/exercises/concept2-react-prompting/starter/lesson-2-chain-of-thought-and-react-prompting-part-ii.ipynb \
  --env-file /path/to/notebook-repo/.env
```

This executes the actual completed calculator, regex dispatcher, and loop cells from the supplied notebook. It extracts the prompt literals without spending the extra standalone Section 2 model call. Notebook code is executed as Python: use the trusted exercise file. It uses the notebook's own key, defaults to the same model, disables SDK retries, and sets a 30-second request timeout. The notebook's completed loop supplies its existing iteration bound. Failures return nonzero without dumping SDK exceptions.

Compare the date, quantities, percentage, tool sequence, model calls, tokens, and elapsed time. The comparison derives the before quantity from the shared fixture because the notebook's final tool does not return it. Prompts and tool contracts differ: Actor-Web v4 computes the maximum over observed sales in one tool call, whereas the Python notebook evaluates model-provided arithmetic expressions. Historical Actor-Web runs used pairwise `percentage_increase` calls. Python sets temperature 0.7 while the native adapter currently uses provider defaults. One run is a demonstration, not a controlled performance benchmark. Do not interpret different hypotheses or token counts as a measured framework advantage.

## Where the work lives

<!-- Source and test modules in examples/retail-analyst. -->

- `analyst.ts`: application-owned workflow, explicit data ports, bounded reads, and no-tools advisory runner.
- `evidence.ts`: pure product/date checks, fact assembly, advisory schema, and reference validation.
- `baseline-analyst.ts`, `baseline-scripted-provider.ts`, and `baseline-analyst.test.ts`: preserved v4 implementation, offline provider, and regression suite.
- `sales-analysis.ts`: pure maximum-increase calculation and explicit edge-case outcomes.
- `demo.ts`: Node environment access, provider configuration, console output, and baseline/candidate/live/scripted selection.
- `scripted-provider.ts`: deterministic advisory response for offline protocol verification, not model-quality evidence.
- `evaluate.ts`: bounded paired comparison CLI and result capture.
- `evaluation.ts` and `evaluation.test.ts`: fixed-fixture oracle, mechanical indicators, and declared qualitative rubric.
- `fixtures.ts`: seven sales records and seven weather records from the exercise.
- `analyst.test.ts`: real local advisory sessions, changed input facts, scope/cancellation failures, reference validation, and trace independence.
- `sales-analysis.test.ts`: maximum selection, tie-breaking, rounding, and invalid/insufficient data.
- `@actor-web/agent/terminal`: the shared reporter used by the CLI, also available to other hosts.
- `compare-notebook.py`: optional comparison against the original notebook.

The baseline's `defineTool` comes from `@actor-web/agent/zod`. It owns schema conversion and typed validation, while grants remain host-owned. The candidate instead gives the model a projection of validated evidence and reference IDs, not the full sales history or tool declarations.

The final check verifies the largest spike and requires successful sales, matching calculation, and matching weather observations. It does not independently prove that prose hypotheses are causal explanations. Observations are in-memory successful handler outputs, not durable or cross-process execution receipts. `structured()` checks final JSON locally; it does not configure provider-native output constraints. The remaining improvements are tracked in [the Actor-Web backlog](../../docs/todos.md#analyst-example-and-tool-ergonomics).

These APIs target the local checkout; the agent package README documents features newer than the published 0.2.1 release.

See [the recorded local verification](verification.md) and [machine-readable results](verification.json) for the first live comparison, including the rejected initial batch.

## Decision-level evaluation traces

<!-- Advisory capture from analyst.ts, baseline decision-summary input validation from baseline-analyst.ts, and rendering behavior from ../../packages/actor-agent/src/terminal.ts. -->

The CLI opts in to Actor-Web's terminal reporter. It uses dividers and, on a TTY, different colors: cyan for model-authored explanations, magenta for provider reasoning summaries, yellow for tool requests/final candidates, blue for successful observations, green for passed validation/validated output, and red for failures. Labels remain visible without color. Use `--color` to force ANSI color, `--no-color` or `NO_COLOR` to disable it, and `--json` for ANSI-free JSONL when running the built Node entry directly.

```sh
pnpm --filter @actor-web/example-retail-analyst build
node examples/retail-analyst/dist/demo.js --color
node examples/retail-analyst/dist/demo.js --json
node examples/retail-analyst/dist/demo.js --trace-profile metadata --trace-file /tmp/retail-metadata.jsonl
node --env-file=.env.local examples/retail-analyst/dist/demo.js --live --trace-file /tmp/retail-trace.jsonl
```

The example now consumes the shared runner `AgentTraceEvent` envelopes rather than an analyst-specific trace union. Every event has a run ID, sequence number, timestamp, schema version, type, and nested payload. `model.requested` captures the effective system prompt, message history, granted tool definitions/examples, and host-supplied model settings. The terminal summarizes model inputs; `--json`, `--trace-file`, and the returned `trace` retain the full captured requests for evaluation.

Every **baseline** tool requires a `decision_summary` string: one concise model-authored justification, 1–320 characters after trimming. Tool validation rejects missing, blank, and oversized summaries before execution. The cyan decision block reads that field even when optional assistant prose is absent; any returned assistant prose is also retained. Requests and observations join by tool-call ID and model-call ID, not tool name. The candidate has no model-selected tools or decision summaries: it returns only an advisory candidate.

`run.completed` means raw execution finished; it does not mean the analysis passed validation. The host calls `validateOutput` with the retail validator revision, emitting `output.validated`. Only its passed verdict renders `VALIDATED OUTPUT`; the host reports its accepted analysis separately. A schema or business-rule failure emits failed validation after successful raw execution. The separate domain observation list remains independent of trace capture, so omitted events cannot change business validation.

The example defaults to the canonical `evaluation` profile for these synthetic fixtures. Select `--trace-profile metadata` to omit trace content, or `--trace-profile off` to disable tracing without changing execution. The separate console `analyst.result` report still contains the accepted answer. `startAnalysis()` exposes `readTrace()` whether its validation promise resolves or rejects; `analyze()` retains its success-result API.

The shared collector defaults to 256 events, 1 MiB total event JSON, and 64 KiB per content field. After a run settles, `--trace-file` appends the package's canonical JSONL: retained event envelopes followed by one `agent.trace.summary` line with completeness, delivery failures, and metrics, including on rejection. New files are created with mode `0600`; file-write failures are reported separately. `--json` emits the same records to stdout and then the separate application result on success. Treat evaluation logs as application data. Historical JSONL and verification artifacts retain their original format.

The notebook's THINK text and this example's explanations are model-authored output, not access to hidden internal computation. GPT-4.1 mini does not return native reasoning summaries. With a compatible reasoning model selected using `OPENAI_ANALYST_MODEL`, `--responses --reasoning-summary` requests Responses summaries explicitly. The adapter keeps returned summaries separate from assistant text and preserves opaque reasoning items for continuation; opaque items are excluded from these evaluation logs. This capability is covered with scripted API responses; a live reasoning-model run is separate from the GPT-4.1 comparison.

## Baseline tool examples

<!-- Input/result examples declared by defineTool calls in baseline-analyst.ts; injection controlled by createAnalyst. -->

The preserved v4 baseline supplies `examples` through `defineTool` and enables the runner's `toolExampleMode: 'description'` mode. All three tools have synthetic input/result pairs. The helper validates their schema shape; the runner retains its four-pair/4-KiB bound and injects examples only into granted, implemented tool descriptions. They do not execute handlers, create observations, or relax assignment scope. Examples use dates and quantities outside the actual fixture to make leakage visible. The v5 advisory workflow does not expose tools, so tool examples are not applicable.

```ts
const maximumExample = {
  input: {
    decision_summary: 'Find the maximum increase across the observed sales records.',
  },
  result: {
    date: '2020-02-02',
    amount_before_increase: 100,
    amount_after_increase: 150,
    percentage_increase: 50,
  },
};
```

Use `--baseline --no-tool-examples` to compare the baseline task and prompt without description examples. Examples may clarify arguments, formatting, and output meaning; they add prompt tokens and are not a guarantee of better results. Assess tool choice, argument validity, example leakage, factual accuracy, unsupported claims, turns, and tokens across repeated runs. Treat explanations/summaries as model output to evaluate against observations, never as proof of correctness.

See [trace verification and examples-on/off findings](tracing-verification.md), including partial explanation coverage and the narrative-grounding limitation.

The earlier `retail-analyst-v2` traces are historical: their optional assistant prose appeared on only one of eight tool turns. `retail-analyst-v3` introduced required decision summaries. `retail-analyst-v4` retains them and replaces pairwise calculator calls with one observed-sales maximum calculation. These summaries remain model-authored justifications, not internal reasoning or proof that an action is correct; the arithmetic does not use their text.

See [required-summary verification](decision-summary-verification.md): the live v3 run included a decision summary on every tool call. The [current preview](trace-preview.txt) reflects that run.
