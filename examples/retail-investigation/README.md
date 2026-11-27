# Retail sales-spike investigation

The [retail analyst](../retail-analyst/README.md) knows which evidence it needs. This example asks a different question: **which source is worth reading next?** The model can choose an investigative read or stop, but it cannot change the assigned product, store, dates, permissions, budget, or calculated sales facts.

## Try it offline

<!-- CLI options from demo.ts; package scripts from package.json and ../../package.json. -->

From the workspace root, with dependencies installed:

```sh
pnpm --filter @actor-web/runtime build
pnpm --filter @actor-web/agent build
pnpm examples:investigation
pnpm examples:investigation:evaluate
```

The first demo uses `bulk-order` and `adaptive`: the scripted provider requests sales, sees a 100 → 300 unit spike, requests orders, and finds one 200-unit order. It stops without checking weather. The fixed checklist reads all six sources for the same case.

To choose another case or strategy after the build:

```sh
node examples/retail-investigation/dist/demo.js --case confounded --strategy adaptive
node examples/retail-investigation/dist/demo.js --case insufficient --strategy rules
node examples/retail-investigation/dist/demo.js --compare --output /tmp/retail-investigation.json
```

Single runs stream the same `@actor-web/agent/terminal` trace as the retail analyst, then print facts, assessment, checks, read sequence, calls, usage when reported, and elapsed time. In adaptive mode the trace shows proposed reads and their observations; fixed/rule reads happen before the model session and appear in the summary, not as model tool calls. Color is automatic on a TTY unless `NO_COLOR` is set; use `--color` or `--no-color` to override.

For machine output, `--json` prints one single-run JSON summary to stdout. `--compare` prints one JSON line per attempt, rotating strategy order across cases. Both modes omit terminal traces by default. Add `--trace-terminal` to stream the analyst-style trace to **stderr** as each assignment runs; comparisons label each case and strategy. This leaves the CLI's stdout and the structured `--output` report unchanged. For JSONL redirection without pnpm's build messages, invoke the built `demo.js` directly.

`--output` optionally writes a full report with observations and structured runner traces at the end; it refuses to overwrite an existing path. Model/provider failures are reported, not retried or dropped.

Archived `evals/*-live.json` reports retain the bytes written by the runner; the repository formatter does not rewrite them.

## Tools and mock cases

<!-- Scoped record schemas from evidence.ts; data generation from createDataset in fixtures.ts. -->

| Read-only tool | Records supplied |
| --- | --- |
| `read_sales` | Daily units, unit price, revenue, and channel, with a host-calculated maximum increase |
| `read_promotions` | Campaign ID, active date, discount, and audience |
| `read_inventory` | Closing units, deliveries, and stockout hours |
| `read_weather` | Conditions, temperature in °C, daily precipitation in mm, and a historical reference |
| `read_orders` | Row ID, order ID, units, and cancellation flag; repeated order IDs can reveal duplicated transactions |
| `read_comparison_sales` | Daily units for a comparison product at the same store; its suitability as a control is not guaranteed |

All six cases use the same model-visible scope (`P005`, `S001`, February 1–3, 2025). Case names and evaluation expectations are not passed to the investigator. Records are synthetic; missing records are distinct from an available source with no entries.

| CLI case | What to investigate |
| --- | --- |
| `promotion` | A discount and lower price coincide with the spike; comparison sales stay flat |
| `restocking` | A delivery follows prior stockouts; availability is not underlying demand |
| `bulk-order` | One large order accounts for the additional units |
| `data-defect` | Repeated order IDs inflate the recorded total; reconcile before interpreting demand |
| `confounded` | A discount and unusually heavy rainfall coincide; these observations do not separate their effects |
| `insufficient` | Sales exist but the other sources are unavailable; abstention is appropriate |

## Compare decision ownership

<!-- Strategy boundaries from createInvestigator in investigation.ts; deterministic rules from policy.ts. -->

- **`fixed`:** the application reads the checklist, then requests one no-tools assessment.
- **`rules`:** the application selects follow-up reads using explicit rules, then requests one no-tools assessment.
- **`adaptive`:** the provider selects one read per turn or returns an assessment. Each read takes only a `reason` (1–240 characters after trimming). The host binds the assigned product, store, and full date range, including for comparison sales. Extra parameters such as `scope`, `productId`, or `startDate` are rejected before the data port runs. Returned records are still checked against the assignment. The receipt includes the records, calculated spike, and remaining budget.

