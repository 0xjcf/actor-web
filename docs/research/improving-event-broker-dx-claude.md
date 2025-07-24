# Reducing Event Broker complexity from 4x to simple subscriptions

The challenge of reducing Event Broker code complexity from 4x overhead to simple subscription patterns while maintaining distributed capabilities is a well-solved problem in established actor frameworks. This research reveals proven patterns and TypeScript-specific approaches that can transform your current verbose message-passing implementation into an elegant API that rivals direct subscriptions in simplicity.

## The facade pattern dominates actor frameworks

**Akka, Orleans, and Erlang/OTP all employ facade patterns to hide the complexity of SUBSCRIBE/UNSUBSCRIBE/PUBLISH messages.** Akka's EventStream provides a hierarchical subscription model that dramatically simplifies event handling compared to raw actor messaging. Instead of manually managing subscribers and routing messages, developers simply call `system.eventStream ! Subscribe(subscriber, classOf[MyEvent])`. The EventStream facade automatically handles subscriber lifecycle management, type-based routing, and cleanup when actors terminate.

Orleans takes a reactive extensions approach with its Streams API, exposing familiar async operations like `await stream.OnNextAsync(data)` and `await stream.SubscribeAsync(handler)`. Behind this simple interface, Orleans manages queue partitioning, failure recovery, backpressure, and distributed subscription coordination. The **virtual streams abstraction** ensures subscriptions survive grain deactivation and reactivation transparently.

Erlang/OTP's gen_event behavior provides callback-based event handling that eliminates manual process management. Developers implement simple callbacks like `handle_event({user_action, UserId, Action}, State)` while the framework handles process lifecycle, message routing to multiple handlers, and crash recovery through supervision integration.

## TypeScript enables compile-time type safety with zero overhead

**Template literal types and discriminated unions can eliminate string-based topic management entirely.** Modern TypeScript patterns enable sophisticated type-safe pub/sub systems without runtime overhead:

```typescript
// Template literal types for topic patterns
type EventTypes = "create" | "read" | "update" | "delete"
type EntityTypes = "user" | "post" | "comment"
type EntityEvents = `${EventTypes}.${EntityTypes}`

// Zero-overhead event broker with compile-time safety
class TypeSafeEventBroker<TEvents extends Record<string, any>> {
  private handlers = new Map<string, Function[]>()
  
  subscribe<K extends keyof TEvents>(
    event: K,
    handler: (data: TEvents[K]) => void
  ): () => void {
    const eventName = event as string
    const handlers = this.handlers.get(eventName) || []
    handlers.push(handler)
    this.handlers.set(eventName, handlers)
    
    return () => {
      handlers.splice(handlers.indexOf(handler), 1)
    }
  }
}
```

For wildcard pattern support, conditional types enable pattern matching at compile time:

```typescript
type MatchPattern<Topic extends string, Pattern extends string> = 
  Pattern extends `${infer Prefix}.*` 
    ? Topic extends `${Prefix}.${string}` ? true : false
    : Topic extends Pattern ? true : false
```

The most powerful approach combines discriminated unions with template literals to avoid nested switch statements entirely. Each event becomes a distinct type with its payload strongly typed, enabling TypeScript to infer correct types throughout the codebase.

## Proxy patterns enable location-transparent subscriptions

**JavaScript's native Proxy API provides zero-overhead interception for creating simple subscribe() APIs over complex message systems.** The research identifies several effective patterns:

```javascript
class LocationTransparentEventBroker {
  async subscribe(eventPattern, callback) {
    const address = await this._resolveAddress(eventPattern)
    
    if (this._isLocal(address)) {
      return this._subscribeLocal(eventPattern, callback)
    } else {
      return this._subscribeRemote(address, eventPattern, callback)
    }
  }

  _subscribeLocal(pattern, callback) {
    // Direct local subscription - zero overhead
    return this.localBroker.subscribe(pattern, callback)
  }

  async _subscribeRemote(address, pattern, callback) {
    // Transparent remote subscription via message passing
    const connection = await this._getConnection(address)
    const subscriptionId = await connection.send({
      type: 'REMOTE_SUBSCRIBE',
      pattern: pattern
    })
    
    connection.onMessage(subscriptionId, callback)
    
    return () => {
      connection.send({
        type: 'REMOTE_UNSUBSCRIBE',
        id: subscriptionId
      })
    }
  }
}
```

