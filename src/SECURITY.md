# Security Analysis: Actor-SPA Framework

## Overview

This document analyzes security implications of the Actor-SPA Framework and provides mitigation strategies for potential vulnerabilities.

## Security Strengths ✅

### 1. **XSS Protection (Strong)**
- **Automatic HTML escaping** in template system
- **Safe-by-default** template literals
- **Nested template preservation** with RawHTML markers

```typescript
// ✅ SECURE: Automatic escaping
const userInput = '<script>alert("xss")</script>';
html`<div>${userInput}</div>`;
// Output: <div>&lt;script&gt;alert("xss")&lt;/script&gt;</div>

// ✅ SECURE: Controlled raw HTML
const safeHtml = html`<strong>Bold</strong>`;
html`<div>${safeHtml}</div>`;
// Only framework-generated HTML bypasses escaping
```

### 2. **Event Sanitization**
- **No direct event handler injection**
- **Structured event processing** through state machines
- **Type-safe event handling**

### 3. **Component Isolation**
- **Scoped state management** per component
- **No global state pollution**
- **Predictable lifecycle management**

## Security Concerns ⚠️

### 1. **JSON Injection in Event Payloads (Medium Risk)**

**Vulnerability**: User-controlled data in `payload` attributes
```typescript
// ⚠️ RISK: Unsanitized user data
const userId = getUserInput(); // Could be: '{"admin": true}'
html`<button send="DELETE_USER" payload=${{ userId: userId }}>Delete</button>`
// Could inject: {"userId": "{\"admin\": true}"}
```

**Mitigation**:
```typescript
// ✅ SECURE: Use attribute extraction instead
html`<button send="DELETE_USER" user-id=${escapeHtml(userId)}>Delete</button>`
// Results in: { type: "DELETE_USER", userId: "123" }

// ✅ SECURE: Validate in state machine
const userMachine = setup({
  actions: {
    deleteUser: ({ event }) => {
      // Validate event structure
      if (typeof event.userId !== 'string' || !/^\d+$/.test(event.userId)) {
        throw new Error('Invalid user ID');
      }
      // Safe to proceed
    }
  }
});
```

### 2. **Component Registration Conflicts (Low Risk)**

**Vulnerability**: Tag name collision attacks
```typescript
// ⚠️ RISK: Malicious component overwrites legitimate one
const maliciousComponent = createComponent({
  machine: evilMachine,
  template: evilTemplate,
  tagName: 'legitimate-component' // Hijacks existing component
});
```

**Mitigation**:
```typescript
// ✅ SECURE: Use unique, namespaced tag names
const component = createComponent({
  machine: myMachine,
  template: myTemplate,
  tagName: 'myapp-user-profile' // Namespace prefix
});

// ✅ SECURE: Check for existing registration
function secureMachineId(id: string): string {
  if (customElements.get(`${id}-component`)) {
    throw new Error(`Component ${id} already registered`);
  }
  return id;
}
```

### 3. **State Injection via Context Manipulation (Medium Risk)**

**Vulnerability**: Unvalidated context updates
```typescript
// ⚠️ RISK: State machine without input validation
const userMachine = setup({
  actions: {
    updateProfile: assign({
      // Direct assignment without validation
      profile: ({ event }) => event.profile
    })
  }
});
```

**Mitigation**:
```typescript
// ✅ SECURE: Input validation and sanitization
const userMachine = setup({
  actions: {
    updateProfile: assign({
      profile: ({ event }) => {
        // Validate and sanitize
        const profile = validateProfile(event.profile);
        return sanitizeProfile(profile);
      }
    })
  }
});

function validateProfile(profile: unknown): UserProfile {
  if (!isValidUserProfile(profile)) {
    throw new Error('Invalid profile data');
  }
  return profile;
}
```

### 4. **Form Data Extraction Vulnerabilities (Medium Risk)**

**Vulnerability**: Unvalidated form data extraction
```typescript
// ⚠️ RISK: Automatic form extraction without validation
html`<form send="SAVE_USER">
  <input name="email" value=${userEmail} />
  <input name="__proto__" value="malicious" />
  <input name="constructor" value="payload" />
</form>`
// Could pollute object prototype
```

**Current Code Analysis**:
```typescript
// extractSendContext() in minimal-api.ts - LINE 420+
if (element.tagName === 'FORM') {
  const formData = new FormData(element as HTMLFormElement);
  for (const [key, value] of formData.entries()) {
    payload[key] = value; // ⚠️ VULNERABILITY: No prototype pollution protection
  }
  return payload;
}
```

**Required Fix**:
```typescript
// ✅ SECURE: Prevent prototype pollution
if (element.tagName === 'FORM') {
  const formData = new FormData(element as HTMLFormElement);
  const safePayload = Object.create(null); // No prototype
  
  for (const [key, value] of formData.entries()) {
    // Validate field names
    if (isValidFieldName(key)) {
      safePayload[key] = sanitizeFieldValue(value);
    }
  }
  return safePayload;
}

function isValidFieldName(name: string): boolean {
  // Reject prototype pollution attempts
  const dangerous = ['__proto__', 'constructor', 'prototype'];
  return !dangerous.includes(name) && /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}
```

### 5. **Event Bus Message Forgery (Low Risk)**

