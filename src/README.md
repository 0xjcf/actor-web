# Actor-SPA Framework Guide

## Overview

The Actor-SPA Framework provides a **minimal, type-safe API** for building web components with XState v5 and the actor model. This guide consolidates all core patterns and best practices for AI agents and developers.

**Framework Principles:**
- **Minimal API**: Just `machine` + `template` - everything else is automatic
- **Type-Safe**: Full TypeScript support with zero `any` types
- **Actor Model**: XState machines manage all business logic
- **Reactive**: Event-driven architecture with smart payload extraction
- **Secure**: Built-in XSS protection and input validation

---

## Core API

### `createComponent(config)` - The Primary Function

```typescript
import { setup, assign } from 'xstate';
import { createComponent, html } from '@framework/core';

const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as { type: 'INCREMENT' } | { type: 'DECREMENT' }
  },
  actions: {
    increment: assign({ count: ({ context }) => context.count + 1 }),
    decrement: assign({ count: ({ context }) => context.count - 1 })
  }
}).createMachine({
  id: 'counter',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: { actions: 'increment' },
        DECREMENT: { actions: 'decrement' }
      }
    }
  }
});

const template = (state) => html`
  <div>
    <h1>Count: ${state.context.count}</h1>
    <button send="INCREMENT">+</button>
    <button send="DECREMENT">-</button>
  </div>
`;

// ✅ Auto-registers as <counter-component>
const CounterComponent = createComponent({ 
  machine: counterMachine, 
  template 
});
```

### Configuration Options

```typescript
createComponent({
  machine: myMachine,              // XState machine (required)
  template: myTemplate,            // Template function (required)
  tagName?: 'custom-name',         // Override auto-generated name
  styles?: 'css styles'            // Shadow DOM styles
})
```

---

## Event Handling Patterns

### ✅ **Preferred: Clean Send Syntax**

```typescript
// ✅ BEST: Individual attributes create clean flat events
html`<button send="UPDATE_USER" user-id=${user.id} role=${user.role}>
  Update User
</button>`
// Results in: { type: "UPDATE_USER", userId: "123", role: "admin" }

// ✅ BEST: Form data extraction
html`<form send="SUBMIT_REGISTRATION">
  <input name="email" type="email" required />
  <input name="password" type="password" required />
  <button type="submit">Register</button>
</form>`
// Results in: { type: "SUBMIT_REGISTRATION", email: "...", password: "..." }
```

### 🎯 **New: Clean Object Literal Syntax**

```typescript
// ✅ NEW: Clean object literals (automatically serialized)
html`<button send="UPDATE_USER" payload=${{ id: user.id, changes: { name: "John" } }}">
  Update User
</button>`
// Results in: { type: "UPDATE_USER", payload: { id: "123", changes: { name: "John" } } }

// ✅ COMPLEX: Nested objects and arrays work seamlessly
const userData = { 
  id: 123, 
  profile: { name: "John", role: "admin" },
  tags: ["frontend", "javascript"]
};
html`<button send="BULK_UPDATE" payload=${userData}>Update</button>`
// Results in: { type: "BULK_UPDATE", payload: { id: 123, profile: {...}, tags: [...] } }

// ✅ MULTIPLE: Different object attributes
html`<button 
  send="COMPLEX_ACTION" 
  payload=${{ action: "update" }}
  metadata=${{ source: "ui", timestamp: Date.now() }}
>Complex Action</button>`
```

### 🔄 **Legacy: JSON String Syntax**

```typescript
// ⚠️ LEGACY: Manual JSON strings (use only when necessary)
html`<button send="BULK_UPDATE" payload='{"users": [1,2,3], "action": "activate"}'>
  Bulk Update
</button>`

// ❌ AVOID: Don't use manual JSON for simple data anymore
html`<button send="DELETE_USER" payload='{"userId": "${user.id}"}'>Delete</button>`
// ↑ Better: send="DELETE_USER" user-id=${user.id} 
// ↑ Or: payload=${{ userId: user.id }} (quote-less is standard)
```

### 🔄 **Alternative Syntax**

