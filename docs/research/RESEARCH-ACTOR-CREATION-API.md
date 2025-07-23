# Research Prompt: Actor Creation API Design - ActorDefinition vs Actor Instance

## Project Context
Developing the Actor-Web Architecture framework - a Pure Actor Model implementation for building resilient, scalable web applications. The framework provides actor system capabilities with location-transparent message-passing. Currently migrating from v1 to v2 API, where v2 introduces a `createActor` function that returns `ActorDefinition` objects to be spawned by an `ActorSystem`.

## Core Problem Statement
The `createActor` function currently returns an `ActorDefinition` which must be spawned by an `ActorSystem` to get an actual actor instance (`ActorPID`). However, existing code (like git-actor) expects `createActor` to return an actor instance with methods like `send()`, `ask()`, `start()`, `stop()`. This creates a mismatch between the API design and usage expectations, particularly for XState machine integration.

## Current Setup / Environment
- **Framework Version:** v2.0.0 (in development)
- **Key Types:**
  - `ActorDefinition<TMessage, TContext, TEmitted>` - Actor behavior specification
  - `ActorPID` - Actor instance with send/ask/stop methods
  - `XStateActorConfig` - Configuration for XState machines
- **Current Implementation:**
  ```typescript
  // create-actor.ts
  export function createActor<TMessage, TContext, TEmitted>(
    config: CreateActorConfig<TMessage, TContext, TEmitted>
  ): ActorDefinition<TMessage, TContext, TEmitted>
  
  // Usage expectation in git-actor.ts
  const gitActor = createActor(...); // Expects actor instance
  gitActor.start(); // Error: start() doesn't exist on ActorDefinition
  gitActor.send({ type: 'MESSAGE' }); // Error: send() doesn't exist
  ```

## Build & Run Commands
```bash
pnpm typecheck
# Results in: Property 'start' does not exist on type 'GitActor'
# Property 'send' does not exist on type 'GitActor'
```

## Troubleshooting Steps Already Taken & Observations
1. **Attempted to cast ActorDefinition to GitActor interface** - Type mismatch, methods don't exist
2. **Considered using ActorSystem.spawn()** - Requires significant refactoring of existing code
3. **Explored XState's createActor pattern** - Returns actor instance directly, different from our ActorDefinition approach
4. **Analyzed developer experience implications** - Having same function return different types based on input is confusing

## Specific Questions for Research

1. **How do other actor frameworks (Akka, Orleans, Proto.Actor) handle the distinction between actor definitions/behaviors and actor instances?**
   - Do they use separate APIs or a unified approach?
   - What are the DX trade-offs?

2. **What are the best practices for integrating XState machines with custom actor systems?**
   - Should XState actors be wrapped or adapted?
   - How to preserve XState's actor interface while integrating with a custom actor system?

3. **What are successful patterns for migration-friendly API design when transitioning from instance-based to definition-based actor creation?**
   - How to support both patterns during migration?
   - Examples of frameworks that successfully made this transition?

4. **What are the type-safety implications of having a polymorphic createActor function that returns different types?**
   - Can TypeScript's conditional types handle this elegantly?
   - Performance and maintainability considerations?

5. **How do other frameworks handle the "autoStart" pattern for actors?**
   - Is immediate instantiation vs deferred spawning a common pattern?
   - What are the lifecycle management best practices?

## Additional Context
The framework aims to provide a simple, intuitive API while maintaining the benefits of the actor model (isolation, supervision, location transparency). The solution should balance:
- Developer experience (minimal boilerplate, clear mental model)
- Type safety (compile-time guarantees)
- Migration path (support existing code patterns)
- Architecture purity (maintain actor model principles)

## Research Focus & Priorities

1. **Framework Comparison Scope**: 
   - **Primary focus**: TypeScript/JavaScript actor frameworks (XState, caf.js, comedy.js, nact)
   - **Secondary**: Patterns from mature frameworks in other languages (Akka, Orleans, Proto.Actor) that could inspire TypeScript API design
   - **Rationale**: TypeScript-specific patterns and constraints are most relevant for our API design

2. **Priority Balance**:
   - **Developer Experience: 70%** - The framework should be intuitive and minimize boilerplate
   - **Architectural Purity: 30%** - Maintain core actor model principles but be pragmatic
   - **Key principle**: "Make the common case easy, make the advanced case possible"

3. **Integration Focus**:
   - **XState integration: 40%** - Critical since XState is the de facto state machine library for TypeScript
   - **General DX: 60%** - The API should work well for all actor creation patterns, not just XState
   - **Consider**: How to make both behavior-based actors and state machine actors feel natural

## Success Criteria
A successful solution would:
- Allow existing git-actor code to work with minimal changes
- Provide clear, type-safe APIs for both actor definitions and instances
- Support XState machines as first-class citizens
- Enable gradual migration from v1 to v2
- Maintain a single, coherent mental model for developers