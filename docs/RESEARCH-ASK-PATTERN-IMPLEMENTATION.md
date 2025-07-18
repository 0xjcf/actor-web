# Research Prompt: Implementing Ask Pattern for Pure Actor Model in Actor-Web Framework

## 1. Project Context

We are developing the **Actor-Web Framework**, a Pure Actor Model implementation for building resilient, scalable web applications with location-transparent message-passing. The project uses:

- **Architecture**: Pure actor model following Erlang/OTP, Akka, and Orleans patterns
- **Language**: TypeScript with strict typing (zero `any` types)
- **State Management**: XState v5 for state machines
- **Monorepo Structure**: 
  - `@actor-core/runtime` - Core actor system (partially implemented)
  - `@agent-workflow/cli` - CLI tools using actors
  - Main framework in `/src/core`
- **Testing**: Vitest with comprehensive actor test utilities

## 2. Core Problem Statement

The actor-web framework needs a proper **ask pattern** implementation for request/response communication between actors. Currently:

- The main framework (`/src/core`) has some ask pattern implementation in tests but not fully exposed
- The `@actor-core/runtime` package has a TODO comment: "Ask pattern not yet implemented"
- CLI commands are stuck using synchronous patterns (`await` + `getSnapshot()`) instead of pure message-passing
- The git-actor supports request/response events (`REQUEST_STATUS`, `REQUEST_BRANCH_INFO`) but there's no clean way to use them

## 3. Current Setup / Environment

### Key Framework Components:
- **ActorRef Interface**: `/packages/actor-core-runtime/src/actor-ref.ts` (no ask method)
- **UnifiedActorRef**: `/src/core/create-actor-ref.ts` (uses RequestResponseManager but ask not exposed)
- **RequestResponseManager**: `/src/core/messaging/request-response.ts` (has correlation ID logic)
- **GitActor**: Supports events like:
  ```typescript
  | { type: 'REQUEST_STATUS'; requestId: string }
  | { type: 'REQUEST_BRANCH_INFO'; requestId: string }
  | { type: 'REQUEST_COMMIT_STATUS'; requestId: string }
  ```

### Current Implementation Attempts:
```typescript
// In tests, ask pattern works:
const response = await actorRef.ask({ type: 'get', key: 'name' }, { timeout: 1000 });

// But in CLI, we're stuck with:
gitActor.send({ type: 'CHECK_STATUS' });
await waitForState(gitActor, 'statusChecked', 5000);
const state = gitActor.getSnapshot(); // Synchronous!
```

### Key Files:
- `/src/core/integration/xstate-adapter.test.ts` - Has working ask pattern in tests
- `/packages/agent-workflow-cli/src/commands/ship.ts` - Needs ask pattern
- `/packages/agent-workflow-cli/src/actors/git-actor.ts` - Has REQUEST/RESPONSE events
- `/packages/actor-core-runtime/src/actor-system-impl.ts` - Has TODO for ask implementation

## 4. Build & Run Commands

```bash
# Run tests showing ask pattern works in main framework
pnpm test src/core/integration/xstate-adapter.test.ts

# Run CLI tests that need ask pattern
pnpm test:cli

# Build all packages
pnpm build
```

## 5. Troubleshooting Steps Already Taken & Observations

1. **Searched for ask implementation**: Found it in test files but not exposed in ActorRef interface
2. **Checked RequestResponseManager**: Has correlation ID logic but not connected to ActorRef
3. **Examined git-actor**: Already supports REQUEST/RESPONSE events but no ask method to use them
4. **Reviewed pure-git-actor.ts**: Incomplete implementation, not using existing infrastructure
5. **Analyzed current CLI patterns**: Using reactive observation but still synchronous with `await`

## 6. Specific Questions for Research

### 6.1 Design Patterns & Implementation (Primary Focus)

1. **Internal design patterns from mature frameworks (Akka, Orleans, Erlang/OTP):**
   - How is the ask pattern implemented internally? (correlation ID management, promise resolution)
   - What's the relationship between ask and the actor's mailbox/message queue?
   - How do they handle ask timeout without blocking the actor's message processing?
   - Pattern for converting fire-and-forget messages to request/response

2. **API-level design for TypeScript/XState integration:**
   - What's the cleanest API surface for ask? (`actor.ask(event)` vs `actorSystem.ask(actor, event)`)
   - How to type the ask method to ensure type safety between request and response?
   - Should ask be a method on ActorRef or a utility function?
   - Examples from other TypeScript actor libraries (xstate/actors, nact, comedy)

### 6.2 Implementation Strategy for Our Framework

3. **Building a generic ask utility for typed actors:**
   - How to implement ask that works with our existing `UnifiedActorRef` and `RequestResponseManager`?
   - Type signature that ensures request/response type safety with XState actors
   - Integration with our existing event emission system (`ActorEventBus`)
   - Making ask work with our supervision strategies (what happens on actor restart?)

4. **Specific integration for GitActor and CLI:**
   - How to map existing REQUEST/RESPONSE events to ask pattern?
   - Migration path from `waitForState` + `getSnapshot` to ask
   - Should we create actor-specific ask handlers or use a generic approach?
   - Best practice for actors that need to handle both tell and ask for the same operation

### 6.3 Communication Scope

5. **Actor communication boundaries:**
   - **Primary focus**: Actor-to-actor ask within same process (CLI to GitActor)
   - **Secondary**: External systems (CLI commands) asking internal actors
   - **Future consideration**: Cross-process ask for distributed actors
   - How to ensure ask pattern doesn't break location transparency principle?

### 6.4 Technical Constraints & Requirements

6. **Our specific requirements:**
   - Zero `any` types - need fully typed request/response pairs
   - Must work with XState v5's event system and state machines
   - Should not block actor's ability to process other messages during ask
   - Must integrate with existing supervision and error handling
   - Performance: Should handle 10,000+ asks/second as per our targets

## 7. Expected Outcome

A clear implementation strategy for the ask pattern that:
- Integrates with existing RequestResponseManager and correlation ID logic
- Works with XState v5 and our event emission system
- Supports location transparency for distributed actors
- Provides type-safe request/response patterns
- Enables migration from synchronous CLI patterns to pure message-passing

## 8. Additional Context

The implementation should follow our pure actor model principles:
- **No direct state access** between actors
- **Message-only communication** (async)
- **Location transparency** (actors can run anywhere)
- **Fault tolerance** with supervision
- **Zero `any` types** in implementation