# Security Documentation

> **Package**: `@actor-core/security`  
> **Status**: Advanced Feature  
> **Use Case**: Multi-tenant systems, fine-grained access control, secure actor communication

## Overview

The security module provides capability-based access control for actors, enabling fine-grained permissions, secure multi-tenant systems, and audit trails. Based on the principle of least privilege, actors only have access to the capabilities explicitly granted to them.

## Installation

```bash
npm install @actor-core/security
```

## Core Concepts

### Capability-Based Security
- **Capabilities as Tokens**: Unforgeable tokens that grant specific permissions
- **Principle of Least Privilege**: Actors only get the permissions they need
- **Delegation**: Capabilities can be delegated with restrictions
- **Revocation**: Capabilities can be revoked at any time

### Security Model
- **No Ambient Authority**: No global permissions or roles
- **Explicit Grants**: All permissions must be explicitly granted
- **Composable**: Capabilities can be combined for complex permissions
- **Auditable**: All capability usage is logged

## API Reference

### `createSecureActor(actor, capabilities, sessionId)`

Wraps an actor with capability-based security.

```typescript
function createSecureActor<T>(
  actor: ActorRef<T>,
  capabilities: Capability[],
  sessionId: string,
  options?: {
    audit?: boolean;
    strictMode?: boolean;
    expirationCheck?: boolean;
  }
): SecureActor<T>
```

**Parameters:**
- `actor`: The actor to secure
- `capabilities`: Initial capabilities for the actor
- `sessionId`: Unique session identifier for audit
- `options.audit`: Enable audit logging (default: true)
- `options.strictMode`: Fail on any permission denial (default: false)
- `options.expirationCheck`: Check capability expiration (default: true)

### `SecureActor<T>`

```typescript
interface SecureActor<T> {
  // Invoke a method with capability checking
  invoke<K extends keyof T>(
    method: K,
    ...args: Parameters<T[K]>
  ): Promise<ReturnType<T[K]>>;
  
  // Capability management
  grant(capability: Capability): void;
  revoke(capabilityId: string): void;
  delegate(capability: Capability, restrictions?: Restrictions): Capability;
  
  // Permission checking
  hasPermission(permission: string): boolean;
  checkPermission(permission: string): void; // throws if denied
  
  // Get current capabilities
  getCapabilities(): ReadonlyArray<Capability>;
  
  // Audit trail
  getAuditLog(): ReadonlyArray<AuditEntry>;
}
```

### `Capability`

```typescript
interface Capability {
  // Unique identifier
  readonly id: string;
  
  // Permissions granted
  readonly permissions: string[];
  
  // Resource this capability applies to
  readonly resource: string;
  
  // Who granted this capability
  readonly grantedBy: string;
  
  // When it was granted
  readonly grantedAt: number;
  
  // Optional expiration
  readonly expiresAt?: number;
  
  // Restrictions on use
  readonly restrictions?: Restrictions;
  
  // Additional metadata
  readonly metadata?: Record<string, unknown>;
}

interface Restrictions {
  // Maximum number of uses
  maxUses?: number;
  
  // Time-based restrictions
  validFrom?: number;
  validUntil?: number;
  
  // IP restrictions
  allowedIPs?: string[];
  
  // Custom restrictions
  custom?: Record<string, unknown>;
}
```

## Usage Examples

### Basic Capability Security

```typescript
import { createSecureActor, Capability } from '@actor-core/security';
import { createActorRef } from '@actor-core/runtime';

// Create a regular actor
const userActor = createActorRef(userMachine);

// Define capabilities
const readCapability: Capability = {
  id: 'cap-read-profile',
  permissions: ['profile.read'],
  resource: 'user:123',
  grantedBy: 'system',
  grantedAt: Date.now(),
  expiresAt: Date.now() + 3600000 // 1 hour
};

const writeCapability: Capability = {
  id: 'cap-write-profile',
  permissions: ['profile.write'],
  resource: 'user:123',
  grantedBy: 'admin',
  grantedAt: Date.now()
};

// Create secure actor
const secureUser = createSecureActor(
  userActor,
  [readCapability, writeCapability],
  'session-456'
);

// Use secure actor - permissions are checked automatically
try {
  const profile = await secureUser.invoke('getProfile');
  await secureUser.invoke('updateProfile', { name: 'Alice' });
} catch (error) {
  if (error instanceof SecurityError) {
    console.error('Permission denied:', error.permission);
  }
}
```

