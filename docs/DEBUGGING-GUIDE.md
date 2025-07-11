# 🐛 Actor-Web Framework Debugging Guide

> **Essential debugging techniques, tools, and patterns for the Actor-Web framework**

## 📋 **Quick Reference**

### **Logger Infrastructure**
- `Logger.namespace('COMPONENT')` - Create scoped logger
- `enableDevMode()` - Enable debug logging in tests
- `log.debug()` - Development-only logging
- `log.info()` - Always visible logging

### **Test Debugging**
- `await vi.runAllTimersAsync()` - Wait for microtasks
- `vi.advanceTimersByTime(ms)` - Control fake timers
- Race conditions → Use `queueMicrotask()`

---

## 🚀 **Getting Started**

### **Enable Debugging in Tests**

```typescript
import { enableDevMode, Logger } from '@actor-web/core';

// Enable dev mode for debug logging
enableDevMode();

describe('My Component', () => {
  const log = Logger.namespace('MY_COMPONENT');
  
  it('should work correctly', () => {
    log.debug('Test starting');
    // ... test logic
  });
});
```

### **Production Logging**

```typescript
import { Logger } from '@actor-web/core';

const log = Logger.namespace('USER_SERVICE');

export const loginUser = async (credentials) => {
  log.info('User login attempt', { email: credentials.email });
  
  try {
    const result = await authenticateUser(credentials);
    log.info('User login successful', { userId: result.id });
    return result;
  } catch (error) {
    log.error('User login failed', error);
    throw error;
  }
};
```

---

## 🔧 **Logger API Reference**

### **Scoped Logger Creation**

```typescript
import { Logger, type ScopedLogger } from '@actor-web/core';

// Create a scoped logger
const log: ScopedLogger = Logger.namespace('SERVICE_NAME');
```

### **Log Levels**

```typescript
// Debug (dev mode only)
log.debug('Detailed information', { data });

// Info (always shows)
log.info('Important events', { userId });

// Warning (always shows)  
log.warn('Potential issues', { validation });

// Error (always shows)
log.error('Critical failures', error);
```

### **Grouped Logging**

```typescript
log.group('Complex Operation');
log.debug('Step 1: Initialize');
log.debug('Step 2: Process data');
log.debug('Step 3: Cleanup');
log.groupEnd();
```

---

## ⚡ **Service Debugging**

### **Timer Services**

```typescript
// ✅ Debug timer service with scoped logging
export const createThrottleService = () => {
  return fromCallback(({ sendBack, input, receive }) => {
    const log = Logger.namespace('THROTTLE');
    log.debug('Service created', input);
    
    receive((event) => {
      log.debug('Received event', { type: event.type });
      
      if (event.type === 'TRIGGER') {
        log.debug('Processing trigger', { 
          timeSinceLastExecution,
          canExecute: timeSinceLastExecution >= interval 
        });
        
        if (shouldExecute) {
          log.debug('Executing immediately');
          execute();
        } else {
          log.debug('Deferring execution');
          scheduleTrailingExecution();
        }
      }
    });
  });
};
```

### **Event Communication**

```typescript
// ✅ Debug service-to-machine communication
const machine = setup({
  actors: { throttle: createThrottleService() }
}).createMachine({
  states: {
    throttling: {
      entry: [
        sendTo('throttle', { type: 'TRIGGER' }),
        () => log.debug('Sent TRIGGER to service')
      ],
      on: {
        THROTTLE_EXECUTE: { 
          actions: [
            executeHandler,
            () => log.debug('Received THROTTLE_EXECUTE')
          ]
        }
      }
    }
  }
});
```

---

## 🧪 **Test Debugging Patterns**

### **Async Operations**

```typescript
// ✅ Handle async operations properly
it('should handle async behavior', async () => {
  const log = Logger.namespace('TEST');
  
  // Trigger operation
  log.debug('Triggering async operation');
  actor.send({ type: 'START_ASYNC' });
  
  // Wait for async completion
  log.debug('Waiting for completion');
  await vi.runAllTimersAsync(); // Microtasks
  
  // Or wait for condition
  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalled();
  });
  
  log.debug('Test completed successfully');
});
```

### **Race Condition Resolution**

```typescript
// ❌ Race condition: events sent simultaneously
on: {
  COMPLETE: {
    actions: [executeAction, sendNextEvent] // Race!
  }
}

// ✅ Deferred event to avoid race
on: {
  COMPLETE: {
    actions: [
      executeAction,
      () => queueMicrotask(() => sendNextEvent())
    ]
  }
}
```

### **Timing-Dependent Tests**

