# 🛡️ Supervision Patterns & Fault Tolerance

> **Agent A (Tech Lead) - Actor-SPA Framework Supervision Architecture**  
> **Version**: 1.0 | **Date**: 2025-07-10 | **Status**: Architecture Definition

## 🎯 Overview

This document defines supervision patterns for fault tolerance in the Actor-SPA framework, establishing hierarchical error handling, recovery strategies, and resilience patterns based on the Actor Model principles.

## 🏗️ Core Supervision Principles

### 1. Let It Crash Philosophy
- **Fail Fast**: Actors should fail quickly when encountering errors
- **Isolation**: Failures in one actor don't affect others
- **Recovery**: Supervisors handle recovery automatically
- **State Management**: Failed actors are restarted with clean state

### 2. Supervision Hierarchy
- **Parent Responsibility**: Every actor (except root) has a supervisor
- **Escalation**: Unhandled failures escalate to parent supervisor
- **Containment**: Failures are contained within supervision boundaries
- **Strategy Selection**: Different strategies for different failure types

### 3. Fault Tolerance Patterns
- **Circuit Breaker**: Prevent cascading failures
- **Bulkhead**: Isolate critical resources
- **Retry with Backoff**: Automated retry with exponential backoff
- **Graceful Degradation**: Fallback behaviors when services fail

## 📋 Supervision Strategies

### 1. Restart-On-Failure (Default)

```typescript
/**
 * Restart actor when it fails, up to maximum attempts
 */
export interface RestartOnFailureStrategy {
  type: 'restart-on-failure';
  maxRestarts: number;
  restartWindow: number; // Time window in ms
  restartDelay?: number; // Delay between restarts
  backoffMultiplier?: number; // Exponential backoff
  jitter?: boolean; // Add randomness to prevent thundering herd
}

const defaultRestartStrategy: RestartOnFailureStrategy = {
  type: 'restart-on-failure',
  maxRestarts: 3,
  restartWindow: 60000, // 1 minute
  restartDelay: 1000, // 1 second
  backoffMultiplier: 2.0,
  jitter: true,
};
```

**Use Cases:**
- Transient failures (network timeouts, temporary resource unavailability)
- Actors with recoverable state
- Service actors that can be reinitialized

**Example:**
```typescript
// API service actor that can recover from network failures
const apiActor = spawn(apiServiceMachine, {
  supervision: {
    type: 'restart-on-failure',
    maxRestarts: 5,
    restartWindow: 300000, // 5 minutes
    restartDelay: 2000,
    backoffMultiplier: 1.5,
  }
});
```

### 2. Stop-On-Failure

```typescript
/**
 * Stop actor immediately when it fails
 */
export interface StopOnFailureStrategy {
  type: 'stop-on-failure';
  cleanup?: (actorRef: ActorRef, error: Error) => Promise<void>;
  notification?: {
    notifyParent: boolean;
    notifyChildren: boolean;
  };
}
```

**Use Cases:**
- Critical failures that cannot be recovered
- Actors with corrupted state
- Security violations or permission errors
- Resource exhaustion

**Example:**
```typescript
// Security validator that stops on permission violations
const securityActor = spawn(securityMachine, {
  supervision: {
    type: 'stop-on-failure',
    cleanup: async (actor, error) => {
      await auditLog.record({
        type: 'security-failure',
        actorId: actor.id,
        error: error.message,
      });
    },
    notification: {
      notifyParent: true,
      notifyChildren: false,
    }
  }
});
```

### 3. Escalate

```typescript
/**
 * Escalate error to parent supervisor for handling
 */
export interface EscalateStrategy {
  type: 'escalate';
  stopActor?: boolean; // Whether to stop this actor after escalation
  includeContext?: boolean; // Include actor context in escalation
  transform?: (error: Error, context: unknown) => Error; // Transform error before escalation
}
```

**Use Cases:**
- Errors that require parent coordination
- System-level failures
- Resource allocation failures
- Cross-actor state consistency issues

**Example:**
```typescript
// Database connection actor escalates connection failures
const dbActor = spawn(databaseMachine, {
  supervision: {
    type: 'escalate',
    stopActor: true,
    includeContext: true,
    transform: (error, context) => new DatabaseConnectionError(
      'Database connection failed',
      error,
      context
    ),
  }
});
```

### 4. Ignore

```typescript
/**
 * Ignore failures and continue operation
 */
export interface IgnoreStrategy {
  type: 'ignore';
  logging?: {
    enabled: boolean;
    level: 'warn' | 'error' | 'debug';
    includeStack: boolean;
  };
  metrics?: {
    counter: string;
    labels?: Record<string, string>;
  };
}
```

