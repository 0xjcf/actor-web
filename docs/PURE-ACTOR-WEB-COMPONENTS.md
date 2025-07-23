# 🎭 Web Components in Pure Actor Model

> **How the Actor-Web Framework's component system works with pure actor architecture**

## Overview

In the pure actor model, **every web component is an actor**. This maintains the clean DX of `createComponent()` while adding the power of actor-based architecture.

## Architecture

```typescript
// Each component is a supervised actor with:
// 1. XState machine (business logic)
// 2. Template function (presentation)  
// 3. Message handler (actor behavior)
// 4. Mailbox (message queue)
// 5. Supervision (fault tolerance)

ComponentActor
  ├─ Mailbox (bounded queue)
  ├─ XState Machine (state management)
  ├─ Template Engine (rendering)
  ├─ Message Handler (actor behavior)
  └─ DOM Updater (efficient updates)
```

## How It Works

### 1. Component Creation

```typescript
// Your existing API remains unchanged
const TodoComponent = createComponent({
  machine: todoMachine,
  template: todoTemplate
});

// But internally, it creates an actor:
class ComponentActor {
  private machine: StateMachine;
  private mailbox: BoundedMailbox;
  private element: HTMLElement;
  
  async onMessage(message: ActorMessage) {
    switch (message.type) {
      case 'DOM_EVENT':
        // User interactions become messages
        this.machine.send(message.payload);
        await this.render();
        break;
        
      case 'RENDER':
        // State changes trigger render messages
        const html = this.template(this.machine.getSnapshot());
        this.updateDOM(html);
        break;
        
      case 'EXTERNAL_MESSAGE':
        // Other actors can send messages
        this.handleExternalMessage(message);
        break;
    }
  }
}
```

### 2. Event Handling

DOM events are automatically converted to actor messages:

```typescript
// This template:
html`<button send="INCREMENT" count=${count}>+</button>`

// Generates this event binding:
button.addEventListener('click', (event) => {
  // Extract attributes as message payload
  const message = {
    type: 'DOM_EVENT',
    payload: {
      type: 'INCREMENT',
      count: event.target.getAttribute('count')
    }
  };
  
  // Send to component's actor mailbox
  componentActor.send(message);
});
```

### 3. State Updates & Rendering

State changes are message-driven:

```typescript
// XState machine processes the message
const machine = createMachine({
  on: {
    INCREMENT: {
      actions: assign({ count: ctx => ctx.count + 1 })
    }
  }
});

// State change triggers render message
machine.onTransition((state) => {
  componentActor.send({ type: 'RENDER' });
});

// Render message updates DOM
onMessage: async ({ message }) => {
  if (message.type === 'RENDER') {
    const snapshot = machine.getSnapshot();
    const html = template(snapshot);
    updateDOM(html);  // Efficient diff-based updates
  }
}
```

### 4. Component-to-Actor Communication

Components can interact with other actors:

```typescript
const SaveableComponent = createComponent({
  machine: formMachine,
  template: formTemplate,
  
  // NEW: Actor configuration
  behavior: {
    // Define relationships
    dependencies: {
      backend: 'actor://system/backend-service',
      notifier: 'actor://system/notification-service'
    },
    
    // Handle cross-actor communication
    onMessage: async ({ message, dependencies }) => {
      if (message.type === 'SAVE_FORM') {
        // Ask backend actor to save
        const result = await dependencies.backend.ask({
          type: 'SAVE_DATA',
          payload: message.formData
        });
        
        // Notify on success
        await dependencies.notifier.send({
          type: 'SHOW_NOTIFICATION',
          payload: { text: 'Saved successfully!' }
        });
        
        // Update component state
        machine.send({ type: 'SAVE_COMPLETE', id: result.id });
      }
    }
  }
});
```

## Benefits Over Traditional Approach

### 1. **True Isolation**
- Components can't directly access each other's state
- Failures are contained to individual components
- No global state pollution

### 2. **Location Transparency**
```typescript
// Component can run anywhere without code changes:
const HeavyComponent = createComponent({
  machine: heavyMachine,
  template: heavyTemplate,
  actor: {
    transport: 'worker'  // Runs in Web Worker!
  }
});

// Or even remote:
const RemoteComponent = createComponent({
  machine: remoteMachine,
  template: remoteTemplate,
  actor: {
    transport: 'websocket',
    endpoint: 'wss://components.example.com'
  }
});
```

### 3. **Built-in Fault Tolerance**
```typescript
// Components supervised like any actor
const ResilientComponent = createComponent({
  machine: myMachine,
  template: myTemplate,
  actor: {
    supervision: {
      strategy: 'restart',
      maxRestarts: 3,
      withinMs: 60000
    }
  }
});
```

### 4. **Message-Based Testing**
```typescript
// Test components by sending messages
it('should increment counter', async () => {
  const component = createComponent({ machine, template });
  
  // Send message instead of clicking DOM
  await component.send({ type: 'INCREMENT' });
  
  // Assert on state via messages
  const state = await component.ask({ type: 'GET_STATE' });
  expect(state.context.count).toBe(1);
});
```

## Migration Path

### Phase 1: Internal Actor Wrapper
Keep existing API, wrap in actor internally:

```typescript
// Existing code continues to work
const MyComponent = createComponent({
  machine: myMachine,
  template: myTemplate
});
```

### Phase 2: Add Actor Features
Gradually add actor capabilities:

```typescript
const MyComponent = createComponent({
  machine: myMachine,
  template: myTemplate,
  actor: {
    // Opt-in to actor features
    supervision: { strategy: 'restart' },
    transport: 'local'
  }
});
```

### Phase 3: Full Actor Components
Components become first-class actors:

```typescript
const MyComponent = defineActor({
  behavior: componentBehavior({
    machine: myMachine,
    template: myTemplate
  }),
  mailbox: { capacity: 100 },
  supervision: { strategy: 'restart' }
});
```

## Example: Todo List Component

```typescript
// Define the machine (unchanged)
const todoMachine = createMachine({
  id: 'todo-list',
  initial: 'idle',
  context: {
    todos: [],
    filter: 'all'
  },
  states: {
    idle: {
      on: {
        ADD_TODO: {
          actions: assign({
            todos: ({ context, event }) => [
              ...context.todos,
              { id: Date.now(), text: event.text, done: false }
            ]
          })
        },
        TOGGLE_TODO: {
          actions: assign({
            todos: ({ context, event }) => 
              context.todos.map(todo =>
                todo.id === event.id 
                  ? { ...todo, done: !todo.done }
                  : todo
              )
          })
        }
      }
    }
  }
});

// Define the template (unchanged)
const todoTemplate = (state) => html`
  <div class="todo-list">
    <form send="ADD_TODO">
      <input name="text" placeholder="New todo..." />
      <button type="submit">Add</button>
    </form>
    
    <ul>
      ${state.context.todos.map(todo => html`
        <li class=${todo.done ? 'done' : ''}>
          <input 
            type="checkbox"
            ${todo.done ? 'checked' : ''}
            send="TOGGLE_TODO"
            todo-id=${todo.id}
          />
          <span>${todo.text}</span>
        </li>
      `)}
    </ul>
  </div>
`;

// Create component with actor features
const TodoListComponent = createComponent({
  machine: todoMachine,
  template: todoTemplate,
  
  // NEW: Actor configuration
  actor: {
    // Save todos to backend
    dependencies: {
      storage: 'actor://system/storage-service'
    },
    
    // Persist on changes
    onMessage: async ({ message, dependencies, state }) => {
      if (message.type === 'STATE_CHANGED') {
        await dependencies.storage.send({
          type: 'SAVE_TODOS',
          payload: state.context.todos
        });
      }
    },
    
    // Load initial data
    onStart: async ({ dependencies, machine }) => {
      const todos = await dependencies.storage.ask({
        type: 'LOAD_TODOS'
      });
      machine.send({ type: 'SET_TODOS', todos });
    }
  }
});
```

## Performance Considerations

### 1. **Message Batching**
DOM updates are automatically batched:

```typescript
// Multiple state changes in same tick
machine.send({ type: 'ADD_TODO', text: 'First' });
machine.send({ type: 'ADD_TODO', text: 'Second' });
machine.send({ type: 'ADD_TODO', text: 'Third' });

// Results in single render message and DOM update
```

### 2. **Efficient Rendering**
Only changed parts update:

```typescript
// Virtual DOM diffing or incremental DOM
const updateDOM = (newHtml: RawHTML) => {
  const patches = diff(currentDOM, newHtml);
  applyPatches(element, patches);
};
```

### 3. **Lazy Component Loading**
Components are actors that can be spawned on-demand:

```typescript
// Spawn component only when needed
const lazyComponent = await actorSystem.spawn(
  MyHeavyComponent,
  { transport: 'worker' }
);
```

## Best Practices

### 1. **Keep Components Focused**
Each component actor should have a single responsibility.

### 2. **Use Message Contracts**
Define clear message types for component communication:

```typescript
type TodoComponentMessages =
  | { type: 'ADD_TODO'; text: string }
  | { type: 'TOGGLE_TODO'; id: number }
  | { type: 'FILTER_TODOS'; filter: 'all' | 'active' | 'done' }
  | { type: 'CLEAR_COMPLETED' };
```

### 3. **Leverage Supervision**
Use supervision for resilient components:

```typescript
// Parent component supervises children
const AppComponent = createComponent({
  machine: appMachine,
  template: appTemplate,
  actor: {
    children: {
      header: HeaderComponent,
      main: MainComponent,
      footer: FooterComponent
    },
    supervision: {
      strategy: 'one-for-one',  // Restart only failed child
      maxRestarts: 3
    }
  }
});
```

### 4. **Test via Messages**
Test components through their actor interface:

```typescript
// Send messages, assert on responses
const state = await component.ask({ type: 'GET_STATE' });
await component.send({ type: 'USER_ACTION' });
const events = await component.ask({ type: 'GET_EVENTS' });
```

## Summary

The pure actor model **enhances** your web component framework by:

- ✅ Maintaining the same clean `createComponent()` API
- ✅ Adding fault tolerance and supervision
- ✅ Enabling location transparency (Workers, remote)
- ✅ Improving testability through messages
- ✅ Providing better isolation and security
- ✅ Supporting advanced patterns (event sourcing, CQRS)

Your existing components continue to work, but gain superpowers! 🚀 