```typescript
// ✅ Control time precisely in tests
it('should throttle correctly', async () => {
  const log = Logger.namespace('THROTTLE_TEST');
  
  // First execution (immediate)
  log.debug('Sending first trigger');
  actor.send({ type: 'TRIGGER' });
  expect(handler).toHaveBeenCalledTimes(1);
  
  // Rapid triggers (should be throttled)
  log.debug('Sending rapid triggers');
  actor.send({ type: 'TRIGGER' });
  actor.send({ type: 'TRIGGER' });
  expect(handler).toHaveBeenCalledTimes(1); // Still 1
  
  // Advance time to trailing execution
  log.debug('Advancing time for trailing execution');
  vi.advanceTimersByTime(300);
  await vi.runAllTimersAsync(); // Key: wait for microtasks
  
  expect(handler).toHaveBeenCalledTimes(2); // Now 2
  log.debug('Throttle test completed');
});
```

---

## 🔍 **Common Issues & Solutions**

### **Service Not Receiving Events**

**Problem**: Service doesn't receive events from machine

```typescript
// ❌ Event not forwarded
on: {
  TRIGGER: 'throttling' // State change only, no event to service
}

// ✅ Forward event with entry action
on: {
  TRIGGER: {
    target: 'throttling',
    actions: sendTo('service', { type: 'TRIGGER' })
  }
}

// ✅ Or use entry action
states: {
  throttling: {
    entry: sendTo('service', { type: 'TRIGGER' }),
    // ...
  }
}
```

### **Test Handlers Not Called**

**Problem**: Event handlers not executing in tests

```typescript
// ❌ Missing microtask wait
vi.advanceTimersByTime(300);
expect(handler).toHaveBeenCalledTimes(2); // Fails!

// ✅ Wait for async operations
vi.advanceTimersByTime(300);
await vi.runAllTimersAsync(); // Critical!
expect(handler).toHaveBeenCalledTimes(2); // Passes!
```

### **Inconsistent Timing**

**Problem**: Tests fail intermittently due to timing

```typescript
// ❌ Real time dependency
setTimeout(() => expect(handler).toHaveBeenCalled(), 100);

// ✅ Controlled fake timers
vi.advanceTimersByTime(100);
expect(handler).toHaveBeenCalled();
```

---

## 🛠️ **Development Tools**

### **Wallaby.js Integration**

```typescript
// Use with Wallaby for live test debugging
import { Logger } from '@actor-web/core';

const log = Logger.namespace('WALLABY_DEBUG');

it('debug with wallaby', () => {
  log.debug('Current state', actor.getSnapshot().value);
  log.debug('Handler calls', handler.mock.calls.length);
  
  // Wallaby shows real-time values
  actor.send({ type: 'EVENT' });
  
  log.debug('New state', actor.getSnapshot().value);
});
```

### **Console Ninja Integration**

```typescript
// Enhanced console output with Console Ninja
const log = Logger.namespace('CONSOLE_NINJA');

// Rich object inspection
log.debug('Complex state', {
  machine: actor.getSnapshot(),
  context: actor.getSnapshot().context,
  history: actor.getSnapshot().history
});
```

---

## 🏷️ **Namespace Constants System**

### **Why Use Namespace Constants?**

Instead of using string literals for namespaces, use predefined constants for:
- **Type Safety** - No typos in namespace strings
- **IDE Support** - Autocomplete and refactoring
- **Consistency** - Standard naming conventions across the team
- **Discoverability** - Easy to see all available namespaces

### **Basic Usage**

```typescript
import { NAMESPACES, Logger } from '@actor-web/core';

// ❌ Before: String literals (error-prone)
const log1 = Logger.namespace('THROTTLE'); // Typo risk
const log2 = Logger.namespace('throttle'); // Inconsistent case
const log3 = Logger.namespace('TROTTLE'); // Typo!

// ✅ After: Type-safe constants
const log = Logger.namespace(NAMESPACES.TIMER.THROTTLE); // Autocomplete + type safety
```

### **Available Namespace Categories**