All three strategies share the data port, scope checks, sales calculation, read budget (default six), assessment schema, and citation checks. `createInvestigator({ provider, data }).start(scope, { strategy, maxReads, signal })` returns a result promise and detached observation/trace readers. Each assignment has its own ledger. Reads have a one-second deadline; cancellation or timeout prevents late acceptance, but does not prove an external adapter stopped. The model session has a 120-second deadline and 30-second provider timeout. No writes or remediation tools are granted.

The application returns `facts.spike` separately from `assessment`. `supported` means evidence supports a hypothesis or data issue, **not** that an underlying demand cause was established. `confounded` identifies competing explanations; `insufficient-evidence` permits abstention. Citation checks reject references to unobserved or unavailable sources. An `availability-recovery` finding must cite inventory showing a prior stockout and spike-day replenishment. A `weather-association` finding must cite available `read_weather` evidence showing positive precipitation **on the spike date, strictly greater than 3 × that record’s daily reference**. This is the example’s existing unusual-rain rule, not a general test for weather effects. A campaign targeting weather-alert subscribers is not a measurement. These checks constrain labels, not every claim in the prose.

The current validator is revision 3 (adaptive method v4, fixed/rules v3, hybrid and synthesis v2). Historical reports below retain their original prompts, validation outcomes and revisions.

## What the comparison measures

### Opt-in hybrid comparison

`--strategy hybrid` pre-reads sales and orders under the normal scope, deadline and six-read budget. The model gets a compact reconciliation: sales delta and prices, non-cancelled order counts, repeated identifiers, largest row, and residual units. Unavailable orders have no totals; mismatched totals and duplicated spike-day IDs do not yield a reconciled residual. The host retains the original packets. Only the remaining sources are granted. The model may assess immediately or request a discriminating follow-up; accounting for the units does not establish a cause.

Use `--compare-hybrid` to run all four strategies on the six original cases plus `mixed-order-promotion` (a large order and discounted campaign coexist) and `partial-availability` (orders and inventory are unavailable but weather is informative). Ordinary `--compare` stays at 18 assignments. `--trials 2` repeats the matrix with a shifted strategy order. Read `extraKinds` and `missedKinds` alongside acceptance, numeric and status checks; rejected attempts remain in the report. Scripted selection is a wiring check, not evidence of live model quality.

```sh
pnpm --filter @actor-web/example-retail-investigation evaluate --compare-hybrid --trials 2
pnpm --filter @actor-web/example-retail-investigation evaluate:live --compare-hybrid --trials 2 --output "evals/$(date -u +%Y%m%dT%H%M%SZ)-hybrid-live.json"
```

The second command makes paid calls: 64 assignments, at most 224 provider calls, no retries. Host reads are counted separately from model-selected reads; usage on rejections is reported when available.

### Hybrid evaluation result (2026-11-25)

The [scorecard](evals/20261125T180837Z-hybrid-scorecard.json) compares the [live matrix](evals/20261125T180837Z-hybrid-live.json.gz) with its [scripted counterpart](evals/20261125T180821Z-hybrid-scripted.json.gz). The live run completed all 64 assignments with 209 calls. All 26 rejections occurred at output validation; none were retried. Cost totals and mean time include rejected attempts.

| Strategy (16 attempts each) | Accepted | Passed all fixture checks | Port reads | Model calls | Input tokens | Mean seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed | 10 | 8 | 96 | 16 | 50,130 | 3.42 |
| Rules | 16 | 7 | 66 | 16 | 44,898 | 2.72 |
| Adaptive | 5 | 2 | 87 | 103 | 237,641 | 10.29 |
| Hybrid | 7 | 3 | 90 | 74 | 123,254 | 7.53 |