This pattern maintains the simple `const unsubscribe = await eventBroker.subscribe('user.profile.*', callback)` API while internally handling the complexity of local vs. remote subscriptions, connection management, and message routing.

## Frameworks succeed through progressive complexity disclosure

**The most successful distributed frameworks don't hide complexity—they organize it thoughtfully.** Research across Dapr, Temporal, and other modern frameworks reveals a consistent pattern of progressive complexity disclosure:

1. **Level 1 - Simple APIs**: Dapr's HTTP endpoints feel like local service calls; Temporal's workflow functions appear synchronous but are distributed
2. **Level 2 - Configuration-driven complexity**: External YAML/JSON definitions add distributed capabilities without code changes
3. **Level 3 - Advanced features**: Custom serialization, complex event processing, and cross-region replication for advanced scenarios

This approach allows developers to start simple and add complexity only when needed, maintaining the "pit of success" where the easiest path is also the correct one.

## Practical implementation recommendations

Based on the research findings, here's a concrete approach to improve your Event Broker:

### 1. Implement a TypeScript facade with proxy pattern

Create a facade that provides the simple subscribe() API while internally translating to Event Broker messages:

```typescript
interface EventBrokerFacade {
  subscribe<T extends EventPattern>(
    pattern: T,
    handler: EventHandler<T>
  ): Promise<Unsubscribe>
}

class TypeSafeEventBrokerFacade implements EventBrokerFacade {
  constructor(private actor: ActorRef<EventBrokerMessage>) {}
  
  async subscribe<T extends EventPattern>(
    pattern: T,
    handler: EventHandler<T>
  ): Promise<Unsubscribe> {
    const subscriptionId = generateId()
    
    // Send SUBSCRIBE message internally
    await this.actor.send({
      type: 'SUBSCRIBE',
      pattern,
      subscriptionId
    })
    
    // Set up local handler mapping
    this.handlers.set(subscriptionId, handler)
    
    // Return simple unsubscribe function
    return async () => {
      await this.actor.send({
        type: 'UNSUBSCRIBE',
        subscriptionId
      })
      this.handlers.delete(subscriptionId)
    }
  }
}
```

### 2. Use discriminated unions to eliminate nested handling

Replace nested TOPIC_EVENT handling with flat discriminated unions:

```typescript
type DomainEvent = 
  | { type: 'user.created'; data: UserCreatedPayload }
  | { type: 'user.updated'; data: UserUpdatedPayload }
  | { type: 'user.deleted'; data: UserDeletedPayload }

// Single-level pattern matching instead of nested switches
function handleEvent(event: DomainEvent) {
  switch (event.type) {
    case 'user.created':
      // TypeScript knows event.data is UserCreatedPayload
      break
  }
}
```

### 3. Consider Event Broker as a required system service

Following the Akka EventStream pattern, make Event Broker a first-class system service with built-in framework support. This enables automatic lifecycle management, supervision integration, and consistent APIs across all actors.

### 4. Maintain location transparency through configuration

Use configuration-driven deployment to maintain location transparency:

```typescript
// Same API works for local and distributed scenarios
const unsubscribe = await eventBroker.subscribe('user.profile.*', handler)

// Location decisions made in configuration, not code
const config = {
  eventBroker: {
    mode: process.env.NODE_ENV === 'production' ? 'distributed' : 'local',
    remoteAddress: process.env.EVENT_BROKER_URL
  }
}
```

## Conclusion

Reducing Event Broker complexity from 4x to simple subscription patterns is achievable through proven architectural patterns. The combination of TypeScript's advanced type system, facade patterns from established actor frameworks, and JavaScript's native Proxy API provides all the tools needed to create an elegant, type-safe API that maintains distributed capabilities while dramatically improving developer experience. The key is not hiding complexity but organizing it thoughtfully through progressive disclosure, allowing developers to use simple APIs for common cases while retaining access to advanced features when needed.