```typescript
// ✅ SUPPORTED: data- prefixed attributes
html`<button data-send="ACTION" data-item-id=${item.id}>Action</button>`
// Results in: { type: "ACTION", itemId: "456" }

html`<button data-action="SIMPLE_EVENT">Simple</button>`
// Results in: { type: "SIMPLE_EVENT" }
```

---

## ✅ **Consistent Attribute Handling**

Our framework provides **smart attribute handling** with automatic type detection:

```typescript
// 🚀 NEW: Quote-less syntax for objects and arrays (automatically quoted)
html`<button payload=${{ id: 123, name: "John" }}>Update</button>`
// → payload='{"id":123,"name":"John"}'

html`<div tags=${['frontend', 'javascript', 'react']}>Tags</div>`
// → tags='["frontend","javascript","react"]'

html`<button data=${{ user: { id: 1 }, items: [1, 2, 3] }}>Complex</button>`
// → data='{"user":{"id":1},"items":[1,2,3]}'

// ✅ SIMPLE TYPES: Still require quotes (HTML syntax requirement)
html`<input value=${user.name} count=${42} active=${true}>` 
// → value="John Doe" count="42" active="true"

// ✅ NULL/UNDEFINED: Handled gracefully as empty
html`<div optional=${null} missing=${undefined}>Content</div>`
// → optional="" missing=""

// ✅ ARRAYS IN CONTENT: Still joined for HTML rendering  
html`<ul>${items.map(item => html`<li>${item}</li>`)}</ul>`
// → <ul><li>Item 1</li><li>Item 2</li></ul>
```

### **🎯 Smart Syntax Detection**

The framework **automatically detects** when you use quote-less syntax and handles it correctly:

```typescript
// ✅ STANDARD: Quote-less syntax for objects/arrays (recommended)
html`<button payload=${{ id: 123 }}>Click</button>`
//               ↑ No quotes needed!

// ✅ LEGACY: Quoted syntax still works (but quote-less is preferred)
html`<button payload="${{ id: 123 }}">Click</button>`
//               ↑     ↑ Manual quotes (unnecessary)

// ✅ MIXED: Use both syntaxes together
html`<button 
  payload=${{ id: 123 }}      <!-- Quote-less object -->
  name=${user.name}           <!-- Quote-less string -->
  count=${42}                 <!-- Quote-less number -->
>Update</button>`
```

### **⚡ Why This is Better**

```typescript
// ❌ OLD WAY: Verbose and error-prone
html`<button payload='{"id": ${user.id}, "name": "${user.name}", "role": "${user.role}"}'>Update</button>`

// ✅ STANDARD: Quote-less syntax (recommended)
html`<button payload=${{ id: user.id, name: user.name, role: user.role }}>Update</button>`

// Benefits:
// ✅ No manual JSON string construction
// ✅ No escaping worries  
// ✅ Full TypeScript support
// ✅ Automatic XSS protection
// ✅ Cleaner, more readable code
```

### **📋 Complete Type Handling Reference**

| Type | In Attributes | In Content | Example |
|------|--------------|------------|---------|
| **Object** | JSON serialized | String representation | `data-obj=${{a:1}}` → `'{"a":1}'` |
| **Array** | JSON serialized | HTML joined | `data-arr=${[1,2]}` → `'[1,2]'` |  
| **String** | HTML escaped | HTML escaped | `value=${'<script>'}` → `'&lt;script&gt;'` |
| **Number** | String conversion | String conversion | `count=${42}` → `'42'` |
| **Boolean** | String conversion | String conversion | `active=${true}` → `'true'` |
| **null** | Empty string | Empty string | `value=${null}` → `''` |
| **undefined** | Empty string | Empty string | `value=${undefined}` → `''` |

---

## Template System

### `html` Template Function

```typescript
import { html } from '@framework/core';

// ✅ SECURE: Automatic XSS protection
const template = (state) => html`
  <div>
    <h1>${userInput}</h1>  <!-- Automatically escaped -->
    ${state.context.items.map(item => html`
      <div class="item">${item.name}</div>
    `)}
  </div>
`;

// ✅ NESTED: Preserve HTML structure
const nestedTemplate = html`
  <div>
    ${items.map(item => html`
      <div class="item">
        <h3>${item.title}</h3>
        ${item.safeHtmlContent}  <!-- Use direct HTML for trusted content -->
      </div>
    `)}
  </div>
