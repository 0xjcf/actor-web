# 🗺️ ROADMAP — Actor‑Web Pure Actor Model

> ⚠️ **DEPRECATED**: This document has been superseded by the unified [ROADMAP.md](./ROADMAP.md)
> 
> The unified roadmap includes all content from this document plus:
> - Agent-Workflow-CLI implementation track
> - Execution-focused task breakdowns
> - Risk register and success metrics
> - Pure actor model principles
> 
> Please refer to [ROADMAP.md](./ROADMAP.md) for the current roadmap.

---

# 🗺️ ROADMAP — Actor‑Web Pure Actor Model

> **Vision**  
> Deliver a universal web runtime whose state, side‑effects, and cross‑component communication are managed **exclusively** through message‑passing actors.  
> Benefits: isolation, fault‑tolerance, scalability (including Web Workers / remote actors), host‑agnostic deployment, and a clear mental model.
> 
> **Host‑Agnostic Design**: Once the pure actor refactor is complete, the runtime supports SPAs, MPAs, SSR, micro‑front‑ends, PWAs, and edge/desktop environments through consistent message‑passing APIs.

---

## 0 🌱 Current Baseline (Hybrid Controllers) - DEPRECATED

⚠️ **CRITICAL ARCHITECTURAL ISSUE IDENTIFIED**: Research shows our current hybrid approach violates pure actor model principles.

| Status | Item | Owner | Notes |
| ------ | ---- | ----- | ----- |
| ⚠️ | `createActorController` (general) | Core team | **VIOLATES**: Direct state access, not message-based |
| ⚠️ | Specialized controllers (`State`, `Event`, `Lifecycle`) | Core team | **VIOLATES**: Expose direct state, not location-transparent |
| 🟡 | Component samples / docs | DevRel | **NEEDS**: Pure actor model examples |