Hybrid reduced input tokens by 48.1% and model calls by 28.2% versus matched adaptive, but used three **more** port reads. All 16 hybrid attempts still requested promotions, inventory and weather. Neither bulk-order nor data-defect trial met the two-read/one-call target. A sampled bulk-order answer recognized the 200-unit order in its limitations but omitted it from findings; a duplicate-record answer identified 20 repeated rows but put `duplicate-records` in the status field, failing schema validation. Hybrid passed all fixture checks on one of two mixed cases and neither partial-availability case. It did correctly abstain on both insufficient cases. These are two trials on synthetic fixtures, not a statistical estimate of prose quality.

Keep hybrid **opt-in**. The scripted policy's 16/16 fixture matches demonstrate wiring, not reliable live stopping. A next experiment should distinguish a synthesis-only turn from one that can request more evidence, without withholding the promotion cue in mixed cases; evaluate that as a new method, not by modifying these reports.

### Original three-strategy comparison

See the **gate and prompt experiment** below for a separate matched comparison. The original comparison commands and defaults are unchanged.

<!-- Fixture-only mechanical checks from evaluation.ts; observed-record script from scripted-provider.ts. -->

Offline, the scripted provider uses the **same rules** as the rule-directed strategy. This deliberately holds the decision policy constant while demonstrating the cost of moving each read decision across the model boundary. It does **not** evaluate live LLM reasoning. On the six default cases the checklist makes 36 reads and 6 scripted provider calls; rules make 25 reads and 6 calls; adaptive makes 25 reads and 31 calls.

Evaluation compares numeric facts, status, and finding kinds against independent fixture expectations. It does not score prose or prove causation. A useful live review also asks whether the explanation is supported by the **actually observed** records, whether the agent overlooked confounding, and whether another read would have changed its conclusion. In particular, stopping early saves reads but can miss a second explanation.

For optional paid inference, use the root `.env.local` containing `OPENAI_API_KEY`:

```sh
pnpm --filter @actor-web/example-retail-investigation live
pnpm --filter @actor-web/example-retail-investigation evaluate:live --trace-terminal \
  --output "evals/$(date -u +%Y%m%dT%H%M%SZ)-live.json"
```

Use `evaluate --trace-terminal` instead of `evaluate:live --trace-terminal` to preview the same display without a paid call. Live mode uses the `gpt-4.1-mini` alias, temperature 0, no parallel tool calls, 900 maximum completion tokens per response, and no retries. A single adaptive case permits at most seven provider calls; the full comparison permits at most 54. Evidence reads remain local. One trial on each synthetic case is not a statistical benchmark.

## Recorded live comparison: 2026-11-25

The [paired scorecard](evals/20261125T165539Z-comparison.json) compares the [scripted](evals/20261125T165539Z-scripted.json.gz) and [live](evals/20261125T165539Z-live.json.gz) runs of the same build, cases, strategy order, and budgets. The `.json.gz` files contain the original reports, including observations and traces. The scripted replay reproduced the previous offline results: all 18 attempts passed all three fixture checks. The live run made 40 provider calls, with no retries. This is the **first** live baseline for these six cases; the earlier retail analyst v4/v5 experiment used different evidence and a different output contract.

| Live strategy (six assignments each) | Accepted | Exact finding kinds | Port reads | Provider calls | Mean seconds per attempt |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fixed checklist | 5/6 | 1/6 | 36 | 6 | 2.73 |
| Rule-directed | 6/6 | 2/6 | 25 | 6 | 3.29 |
| Adaptive | 1/6 | 0/6 | 22 | 28 | 7.82 |

All 12 accepted answers had the correct application-calculated spike and assessment status. Only three matched the exact expected set of finding kinds. Of the nine mismatches, seven included the expected kinds **plus extra labels**; two missed the fixture's duplicate-record finding entirely. Exact match is useful for downstream consumers of these labels, but is not a semantic score. Durations include failed attempts. In particular, the fixed `confounded` attempt returned `LLM_PROVIDER_UNAVAILABLE` in 39 ms with no usage reported. Do not interpret a fast failure or fewer reads before rejection as an efficiency improvement.

### What the records show