`;
```

### Native JavaScript Template Patterns

```typescript
// ✅ ARRAYS: Use native map() and join()
const listTemplate = (items: string[]) => html`
  <ul>
    ${items.map((item, index) => html`
      <li data-index=${index}>${item}</li>
    `)}
  </ul>
`;

// ✅ CONDITIONALS: Use logical AND for cleaner conditional rendering
const conditionalTemplate = (showContent: boolean, content: string) => html`
  <div>
    ${showContent && html`<p>${content}</p>`}
  </div>
`;

// ✅ TERNARY: Use when you need both true and false cases
const ternaryTemplate = (isLoading: boolean) => html`
  <div>
    ${isLoading ? html`<spinner-component></spinner-component>` : html`<content-component></content-component>`}
  </div>
`;

// ✅ COMPLEX ARRAYS: Use native JavaScript methods
const complexListTemplate = (items: Item[]) => html`
  <div>
    ${items
      .filter(item => item.visible)
      .map(item => html`
        <div class="item ${item.active ? 'active' : ''}">
          ${item.name}
        </div>
      `)
    }
  </div>
`;
```

### Conditional Rendering Best Practices

| Pattern | When to Use | Example |
|---------|-------------|---------|
| **Logical AND (`&&`)** | Show/hide content conditionally | `${hasError && html`<div class="error">Error!</div>`}` |
| **Ternary (`? :`)** | Choose between two different renders | `${isLoading ? html`<spinner/>` : html`<content/>`}` |
| **Guard Clauses** | Early returns in complex logic | `if (!user) return html`<login-form/>`; return html`<dashboard/>`; |

```typescript
// ✅ PREFERRED: Logical AND for conditional display
const errorTemplate = (state) => html`
  <form>
    <input type="email" />
    ${state.context.error && html`
      <div role="alert" class="error">
        ${state.context.error}
      </div>
    `}
  </form>
`;

// ✅ PREFERRED: Ternary for state-based switching
const statusTemplate = (state) => html`
  <div class="status">
    ${state.matches('loading') 
      ? html`<spinner-component></spinner-component>`
      : state.matches('error')
      ? html`<error-message message=${state.context.error}></error-message>`
      : html`<success-content data=${state.context.data}></success-content>`
    }
  </div>
`;

// ✅ PREFERRED: Guard clauses for complex conditions
const complexTemplate = (state) => {
  // Early return for loading state
  if (state.matches('loading')) {
    return html`<loading-spinner></loading-spinner>`;
  }
  
  // Early return for error state
  if (state.matches('error')) {
    return html`<error-boundary error=${state.context.error}></error-boundary>`;
  }
  
  // Main content
  return html`
    <main>
      ${state.context.items.map(item => html`
        <item-card item=${item}></item-card>
      `)}
    </main>
  `;
};
```

### Template Organization Best Practices

```typescript
// ✅ EXTRACT: Break complex templates into functions
const userCardTemplate = (user: User) => html`
  <div class="user-card">
    <h3>${user.name}</h3>
    <p>${user.email}</p>
    <button send="EDIT_USER" user-id=${user.id}>Edit</button>
  </div>
`;

const userListTemplate = (users: User[]) => html`
  <div class="user-list">
    ${users.map(userCardTemplate)}
  </div>
`;

// ❌ AVOID: Deeply nested templates (max 2 levels)
const badTemplate = html`
  <div>
    ${items.map(item => html`
      <div>
        ${item.children.map(child => html`
          <div>
            ${child.nested.map(n => html`<span>${n.value}</span>`)}
          </div>
        `)}
      </div>
    `)}
  </div>
`;
```

---

## JSON Utilities

### Safe Serialization & Deserialization

```typescript
import { 
  safeSerialize, 
  safeDeserialize, 
  serializeEventPayload, 
  deserializeEventPayload,
  frameworkSerializers,
  storageHelpers
} from '@framework/core';

// ✅ SAFE: Automatic protection against circular references, type validation
const userData = { id: '123', name: 'John', email: 'john@example.com' };
const serialized = safeSerialize(userData);
const deserialized = safeDeserialize<User>(serialized);

