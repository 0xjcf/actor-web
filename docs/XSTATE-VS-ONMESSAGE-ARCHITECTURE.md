# 🎯 XState vs onMessage: Why the Separation?

## The Key Insight

**XState Machine** = Your component's **internal brain** (UI logic)  
**onMessage Handler** = Your component's **external nervous system** (system integration)

## A Concrete Example: Form Component

Let's see why this separation is powerful:

### ❌ Approach 1: Everything in XState (Problematic)

```typescript
// Mixing concerns in XState - becomes messy and hard to test
const formMachine = createMachine({
  states: {
    editing: {
      on: {
        SUBMIT: {
          invoke: {
            src: async (context) => {
              // ❌ XState now needs to know about:
              // - How to find the backend actor
              // - Message protocols
              // - Error handling strategies
              // - Retry logic
              // - Event emission
              
              const backendActor = await actorSystem.lookup('backend');
              const storageActor = await actorSystem.lookup('storage');
              
              try {
                // Save to backend
                const result = await backendActor.ask({
                  type: 'SAVE_FORM',
                  payload: context.formData
                });
                
                // Cache locally
                await storageActor.send({
                  type: 'CACHE_FORM',
                  payload: result
                });
                
                // Emit event
                await eventBus.emit({
                  type: 'FORM_SAVED',
                  formId: result.id
                });
                
                return result;
              } catch (error) {
                // Complex error handling
                if (error.retryable) {
                  // Retry logic...
                }
                throw error;
              }
            },
            onDone: 'saved',
            onError: 'error'
          }
        }
      }
    }
  }
});

// Problems:
// 1. XState machine is now coupled to the actor system
// 2. Can't test the UI logic without mocking the entire system
// 3. Can't reuse this machine in different contexts
// 4. Machine becomes complex and hard to understand
```

### ✅ Approach 2: Separation of Concerns (Clean)

```typescript
// XState handles ONLY the UI logic
const formMachine = createMachine({
  id: 'form',
  initial: 'editing',
  context: {
    formData: {},
    error: null
  },
  states: {
    editing: {
      on: {
        UPDATE_FIELD: {
          actions: assign({
            formData: ({ context, event }) => ({
              ...context.formData,
              [event.field]: event.value
            })
          })
        },
        SUBMIT: 'saving'  // Just transition state!
      }
    },
    saving: {
      // Machine doesn't know HOW saving happens
      on: {
        SAVE_SUCCESS: 'saved',
        SAVE_ERROR: {
          target: 'editing',
          actions: assign({
            error: ({ event }) => event.error
          })
        }
      }
    },
    saved: {
      after: { 2000: 'editing' }
    }
  }
});

// onMessage handles ALL external communication
const formComponent = createComponent({
  machine: formMachine,
  template: formTemplate,
  
  actor: {
    dependencies: {
      backend: 'actor://system/backend',
      storage: 'actor://system/storage'
    },
    
    onMessage: async ({ message, machine, dependencies, emit }) => {
      // Listen for state changes
      if (message.type === 'STATE_CHANGED') {
        const state = machine.getSnapshot();
        
        // React to state transitions
        if (state.matches('saving') && state.history?.matches('editing')) {
          try {
            // Handle the save operation
            const result = await dependencies.backend.ask({
              type: 'SAVE_FORM',
              payload: state.context.formData
            });
            
            // Cache locally
            await dependencies.storage.send({
              type: 'CACHE_FORM',
              payload: result
            });
            
            // Emit event
            await emit({
              type: 'FORM_SAVED',
              formId: result.id
            });
            
            // Tell the machine it succeeded
            machine.send({ type: 'SAVE_SUCCESS', result });
            
          } catch (error) {
            // Tell the machine it failed
            machine.send({ 
              type: 'SAVE_ERROR', 
              error: error.message 
            });
          }
        }
      }
    }
  }
});
```

## The Benefits of This Separation

### 1. **Testability**

```typescript
// Test XState machine in complete isolation
describe('Form Machine', () => {
  it('should transition to saving on SUBMIT', () => {
    const machine = formMachine.createActor();
    machine.start();
    
    machine.send({ type: 'SUBMIT' });
    expect(machine.getSnapshot().matches('saving')).toBe(true);
  });
  
  it('should handle save success', () => {
    const machine = formMachine.createActor();
    machine.start();
    machine.send({ type: 'SUBMIT' });
    machine.send({ type: 'SAVE_SUCCESS' });
    
    expect(machine.getSnapshot().matches('saved')).toBe(true);
  });
});

// Test actor integration separately
describe('Form Component Actor', () => {
  it('should save to backend when transitioning to saving', async () => {
    const mockBackend = createMockActor();
    const component = createComponent({
      machine: formMachine,
      template: formTemplate,
      actor: {
        dependencies: { backend: mockBackend }
      }
    });
    
    // Trigger save through component
    component.send({ type: 'SUBMIT' });
    
    // Verify backend was called
    expect(mockBackend.received).toContainEqual({
      type: 'SAVE_FORM',
      payload: expect.any(Object)
    });
  });
});
```

