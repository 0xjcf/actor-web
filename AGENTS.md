# Actor-Web

Actor-Web is the actor runtime. FAS is retired and is not part of this project.

## Work queue

Use the operator console in the sibling [agent-starter board](../agent-starter/apps/board/README.md).

- Columns are Idle, Plan, Build, Test, Review, Shipped, and Errored.
- The board actor moves a ticket. An agent does not choose the next stage.
- Planner, builder, tester, and reviewer each have one purpose, a sealed system prompt, one task prompt, and an explicit tool grant.
- A ticket stays idle until every ticket in `dependsOn` is shipped.
- Open the board from agent-starter with `pnpm board:dev` at `http://127.0.0.1:4173/`. `pnpm examples:queue-board` starts that same server.

## Code boundaries

- Domain and behavior decisions stay free of network, filesystem, and provider SDKs.
- Adapters return facts. Expected failures stay data.
- Effects and tool calls go through the runtime toolbox or an explicit port.
- One agent session does one purpose, then stops.

## Verification

- `pnpm --filter @actor-web/runtime test` for runtime changes.
- Board tests live in agent-starter: `pnpm --dir ../agent-starter exec vitest run --config apps/board/vitest.config.ts`.
- `pnpm typecheck` and `pnpm architecture:check` before handing off a runtime change.
- `pnpm test:examples` for example changes.

Do not add a `.fas/` directory, `.fas-config.json`, or a FAS task tracker back into this repo.