// ✅ EVENT PAYLOADS: Optimized for framework events
const payload = { type: 'UPDATE_USER', userId: '123', changes: { name: 'Jane' } };
const eventJson = serializeEventPayload(payload);
const eventData = deserializeEventPayload(eventJson);

// ✅ FORM DATA: Direct FormData serialization
const formData = new FormData(formElement);
const formJson = frameworkSerializers.formData.serialize(formData);
const formObject = frameworkSerializers.formData.deserialize(formJson);
```

### Type-Safe Serializers

```typescript
// ✅ TYPED: Create domain-specific serializers
const UserSerializer = createTypedSerializer(
  (obj: unknown): obj is User => {
    return validators.isObject(obj) &&
           typeof obj.id === 'string' &&
           typeof obj.name === 'string' &&
           typeof obj.email === 'string' &&
           obj.email.includes('@');
  },
  'User'
);

// Usage
const user = { id: '123', name: 'John', email: 'john@example.com' };
const json = UserSerializer.serialize(user);
const restored = UserSerializer.deserialize(json);
```

### Storage Integration

```typescript
// ✅ SAFE: Automatic JSON handling with error recovery
import { storageHelpers } from '@framework/core';

// Store any serializable data
const success = storageHelpers.setItem('user-preferences', {
  theme: 'dark',
  language: 'en',
  notifications: true
});

// Retrieve with fallback
const preferences = storageHelpers.getItem('user-preferences', {
  theme: 'light',
  language: 'en',
  notifications: false
});

// Session storage
storageHelpers.setSessionItem('temp-data', formData);
const tempData = storageHelpers.getSessionItem('temp-data');
```

### Built-in Validators

```typescript
import { validators } from '@framework/core';

// ✅ VALIDATION: Common validation patterns
const isValidUser = validators.isUser(unknownData);
const isValidPayload = validators.isEventPayload(eventData);
const hasRequiredFields = validators.hasRequiredFields(['name', 'email']);

// Custom validation
const isValidConfig = (obj: unknown): obj is AppConfig => {
  return validators.isObject(obj) &&
         typeof obj.apiUrl === 'string' &&
         typeof obj.version === 'string';
};
```

---

## State Machine Design

### Single Responsibility Principle

```typescript
// ✅ GOOD: Focused machines
const userSessionMachine = setup({
  types: {
    context: {} as { user: User | null; isAuthenticated: boolean },
    events: {} as 
      | { type: 'LOGIN'; email: string; password: string }
      | { type: 'LOGOUT' }
  }
}).createMachine({
  id: 'userSession',
  initial: 'loggedOut',
  context: { user: null, isAuthenticated: false },
  states: {
    loggedOut: {
      on: { LOGIN: 'authenticating' }
    },
    authenticating: {
      // ... async authentication logic
    },
    loggedIn: {
      on: { LOGOUT: 'loggedOut' }
    }
  }
});

// ❌ AVOID: God machines mixing concerns
const everythingMachine = setup({
  // Don't mix authentication + document editing + navigation
});
```

### Async Operations

```typescript
import { fromPromise } from 'xstate';

