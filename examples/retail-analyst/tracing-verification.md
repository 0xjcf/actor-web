# Decision trace and tool-example verification

These are local checks of the uncommitted `retail-analyst-v2` working tree, recorded 2026-11-24T22:25:41.407218+00:00. They do not replace independent review or qualify a release.

## Checked behavior

- 207 agent tests passed; the unrelated opt-in live-conformance test remained skipped.
- 216 example tests passed, including trace correlation, failed validation, observer isolation/mutation, missing summaries, and synthetic example leakage.
- Public package build, strict ESM/CJS consumers, browser runner smoke, root typecheck, and architecture checks passed.
- Console smoke verified distinct ANSI colors and dividers, forced color with a non-TTY, and valid ANSI-free JSONL.
- Scripted Responses tests verified explicit summary requests, separation from assistant text, preservation/replay of opaque reasoning items, absent summaries, and refusal of summary settings on Chat Completions.
- Two live GPT-4.1 mini runs completed with the same prompt, task, numeric tool contracts, and provider configuration. Only tool-example description injection was toggled. Requested and observed tool-call IDs matched in each run.

## Live examples comparison

| Metric | Examples on | Examples off |
| --- | --- | --- |
| Largest spike | 2024-01-12, 114 to 342, 200% | 2024-01-12, 114 to 342, 200% |
| Model calls | 9 | 9 |
| Tool calls | 8 | 8 |
| Input tokens | 11802 | 10010 |
| Output tokens | 289 | 292 |
| Elapsed milliseconds | 8822 | 7446 |
| Tool turns with explanations | 1 / 8 | 1 / 8 |
| Native reasoning summaries | 0 | 0 |
| Trace delivery failures | 0 | 0 |

Examples clarified wire-input/result shape but did not establish an accuracy or call-count gain in this pair. They added input tokens. One stochastic run per mode with an unpinned model alias is insufficient to claim a quality or latency improvement.

## What the trace revealed

The model returned a useful explanation before starting its calculations, while most tool turns returned no explanation. The console reports the absence rather than inventing a reason. These explanations are model-authored output, not proof of internal reasoning. GPT-4.1 mini has no native reasoning summary; the opt-in reasoning-model path has scripted verification only.

Both final answers passed the implemented numeric and required-observation checks. The examples-on narrative nevertheless asserted “2.7 inches precipitation,” while the actual weather fixture only reports `precipitation_amount: 2.7` without a unit. Current validation does not check narrative grounding or establish causation. This finding remains in AW-05-08. Tracing makes that quality gap inspectable; it does not turn an accepted numeric result into a fully grounded explanation.

## Artifacts

- [Historical v2 console preview](trace-preview-v2.txt), preserving the divider layout. Terminal execution adds colors.
- [Examples-on JSONL](traces/examples-on.jsonl).
- [Examples-off JSONL](traces/examples-off.jsonl).
- [Summary and findings](tracing-verification.json).

The JSONL contains model text, requests, successful observations, and validation joined by run ID, sequence, turn, and tool-call ID. It excludes provider headers, API keys, and opaque continuation state. The [earlier notebook comparison](verification.md) is retained as a separate historical run because its prompt and trace format preceded this change.