### 2. **Reusability**

```typescript
// Same XState machine, different actor configurations

// Web version
const WebForm = createComponent({
  machine: formMachine,  // Same machine!
  template: webTemplate,
  actor: {
    dependencies: {
      backend: 'actor://web/api'
    }
  }
});

// Desktop version
const DesktopForm = createComponent({
  machine: formMachine,  // Same machine!
  template: desktopTemplate,
  actor: {
    dependencies: {
      backend: 'actor://electron/ipc'
    }
  }
});

// Test version
const TestForm = createComponent({
  machine: formMachine,  // Same machine!
  template: testTemplate,
  actor: {
    dependencies: {
      backend: mockBackendActor
    }
  }
});
```

### 3. **Progressive Enhancement**

```typescript
// Start simple
const BasicForm = createComponent({
  machine: formMachine,
  template: formTemplate
  // No actor config - just local state
});

// Add persistence later
const PersistentForm = createComponent({
  machine: formMachine,  // Unchanged!
  template: formTemplate,
  actor: {
    onMessage: async ({ message, machine, localStorage }) => {
      if (message.type === 'STATE_CHANGED') {
        // Auto-save to localStorage
        localStorage.setItem('form-draft', 
          JSON.stringify(machine.getSnapshot().context)
        );
      }
    }
  }
});

// Add full backend integration later
const FullForm = createComponent({
  machine: formMachine,  // Still unchanged!
  template: formTemplate,
  actor: {
    dependencies: {
      backend: 'actor://system/backend',
      analytics: 'actor://system/analytics'
    },
    transport: 'worker',  // Move to worker for performance
    onMessage: async ({ message, machine, dependencies }) => {
      // Full integration logic
    }
  }
});
```

### 4. **Clean Mental Model**

```typescript
// Developer asks: "What states can this form be in?"
// Answer: Look at the XState machine
const formStates = {
  editing: "User is filling out the form",
  saving: "Form is being saved",
  saved: "Form was saved successfully",
  error: "Save failed"
};

// Developer asks: "How does it integrate with the backend?"
// Answer: Look at the onMessage handler
const integrations = {
  backend: "Saves form data",
  storage: "Caches locally",
  analytics: "Tracks form events"
};

// Clear separation of concerns!
```

### 5. **System Evolution**

```typescript
// Original: Direct HTTP calls
actor: {
  onMessage: async ({ message, machine }) => {
    if (machine.matches('saving')) {
      const response = await fetch('/api/form', {
        method: 'POST',
        body: JSON.stringify(machine.getSnapshot().context)
      });
      // ...
    }
  }
}

// Later: Move to actor-based backend
actor: {
  dependencies: { backend: 'actor://system/backend' },
  onMessage: async ({ message, machine, dependencies }) => {
    if (machine.matches('saving')) {
      await dependencies.backend.ask({
        type: 'SAVE_FORM',
        payload: machine.getSnapshot().context
      });
    }
  }
}

// Even later: Add event sourcing
actor: {
  dependencies: { 
    backend: 'actor://system/backend',
    eventStore: 'actor://system/event-store'
  },
  onMessage: async ({ message, machine, dependencies }) => {
    // Now also stores events
    await dependencies.eventStore.send({
      type: 'FORM_EVENT',
      event: message
    });
  }
}

// The XState machine never changes!
```

## When to Use Each

### Use XState Machine for:
- UI state transitions
- Form validation logic
- Animation sequences
- User interaction flows
- Component-specific business logic

### Use onMessage for:
- External API calls
- Cross-component communication
- System event handling
- Persistence operations
- Error reporting to external services
- Performance monitoring
- Analytics tracking

## Summary

The separation gives you:

1. **Testable Components**: Test UI logic without system dependencies
2. **Reusable Machines**: Same state logic in different contexts
3. **Clear Architecture**: UI logic vs system integration
4. **Progressive Enhancement**: Start simple, add features
5. **Maintainable Code**: Changes to integration don't affect UI logic

**Think of it this way:**
- **XState** = What your component **is** (states, transitions)
- **onMessage** = How your component **connects** (to the world)

This separation is what makes the actor model so powerful for building resilient, scalable applications! 