const asyncMachine = setup({
  types: {
    context: {} as { data: unknown; error: string | null },
    events: {} as { type: 'FETCH' } | { type: 'RETRY' }
  },
  actors: {
    fetchData: fromPromise(async () => {
      const response = await fetch('/api/data');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
  },
  actions: {
    setData: assign({ data: ({ event }) => event.output, error: null }),
    setError: assign({ error: ({ event }) => event.error.message })
  }
}).createMachine({
  id: 'async-data',
  initial: 'idle',
  context: { data: null, error: null },
  states: {
    idle: {
      on: { FETCH: 'loading' }
    },
    loading: {
      invoke: {
        src: 'fetchData',
        onDone: { target: 'success', actions: 'setData' },
        onError: { target: 'error', actions: 'setError' }
      }
    },
    success: {
      on: { FETCH: 'loading' }
    },
    error: {
      on: { 
        RETRY: 'loading',
        FETCH: 'loading'
      }
    }
  }
});
```

---

## Testing Patterns

### Testing Machines

```typescript
import { createActor } from 'xstate';
import { testMachine } from '@framework/core/test-utilities';

describe('Counter Machine', () => {
  it('should increment count', () => {
    const machine = testMachine(counterMachine);
    machine.start();
    
    expect(machine.state().context.count).toBe(0);
    
    machine.send({ type: 'INCREMENT' });
    expect(machine.state().context.count).toBe(1);
  });
});
```

### Testing Templates

```typescript
import { testTemplate } from '@framework/core/test-utilities';

describe('User Template', () => {
  it('should render user info', () => {
    const mockState = {
      context: { user: { name: 'John', email: 'john@example.com' } },
      matches: (state: string) => state === 'loaded'
    };
    
    const result = testTemplate(userTemplate, mockState);
    
    expect(result.contains('John')).toBe(true);
    expect(result.contains('send="EDIT_USER"')).toBe(true);
  });
});
```

### Component Integration Testing

```typescript
import { setupDOM, cleanupDOM } from '@framework/core/test-utilities';

describe('Counter Component', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = setupDOM();
  });

  afterEach(() => {
    cleanupDOM();
  });

  it('should handle user interactions', () => {
    const component = new CounterComponent();
    container.appendChild(component);

    // Test initial state
    expect(component.html()).toContain('Count: 0');

    // Test interaction
    const button = component.querySelector('[send="INCREMENT"]');
    button?.click();
    
    expect(component.html()).toContain('Count: 1');
  });
});
```

---

## Type Safety Best Practices

### Strict Event Typing

```typescript
// ✅ EXCELLENT: Comprehensive event types
type UserEvents =
  | { type: 'FETCH_USERS' }
  | { type: 'SEARCH_USERS'; query: string }
  | { type: 'SELECT_USER'; userId: string }
  | { type: 'UPDATE_USER'; userId: string; changes: Partial<User> }
  | { type: 'DELETE_USER'; userId: string };

// ❌ AVOID: Loose typing
type BadEvents = 
  | { type: string; [key: string]: any };
```

### Context Typing

```typescript
// ✅ GOOD: Precise context interface
interface UserManagementContext {
  users: User[];
  selectedUser: User | null;
  isLoading: boolean;
  error: string | null;
  filters: {
    search: string;
    department: string | null;
    status: 'active' | 'inactive' | 'all';
  };
}

// ❌ AVOID: Generic typing
interface BadContext {
  data: any;
  state: any;
  props: { [key: string]: any };
}
```

---

## Performance Optimization

### Efficient Re-rendering

```typescript
// ✅ GOOD: Framework handles efficient updates automatically
const template = (state) => html`
  <div class="user-list">
    ${state.context.users.map(user => html`
      <div class="user-item" key=${user.id}>
        ${user.name} - ${user.email}
      </div>
    `)}
  </div>
`;

// ✅ GOOD: Pre-compute expensive operations in machine actions
const userMachine = setup({
  actions: {
    sortUsers: assign({
      sortedUsers: ({ context }) => 
        [...context.users].sort((a, b) => a.name.localeCompare(b.name))
    })
  }
}).createMachine({
  // Sort users when data changes, not in template
  on: {
    USERS_LOADED: { actions: ['setUsers', 'sortUsers'] }
  }
});

// Template uses pre-computed data
const template = (state) => html`
  <div>
    ${state.context.sortedUsers.map(user => userCardTemplate(user))}
  </div>
`;

// ✅ ALTERNATIVE: Use pure functions for computations outside template
function getSortedUsers(users: User[]): User[] {
  return [...users].sort((a, b) => a.name.localeCompare(b.name));
}

const template = (state) => {
  const sortedUsers = getSortedUsers(state.context.users);
  return html`
    <div>
      ${sortedUsers.map(user => userCardTemplate(user))}
    </div>
  `;
};
```

### Memory Management

```typescript
// ✅ GOOD: Framework handles cleanup automatically
const component = createComponent({
  machine: myMachine,
  template: myTemplate
});
// No manual cleanup needed - framework handles it
```

---

## Common Pitfalls & Solutions

### ❌ **Pitfall 1: Mutating Context**

```typescript
// ❌ WRONG: Direct mutation
const badAction = assign({
  users: ({ context, event }) => {
    context.users.push(event.newUser); // Mutates existing array!
    return context.users;
  }
});

