# Implementation Prompt: Transactional Outbox & Durable Event Delivery

## 1 · Context & Pain

Web‑component actors currently **update local UI state** with `machine.send(…)` **and broadcast domain events** with `emit(…)` as **two separate steps**.  
If the tab crashes, network drops, or a container restarts **between** those steps, the system can diverge:

* The UI shows “saved” but other actors never receive the `FORM_SAVED` event.  
* Analytics fire twice because the component retried after half‑committing.  

These **dual‑write bugs** are hard to reproduce, undermine user trust, and force every product team to write ad‑hoc retry logic.

## 2 · Proposed Solution

Embed a **Transactional Outbox** inside `@actor‑web/core` so that every event produced by an actor is:

1. **Persisted atomically** together with the component’s new state in a durable store  
2. **Forwarded exactly once** to the event bus by a background worker, even after crashes or offline gaps

The mechanism is **framework‑internal** by default, with opt‑out / custom‑store hooks for advanced users.

## 3 · Expected Behaviour

| Scenario | Expected Outcome |
|----------|------------------|
| User saves a form while offline, closes the tab, re‑opens later online | Form appears in “saved” state and `FORM_SAVED` is delivered once to all listeners |
| Actor crashes after writing state but before emitting event | Transaction aborts; on restart the actor retries both state and event |
| Duplicate `FORM_SAVED` packets arrive at a consumer | Consumer drops duplicates via built‑in idempotency key |
| Developer sets `durability:"memory"` in dev mode | Runtime bypasses durable store but logs a warning in metrics |

## 4 · Functional Requirements

1. **Atomic write API**  
   `DurableStore.putStateAndEvent(state, event)` commits both records or none.  
2. **Default stores**  
   * Browser → IndexedDB  
   * Node/Electron → SQLite file  
   * Serverless → in‑memory (warn)  
3. **Background Forwarder**  
   * Flush unsent events every _N_ ms or on `online` event  
   * Single‑instance lock via `navigator.locks` or file lock to avoid double flushing  
4. **Idempotency**  
   Each event carries `eventId` (UUID v7) + `originActor`; duplicates ignored.  
5. **Metrics hooks**  
   Counters: `outbox.pending`, `outbox.flush.ms`, `outbox.durable` (bool).  
6. **Developer‑facing API**  

```ts
configureOutbox({
  durability: 'auto' | 'memory' | 'off',
  store: 'indexeddb' | 'sqlite' | CustomStore,
  flushInterval?: number,
  onError?: (evt, err) => void
});
```

## 5 · Non‑Functional Requirements

* **Bundle size impact** ≤ 4 KB gzipped  
* **P99 delivery latency after reconnect** ≤ 2 s  
* **Cross‑browser** – Chrome, Firefox, Safari (desktop + iOS)  
* **Graceful degradation** – if durable store quota exceeded, fallback to memory and increment `outbox.durable=false` metric

## 6 · Deliverables

| # | Item |
|---|------|
| 1 | `DurableStore` interface & default IndexedDB / SQLite implementations |
| 2 | Runtime interception logic for `emit` and returned events |
| 3 | `OutboxForwarder` shared / service worker |
| 4 | Idempotent consumer helper `oncePerEvent()` |
| 5 | Dev‑tools panel “Pending Events” |
| 6 | Documentation & upgrade guide |
| 7 | E2E test suite (Cypress offline / crash scenarios) |

## 7 · Acceptance Criteria

* All functional & non‑functional requirements met  
* No breaking changes to public component API (semver minor)  
* CI green on unit, integration, browser tests  
* “Todo PWA” sample upgraded and passes Lighthouse PWA ≥ 95

## 8 · Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| IndexedDB quota exceeded | Switch to in‑memory + metric alert |
| Safari background eviction aborts long TX | Keep TX ≤ 10 ms; split large batches |
| Forwarder crash causes duplicate delivery | Idempotency key & at‑least‑once semantics |

## 9 · Timeline (high‑level)

* **Week 1** – API design + default store  
* **Week 2** – Forwarder worker + runtime hooks  
* **Week 3** – Metrics, dev‑tools panel, docs  
* **Week 4** – E2E soak tests, performance tuning, release candidate

---

### TL;DR

We are adding a **built‑in safety deposit box** so that every actor event and UI state change are written together, survive crashes, and are delivered exactly once—giving apps bank‑level robustness with zero extra developer effort.