- **Order scope:** In `promotion`, `bulk-order`, `data-defect`, and `confounded`, adaptive requested `read_orders` for February 3 alone. The schema requires an increasing date range, and policy requires the exact February 1–3 assignment. All four requests were rejected before the read. In `insufficient`, adaptive requested comparison sales with `P006` as the assignment instead of `P005`; the host denied it. None of the five rejected requests executed.
- **Order evidence:** In `bulk-order`, rules found the 200-unit order among otherwise 10-unit orders and named the sources it had not examined. Fixed also found the order but added “availability recovery” despite zero stockout hours. In `data-defect`, both fixed and rules read the orders but missed that 30 spike-day rows contained only 10 distinct order IDs. Fixed even said “No duplicate sales records were found, so data duplication is not a factor.”
- **Labels versus prose:** All three accepted `restocking` answers identified replenishment, but added `order-concentration` while describing many equal-sized orders. Rules explicitly said it was “ruling out order concentration as a cause.” A ruled-out alternative is useful in prose but misleading as a positive finding.
- **Uncertainty:** Rules recognized the simultaneous promotion and heavy rain as confounded, though it added an unsupported recovery finding. Fixed and rules both correctly abstained when non-sales sources were unavailable. Adaptive did not return an assessment in either case.

### Live rerun: adaptive v2

The [v1 vs. v2 scorecard](evals/20261125T170837Z-v1-vs-v2.json) pairs every assignment in the [rerun trace](evals/20261125T170837Z-live.json.gz) with its archived live v1 result. The six cases, evaluator, model settings, budgets, and strategy order were unchanged. Only adaptive has a new method revision. All 18 rerun assignments completed: 49 provider calls, no retries.

| Adaptive metric across six assignments | v1 | v2 |
| --- | ---: | ---: |
| Accepted assessments | 1/6 | 6/6 |
| Tool requests rejected for invalid input or scope | 5 | 0 |
| Exact expected finding kinds | 0/6 | 1/6 |
| Port reads / provider calls | 22 / 28 | 31 / 37 |
| Mean seconds per attempt, including rejections | 7.82 | 9.02 |
| Reported input / output tokens | 97,269 / 2,430 | 84,827 / 2,994 |

All 31 adaptive tool requests supplied only `reason`. All five cases that previously failed at tool validation returned assessments, and `restocking` remained accepted. V2 got the application-calculated spike and assessment status right on all six. More calls and longer mean time per attempt include the work of finishing five previously interrupted runs; they are not a like-for-like cost per successful assessment.

**Finding quality remains the constraint.** `insufficient` correctly abstained and was the only exact match. On `promotion`, `restocking`, `bulk-order`, and `confounded`, adaptive included the expected kinds **and extra labels**. On `data-defect`, it noticed repeated order IDs in prose but labeled that finding `order-concentration` instead of `duplicate-records`. On all five non-missing cases it chose the same five reads in the same order, despite different evidence.

The unchanged rule-directed control achieved 6/6 accepted and 2/6 exact in both runs, with six provider calls per run. Fixed went from 5/6 to 6/6 accepted (the earlier provider failure did not recur) and stayed at 1/6 exact. The evidence supports keeping scope host-bound; it does not establish that adaptive investigation gives better explanations. This was one live attempt per case per version on an unpinned model alias.

## Gate and prompt experiment

`--compare-gate --trials 2` runs six scenarios across seven conditions (84 attempts, upper bound 318 model calls, zero retries). Fixed, rules and adaptive are reference strategies. The four hybrid conditions cross initial host gate off/on with the standard or `discriminate` read prompt. The alternate asks for the open question and the observation that would change the assessment, in the existing tool `reason` field. Neither prompt requests a transcript of private reasoning; both use the same tool calls, observations, final schema and validator. Only the host can revoke grants.

Before seeing results: test two reads/one model call **and a correct accepted answer** on `bulk-order` and `data-defect`; keep follow-ups open on a competing price cue (`mixed-order-promotion`) and unavailable orders (`partial-availability`); test the familiar rules path on `restocking`. Assign **every** strategy only three reads on `confounded`: can it find both a promotion and weather association under scarcity? The other five cases allow six reads. The host gate examines validated sales/order facts, never case IDs. It closes only on stable price, matching totals, clean previous IDs, and either repeated spike-day IDs or an unusually large row accounting for the full increase. Closure is a limit on further investigation, not proof of cause. These reused fixtures are diagnostic contrasts, not independent held-out evidence.