```typescript
import { NAMESPACES } from '@actor-web/core';

// Timer Services
NAMESPACES.TIMER.DELAY
NAMESPACES.TIMER.INTERVAL  
NAMESPACES.TIMER.ANIMATION_FRAME
NAMESPACES.TIMER.DEBOUNCE
NAMESPACES.TIMER.THROTTLE

// Event System
NAMESPACES.EVENT.BUS
NAMESPACES.EVENT.DELEGATION
NAMESPACES.EVENT.OBSERVER
NAMESPACES.EVENT.EMITTER

// Components
NAMESPACES.COMPONENT.BRIDGE
NAMESPACES.COMPONENT.REGISTRY
NAMESPACES.COMPONENT.LIFECYCLE
NAMESPACES.COMPONENT.RENDERER
NAMESPACES.COMPONENT.TEMPLATE

// State Management
NAMESPACES.STATE.MACHINE
NAMESPACES.STATE.ACTOR
NAMESPACES.STATE.SUPERVISOR
NAMESPACES.STATE.CONTEXT

// Utilities
NAMESPACES.UTILITY.JSON
NAMESPACES.UTILITY.ACCESSIBILITY
NAMESPACES.UTILITY.KEYBOARD
NAMESPACES.UTILITY.FOCUS
NAMESPACES.UTILITY.VALIDATION

// APIs
NAMESPACES.API.HTTP
NAMESPACES.API.MINIMAL
NAMESPACES.API.REQUEST
NAMESPACES.API.RESPONSE
NAMESPACES.API.AUTH

// User Features
NAMESPACES.USER.AUTH
NAMESPACES.USER.PROFILE
NAMESPACES.USER.PREFERENCES
NAMESPACES.USER.SESSION

// UI Components
NAMESPACES.UI.FORM
NAMESPACES.UI.MODAL
NAMESPACES.UI.NAVIGATION
NAMESPACES.UI.LAYOUT
NAMESPACES.UI.THEME

// Testing & Development
NAMESPACES.TEST.SETUP
NAMESPACES.TEST.FIXTURE
NAMESPACES.TEST.MOCK
NAMESPACES.TEST.INTEGRATION
NAMESPACES.TEST.E2E

NAMESPACES.DEV.HOT_RELOAD
NAMESPACES.DEV.BUNDLER
NAMESPACES.DEV.WATCHER
NAMESPACES.DEV.PERFORMANCE
```

### **Custom Namespaces**

For namespaces not in the predefined constants:

```typescript
import { createCustomNamespace, NAMESPACE_PATTERNS } from '@actor-web/core';

// ✅ Validated custom namespace
const myServiceNamespace = createCustomNamespace('MY_CUSTOM_SERVICE');
const log = Logger.namespace(myServiceNamespace);

// ✅ Use patterns for consistency
const serviceNamespace = NAMESPACE_PATTERNS.SERVICE('payment'); // "PAYMENT_SERVICE"
const componentNamespace = NAMESPACE_PATTERNS.COMPONENT('button'); // "BUTTON_COMPONENT"
const testNamespace = NAMESPACE_PATTERNS.TEST('integration'); // "INTEGRATION_TEST"
```

### **Migration Example**

```typescript
// ❌ Before: Scattered string literals
const createThrottleService = () => {
  const log = Logger.namespace('THROTTLE'); // Easy to typo
  // ...
};

const createEventBus = () => {
  const log = Logger.namespace('eventBus'); // Inconsistent case
  // ...
};

const createHttpService = () => {
  const log = Logger.namespace('HTTP-SERVICE'); // Wrong format
  // ...
};

// ✅ After: Consistent, type-safe constants
import { NAMESPACES } from '@actor-web/core';

const createThrottleService = () => {
  const log = Logger.namespace(NAMESPACES.TIMER.THROTTLE); // Type-safe
  // ...
};

const createEventBus = () => {
  const log = Logger.namespace(NAMESPACES.EVENT.BUS); // Consistent
  // ...
};

const createHttpService = () => {
  const log = Logger.namespace(NAMESPACES.API.HTTP); // Standard format
  // ...
};
```

### **Team Benefits**

#### **1. IDE Autocomplete**
```typescript
// Type NAMESPACES. and get autocomplete for all categories
const log = Logger.namespace(NAMESPACES.TIMER./*autocomplete here*/);
```

#### **2. Refactoring Safety**
```typescript
// Rename THROTTLE to RATE_LIMITER in one place, updates everywhere
export const TIMER_NAMESPACES = {
  THROTTLE: 'RATE_LIMITER', // Change here
  // ... other namespaces
} as const;

// All usages automatically update without find/replace
```

#### **3. Validation**
```typescript
import { isValidNamespace } from '@actor-web/core';

// Runtime validation for dynamic namespaces
const dynamicNamespace = getUserSelectedNamespace();
if (isValidNamespace(dynamicNamespace)) {
  const log = Logger.namespace(dynamicNamespace);
  // ... safe to use
}
```

#### **4. Documentation Generation**
```typescript
import { getAllNamespaceValues } from '@actor-web/core';

// Generate documentation automatically
const allNamespaces = getAllNamespaceValues();
console.log('Available namespaces:', allNamespaces);
// ['DELAY', 'INTERVAL', 'THROTTLE', 'EVENT_BUS', ...]
```

### **Implementation Guide**

#### **Step 1: Import Constants**
```typescript
import { NAMESPACES, Logger } from '@actor-web/core';
```

