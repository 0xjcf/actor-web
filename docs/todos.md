# FAS Agent Product Demo TODOs

Yes. To target the real FAS agent product demo, the work splits across all three repos/layers.

**Actor-Web**
Actor-Web is mostly ready for the demo shape, but a few gaps remain:

- Server-owned FAS topology:
  `serveActorWebNode(fasTopology, { node: 'coordinator', gateway: true, transport: true })`
- Browser UI should consume `taskBoard.source({ gateway: { url } })`, not local actors.
- Real tool port boundaries need to be cleanly injected per actor.
- Agent/tool execution telemetry should be visible in source projections.
- Transport is still demo/trusted-environment grade: auth, retries, replay, durable membership, and backpressure remain production hardening work.

For the demo, we can proceed before full transport hardening if it’s local/trusted.

**Ignite Element**
Ignite Element is usable for this now.

Remaining work is mostly DX polish:

- Make the DOM component consume a remote Actor-Web source exactly like the local headless runtime.
- Keep the headless dashboard runtime as the behavior-first contract.
- Possibly improve `igniteCore` Actor-Web inference so we don’t need any explicit command/view helper types.
- Add a standard pattern for: tested headless runtime -> thin custom element.

No major runtime blocker here.

**FAS**
FAS has the most remaining work for the real product demo:

- Define real FAS actor contracts:
  `TaskBoardActor`, `TaskRunActor(taskId)`, `PlannerAgent`, `ImplementerAgent`, `VerifierAgent`, `ReviewerAgent`.
- Replace fake tools with real adapters:
  - Codex plan/patch generation
  - repo diff
  - shell verification / `fas verify`
  - reviewer
  - memory write
- Add a safe workspace execution policy:
  - allowed commands
  - writable paths
  - no destructive Git operations unless explicitly enabled
  - task-scoped working directories if needed
- Add persistence or recovery boundary:
  - task state
  - timeline/events
  - tool outputs
  - verification logs
- Decide whether real agent execution starts as:
  - single-process local server demo, recommended first
  - multi-process worker nodes, later
  - distributed workers, later still

## Best Next Sequence

1. Move FAS agent loop from browser-local to server-owned Actor-Web node.
2. Keep fake deterministic tools, but expose the server task board to the browser through gateway WebSocket.
3. Add a minimal REST command ingress: `POST /tasks`.
4. Update the UI to consume the server `TaskBoardActor` source.
5. In FAS repo, replace fake tools one at a time with real adapters.
6. Add persistence/log artifacts.
7. Add auth/security once it moves beyond localhost.

The next best slice is:

## Server-Owned FAS Agent Loop Demo with Fake Tools

That bridges the current v0 architecture into the real product topology without taking on Codex/shell/Git risk yet.