### Multi-Tenant System

```typescript
// Tenant-specific actor factory
function createTenantActor(tenantId: string, userId: string) {
  const actor = createActorRef(tenantMachine);
  
  // Capabilities scoped to tenant
  const capabilities: Capability[] = [
    {
      id: `cap-${tenantId}-${userId}`,
      permissions: [
        'tenant.read',
        'tenant.users.read',
        'tenant.users.write'
      ],
      resource: `tenant:${tenantId}`,
      grantedBy: 'tenant-system',
      grantedAt: Date.now(),
      metadata: {
        tenantId,
        userId,
        role: 'member'
      }
    }
  ];
  
  return createSecureActor(actor, capabilities, `${tenantId}-${userId}`);
}

// Usage
const tenantActor = createTenantActor('acme-corp', 'user-123');

// Only has access to their tenant
await tenantActor.invoke('listUsers'); // ✓ Allowed
await tenantActor.invoke('deleteAllData'); // ✗ SecurityError
```

### Capability Delegation

```typescript
// Admin creates a capability
const adminCapability: Capability = {
  id: 'admin-cap',
  permissions: ['users.*', 'data.*'],
  resource: '*',
  grantedBy: 'root',
  grantedAt: Date.now()
};

const adminActor = createSecureActor(actor, [adminCapability], 'admin');

// Admin delegates limited capability to another user
const delegatedCapability = adminActor.delegate(adminCapability, {
  permissions: ['users.read'], // Subset of permissions
  maxUses: 10,
  validUntil: Date.now() + 86400000, // 24 hours
  metadata: {
    delegatedTo: 'user-456',
    reason: 'Temporary audit access'
  }
});

// User can only use delegated permissions
const userActor = createSecureActor(
  actor,
  [delegatedCapability],
  'user-456'
);
```

### Role-Based Access Control (RBAC) Layer

```typescript
// Build RBAC on top of capabilities
class RoleManager {
  private roleDefinitions = new Map<string, string[]>();
  
  defineRole(role: string, permissions: string[]) {
    this.roleDefinitions.set(role, permissions);
  }
  
  createCapabilitiesForRole(
    role: string,
    resource: string,
    grantedBy: string
  ): Capability[] {
    const permissions = this.roleDefinitions.get(role) || [];
    
    return [{
      id: `role-${role}-${Date.now()}`,
      permissions,
      resource,
      grantedBy,
      grantedAt: Date.now(),
      metadata: { role }
    }];
  }
}

// Define roles
const roleManager = new RoleManager();
roleManager.defineRole('viewer', ['read']);
roleManager.defineRole('editor', ['read', 'write']);
roleManager.defineRole('admin', ['read', 'write', 'delete', 'admin']);

// Assign role to actor
const capabilities = roleManager.createCapabilitiesForRole(
  'editor',
  'document:123',
  'system'
);

const secureActor = createSecureActor(actor, capabilities, sessionId);
```

### Audit Logging

```typescript
// Enable detailed audit logging
const secureActor = createSecureActor(
  actor,
  capabilities,
  sessionId,
  { audit: true }
);

// Perform actions
await secureActor.invoke('updateProfile', { name: 'Bob' });
await secureActor.invoke('deleteAccount'); // May fail

// Get audit log
const auditLog = secureActor.getAuditLog();
auditLog.forEach(entry => {
  console.log(`
    Timestamp: ${new Date(entry.timestamp).toISOString()}
    Action: ${entry.action}
    Permission: ${entry.permission}
    Result: ${entry.result}
    SessionId: ${entry.sessionId}
    Metadata: ${JSON.stringify(entry.metadata)}
  `);
});

// Example audit entry
{
  timestamp: 1234567890,
  action: 'invoke',
  method: 'updateProfile',
  permission: 'profile.write',
  result: 'allowed',
  sessionId: 'session-456',
  metadata: {
    capabilityId: 'cap-write-profile',
    resource: 'user:123'
  }
}
```

