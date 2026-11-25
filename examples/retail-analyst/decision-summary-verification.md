# Required decision-summary verification

Recorded 2026-11-25T00:05:23.135003+00:00 against the local uncommitted `retail-analyst-v3` example using `gpt-4.1-mini`.

The earlier prompt relied on optional assistant text; most tool requests omitted it. The example now requires a `decision_summary` tool argument containing 1–320 characters after trimming. The host validates it before tool execution and renders it in cyan as a model-authored decision justification. Separate assistant text and provider reasoning summaries remain distinct. No explanation is invented by the logger.

## Verification

- All 222 example tests passed, including missing, blank, oversized, and valid summaries; assistant prose cannot substitute for the required field.
- Root typecheck, architecture checks, example build, and README lint passed.
- The offline run completed all 3 tool calls with structured summaries and no placeholder explanation blocks.
- The live run completed 8 tool calls with 8 structured summaries across 9 model calls. All requested IDs matched observed IDs.
- The accepted numeric result remained January 12, 2024: 114 to 342 units, a 200% increase.
- Live token usage: 14372 input and 543 output; elapsed time 11455 ms.

This verifies summary presence and bounds, not whether each justification is faithful to internal computation or sufficient to establish a causal explanation. The example's numeric/observation checks and the separate narrative-grounding backlog remain unchanged. The model alias was not pinned; this single live trial is not a comparative quality benchmark.

See the [current console preview](trace-preview.txt), [structured JSONL](traces/decision-summary-v3.jsonl), and [verification data](decision-summary-verification.json). The [v2 report](tracing-verification.md) retains its original optional-prose results and links to its historical preview.
