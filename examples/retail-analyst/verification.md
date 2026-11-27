# Retail analyst verification

Recorded 2026-11-24 21:04 UTC against an uncommitted Actor-Web working tree based on `a5b5df98`. This is local verification, not independent Test/Review or release qualification.

## Checks

- Agent package: 202 tests passed; the unrelated opt-in live-conformance test stayed skipped.
- Public package build: declaration generation, ESM/CJS strict TypeScript consumers, runtime imports, and browser runner smoke passed.
- Examples: 206 tests passed, including 6 analyst tests.
- Root `pnpm typecheck` and `pnpm architecture:check` passed.
- The offline demo completed with 4 model turns and 3 tool observations.
- All 7 sales and all 7 weather fixtures exactly matched the notebook's Python source.
- The completed Python notebook and the native-tool analyst both completed live model runs.

## Live comparison

Both requested `gpt-4.1-mini` through OpenAI Chat Completions using their existing local credentials. No key was copied, written, or printed. Both returned January 12, 2024, with 114 before, 342 after, and a 200% increase. Weather remained simulated local data.

| Metric | Actor-Web native tools | Python notebook regex |
| --- | --- | --- |
| Model calls | 9 | 4 |
| Executed tool requests | 8 | 4 including final_answer |
| Input tokens | 9205 | 3653 |
| Output tokens | 244 | 261 |
| Elapsed milliseconds | 9982 | 6509 |

Actor-Web checked every consecutive quantity pair. Python calculated only the largest candidate. The implementations use different prompts and tool contracts, and Python explicitly sets temperature 0.7 while the native adapter uses provider defaults. The model alias was not pinned to a dated snapshot. These single-run numbers do not establish comparative efficiency or model quality.

The first native trial requested six calculations in one batch despite the prompt. The runner rejected it with `TOOL_BATCH_LIMIT` before executing that batch. An explicit `parallelToolCalls: false` provider option was added and tested for Chat Completions and Responses. The subsequent live trial completed. A prompt instruction alone did not enforce this constraint.

## Interpretation limits

The analyst verifies numeric facts, scopes tool arguments to the fixture, and requires successful calculation and weather observations. Tests reject invented quantities, ungranted tools, skipped observations, and incorrect final percentages. The local observation list is not a durable execution ledger.

The accepted live narrative used possible explanations, but omitted the system prompt's requested explicit correlation/causation disclaimer. Current final validation does not check causal prose. Evidence-linked hypothesis output is tracked as AW-05-08. None of these runs establishes what caused Product 5's demand.

See [verification.json](verification.json) for the accepted outputs, observations, tokens, and the initial batch refusal. See [README.md](README.md) for repeatable commands.