### Custom Permission Checks

```typescript
// Implement custom permission logic
class CustomSecureActor extends SecureActor {
  async invoke(method: string, ...args: any[]) {
    // Custom pre-checks
    if (method.startsWith('danger')) {
      if (!this.hasPermission('admin.danger')) {
        throw new SecurityError('Dangerous operations require special permission');
      }
    }
    
    // Time-based restrictions
    const hour = new Date().getHours();
    if (hour < 9 || hour > 17) {
      if (!this.hasPermission('after-hours')) {
        throw new SecurityError('Operation not allowed outside business hours');
      }
    }
    
    // Delegate to parent
    return super.invoke(method, ...args);
  }
}
```

## Security Patterns

### 1. Principle of Least Privilege
Grant only the minimum permissions needed:
```typescript
// Bad: Too broad
const capability = {
  permissions: ['*'],
  resource: '*'
};

// Good: Specific permissions
const capability = {
  permissions: ['profile.read', 'profile.update.name'],
  resource: 'user:123'
};
```

### 2. Capability Expiration
Always set expiration for temporary access:
```typescript
const tempCapability: Capability = {
  id: 'temp-access',
  permissions: ['data.export'],
  resource: 'reports:2024',
  grantedBy: 'scheduler',
  grantedAt: Date.now(),
  expiresAt: Date.now() + 3600000, // 1 hour
  metadata: {
    reason: 'Scheduled export job'
  }
};
```

### 3. Resource Scoping
Scope capabilities to specific resources:
```typescript
// Pattern: resource_type:resource_id:sub_resource
const documentCapability: Capability = {
  permissions: ['read', 'comment'],
  resource: 'document:doc-123:comments'
};

const projectCapability: Capability = {
  permissions: ['manage'],
  resource: 'project:proj-456:*' // All project resources
};
```

### 4. Capability Chains
Create capability chains for delegation:
```typescript
interface ChainedCapability extends Capability {
  parent?: string; // Parent capability ID
  depth: number;   // Delegation depth
}

// Limit delegation depth
if (capability.depth >= 3) {
  throw new Error('Maximum delegation depth exceeded');
}
```

## Integration Examples

### With Virtual Actors

```typescript
import { createVirtualActorSystem } from '@actor-core/virtual';
import { createSecureActor } from '@actor-core/security';

const system = createVirtualActorSystem({ nodeId: 'secure-node' });

// Secure virtual actor factory
system.registerActorType('secure-user', userMachine, {
  onCreate: (actor, context) => {
    const capabilities = loadUserCapabilities(context.userId);
    return createSecureActor(actor, capabilities, context.sessionId);
  }
});
```

### With Event Sourcing

```typescript
// Audit all capability usage as events
class SecurityEventStore extends EventStore {
  async appendSecurityEvent(event: SecurityEvent) {
    await this.append(`security-${event.sessionId}`, [event]);
  }
}

// Track capability usage
secureActor.on('capabilityUsed', async (event) => {
  await securityEventStore.appendSecurityEvent({
    type: 'CapabilityUsed',
    timestamp: Date.now(),
    sessionId: event.sessionId,
    capabilityId: event.capabilityId,
    permission: event.permission,
    result: event.result
  });
});
```

## Best Practices

### 1. Capability Design
- Use hierarchical permissions (e.g., `user.profile.read`)
- Include metadata for context
- Set appropriate expiration times
- Use meaningful capability IDs

### 2. Security Boundaries
- Validate capabilities at system boundaries
- Don't trust client-provided capabilities
- Verify capability signatures if transmitted

### 3. Performance
- Cache permission checks for repeated operations
- Use capability indexes for large sets
- Consider permission inheritance for efficiency

### 4. Monitoring
- Log all security decisions
- Alert on suspicious patterns
- Track capability usage metrics
- Monitor failed permission attempts

## See Also

- [Core API Reference](./API.md)
- [Virtual Actors](./virtual-actors.md) - Secure distributed actors
- [Event Sourcing](./event-sourcing.md) - Audit trail persistence
- [Examples](../examples/security/)