**Use Cases:**
- Non-critical background tasks
- Logging or metrics actors
- Optional feature actors
- Best-effort operations

**Example:**
```typescript
// Analytics actor that ignores tracking failures
const analyticsActor = spawn(analyticsMachine, {
  supervision: {
    type: 'ignore',
    logging: {
      enabled: true,
      level: 'warn',
      includeStack: false,
    },
    metrics: {
      counter: 'analytics_failures_total',
      labels: { service: 'tracking' },
    }
  }
});
```

### 5. Custom Strategy

```typescript
/**
 * Custom supervision strategy with user-defined logic
 */
export interface CustomStrategy {
  type: 'custom';
  handler: (error: Error, actor: ActorRef, attempts: number) => Promise<SupervisionAction>;
  maxAttempts?: number;
  cooldownPeriod?: number;
}

export type SupervisionAction = 
  | { action: 'restart'; delay?: number }
  | { action: 'stop'; reason?: string }
  | { action: 'escalate'; transformedError?: Error }
  | { action: 'ignore'; logLevel?: 'warn' | 'error' }
  | { action: 'delegate'; supervisor: ActorRef };
```

**Use Cases:**
- Complex business logic for error handling
- Multi-step recovery procedures
- Context-dependent strategies
- A/B testing recovery strategies

**Example:**
```typescript
// Payment processor with custom recovery logic
const paymentActor = spawn(paymentMachine, {
  supervision: {
    type: 'custom',
    handler: async (error, actor, attempts) => {
      if (error instanceof PaymentTimeoutError) {
        // Retry up to 3 times with increasing delay
        if (attempts < 3) {
          return { action: 'restart', delay: attempts * 2000 };
        }
        // After 3 attempts, escalate to payment coordinator
        return { action: 'escalate', transformedError: new PaymentFailureError(error) };
      }
      
      if (error instanceof InsufficientFundsError) {
        // Don't retry, notify user immediately
        return { action: 'stop', reason: 'insufficient-funds' };
      }
      
      // Default: restart with exponential backoff
      return { action: 'restart', delay: Math.min(attempts * 1000, 30000) };
    },
    maxAttempts: 5,
    cooldownPeriod: 60000,
  }
});
```

## 🌳 Supervision Hierarchies

### Basic Hierarchy Pattern

```typescript
/**
 * Root supervisor manages system-level actors
 */
const rootSupervisor = createSupervisor({
  strategy: 'restart-on-failure',
  maxRestarts: 1, // Conservative for system-level
  restartWindow: 300000, // 5 minutes
});

/**
 * Service supervisor for business logic actors
 */
const serviceSupervisor = rootSupervisor.spawn(supervisorMachine, {
  id: 'service-supervisor',
  supervision: 'restart-on-failure',
});

/**
 * UI supervisor for component actors
 */
const uiSupervisor = rootSupervisor.spawn(supervisorMachine, {
  id: 'ui-supervisor',
  supervision: 'escalate', // UI failures escalate to service layer
});

/**
 * Worker actors under service supervision
 */
const apiActor = serviceSupervisor.spawn(apiMachine, {
  supervision: 'restart-on-failure',
});

const cacheActor = serviceSupervisor.spawn(cacheMachine, {
  supervision: 'restart-on-failure',
});

const dbActor = serviceSupervisor.spawn(databaseMachine, {
  supervision: 'escalate', // DB failures are critical
});
```

### Domain-Specific Hierarchies

```typescript
/**
 * E-commerce supervision hierarchy
 */

// Root: Application supervisor
const appSupervisor = createSupervisor({
  strategy: 'stop-on-failure', // App-level failures are critical
});

// Order Processing Hierarchy
const orderSupervisor = appSupervisor.spawn(supervisorMachine, {
  id: 'order-supervisor',
  supervision: 'restart-on-failure',
});

const orderActor = orderSupervisor.spawn(orderMachine, {
  supervision: 'restart-on-failure', // Orders can be retried
});

const inventoryActor = orderSupervisor.spawn(inventoryMachine, {
  supervision: 'escalate', // Inventory issues need coordination
});

const paymentActor = orderSupervisor.spawn(paymentMachine, {
  supervision: 'custom', // Custom payment recovery logic
});

// User Experience Hierarchy
const uxSupervisor = appSupervisor.spawn(supervisorMachine, {
  id: 'ux-supervisor',
  supervision: 'ignore', // UX failures shouldn't crash app
});

const recommendationActor = uxSupervisor.spawn(recommendationMachine, {
  supervision: 'ignore', // Recommendations are best-effort
});

const searchActor = uxSupervisor.spawn(searchMachine, {
  supervision: 'restart-on-failure', // Search is important but recoverable
});
```

## 🔄 Error Propagation Patterns

### 1. Bulkhead Pattern