#### **Step 2: Replace String Literals**
```typescript
// Find: Logger.namespace('STRING_LITERAL')
// Replace: Logger.namespace(NAMESPACES.CATEGORY.NAME)
```

#### **Step 3: Add New Categories (if needed)**
```typescript
// Add to namespace-constants.ts if new categories needed
export const MY_CATEGORY_NAMESPACES = {
  NEW_SERVICE: 'NEW_SERVICE',
} as const;
```

#### **Step 4: Update Team Documentation**
```typescript
// Document your custom namespaces for the team
const TEAM_NAMESPACES = {
  PAYMENT: NAMESPACE_PATTERNS.SERVICE('payment'),
  ANALYTICS: NAMESPACE_PATTERNS.SERVICE('analytics'),
} as const;
```

---

## 📚 **Best Practices**

### **Namespace Conventions**

```typescript
// ✅ Clear, consistent namespaces
const log = Logger.namespace('USER_SERVICE');      // Services
const log = Logger.namespace('LOGIN_COMPONENT');   // Components  
const log = Logger.namespace('AUTH_MACHINE');      // State machines
const log = Logger.namespace('VALIDATION_UTILS');  // Utilities
const log = Logger.namespace('USER_TEST');         // Tests
```

### **Log Message Patterns**

```typescript
const log = Logger.namespace('SERVICE');

// ✅ Good: Action + context
log.debug('Service created', { config });
log.debug('Processing request', { requestId, userId });
log.debug('Operation completed', { duration, result });

// ❌ Avoid: Vague messages
log.debug('Something happened');
log.debug('Error');
```

### **Production Safety**

```typescript
const log = Logger.namespace('PRODUCTION_SERVICE');

// ✅ Safe: No sensitive data in logs
log.info('User login', { userId: user.id });

// ❌ Unsafe: Sensitive data exposed
log.info('User login', { password: user.password });

// ✅ Conditional detailed logging
if (process.env.NODE_ENV === 'development') {
  log.debug('Detailed state', complexInternalState);
}
```

---

## 🚨 **Troubleshooting Checklist**

### **Test Failures**

- [ ] **Dev mode enabled?** `enableDevMode()` in test file?
- [ ] **Microtask wait?** Using `await vi.runAllTimersAsync()`?
- [ ] **Event forwarding?** Service receiving events properly?
- [ ] **Race conditions?** Using `queueMicrotask()` for deferred events?
- [ ] **Timing control?** Using `vi.advanceTimersByTime()` correctly?

### **Service Communication**

- [ ] **Service registered?** In machine `actors` config?
- [ ] **Events forwarded?** Using `sendTo()` actions?
- [ ] **Event types match?** Service expecting correct event types?
- [ ] **Logging added?** Scoped logger in service `receive()` handler?

### **Performance Issues**

- [ ] **Excessive logging?** Too many debug statements?
- [ ] **Memory leaks?** Cleanup functions implemented?
- [ ] **Timer cleanup?** `clearTimeout`/`clearInterval` called?
- [ ] **Event listener cleanup?** `removeEventListener` called?

---

## 🎯 **Examples by Use Case**

### **Form Validation Service**

```typescript
const log = Logger.namespace('FORM_VALIDATION');

export const createValidationService = () => {
  return fromCallback(({ sendBack, receive }) => {
    log.debug('Validation service created');
    
    receive((event) => {
      log.debug('Received validation request', { 
        field: event.field, 
        value: event.value?.length 
      });
      
      const isValid = validateField(event.field, event.value);
      
      log.debug('Validation completed', { 
        field: event.field, 
        isValid,
        errors: isValid ? [] : getErrors(event.field, event.value)
      });
      
      sendBack({
        type: 'VALIDATION_RESULT',
        field: event.field,
        isValid,
        errors: isValid ? [] : getErrors(event.field, event.value)
      });
    });
  });
};
```

### **HTTP Request Service**

```typescript
const log = Logger.namespace('HTTP_SERVICE');

export const createHttpService = () => {
  return fromPromise(async ({ input }) => {
    const { url, method = 'GET', data } = input;
    
    log.info('HTTP request started', { method, url });
    
    try {
      const response = await fetch(url, {
        method,
        body: data ? JSON.stringify(data) : undefined,
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        log.error('HTTP request failed', { 
          method, 
          url, 
          status: response.status,
          statusText: response.statusText 
        });
        throw error;
      }
      
      const result = await response.json();
      log.info('HTTP request completed', { 
        method, 
        url, 
        status: response.status,
        dataSize: JSON.stringify(result).length 
      });
      
      return result;
    } catch (error) {
      log.error('HTTP request error', { method, url, error });
      throw error;
    }
  });
};
```

---

*Happy debugging! 🐛→✨* 