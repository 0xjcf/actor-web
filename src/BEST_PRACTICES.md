# Actor-SPA Framework: Best Practices Guide

## Table of Contents
1. [Event Handling Patterns](#event-handling-patterns)
2. [State Machine Design](#state-machine-design)
3. [Template Organization](#template-organization)
4. [Performance Optimization](#performance-optimization)
5. [Testing Strategies](#testing-strategies)
6. [Common Pitfalls](#common-pitfalls)
7. [Accessibility Guidelines](#accessibility-guidelines)
8. [Type Safety Best Practices](#type-safety-best-practices)

## Event Handling Patterns

### ✅ **Preferred: Clean Send Syntax**

Use the modern `send` syntax for the best developer experience:

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
  <input name="confirmPassword" type="password" required />
  <button type="submit">Register</button>
</form>`
// Results in: { type: "SUBMIT_REGISTRATION", email: "...", password: "...", confirmPassword: "..." }
```

### 🎯 **When to Use Payload Attribute**

Reserve the `payload` attribute for truly complex data structures:

```typescript
// ✅ GOOD: Use payload for complex nested data
html`<button send="BULK_UPDATE" payload=${{
  users: selectedUsers,
  changes: { status: "active", department: "engineering" },
  metadata: { updatedBy: currentUser.id, timestamp: Date.now() }
}}>
  Bulk Update Selected Users
</button>`

// ❌ AVOID: Don't use payload for simple data
html`<button send="DELETE_USER" payload=${{ userId: user.id }}>Delete</button>`
// ↑ Should be: send="DELETE_USER" user-id=${user.id}
```

## State Machine Design

### 🎯 **Single Responsibility Principle**

Each machine should handle one specific domain:

```typescript
// ✅ GOOD: Focused machines
const userSessionMachine = setup({
  types: {
    context: {} as { user: User | null; isAuthenticated: boolean },
    events: {} as 
      | { type: 'LOGIN'; email: string; password: string }
      | { type: 'LOGOUT' }
      | { type: 'REFRESH_TOKEN' }
  }
}).createMachine({
  id: 'userSession',
  // ... focused on authentication only
});

// ❌ AVOID: God machines that do everything
const everythingMachine = setup({
  // Don't mix authentication, document editing, navigation, etc.
});
```

## Template Organization

### 📦 **Component Decomposition**

Break complex templates into focused sub-components:

```typescript
// ✅ GOOD: Decomposed templates
const userCardTemplate = (user: User) => html`
  <div class="user-card">
    <img src=${user.avatar} alt=${user.name} />
    <h3>${user.name}</h3>
    <p>${user.email}</p>
    <button send="EDIT_USER" user-id=${user.id}>Edit</button>
    <button send="DELETE_USER" user-id=${user.id}>Delete</button>
  </div>
`;
```

## Performance Optimization

### ⚡ **Efficient Re-rendering**

The framework automatically optimizes re-renders:

```typescript
// ✅ GOOD: Stable references for expensive computations
const template = (state: SnapshotFrom<typeof machine>) => {
  // The framework handles efficient updates automatically
  return html`
    <div class="user-list">
      ${state.context.users.map(user => html`
            <div class="user-item" key=${user.id}>
      ${user.name} - ${user.email}
    </div>
      `)}
    </div>
  `;
};
```

## Testing Strategies

### 🧪 **Unit Testing Machines**

Test business logic separately from presentation:

```typescript
import { createActor } from 'xstate';
import { describe, it, expect } from 'vitest';

describe('User Machine', () => {
  it('should handle user login flow', () => {
    const actor = createActor(userMachine);
    actor.start();
    
    // Initial state
    expect(actor.getSnapshot().value).toBe('loggedOut');
    
    // Start login
    actor.send({ 
      type: 'LOGIN', 
      email: 'test@example.com', 
      password: 'password123' 
    });
    
    expect(actor.getSnapshot().value).toBe('authenticating');
  });
});
```

### 🎭 **Template Testing**

Test template rendering logic:

```typescript
describe('User List Template', () => {
  it('should render user list correctly', () => {
    const mockState = {
      context: {
        users: [
          { id: '1', name: 'John Doe', email: 'john@example.com' },
          { id: '2', name: 'Jane Smith', email: 'jane@example.com' }
        ]
      },
      matches: (state: string) => state === 'loaded'
    };
    
    const result = userListTemplate(mockState as any);
    
    expect(result.html).toContain('John Doe');
    expect(result.html).toContain('send="EDIT_USER"');
  });
});
```

## Common Pitfalls

### ❌ **Pitfall 1: Mutating Context Directly**

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
  // Don't do API calls, localStorage, or other side effects in templates!
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

## Accessibility Guidelines

### ♿ **ARIA Integration**

The framework automatically handles many ARIA attributes:

```typescript
const template = (state) => html`
  <div role="main">
    <h1>User Management</h1>
    
    ${state.matches('loading') ? html`
      <div role="status" aria-live="polite">
        Loading users...
      </div>
    ` : ''}
    
    ${state.matches('error') ? html`
      <div role="alert" aria-live="assertive">
        Error: ${state.context.error}
      </div>
    ` : ''}
  </div>
`;
```

## Type Safety Best Practices

### 🔒 **Strict Event Typing**

Define comprehensive event types:

```typescript
// ✅ EXCELLENT: Comprehensive event types
type UserEvents =
  | { type: 'FETCH_USERS' }
  | { type: 'SEARCH_USERS'; query: string }
  | { type: 'SELECT_USER'; userId: string }
  | { type: 'EDIT_USER'; userId: string }
  | { type: 'UPDATE_USER'; userId: string; changes: Partial<User> }
  | { type: 'DELETE_USER'; userId: string };

// ❌ AVOID: Loose typing
type BadEvents = 
  | { type: string; [key: string]: any };
```

This best practices guide provides comprehensive patterns for building robust, maintainable applications with the Actor-SPA Framework. Remember to always prioritize type safety, accessibility, and clear separation of concerns in your implementations. 