# 🎭 Actor-Web Framework

> Pure Actor Model framework for building resilient, scalable web applications with location-transparent message-passing architecture.

[![npm version](https://badge.fury.io/js/%40actor-web%2Fcore.svg)](https://badge.fury.io/js/%40actor-web%2Fcore)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6+-blue.svg)](https://www.typescriptlang.org/)
[![XState v5](https://img.shields.io/badge/XState-v5-orange.svg)](https://stately.ai/docs/xstate)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/0xjcf/actor-web?utm_source=oss&utm_medium=github&utm_campaign=0xjcf%2Factor-web&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)

## 🚀 Features

- **Pure Actor Model**: Message-passing only communication with location transparency
- **Distributed Actor Directory**: Orleans-style caching with 90%+ hit rate
- **Fault Tolerance**: Built-in supervision strategies for error recovery
- **Type Safety**: Full TypeScript support with zero `any` types
- **Location Transparency**: Actors can be addressed regardless of physical location
- **XState Integration**: Seamless integration with XState v5 state machines
- **High Performance**: 10,000+ messages/second throughput
- **Orleans Architecture**: Distributed actor registry with automatic failover
- **CLI & UI Packages**: Complete tooling for development and monitoring

## 📦 Installation

```bash
# Core runtime
pnpm add @actor-core/runtime

# CLI tools
pnpm add @agent-workflow/cli -D

# Testing utilities
pnpm add @actor-core/testing -D

# Complete setup
pnpm add @actor-core/runtime xstate
pnpm add @agent-workflow/cli @actor-core/testing -D
```

## 🎯 Quick Start

### Basic Actor System Usage

```typescript
import { createActorSystem, createActorRef } from '@actor-core/runtime';
import { setup, assign } from 'xstate';

// 1. Create the actor system
const system = createActorSystem({
  nodeAddress: 'node-1',
  directory: {
    maxCacheSize: 10000,
    cacheTtl: 300000 // 5 minutes
  }
});

// 2. Start the system
await system.start();

// 3. Define your state machine
const counterMachine = setup({
  types: {
    context: {} as { count: number },
    events: {} as 
      | { type: 'INCREMENT' }
      | { type: 'DECREMENT' }
      | { type: 'RESET' }
  }
}).createMachine({
  id: 'counter',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: { actions: assign({ count: ({ context }) => context.count + 1 }) },
        DECREMENT: { actions: assign({ count: ({ context }) => context.count - 1 }) },
        RESET: { actions: assign({ count: 0 }) }
      }
    }
  }
});

// 4. Spawn an actor
const counterActor = await system.spawn({
  initialState: { count: 0 },
  onMessage: async (message, state) => {
    // Handle messages and return new state
    switch (message.type) {
      case 'INCREMENT':
        return { count: state.count + 1 };
      case 'DECREMENT':
        return { count: state.count - 1 };
      case 'RESET':
        return { count: 0 };
      default:
        return state;
    }
  }
}, { id: 'counter-1' });

// 5. Send messages
await counterActor.send({ type: 'INCREMENT', payload: null, timestamp: Date.now() });

// 6. Check if actor is alive
const isAlive = await counterActor.isAlive();
console.log('Actor is alive:', isAlive);

// 7. Get actor statistics
const stats = await counterActor.getStats();
console.log('Messages processed:', stats.messagesProcessed);
```

### Location-Transparent Actor Lookup

```typescript
// Look up actors by path from anywhere in the system
const remoteActor = await system.lookup('actor://node-2/service/user-manager');

if (remoteActor) {
  // Send message to remote actor (location transparent)
  await remoteActor.send({ 
    type: 'GET_USER', 
    payload: { userId: '123' },
    timestamp: Date.now()
  });
}

// List all actors in the system
const allActors = await system.listActors();
console.log('Total actors:', allActors.length);
```

### Cluster Operations

```typescript
// Join a cluster
await system.join(['node-2', 'node-3']);

// Get cluster state
const clusterState = system.getClusterState();
console.log('Cluster nodes:', clusterState.nodes);
console.log('Leader:', clusterState.leader);

// Subscribe to cluster events
const clusterEvents = system.subscribeToClusterEvents();
clusterEvents.subscribe(event => {
  console.log('Cluster event:', event.type, event.node);
});
```

## 🎭 Pure Actor Model

The Actor-Web Framework supports both XState-based actors and pure message-passing actors. Pure actors are ideal for CLI applications, backend services, and systems requiring maximum control over message flow.

### Message-Passing Actors

```typescript
import { createPureGitActor, createGitMessage } from '@agent-workflow/cli';

// Create a pure actor
const gitActor = createPureGitActor('/path/to/repo');

// Start the actor
await gitActor.start();

// Send messages
await gitActor.send(createGitMessage('CHECK_STATUS'));
await gitActor.send(createGitMessage('COMMIT_CHANGES', { 
  message: 'feat: implement pure actor model' 
}));
await gitActor.send(createGitMessage('PUSH_CHANGES', { 
  branch: 'main' 
}));

// Get actor state
const state = gitActor.getState();
console.log('Current branch:', state.currentBranch);
console.log('Last operation:', state.lastOperation);

// Stop the actor
await gitActor.stop();
```

### Custom Pure Actor Implementation

```typescript
// Define message types
export type CustomMessageType = 
  | 'PROCESS_DATA'
  | 'SAVE_RESULT'
  | 'CLEANUP';

export interface CustomMessage {
  type: CustomMessageType;
  payload?: Record<string, unknown>;
  timestamp: number;
  correlationId?: string;
}

// Define actor state
export interface CustomActorState {
  data?: unknown;
  processed?: boolean;
  lastError?: string;
  lastOperation?: string;
}

// Pure actor implementation
export class CustomActor {
  private state: CustomActorState = {};
  private messageQueue: CustomMessage[] = [];
  private isProcessing = false;

  async send(message: CustomMessage): Promise<void> {
    this.messageQueue.push(message);
    
    if (!this.isProcessing) {
      await this.processMessages();
    }
  }

  getState(): CustomActorState {
    return { ...this.state };
  }

  private async processMessages(): Promise<void> {
    this.isProcessing = true;
    
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (message) {
        await this.handleMessage(message);
      }
    }
    
    this.isProcessing = false;
  }

  private async handleMessage(message: CustomMessage): Promise<void> {
    switch (message.type) {
      case 'PROCESS_DATA':
        await this.processData(message.payload);
        break;
      case 'SAVE_RESULT':
        await this.saveResult(message.payload);
        break;
      case 'CLEANUP':
        await this.cleanup();
        break;
    }
  }

  private async processData(payload: unknown): Promise<void> {
    // Implementation details...
    this.state = {
      ...this.state,
      data: payload,
      processed: true,
      lastOperation: 'PROCESS_DATA',
      lastError: undefined,
    };
  }

  private async saveResult(payload: unknown): Promise<void> {
    // Implementation details...
    this.state = {
      ...this.state,
      lastOperation: 'SAVE_RESULT',
      lastError: undefined,
    };
  }

  private async cleanup(): Promise<void> {
    // Implementation details...
    this.state = {
      data: undefined,
      processed: false,
      lastOperation: 'CLEANUP',
      lastError: undefined,
    };
  }
}
```

### When to Use Pure Actors vs State Machines

**Use Pure Actors for:**
- CLI applications and backend services
- Simple request/response patterns
- Integration with external systems
- When you need maximum control over message flow

**Use State Machines for:**
- Complex UI interactions
- Multi-step workflows with branching
- When you need visual state representation
- Event-driven frontend components

## 🛠️ CLI Tools

### Agent Workflow CLI

```bash
# Initialize agent workflow
pnpm aw init

# Save changes with conventional commits
pnpm aw save "feat: implement user authentication"

# Ship changes to integration
pnpm aw ship

# Analyze state machines
pnpm aw analyze --target git-actor --workflow

# Interactive state machine monitoring
pnpm aw analyze --subscribe --target git-actor
```

### State Machine Analysis

```typescript
// Use the CLI for interactive state machine analysis
import { analyzeCommand } from '@agent-workflow/cli';

// Analyze with workflow validation
await analyzeCommand({
  target: 'git-actor',
  workflow: true,
  validate: true,
  verbose: true
});

// Live monitoring with event simulation
await analyzeCommand({
  target: 'git-actor',
  subscribe: true,
  events: 'CHECK_STATUS,COMMIT_CHANGES,PUSH_CHANGES',
  eventDelay: '1000',
  autoRun: true
});
```

## 🎭 Advanced Actor Patterns

### Supervision Strategies

```typescript
import { createActorRef, SupervisionStrategy } from '@actor-core/runtime';

// Create a supervised actor
const supervisedActor = createActorRef(machine, {
  supervision: {
    strategy: SupervisionStrategy.RESTART_ON_FAILURE,
    maxRestarts: 3,
    withinTimespan: 60000
  }
});

// The supervisor will automatically restart the actor on failure
```

### Distributed Actor Directory

```typescript
import { DistributedActorDirectory } from '@actor-core/runtime';

// Create a distributed directory with Orleans-style caching
const directory = new DistributedActorDirectory({
  nodeAddress: 'node-1',
  maxCacheSize: 10000,
  cacheTtl: 300000,
  cleanupInterval: 60000
});

// Register an actor
const address = { id: 'user-1', type: 'user', path: 'actor://node-1/user/user-1' };
await directory.register(address, 'node-1');

// High-performance lookup with caching
const location = await directory.lookup(address);
console.log('Actor location:', location);

// Get cache statistics
const stats = directory.getCacheStats();
console.log('Cache hit rate:', stats.hitRate); // Should be >90%
```

### Event-Driven Architecture

```typescript
// Subscribe to directory changes
const changes = directory.subscribeToChanges();
changes.subscribe(event => {
  console.log('Directory event:', event.type, event.address.path);
});

// List actors by type
const userActors = await directory.listByType('user');
console.log('User actors:', userActors.length);

// Get all registered actors
const allActors = await directory.getAll();
console.log('Total registered actors:', allActors.size);
```

## 🧪 Testing

```typescript
import { createMockActorRef, createTestEnvironment } from '@actor-core/testing';
import { describe, it, expect, beforeEach } from 'vitest';

describe('User Actor', () => {
  let testEnv: TestEnvironment;
  let userActor: MockActorRef;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    userActor = createMockActorRef('user');
  });

  it('should handle user registration', async () => {
    const message = { 
      type: 'REGISTER_USER', 
      payload: { email: 'test@example.com' },
      timestamp: Date.now()
    };
    
    await userActor.send(message);
    
    expect(userActor.getSentEvents()).toContain(message);
  });

  it('should maintain actor statistics', async () => {
    const stats = await userActor.getStats();
    expect(stats.messagesProcessed).toBe(0);
    expect(stats.uptime).toBeGreaterThan(0);
  });
});
```

## 📊 Performance

- **Message Throughput**: 10,000+ messages/second
- **Cache Hit Rate**: 90%+ with Orleans-style caching
- **Memory Efficient**: Bounded mailboxes with TTL cleanup
- **Concurrent Actors**: Handles 1,000+ concurrent actors
- **Bundle Size**: < 20KB gzipped

## 🏛️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Distributed Actor System                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐             │
│  │     Node-1      │    │     Node-2      │    │     Node-3      │             │
│  │                 │    │                 │    │                 │             │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │             │
│  │  │ ActorRef  │  │    │  │ ActorRef  │  │    │  │ ActorRef  │  │             │
│  │  │  (Local)  │  │    │  │ (Remote)  │  │    │  │ (Remote)  │  │             │
│  │  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │             │
│  │                 │    │                 │    │                 │             │
│  │  ┌───────────┐  │    │  ┌───────────┐  │    │  ┌───────────┐  │             │
│  │  │ Directory │  │    │  │ Directory │  │    │  │ Directory │  │             │
│  │  │  (Cache)  │  │    │  │  (Cache)  │  │    │  │  (Cache)  │  │             │
│  │  └───────────┘  │    │  └───────────┘  │    │  └───────────┘  │             │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘             │
│                                                                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                    Location-Transparent Message Routing                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐             │
│  │   Supervisor    │    │  ActorSystem    │    │  CLI Tools      │             │
│  │ (Fault Tol.)    │    │  (Cluster)      │    │  (Analysis)     │             │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘             │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 📦 Package Structure

```
actor-web-architecture/
├── packages/
│   ├── actor-core-runtime/        # Core actor system implementation
│   │   ├── src/
│   │   │   ├── actor-system.ts    # Actor system interfaces
│   │   │   ├── actor-system-impl.ts # Production implementation
│   │   │   ├── distributed-actor-directory.ts # Orleans-style directory
│   │   │   ├── create-actor-ref.ts # Actor reference creation
│   │   │   └── logger.ts          # Debug logging system
│   │   └── package.json
│   │
│   ├── actor-core-testing/        # Testing utilities
│   │   ├── src/
│   │   │   ├── index.ts          # Mock actors and test environment
│   │   │   └── state-machine-analysis.ts # Analysis tools
│   │   └── package.json
│   │
│   └── agent-workflow-cli/        # CLI tools
│       ├── src/
│       │   ├── commands/         # CLI commands
│       │   ├── actors/          # Git and input actors
│       │   └── cli/             # Command-line interface
│       └── package.json
│
├── src/                          # Framework core (legacy)
├── examples/                     # Usage examples
└── docs/                        # Documentation
```

## 🛣️ Roadmap

- [x] **Phase 1**: Distributed Actor Directory with Orleans-style caching
- [x] **Phase 2**: Location-transparent actor system
- [x] **Phase 3**: CLI tools and state machine analysis
- [ ] **Phase 4**: Web Worker support for true parallelism
- [ ] **Phase 5**: Browser DevTools integration
- [ ] **Phase 6**: Performance optimizations and monitoring
- [ ] **Phase 7**: Multi-language bindings

See [ROADMAP.md](./docs/ROADMAP.md) for detailed timeline.

## 📚 Documentation

### **Getting Started**
- [Pure Actor Model Analysis](docs/PURE-ACTOR-MODEL-ANALYSIS.md) - Architecture principles and implementation
- [Testing Guide](docs/TESTING-GUIDE.md) - Comprehensive testing patterns and best practices
- [Implementation Plan](docs/AGENT-A-IMPLEMENTATION-PLAN.md) - Current development status

### **Development & Debugging**
- [🐛 Debugging Guide](docs/DEBUGGING-GUIDE.md) - Essential debugging techniques and Logger infrastructure
- [🤖 Agent Workflow Guide](docs/AGENT-WORKFLOW-GUIDE.md) - Complete guide to parallel agent development

### **Architecture**
- [Actor System Design](docs/architecture/actor-system-design.md) - Core system architecture
- [Distributed Directory Design](docs/architecture/distributed-directory-design.md) - Orleans-style caching
- [Supervision Patterns](docs/architecture/supervision-patterns.md) - Fault tolerance strategies

### **CLI & Tools**
- [Agent Workflow CLI](packages/agent-workflow-cli/README.md) - Complete CLI documentation
- [State Machine Analysis](docs/KNOWLEDGE-SHARE-XSTATE-TIMEOUT-PATTERNS.md) - Analysis patterns

## 🤝 Contributing

1. Fork the repository
2. Set up the agent workflow: `pnpm aw init`
3. Follow the [🤖 Agent Workflow Guide](./docs/AGENT-WORKFLOW-GUIDE.md) for parallel development
4. Use agent scripts: `pnpm aw save` and `pnpm aw ship`
5. Submit a Pull Request from your agent branch

### Development Setup

```bash
# Clone the repository
git clone https://github.com/0xjcf/actor-web-architecture.git
cd actor-web-architecture

# Install dependencies
pnpm install

# Run tests
pnpm test
# Or run tests by environment
pnpm test:dom      # DOM tests
pnpm test:cli      # CLI tests  
pnpm test:runtime  # Runtime tests

# Start development mode
pnpm dev

# Analyze state machines
pnpm aw analyze --target git-actor --workflow

# Build the project
pnpm build
```

## 📄 License

MIT © [0xjcf](https://github.com/0xjcf)

## 🙏 Acknowledgments

- [XState](https://stately.ai/docs/xstate) for the excellent state machine library
- [Orleans](https://docs.microsoft.com/en-us/dotnet/orleans/) for distributed actor model inspiration
- [Akka](https://akka.io/) for actor supervision patterns
- [Erlang/OTP](https://www.erlang.org/) for fault tolerance principles

---

**Built with ❤️ for resilient, distributed web applications** 