**Vulnerability**: Components could send events to other components
```typescript
// ⚠️ RISK: Component A triggering Component B's events
componentA.eventBus.send({ 
  type: 'DISPATCH', 
  componentId: 'component-b-id', 
  action: 'DELETE_ALL_DATA' 
});
```

**Current Protection**: Components use unique IDs, but EventBus is singleton
**Additional Mitigation**: Add component origin validation

## Recommended Security Enhancements

### 1. **Immediate Fixes (High Priority)**

Fix prototype pollution in form extraction:

```typescript
// Update extractSendContext() method
private extractSendContext(element: Element): Record<string, unknown> {
  const payload = Object.create(null); // ✅ No prototype
  
  // ... existing code ...
  
  // Form data extraction with validation
  if (element.tagName === 'FORM') {
    const formData = new FormData(element as HTMLFormElement);
    for (const [key, value] of formData.entries()) {
      if (this.isValidFieldName(key)) {
        payload[key] = this.sanitizeFieldValue(value);
      }
    }
    return payload;
  }
  
  // Attribute extraction with validation
  for (const attr of element.attributes) {
    if (this.isValidAttributeName(attr.name)) {
      const key = this.normalizeAttributeName(attr.name);
      payload[key] = this.sanitizeAttributeValue(attr.value);
    }
  }
  
  return payload;
}

private isValidFieldName(name: string): boolean {
  const dangerous = ['__proto__', 'constructor', 'prototype', 'valueOf', 'toString'];
  return !dangerous.includes(name) && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name);
}

private sanitizeFieldValue(value: FormDataEntryValue): string {
  return typeof value === 'string' ? escapeHtml(value) : '';
}
```

### 2. **Content Security Policy Integration**

Add CSP headers recommendation:
```javascript
// Recommended CSP for framework applications
"Content-Security-Policy": [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Needed for inline event handlers
  "style-src 'self' 'unsafe-inline'",  // Needed for component styles
  "object-src 'none'",
  "base-uri 'self'"
].join('; ')
```

### 3. **State Machine Security Patterns**

```typescript
// ✅ SECURE: Input validation in guards
const secureUserMachine = setup({
  guards: {
    isValidEmail: ({ event }) => {
      return typeof event.email === 'string' && 
             /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(event.email);
    },
    isAuthorized: ({ context, event }) => {
      return context.user?.permissions?.includes(event.requiredPermission);
    }
  },
  actions: {
    updateEmail: assign({
      email: ({ event }) => {
        // Additional sanitization
        return event.email.toLowerCase().trim();
      }
    })
  }
}).createMachine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        UPDATE_EMAIL: {
          guard: 'isValidEmail',
          actions: 'updateEmail'
        },
        ADMIN_ACTION: {
          guard: 'isAuthorized',
          actions: 'performAdminAction'
        }
      }
    }
  }
});
```

### 4. **Template Security Headers**

```typescript
// Add template security validation
export function secureHtml(strings: TemplateStringsArray, ...values: unknown[]): RawHTML {
  // Validate template strings for suspicious patterns
  const combinedString = strings.join('{{VALUE}}');
  if (containsSuspiciousPatterns(combinedString)) {
    throw new Error('Template contains potentially unsafe patterns');
  }
  
  return html(strings, ...values);
}

function containsSuspiciousPatterns(template: string): boolean {
  const suspicious = [
    /javascript:/i,
    /data:(?!image)/i,
    /vbscript:/i,
    /on\w+\s*=/i
  ];
  return suspicious.some(pattern => pattern.test(template));
}
```

## Security Best Practices for Developers

### 1. **Input Validation**
```typescript
// ✅ Always validate event data
const machine = setup({
  actions: {
    processInput: ({ event }) => {
      const validated = validateAndSanitize(event);
      // Use validated data
    }
  }
});
```

### 2. **Avoid Dangerous Patterns**
```typescript
// ❌ AVOID: Direct user input in payload
html`<button payload='${userInput}'>Button</button>`

// ✅ USE: Attribute extraction
html`<button send="ACTION" data-value=${escapeHtml(userInput)}>Button</button>`
```

### 3. **Component Naming**
```typescript
// ✅ Use namespaced component names
const component = createComponent({
  tagName: 'myapp-secure-component',
  // ...
});
```

### 4. **State Validation**
```typescript
// ✅ Validate all external inputs
const secureAssign = (updater: (context: Context, event: Event) => Partial<Context>) => 
  assign((context, event) => {
    const updates = updater(context, event);
    return validateStateUpdates(updates);
  });
```

## Security Testing Checklist

- [ ] XSS prevention in templates
- [ ] JSON injection in payloads
- [ ] Prototype pollution in form data
- [ ] Component name conflicts
- [ ] State validation
- [ ] CSP compatibility
- [ ] Event handler security
- [ ] Memory leaks in cleanup

## Monitoring and Logging

```typescript
// Add security monitoring
const secureEventBus = {
  logSuspiciousActivity(componentId: string, event: unknown) {
    if (this.isSuspicious(event)) {
      console.warn('Suspicious event detected:', { componentId, event });
      // Report to security monitoring
    }
  },
  
  isSuspicious(event: unknown): boolean {
    // Detect unusual patterns
    return false; // Implement detection logic
  }
};
```

## Conclusion

The Actor-SPA Framework has strong security foundations but requires the immediate fixes outlined above, particularly around form data extraction and input validation. With these mitigations, the framework provides a secure foundation for web application development. 