```typescript
/**
 * Isolate critical and non-critical operations
 */
export class BulkheadSupervisor {
  private criticalSupervisor: ActorRef;
  private nonCriticalSupervisor: ActorRef;
  
  constructor() {
    // Critical operations: strict supervision
    this.criticalSupervisor = createSupervisor({
      strategy: 'restart-on-failure',
      maxRestarts: 1,
      restartWindow: 60000,
    });
    
    // Non-critical operations: lenient supervision
    this.nonCriticalSupervisor = createSupervisor({
      strategy: 'ignore',
    });
  }
  
  spawnCritical<TEvent>(machine: StateMachine, options?: SpawnOptions) {
    return this.criticalSupervisor.spawn(machine, options);
  }
  
  spawnNonCritical<TEvent>(machine: StateMachine, options?: SpawnOptions) {
    return this.nonCriticalSupervisor.spawn(machine, options);
  }
}

// Usage
const bulkhead = new BulkheadSupervisor();

// Critical: payment processing
const paymentActor = bulkhead.spawnCritical(paymentMachine);

// Non-critical: analytics tracking
const analyticsActor = bulkhead.spawnNonCritical(analyticsMachine);
```

### 2. Circuit Breaker Pattern

```typescript
/**
 * Circuit breaker supervision to prevent cascading failures
 */
export interface CircuitBreakerStrategy {
  type: 'circuit-breaker';
  failureThreshold: number; // Number of failures before opening
  resetTimeout: number; // Time before attempting reset
  halfOpenMaxCalls: number; // Max calls in half-open state
  monitor?: (state: CircuitState, error?: Error) => void;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreakerSupervisor {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenCallCount = 0;
  
  async handleFailure(
    error: Error,
    actor: ActorRef,
    strategy: CircuitBreakerStrategy
  ): Promise<SupervisionAction> {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (strategy.monitor) {
      strategy.monitor(this.state, error);
    }
    
    switch (this.state) {
      case 'closed':
        if (this.failureCount >= strategy.failureThreshold) {
          this.state = 'open';
          this.scheduleReset(strategy.resetTimeout);
          return { action: 'stop', reason: 'circuit-breaker-open' };
        }
        return { action: 'restart', delay: 1000 };
        
      case 'open':
        return { action: 'stop', reason: 'circuit-breaker-open' };
        
      case 'half-open':
        this.halfOpenCallCount++;
        if (this.halfOpenCallCount >= strategy.halfOpenMaxCalls) {
          this.state = 'open';
          this.scheduleReset(strategy.resetTimeout);
        }
        return { action: 'stop', reason: 'circuit-breaker-half-open-limit' };
    }
  }
  
  private scheduleReset(timeout: number): void {
    setTimeout(() => {
      this.state = 'half-open';
      this.halfOpenCallCount = 0;
    }, timeout);
  }
}
```

### 3. Retry with Backoff

```typescript
/**
 * Exponential backoff with jitter
 */
export class BackoffSupervisor {
  async calculateDelay(
    attempt: number,
    baseDelay: number,
    maxDelay: number,
    backoffMultiplier: number,
    jitter: boolean
  ): Promise<number> {
    const exponentialDelay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);
    
    if (jitter) {
      // Add ±25% jitter to prevent thundering herd
      const jitterRange = cappedDelay * 0.25;
      const jitterAmount = (Math.random() - 0.5) * 2 * jitterRange;
      return Math.max(0, cappedDelay + jitterAmount);
    }
    
    return cappedDelay;
  }
}

// Usage in supervision strategy
const retryStrategy: RestartOnFailureStrategy = {
  type: 'restart-on-failure',
  maxRestarts: 5,
  restartWindow: 300000,
  restartDelay: 1000,
  backoffMultiplier: 2.0,
  jitter: true,
};
```

## 📊 Monitoring & Observability

### Supervision Metrics