### 🚨 **URGENT MIGRATION REQUIRED**
Based on comprehensive research into pure actor model systems (Erlang/OTP, Akka, Orleans), our current implementation has critical violations:
- ❌ Direct state access (not message-only)
- ❌ Singleton registries (not distributed)
- ❌ Direct function calls (not location-transparent)
- ❌ Local event systems (can't span processes)

---

## 1 🚀 Introduce **ActorRef** API _(MVP)_

> _Goal:_ Ship a **minimal yet functional** reference abstraction that hides internal actor state.

- [ ] **1.1** API spec frozen (`ActorRef<TEvent, TEmit>`)  
  - `send(event)` – fire‑and‑forget  
  - `ask(query) → Promise<T>` – request/response, unique `responseId` generated internally  
  - `observe(selector) → Observable<U>` – reactive state slices  
  - `spawn(machine) → ActorRef` – child actors  
  - `start/stop/restart` lifecycle  
  **Exit criteria:** Type‑safe signatures in `@actor-web/core`.

- [ ] **1.2** XState interpreter wrapper implements `ActorRef`  
  _Owner:_ Runtime team

- [ ] **1.3** Dev ergonomics  
  - Auto‑unsubscribe helper (`useActorRef`, `withActorRef` for plain Web Components)  
  - Default `observe()` → RxJS OR minimal custom observable  
  _Owner:_ DX team

- [ ] **1.4** Docs & code samples ("CounterRef", "AuthRef")  
  _Owner:_ DevRel

---

## 2 🔁 Reactive View Binding

> _Goal:_ Make UI updates **feel** as simple as state reads while retaining encapsulation.

- [ ] **2.1** Template helpers accept observables (`${state$}` or `bind(state$, fn)` pattern).  
- [ ] **2.2** Auto‑unsubscribe on component disconnect.  
- [ ] **2.3** Demo: live counter, auth badge, form validation indicators.  
  _Owner:_ View/Template team

---

## 3 🧹 Controller→ActorRef Migration

> _Goal:_ All first‑party components stop reading controller `.state.context`.

- [ ] **3.1** Shield direct context access behind `observe()` / selectors.  
- [ ] **3.2** Provide codemod (`npx actor-web-migrate`) that:  
  - Rewrites `createStateController` → `createActorRef`  
  - Replaces `controller.state.context.foo` with `await actor.ask({ ... })` or `observe`.  
  - Flags unsafe patterns.

- [ ] **3.3** Deprecation banner in docs; announce removal schedule.  
  _Owner:_ Migration squad

---

## 4 🛡️ Supervision & Fault Handling

> _Goal:_ Match backend actor robustness (restart strategies, escalation).

- [ ] **4.1** `SupervisorRef` implementation (`one-for-one`, `all-for-one`).  
- [ ] **4.2** Configurable restart strategy on `spawn(machine, { supervision })`.  
- [ ] **4.3** Logging / dev‑mode overlay shows actor restarts.  
  _Owner:_ Runtime team

---

## 5 📨 Distributed / Worker Actors

> _Goal:_ Allow actors to live off the main thread, in other processes, or on remote hosts.

- [ ] **5.1** `WebWorkerActorHost` – serialize events with `structuredClone`.  
- [ ] **5.2** Transport‑agnostic adapter (`postMessage`, WebSocket, IPC).  
- [ ] **5.3** Demo: sort‑10k‑rows actor runs in worker, UI stays responsive.  
  _Owner:_ Concurrency squad

---

## 5b 🌍 Host‑Integration (MPA & SSR)

> _Goal:_ Enable actor runtime to work seamlessly across different web architectures and deployment modes.

- [ ] **5b.1** Multi‑page application support  
  - Browser ↔ Service‑Worker transport adapter (BroadcastChannel)  
  - IndexedDB mailbox for cross‑page actor persistence  
  - Bootstrap contract for actor system discovery/reinstantiation  

- [ ] **5b.2** Server‑side rendering helpers  
  - `renderToString(actorRef, templateFn)` for stable state snapshots  
  - `hydrate(actorRef, snapshot)` for client‑side resumption  
  - Serialization adapters for actor context data  

- [ ] **5b.3** Cross‑deployment transport examples  
  - Islands / Micro‑front‑ends via postMessage  
  - Electron / Tauri via IPC  
  - Edge / Workers (Cloudflare, Deno) via RemoteActorRef  

- [ ] **5b.4** Example repositories  
  - Multi‑page site sharing login actor  
  - SSR‑hydrated e‑commerce with cart persistence  
  - Micro‑front‑end dashboard with shared state  
  _Owner:_ Host Integration squad

---

## 6 ⚡ Performance & Back‑pressure

- [ ] **6.1** Benchmarks: event throughput, memory footprint, GC.  
- [ ] **6.2** Configurable mailbox size + overflow strategy (`drop`, `park`, `fail`).  
- [ ] **6.3** Micro‑tasks batching for high‑frequency UI events.  
  _Owner:_ Perf team

---

## 7 🛠️ Tooling & Dev UX

- [ ] **7.1** Browser DevTools extension  
  - Actor tree, message timeline, state snapshots.  
- [ ] **7.2** Time‑travel replay via stored message log.  
- [ ] **7.3** VS Code code‑gen snippets for `ask`, `observe`, `spawn`.  
  _Owner:_ DX team

---

## 8 📚 Documentation & Learning Path

- [ ] **8.1** "Why Actors?" explainer with diagrams.  
- [ ] **8.2** Migration guide: controllers → ActorRefs.  
- [ ] **8.3** Cookbook recipes (infinite scrolling, optimistic updates, offline cache).  
- [ ] **8.4** Host‑specific deployment guides (SPA, MPA, SSR, Edge).  
  _Owner:_ DevRel

---

## 9 🎉 v1.0 GA — Pure Actor Web Runtime

| Release Gate | Success Metric |
|--------------|----------------|
| 🔒 **Zero** first‑party code reads actor state directly. | Type‑level check & static analysis. |
| 🛡️ All critical actors protected by a supervisor. | Chaos tests: random failures auto‑recovered. |
| ⚙️ CI runs **benchmarks** under target thresholds (CPU < X ms/frame, memory < Y MB). | Perf dashboards green. |
| 🌍 **Host‑agnostic** deployment verified across SPA, MPA, SSR, Worker environments. | Integration tests pass in all target hosts. |
| 📖 Docs include full tutorial path ("TodoMVC" to distributed chat to SSR e‑commerce). | Community feedback > 90 % positive. |

Once these gates are green we can tag **`@actor-web/core@1.0.0`** and begin the 1.x feature cadence.

---

## 10 🔮 Enhanced Architecture & Testing _(Research-Driven Improvements)_

> _Goal:_ Incorporate research-validated improvements for a truly universal actor system.

### 10.1 🎯 Unified Actor Registry & Addressing

- [ ] **10.1.1** Actor Registry Service
  - Central registry for actor discovery by address/pattern
  - Location-transparent routing (local, worker, remote)
  - Dynamic actor discovery API
  
- [ ] **10.1.2** Actor Addressing Scheme
  - Hierarchical addresses: `system://parent/child/grandchild`
  - Pattern-based discovery: `system://auth/*`
  - Migration-safe addressing (actors can move locations)

### 10.2 🧪 Actor Testing Framework

- [ ] **10.2.1** Test Harness & Utilities
  - `ActorTestHarness` for scenario-based testing
  - Deterministic message replay
  - State assertion helpers
  - Mock supervisor & mailbox implementations
  
- [ ] **10.2.2** Testing Patterns Documentation
  - Unit testing individual actors
  - Integration testing actor hierarchies
  - Property-based testing for message flows
  - Chaos testing with failure injection

### 10.3 📦 Minimal Core Architecture

- [ ] **10.3.1** Package Separation
  - `@actor-web/core` - Zero DOM dependencies
  - `@actor-web/dom` - Browser-specific bindings
  - `@actor-web/node` - Node.js adapters
  - `@actor-web/embedded` - Minimal footprint build
  
- [ ] **10.3.2** Platform Abstraction Layer
  - Pluggable timer implementation
  - Pluggable I/O abstractions
  - Memory-constrained mode (no observables)

### 10.4 🛡️ Security & Error Patterns

- [ ] **10.4.1** Message Security
  - Message validation/sanitization framework
  - Trust boundary enforcement
  - Encrypted actor communication option
  
- [ ] **10.4.2** Error Handling Cookbook
  - Supervision hierarchy patterns
  - Error escalation strategies
  - Circuit breaker implementation
  - Dead letter queue pattern

### 10.5 📊 Performance Monitoring

- [ ] **10.5.1** Built-in Metrics
  - Message throughput tracking
  - Mailbox depth monitoring
  - Actor lifecycle timing
  - Memory usage per actor
  
- [ ] **10.5.2** Performance Best Practices
  - Actor granularity guidelines
  - Message batching strategies
  - Back-pressure patterns
  - Hot-path optimization guide

_Owner:_ Architecture team  
_Timeline:_ Q4 '26 - Q1 '27

---

## Deployment Mode Support Matrix

| Mode | Status | Phase | Notes |
|------|--------|-------|-------|
| **Classic SPA** | ✅ Native | 1-4 | Single HTML shell, client routing |
| **Multi-Page App** | 🔄 Planned | 5b | Shared actors via Service Worker/BroadcastChannel |
| **SSR / Hydration** | 🔄 Planned | 5b | Server snapshots, client resumption |
| **Islands / Micro-frontends** | 🔄 Planned | 5b | Cross-island messaging via event bus |
| **PWA / Offline** | 🔄 Planned | 5b | Service Worker actor persistence |
| **Electron / Tauri** | 🔄 Planned | 5b | Main process actors, renderer ActorRefs |
| **Edge / Workers** | 🔄 Planned | 5b | Serverless isolates, RemoteActorRef |

---

## Timeline Snapshot *(tentative)*

| Quarter | Milestone |
|---------|-----------|
| **Q3 '25** | Phases 1‑2 complete, early adopters testing ActorRefs |
| **Q4 '25** | Phase 3 migration finished, supervisor beta |
| **Q1 '26** | Worker actors, host‑integration (Phase 5b) |
| **Q2 '26** | Perf/back‑pressure tuning, DevTools |
| **Q3 '26** | Docs polish, multi‑deployment validation, **v1.0 GA** |
| **Q4 '26** | Enhanced architecture (Phase 10) begins |
| **Q1 '27** | Complete testing framework & security patterns |

> _Adjustments made monthly based on community feedback and internal velocity._

---

## Branding Evolution

### Current State
- **Project Name**: Actor-SPA  
- **Package Scope**: `@actor-spa/core`  
- **Community**: #actor-spa on Discord  

### Future State (Post-v1.0)
- **Project Name**: Actor-Web *(or Actor-UI)*  
- **Package Scope**: `@actor-web/core`  
- **Tagline**: "Pure‑actor web runtime"  
- **Community**: #actor-web on Discord  

> **Migration Strategy**: Maintain `@actor-spa/*` packages as aliases during v1.x for backward compatibility. Announce branding transition 6 months before v2.0.

---

## Governance

- **Product Owner:** 0xjcf  
- **Steering Group:** Runtime Lead, DX Lead, Perf Lead, DevRel, Host Integration Lead  
- **Community Sync:** #actor-spa on Discord, every second Thursday (16:00 UTC)  
- **RFC Process:** Propose → 7‑day comment → Accepted / Need‑More‑Work  

---

### Contributing

1. Check open roadmap item labels: `good first issue`, `help wanted`, `RFC`.  
2. Submit PRs targeting the **next** milestone branch (e.g. `phase-1-actorref`).  
3. Add your change to `CHANGELOG.md` under `Unreleased`.  
4. Pass CI (`npm test`, `npm run lint`, `npm run benchmark`).  

Let's build the most resilient, scalable, **host‑agnostic** actor runtime for the web! 🌟 