```sh
pnpm --filter @actor-web/example-retail-investigation evaluate --compare-gate --trials 2
pnpm --filter @actor-web/example-retail-investigation evaluate:live --compare-gate --trials 2 --output "evals/$(date -u +%Y%m%dT%H%M%SZ)-gate-live.json"
```

### Gate results: when each strategy helped

The [scorecard](evals/20261125T183215Z-gate-scorecard.json) covers all 84 [live assignments](evals/20261125T183215Z-gate-live.json.gz) and their [scripted controls](evals/20261125T183215Z-gate-scripted.json.gz). The live matrix made 269 calls with 27 rejections and no retries. A pass below requires acceptance, correct numeric facts, correct assessment status and the exact fixture finding set. These are not prose-quality scores.

| Condition (12 live attempts each) | Accepted | Passed | Data reads | Model calls |
| --- | ---: | ---: | ---: | ---: |
| Rules | 10 | 4 | 36 | 12 |
| Fixed | 8 | 4 | 66 | 12 |
| Adaptive | 4 | 0 | 58 | 70 |
| Hybrid, standard prompt | 5 | 1 | 65 | 53 |
| Hybrid, discriminate prompt | 7 | 1 | 61 | 49 |
| Gated hybrid, standard | 12 | 6 | 49 | 37 |
| Gated hybrid, discriminate | 11 | 5 | 48 | 36 |

- **Gate:** Both gated prompts passed every bulk-order and data-defect attempt using two host reads and one synthesis call (8/8 together); the two ungated prompts passed 0/8 on the same cases. With the standard prompt all 16 calls saved were on those eligible cases. The gate did not fire elsewhere; differences there should not be attributed to it.
- **Rules and fixed:** Rules was economical on bulk orders (2/2) and correct despite unavailable orders on partial availability (2/2). Fixed found both mixed order and promotion on 2/2; rules missed the promotion on both. Both strategies made just one provider call per attempt. No condition passed the full restocking checks.
- **Read selection:** With only three reads, an adaptive controller *can* read sales, promotions and weather, unlike controllers that pre-commit one of those slots to orders or inventory. No live condition passed that confounded case. In a separate [exploratory adaptive prompt comparison](evals/20261125T184130Z-adaptive-prompt-live.json.gz), two pairs (standard/discriminate, then reversed; 16 calls total) all chose sales → promotions → inventory. The extra instruction changed the wording of the public reason, not the third read.
- **Interpretation:** Keep the tool-call/observation protocol. There is no demonstrated accuracy gain from changing the read prompt alone; an enforceable stop mattered much more here. Keep defaults unchanged. On these repeated synthetic cases the gated policy is a candidate for order-reconciliation tasks, not a universal stopping rule. An unchanged price does not rule out a campaign, and repeated order IDs warrant investigation rather than proving duplicate transactions.

For a single scripted contrast use `--strategy hybrid --synthesis-gate --read-prompt discriminate`; to reproduce the exploratory condition use `--strategy adaptive --case confounded --max-reads 3 --read-prompt discriminate` on the built CLI.

## Budget-aware source selection

`--compare-selection --trials 2` compares two adaptive prompts on three new synthetic cases. Both get three reads (sales first), the same tools and schema, and at most four calls per assignment. The `budget-plan` instruction asks for a provisional last source in the tool `reason` after sales, then asks the model to revise its choice after the next receipt. It adds no examples, host routing, or extra planning turn. Order reverses within each case on trial two.

All three cases have the same 80 → 240 sales spike and 25% price drop. After sales, campaign records identify either heavy-rain-alert subscribers or trade accounts buying pallet quantities. The diagnostic route reads promotions plus weather or orders respectively. On `alert-normal`, actual rainfall matches its reference: checking weather is informative, labeling it a positive finding is not. `selection.covered` counts completed diagnostic sources even if the output is rejected; `cueThenProbe` additionally requires reading the campaign before the probe. Exact pass separately requires accepted output, correct numeric facts, status, and finding kinds.

```sh
pnpm --filter @actor-web/example-retail-investigation evaluate --compare-selection --trials 2
pnpm --filter @actor-web/example-retail-investigation evaluate:live --compare-selection --trials 2 --output "evals/$(date -u +%Y%m%dT%H%M%SZ)-selection-live.json"
```