// ✅ CORRECT: Immutable updates
const goodAction = assign({
  users: ({ context, event }) => [...context.users, event.newUser]
});
```

### ❌ **Pitfall 2: Side Effects in Templates**

```typescript
// ❌ WRONG: Side effects in templates
const badTemplate = (state) => {
  if (state.context.shouldSave) {
    localStorage.setItem('data', JSON.stringify(state.context.data));
  }
  
  return html`<div>${state.context.data}</div>`;
};

// ✅ CORRECT: Pure template, side effects in machine
const goodTemplate = (state) => html`
  <div>${state.context.data}</div>
`;
```

### ❌ **Pitfall 3: Manual Event Listeners**

```typescript
// ❌ WRONG: Manual event handling
class BadComponent extends HTMLElement {
  connectedCallback() {
    this.querySelector('button')?.addEventListener('click', this.handleClick);
  }
}

// ✅ CORRECT: Declarative event handling
const template = (state) => html`
  <button send="HANDLE_CLICK">Click Me</button>
`;
```

---

## Accessibility Integration

### Automatic ARIA Attributes

```typescript
// ✅ GOOD: Framework automatically manages ARIA
const template = (state) => html`
  <div>
    ${state.matches('loading') ? html`
      <div>Loading...</div>  <!-- Gets aria-live="polite" -->
    ` : state.matches('error') ? html`
      <div>Error occurred</div>  <!-- Gets role="alert" -->
    ` : html`
      <div>Content loaded</div>
    `}
    
    <button send="SUBMIT" data-aria-disabled=${state.matches('submitting')}>
      ${state.matches('submitting') ? 'Submitting...' : 'Submit'}
    </button>
  </div>
`;
```

### Convention-Based ARIA

```typescript
// ✅ GOOD: Use conventional naming for automatic ARIA
const machine = setup({
  types: {
    context: {} as {
      isLoading: boolean,    // → aria-busy="true"
      isExpanded: boolean,   // → aria-expanded="false"
      isSelected: boolean,   // → aria-selected="true"
      isDisabled: boolean,   // → aria-disabled="false"
      isChecked: boolean     // → aria-checked="true"
    }
  }
}).createMachine({
  states: {
    loading: {},      // → aria-busy="true"
    error: {},        // → role="alert"
    success: {}
  }
});
```

---

## Development Workflow

### Component Creation Checklist

1. **Define State Machine**: Business logic first
2. **Create Template**: Pure presentation function
3. **Add Types**: Strict TypeScript typing
4. **Test Logic**: Unit test machine separately
5. **Test Template**: Test rendering separately
6. **Integration Test**: Test complete component
7. **Accessibility**: Verify ARIA attributes
8. **Performance**: Check for unnecessary re-renders

### File Organization

```
src/
├── components/
│   ├── user/
│   │   ├── user-profile.ts        # Component definition
│   │   ├── user-profile.test.ts   # Component tests
│   │   └── user-profile.css       # Component styles
│   └── shared/
│       ├── loading-spinner.ts
│       └── error-message.ts
├── machines/
│   ├── user-session.ts            # Shared state machines
│   └── data-fetching.ts
└── templates/
    ├── user-templates.ts          # Reusable templates
    └── common-templates.ts
```

---

## Summary

This framework provides:

✅ **Minimal API**: Just `machine` + `template`  
✅ **Type Safety**: Zero `any` types, full TypeScript support  
✅ **Event Handling**: Modern `send` attributes with smart extraction  
✅ **Automatic Features**: Lifecycle, rendering, state sync, ARIA  
✅ **Security**: Built-in XSS protection  
✅ **Performance**: Efficient updates and memory management  
✅ **Testing**: Comprehensive testing utilities  
✅ **Accessibility**: Convention-based ARIA automation  

**Quick Start Pattern:**
1. Define machine (business logic)
2. Define template (presentation)  
3. Call `createComponent()` - done!

For specific security, accessibility, or AI development patterns, see the dedicated guides: `SECURITY_GUIDE.md`, `ACCESSIBILITY_GUIDE.md`, and `AI_DEVELOPMENT_GUIDE.md`. 