```typescript
/**
 * Metrics for supervision monitoring
 */
export interface SupervisionMetrics {
  // Counters
  restarts_total: { labels: { actor_id: string; reason: string } };
  failures_total: { labels: { actor_id: string; error_type: string } };
  escalations_total: { labels: { from_actor: string; to_actor: string } };
  
  // Gauges
  active_actors: { labels: { supervisor_id: string } };
  restart_rate: { labels: { actor_id: string } };
  
  // Histograms
  restart_duration: { labels: { actor_id: string } };
  failure_recovery_time: { labels: { actor_id: string } };
}

/**
 * Metrics collector for supervision events
 */
export class SupervisionMetricsCollector {
  private metrics: Map<string, number> = new Map();
  
  recordRestart(actorId: string, reason: string, duration: number): void {
    this.increment('restarts_total', { actor_id: actorId, reason });
    this.recordHistogram('restart_duration', duration, { actor_id: actorId });
  }
  
  recordFailure(actorId: string, errorType: string): void {
    this.increment('failures_total', { actor_id: actorId, error_type: errorType });
  }
  
  recordEscalation(fromActor: string, toActor: string): void {
    this.increment('escalations_total', { from_actor: fromActor, to_actor: toActor });
  }
  
  private increment(metric: string, labels: Record<string, string>): void {
    const key = this.buildKey(metric, labels);
    this.metrics.set(key, (this.metrics.get(key) ?? 0) + 1);
  }
  
  private recordHistogram(metric: string, value: number, labels: Record<string, string>): void {
    // Implementation would depend on metrics system (Prometheus, etc.)
    console.log(`${metric}[${JSON.stringify(labels)}] = ${value}`);
  }
  
  private buildKey(metric: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${metric}{${labelStr}}`;
  }
}
```

### Health Checks

```typescript
/**
 * Health check system for supervised actors
 */
export interface ActorHealthCheck {
  actorId: string;
  check: () => Promise<HealthStatus>;
  interval: number;
  timeout: number;
}

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export class HealthMonitor {
  private checks = new Map<string, ActorHealthCheck>();
  private healthStatus = new Map<string, HealthStatus>();
  
  registerCheck(check: ActorHealthCheck): void {
    this.checks.set(check.actorId, check);
    this.startHealthCheck(check);
  }
  
  private async startHealthCheck(check: ActorHealthCheck): void {
    setInterval(async () => {
      try {
        const status = await Promise.race([
          check.check(),
          new Promise<HealthStatus>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
          ),
        ]);
        
        this.healthStatus.set(check.actorId, status);
        
        if (status === 'unhealthy') {
          this.triggerSupervisionAction(check.actorId);
        }
      } catch (error) {
        this.healthStatus.set(check.actorId, 'unhealthy');
        this.triggerSupervisionAction(check.actorId);
      }
    }, check.interval);
  }
  
  private triggerSupervisionAction(actorId: string): void {
    // Trigger supervision based on health check failure
    console.log(`Actor ${actorId} failed health check, triggering supervision`);
  }
}
```

## 🎯 Best Practices

### 1. Strategy Selection Guidelines

```typescript
/**
 * Decision matrix for supervision strategy selection
 */
export const StrategySelection = {
  // Data consistency critical
  financial: 'escalate',
  
  // Transient failures expected
  network: 'restart-on-failure',
  
  // Best effort operations
  analytics: 'ignore',
  
  // Security violations
  authentication: 'stop-on-failure',
  
  // User experience features
  recommendations: 'ignore',
  search: 'restart-on-failure',
  
  // System resources
  database: 'escalate',
  cache: 'restart-on-failure',
  logging: 'ignore',
} as const;
```

### 2. Error Classification

```typescript
/**
 * Classify errors for appropriate supervision
 */
export class ErrorClassifier {
  static classify(error: Error): ErrorCategory {
    if (error instanceof TypeError || error instanceof ReferenceError) {
      return 'programming'; // Stop on programming errors
    }
    
    if (error.message.includes('timeout') || error.message.includes('network')) {
      return 'transient'; // Retry transient errors
    }
    
    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
      return 'security'; // Stop on security errors
    }
    
    if (error.message.includes('resource') || error.message.includes('limit')) {
      return 'resource'; // Escalate resource errors
    }
    
    return 'unknown'; // Default handling
  }
}

export type ErrorCategory = 'programming' | 'transient' | 'security' | 'resource' | 'unknown';
```

### 3. Configuration Validation

```typescript
/**
 * Validate supervision configuration
 */
export function validateSupervisionConfig(strategy: SupervisionStrategy): void {
  if (strategy.type === 'restart-on-failure') {
    if (strategy.maxRestarts < 0) {
      throw new Error('maxRestarts must be non-negative');
    }
    if (strategy.restartWindow <= 0) {
      throw new Error('restartWindow must be positive');
    }
    if (strategy.restartDelay && strategy.restartDelay < 0) {
      throw new Error('restartDelay must be non-negative');
    }
  }
}
```

## 🚀 Performance Considerations

### 1. Memory Management
- Clean up failed actor state before restart
- Limit supervision metadata storage
- Use weak references for parent-child relationships

### 2. Restart Throttling
- Implement exponential backoff to prevent rapid restarts
- Use jitter to avoid thundering herd problems
- Monitor restart rates and adjust strategies

### 3. Error Handling Overhead
- Minimize error context collection
- Use efficient error serialization
- Batch supervision events when possible

---

**This supervision architecture provides comprehensive fault tolerance while maintaining the performance and reliability requirements of modern web applications.**