| Live prompt | Diagnostic route | Accepted | Exact passes | Model calls | Input / output tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| Standard | 3/6 | 3/6 | 1/6 | 24 | 35,869 / 2,365 |
| Budget-plan | 3/6 | 3/6 | 2/6 | 24 | 38,388 / 3,138 |

All 12 [live attempts](evals/20261125T190330Z-selection-live.json.gz) read sales then promotions. None of the six budget-plan tool reasons after sales named a provisional last source. On `alert-wet`, three of four attempts read weather and all three passed. On `volume-offer`, all four spent their last read on inventory, missing the 160-unit order. On `alert-normal`, three read weather and all three returned a positive weather label despite 2 mm rainfall matching the 2 mm reference. This is a distinction between *picking the right source* and *interpreting what it says*. See the [scorecard](evals/20261125T190330Z-selection-scorecard.json) and [scripted wiring control](evals/20261125T190315Z-selection-scripted.json.gz).

Keep the standard prompt as the default. The one additional exact pass came on the wet case, not from improved aggregate selection, and two repeats on one model are not a general ranking. A separate synthesis-only comparison could hold the receipts fixed and test a labeled example of placing a ruled-out explanation in limitations rather than findings.

## Synthesis: explicit rule versus one worked example

Use `--compare-synthesis --trials 2` with `evaluate` (offline) or `evaluate:live` (paid, at most **8 calls**, no retries). Both arms get the same validated sales, campaign and weather packets, no tool grants, and one final call. They share the decision rule and output schema; `one-shot` adds only a labeled library-booking example illustrating an affirmative finding and a checked alternative at baseline. Each case uses the reverse prompt order on the second trial. The two reused fixtures differ in spike-day rainfall, not campaign audience or sales. This tests final-answer interpretation, not tool selection.

| Live result | Rule only | Rule + example |
| --- | ---: | ---: |
| Accepted / exact passes | 4/4 · 2/4 | 4/4 · 2/4 |
| False weather finding at baseline (2 mm vs 2 mm) | 2/2 | 2/2 |
| Weather finding retained on heavy rain (50 mm vs 2 mm) | 2/2 | 2/2 |
| Input / output tokens | 4,220 / 960 | 4,748 / 726 |

All four normal-rain answers described the weather as stable but treated the campaign’s rain-alert audience as a separate weather finding, making the status `confounded` instead of `supported`. The schema and citation checks accepted those answers: citing an observed source does not establish that it supports the label. The example did not fix the mismatch on this model and these fixtures; the comparison is not evidence against examples generally. [Scorecard](evals/20261125T191919Z-synthesis-scorecard.json) · [live traces](evals/20261125T191919Z-synthesis-live.json.gz) · [scripted control](evals/20261125T191844Z-synthesis-scripted.json.gz).

**Prompt authoring pattern:** Put one responsibility, the decision criteria (including when to abstain), and the stopping condition in the trusted `systemPrompt`. Put the actual scope and facts in the per-run `task` or validated tool observations. Let `structured()` supply the output schema; use a host-side check for evidence requirements that can be computed. Add a labeled final-answer example only to illustrate a specific ambiguity and test it against both positive and negative cases. Tool-call examples illustrate how to use a tool; they are not observations or examples of a final assessment.

### Weather validator replay (no inference)

The [offline regression](weather-evidence.test.ts) feeds the original final JSON and observed packets from all eight [synthesis runs](evals/20261125T191919Z-synthesis-live.json.gz) through the current investigator:

| Archived answers | Validator v2 | Validator v3 |
| --- | --- | --- |
| Normal rainfall (2 mm; reference 2 mm) | 4/4 accepted with unsupported weather labels | 4/4 rejected (`taskMismatch`) |
| Heavy rainfall (50 mm; reference 2 mm) | 4/4 accepted | 4/4 accepted unchanged |

Run `pnpm exec vitest run --config examples/vitest.config.ts examples/retail-investigation/weather-evidence.test.ts` from the workspace root. Rejection does not repair an answer, and this replay does not measure whether the revised prompt improves generation. [Prompt assembly](prompts.ts) now supplies the same evidence rule to every strategy; [the host](investigation.ts) supplies the per-run objective, scope, observations or reconciliation, grants, and structured output check. The worked example remains opt-in.
