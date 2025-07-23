# 🎯 Actor-SPA Pure Actor Model Implementation Guide

> **Test-Driven Development with Three-Agent Team**

## 🚨 CRITICAL: Pure Actor Model Architecture Required!

**📖 URGENT ARCHITECTURAL CHANGE**: Research shows our current implementation violates pure actor model principles.

**🚨 IMMEDIATE ACTIONS REQUIRED**:
- ❌ **Remove all direct function calls between actors**
- ❌ **Replace singleton registries with distributed directories**
- ❌ **Implement message-only communication patterns**
- ❌ **Add location transparency for distributed actors**

**📖 For the complete, up-to-date workflow guide, see: [🤖 Agent Workflow Guide](./AGENT-WORKFLOW-GUIDE.md)**

The new guide includes:
- ✅ Complete script documentation  
- ✅ Troubleshooting guide
- ✅ Best practices & guardrails
- ✅ Daily workflow examples
- ✅ Emergency procedures

**This document remains for reference, but use the [Agent Workflow Guide](./AGENT-WORKFLOW-GUIDE.md) for current practices.**

---

## 🚀 STEP 1: Essential Git Worktree Setup

**⚠️ CRITICAL FIRST STEP**: Before any development work begins, all agents MUST set up separate Git worktrees to prevent branch conflicts and enable truly parallel development.

### 🌿 Git Worktree Strategy (SOLVES BRANCH JUMPING)

**Problem**: Multiple agents sharing one Git working directory causes branch conflicts when anyone runs `git checkout`.

**Solution**: Each agent gets their own isolated working directory with shared Git history.

```
actor-web/                     # Main repository (integration work)
├── .git/                      # Shared Git database
└── docs/, src/, ...

../actor-web-architecture/     # Agent A workspace  
├── .git -> ../actor-web/.git   # Symlink to shared Git
└── docs/, src/, ...           # Independent working files

../actor-web-implementation/   # Agent B workspace
../actor-web-tests/            # Agent C workspace
```

### 📋 One-Time Setup Commands

#### 🚀 Quick Setup (RECOMMENDED)
```bash
# Run the automated setup script (from main repository)
./scripts/setup-agent-worktrees.sh
```

#### 🛠️ Manual Setup (if needed)
```bash
# 1. From main repository, create agent worktrees
cd actor-web

# Agent A - Architecture worktree
git worktree add ../actor-web-architecture feature/actor-ref-architecture

# Agent B - Implementation worktree  
git worktree add ../actor-web-implementation feature/actor-ref-implementation

# Agent C - Testing worktree
git worktree add ../actor-web-tests feature/actor-ref-tests

# Configure automatic push tracking
git config --global worktree.guessRemote true
```

### 🎯 Agent-Specific Working Directories

#### Agent A (Tech Lead) - Architecture
```bash
# Always work from the architecture directory
cd ../actor-web-architecture

# Verify you're on the right branch
git status  # Should show: feature/actor-ref-architecture

# Open Cursor IDE in this directory
code .  # or open Cursor here
```

#### Agent B (Senior Developer) - Implementation  
```bash
# Always work from the implementation directory
cd ../actor-web-implementation

# Verify you're on the right branch
git status  # Should show: feature/actor-ref-implementation

# All your implementation work happens here
```

#### Agent C (Junior Developer) - Testing
```bash
# Always work from the testing directory
cd ../actor-web-tests

# Verify you're on the right branch  
git status  # Should show: feature/actor-ref-tests

# All your testing work happens here
```

### 🔄 Daily Workflow (ALL AGENTS)

#### Using the New Merge Scripts (RECOMMENDED)

```bash
# 1. Navigate to YOUR agent directory
cd ../actor-web-[architecture|implementation|tests]

# 2. Daily sync with integration (MANDATORY - before any work)
pnpm sync  # Automatically fetches and merges from integration branch

# 3. Optional: Pull specific agent changes if needed
pnpm merge-a  # Architecture changes from Agent A
pnpm merge-b  # Implementation changes from Agent B  
pnpm merge-c  # Test updates from Agent C

# 4. Work normally (no branch switching needed!)
git add .
git commit -m "feat: your changes"
git push origin feature/actor-ref-[your-branch]
```

#### Manual Method (if scripts unavailable)

```bash
# 1. Navigate to YOUR agent directory
cd ../actor-web-[architecture|implementation|tests]

# 2. Daily sync with integration (MANDATORY - before any work)
git pull origin feature/actor-ref-[your-branch]
git fetch origin feature/actor-ref-integration
git merge origin/feature/actor-ref-integration

# 3. Work normally (no branch switching needed!)
git add .
git commit -m "feat: your changes"
git push origin feature/actor-ref-[your-branch]
```

📝 **See [scripts/IMPROVED-WORKFLOW.md](../scripts/IMPROVED-WORKFLOW.md) for the new simplified integration workflow with easy-to-remember commands.**

### 🛡️ Worktree Benefits

1. **✅ No Branch Jumping**: Each agent locked to their branch
2. **✅ IDE Independence**: Cursor, terminals work separately  
3. **✅ Shared Git History**: Minimal disk usage
4. **✅ Parallel Development**: True concurrent work
5. **✅ Automated Setup**: One script configures everything

### ⚠️ Migration for Existing Work

If you have existing work in the main repository:
```bash
# 1. Stash your current work
git stash

# 2. Run the setup script
./scripts/setup-agent-worktrees.sh

# 3. Move to your agent directory and restore work
cd ../actor-web-[your-agent-area]
git stash pop
```

---

## 📋 Table of Contents
1. [🚀 STEP 1: Essential Branching Strategy Setup](#-step-1-essential-branching-strategy-setup)
2. [Git Setup & Branching](#git-setup--branching)
3. [Team Structure & Roles](#team-structure--roles)
4. [Agent Responsibilities](#agent-responsibilities)
5. [Code Standards & Patterns](#code-standards--patterns)
6. [TDD Workflow](#tdd-workflow)
7. [Implementation Timeline](#implementation-timeline)
8. [Communication Protocol](#communication-protocol)
9. [Quality Assurance](#quality-assurance)

---

## 🌿 Git Setup & Branching

### Multi-Worktree Strategy (RECOMMENDED)

**PROBLEM SOLVED**: Previously, all agents shared one Git working directory, causing branch conflicts when any agent switched branches. The `git worktree` solution gives each agent their own isolated working directory.

#### Why This Approach?
- **No More Branch Jumping**: Each agent works in their own directory, locked to their branch
- **Shared Git History**: All worktrees share the same `.git` folder and objects
- **Minimal Disk Usage**: Only working files are duplicated, not the entire Git history
- **IDE Independence**: Each tool (Cursor, terminals) operates in its own space

#### Step 1: Create Central Integration Branch (Agent A - Day 0)
```bash
# Agent A creates the CENTRAL integration branch for all agents
git checkout main
git pull origin main
git checkout -b feature/actor-ref-integration
git push -u origin feature/actor-ref-integration

# Mark as protected branch requiring reviews
# This becomes the single source of truth for all actor-ref work
```

#### Step 2: Setup Agent Worktrees (CRITICAL - Do This Once)
```bash
# From the main repo directory, create separate worktrees for each agent
cd actor-web  # Main repository

# Agent A - Architecture worktree
git worktree add ../actor-web-architecture feature/actor-ref-architecture

# Agent B - Implementation worktree  
git worktree add ../actor-web-implementation feature/actor-ref-implementation

# Agent C - Testing worktree
git worktree add ../actor-web-tests feature/actor-ref-tests

# Configure automatic push tracking
git config --global worktree.guessRemote true
```

#### Step 3: Agent Working Directories
```bash
# Directory structure after setup:
actor-web/                    # Main repository (integration work)
├── .git/                     # Shared Git database
├── docs/
├── src/
└── ...

../actor-web-architecture/   # Agent A workspace
├── .git -> ../actor-web/.git # Symlink to shared Git
├── docs/
├── src/
└── ...

../actor-web-implementation/ # Agent B workspace
../actor-web-tests/          # Agent C workspace
```

#### Step 4: Agent-Specific Setup Commands

**Agent A (Tech Lead) Setup:**
```bash
# Open Cursor IDE in the architecture directory
cd ../actor-web-architecture
git status  # Shows: feature/actor-ref-architecture
git pull origin feature/actor-ref-architecture
```

**Agent B (Senior Dev) Setup:**
```bash
# Navigate to implementation directory
cd ../actor-web-implementation  
git status  # Shows: feature/actor-ref-implementation
git pull origin feature/actor-ref-implementation
```

**Agent C (Junior Dev) Setup:**
```bash
# Navigate to testing directory
cd ../actor-web-tests
git status  # Shows: feature/actor-ref-tests  
git pull origin feature/actor-ref-tests
```

### Integration & Merge Strategy

#### Daily Integration Process (MANDATORY)

##### Using Merge Scripts (RECOMMENDED)
```bash
# Each agent works in their own worktree - no branch conflicts!

# All agents run the same command from their worktree:
pnpm sync  # Automatically syncs with integration branch

# Optional: Pull specific changes from other agents
pnpm merge-a  # Get latest architecture changes
pnpm merge-b  # Get latest implementation changes
pnpm merge-c  # Get latest test updates
```

##### Manual Method
```bash
# Agent A daily sync (from ../actor-web-architecture/)
cd ../actor-web-architecture
git pull origin feature/actor-ref-architecture
git fetch origin feature/actor-ref-integration
git merge origin/feature/actor-ref-integration  # Merge latest integration changes

# Agent B daily sync (from ../actor-web-implementation/)  
cd ../actor-web-implementation
git pull origin feature/actor-ref-implementation
git fetch origin feature/actor-ref-integration
git merge origin/feature/actor-ref-integration

# Agent C daily sync (from ../actor-web-tests/)
cd ../actor-web-tests
git pull origin feature/actor-ref-tests
git fetch origin feature/actor-ref-integration
git merge origin/feature/actor-ref-integration
```

#### Merge-to-Integration Process
```bash
# When a feature is complete and tested:

# 1. From your agent worktree, push your branch
cd ../actor-web-[your-worktree]  # architecture/implementation/tests
git add .
git commit -m "feat: [your feature description]"
git push origin feature/actor-ref-[your-branch]

# 2. Switch to main repo for integration (or use GitHub PR)
cd ../actor-web  # Main repository
git checkout feature/actor-ref-integration
git pull origin feature/actor-ref-integration
git merge feature/actor-ref-[your-branch]
git push origin feature/actor-ref-integration

# 3. All other agents pull the integration changes in their next daily sync
```

#### Automated Setup Script
```bash
# Create scripts/setup-agent-worktrees.sh for easy onboarding
#!/usr/bin/env bash
declare -A branches=(
  ["architecture"]="feature/actor-ref-architecture"
  ["implementation"]="feature/actor-ref-implementation"  
  ["tests"]="feature/actor-ref-tests"
)

for dir in "${!branches[@]}"; do
  branch="${branches[$dir]}"
  echo "Setting up worktree: ../actor-web-${dir} -> ${branch}"
  git worktree add -B "$branch" "../actor-web-${dir}" origin/"$branch" 2>/dev/null \
    || git worktree add "../actor-web-${dir}" -b "$branch"
done

echo "✅ Worktrees ready! Each agent can now work independently."
echo "Agent A: cd ../actor-web-architecture"
echo "Agent B: cd ../actor-web-implementation"  
echo "Agent C: cd ../actor-web-tests"
```

### Branch Protection Rules
- `feature/actor-ref-integration` (PROTECTED):
  - Requires PR reviews from at least one other agent
  - All CI tests must pass
  - No merge conflicts allowed
  - No direct commits (PR only)
  - Linear history preferred

### Real-Time Coordination Rules
1. **Communicate Before Big Merges**: Announce in #actor-spa-dev before merging significant changes
2. **Fast Conflict Resolution**: If conflicts arise, resolve within 4 hours or rollback
3. **Integration Branch Priority**: Always prioritize keeping integration branch stable
4. **Cross-Agent Dependencies**: Merge dependent changes in correct order
5. **Worktree Independence**: Each agent's worktree is independent - no more branch jumping!
6. **Daily Sync Protocol**: Pull integration changes into your worktree daily (see commands above)

### Worktree Management Commands
```bash
# List all worktrees
git worktree list

# Remove a worktree (when no longer needed)
git worktree remove ../actor-web-architecture

# Prune worktrees (cleanup deleted ones)
git worktree prune

# Add new worktree for feature branch
git worktree add ../feature-branch-name feature/new-feature
```

---

## 👥 Team Structure & Roles

### Agent A: Tech Lead (Claude)
- **Primary Focus**: Architecture, API design, complex algorithms
- **Experience Level**: Expert
- **Tools**: Claude Code, comprehensive codebase access

### Agent B: Senior Developer (Cursor)
- **Primary Focus**: Core implementations, integrations, performance
- **Experience Level**: Senior
- **Tools**: Cursor IDE, full development environment

### Agent C: Junior Developer (Local LLM)
- **Primary Focus**: Tests, documentation, utilities, simple features
- **Experience Level**: Junior
- **Tools**: Basic IDE, focused on specific files

---

## 🎯 Agent Responsibilities

### Agent A (Tech Lead) - Pure Actor Model Architecture

#### Scope of Work (MESSAGE PLAN DSL ARCHITECTURE)
```typescript
// Primary Responsibilities - DECLARATIVE MESSAGE ORCHESTRATION
- 🚨 Design Message Plan DSL for unified communication patterns
- 🚨 Implement declarative message instructions (Send, Ask, Broadcast)
- 🚨 Design atomic transaction boundaries for message plans
- 🚨 Create location-transparent ActorRef abstraction
- 🚨 Define retry policies and circuit breaker patterns
- Distributed actor directory with caching
- Supervision strategies and fault tolerance
- Architecture decision records (ADRs)
- Code review for all PRs
```

#### Deliverables (UPDATED FOR MESSAGE PLAN DSL)
- [ ] `src/framework/core/actors/message-plan-dsl.ts`
- [ ] `src/framework/core/actors/message-plan-interpreter.ts`
- [ ] `src/framework/core/actors/location-transparent-actor-ref.ts`
- [ ] `src/framework/core/actors/distributed-actor-directory.ts`
- [ ] `src/framework/core/actors/supervisor.ts`
- [ ] `src/framework/core/messaging/retry-policies.ts`
- [ ] `docs/architecture/message-plan-dsl-design.md`
- [ ] `docs/architecture/cross-actor-communication.md`

#### Key Patterns
```typescript
// Message Plan DSL Types
export type MessagePlan =
  | DomainEvent                                    // Fan-out broadcast
  | SendInstruction                               // Point-to-point command
  | AskInstruction                                // Request/response
  | (DomainEvent | SendInstruction | AskInstruction)[];

export interface SendInstruction {
  to: ActorRef<any>;
  msg: ActorMessage;
  mode?: 'fireAndForget' | 'retry(3)' | 'circuitBreaker';
}

export interface AskInstruction<R = unknown> {
  to: ActorRef<any>;
  ask: ActorMessage;
  onOk: DomainEvent | ((response: R) => DomainEvent);
  onErr?: DomainEvent;
  timeout?: number;
}

// Component behavior with Message Plan
export interface ComponentBehaviorConfig<TMessage, TDomainEvent> {
  onMessage: (params: {
    message: TMessage;
    machine: Actor<TMachine>;
    dependencies: Record<string, ActorRef>;
  }) => Promise<MessagePlan>;
}
```

### Agent B (Senior Developer) - Message Plan Runtime & Transport

#### Scope of Work (MESSAGE PLAN EXECUTION ENGINE)
```typescript
// Primary Responsibilities - RUNTIME INTERPRETER & TRANSPORT
- 🚨 Implement Message Plan interpreter/executor
- 🚨 Build atomic persistence for message plans
- 🚨 Create instruction execution pipeline
- 🚨 Implement retry and circuit breaker mechanisms
- WebSocket transport for cross-machine communication
- Worker Thread transport for CPU-intensive actors
- Message correlation and routing system
- Performance optimizations (10,000+ messages/sec)
- Integration with transactional outbox
```

#### Deliverables (UPDATED FOR MESSAGE PLAN RUNTIME)
- [ ] `src/framework/core/runtime/message-plan-executor.ts`
- [ ] `src/framework/core/runtime/instruction-pipeline.ts`
- [ ] `src/framework/core/runtime/retry-executor.ts`
- [ ] `src/framework/core/runtime/circuit-breaker.ts`
- [ ] `src/framework/core/transport/websocket-transport.ts`
- [ ] `src/framework/core/transport/worker-thread-transport.ts`
- [ ] `src/framework/core/persistence/message-plan-store.ts`
- [ ] `src/framework/core/messaging/correlation-tracker.ts`

#### Key Patterns
```typescript
// Message Plan Executor
export class MessagePlanExecutor {
  async execute(plan: MessagePlan, context: ExecutionContext): Promise<void> {
    // 1. Persist plan atomically with state
    await this.store.transaction(async tx => {
      await tx.saveState(context.actorId, context.state);
      await tx.savePlan(context.planId, plan);
    });
    
    // 2. Execute each instruction
    const instructions = Array.isArray(plan) ? plan : [plan];
    for (const instruction of instructions) {
      await this.executeInstruction(instruction, context);
    }
  }
  
  private async executeInstruction(
    instruction: MessagePlan,
    context: ExecutionContext
  ): Promise<void> {
    if (isDomainEvent(instruction)) {
      // Fan-out: machine.send() + emit()
      context.machine.send(instruction);
      await context.emit(instruction);
    } else if (isSendInstruction(instruction)) {
      // Point-to-point with retry policy
      await this.sendWithPolicy(instruction);
    } else if (isAskInstruction(instruction)) {
      // Request/response with timeout
      await this.askWithCallback(instruction);
    }
  }
}
```

### Agent C (Junior Developer) - Pure Actor Model Testing

#### Scope of Work (UPDATED FOR PURE ACTOR MODEL)
```typescript
// Primary Responsibilities - PURE ACTOR MODEL TESTING
- 🚨 Write comprehensive tests for message-only communication
- 🚨 Test location transparency (actors running on different threads/processes)
- 🚨 Test distributed actor directory functionality
- 🚨 Test actor supervision and fault tolerance
- 🚨 Performance tests for 10,000+ messages/sec
- Write ALL test files following TDD
- Create test utilities and fixtures
- Simple type definitions and interfaces
- Documentation and examples
- Test data generators
- Performance benchmark harnesses
```

#### Deliverables (UPDATED FOR PURE ACTOR MODEL)
- [ ] All `*.test.ts` files for Agent A & B's code
- [ ] `src/framework/testing/pure-actor-model-test-utils.ts`
- [ ] `src/framework/testing/distributed-actor-test-harness.ts`
- [ ] `src/framework/testing/location-transparency-tests.ts`
- [ ] `src/framework/testing/fixtures/`
- [ ] `src/framework/core/actors/types.ts`
- [ ] `src/framework/core/messaging/message-types.ts`
- [ ] `docs/examples/` (pure actor model examples)
- [ ] `benchmarks/` (performance tests including message throughput)
- [ ] `docs/pure-actor-model-testing-guide.md`

#### Key Patterns
```typescript
// Example: Test Fixture
export function createMockActorRef<T extends EventObject>(
  id = 'test-actor'
): MockActorRef<T> {
  const sentEvents: T[] = [];
  const observers: Set<Observer<any>> = new Set();
  
  return {
    id,
    send: vi.fn((event: T) => sentEvents.push(event)),
    ask: vi.fn(),
    observe: vi.fn(),
    spawn: vi.fn(),
    stop: vi.fn(),
    // Test helpers
    getSentEvents: () => [...sentEvents],
    getObserverCount: () => observers.size,
  };
}
```

---

## 📐 Code Standards & Patterns

### Unified Code Style

All agents MUST follow these standards:

```typescript
// File Header Template (REQUIRED for all files)
/**
 * @module framework/core/[module-name]
 * @description [Brief description]
 * @author Agent [A/B/C] - [Date]
 */

// Import Order (enforced by Biome)
1. Node built-ins
2. External dependencies  
3. Framework imports (@framework/*)
4. Relative imports (./)
5. Type imports (type keyword)

// Naming Conventions
- Files: kebab-case.ts
- Classes: PascalCase
- Interfaces: PascalCase with "I" prefix for contracts
- Functions: camelCase
- Constants: UPPER_SNAKE_CASE
- Test files: [name].test.ts (same directory)
```

### Test Standards

```typescript
// Test File Structure (REQUIRED)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestEnvironment } from '@framework/testing';

describe('[Module Name]', () => {
  // Setup
  let testEnv: TestEnvironment;
  
  beforeEach(() => {
    testEnv = createTestEnvironment();
  });
  
  afterEach(() => {
    testEnv.cleanup();
  });
  
  describe('[Feature/Method Name]', () => {
    it('should [behavior description]', () => {
      // Arrange
      const input = createTestData();
      
      // Act
      const result = performAction(input);
      
      // Assert
      expect(result).toBe(expected);
    });
  });
});
```

### Design Patterns to Use

1. **Actor Pattern** (Required)
   ```typescript
   // All stateful components must be actors
   const actorRef = spawn(behavior, { id: 'my-actor' });
   ```

2. **Message-First** (Required)
   ```typescript
   // No direct method calls between actors
   actorRef.send({ type: 'UPDATE', data });
   ```

3. **Supervision Tree** (Required for fault tolerance)
   ```typescript
   const supervisor = spawn(supervisorBehavior);
   const child = supervisor.spawn(childBehavior, {
     supervision: 'restart-on-failure'
   });
   ```

4. **Observable State** (Required for UI binding)
   ```typescript
   const state$ = actorRef.observe(snapshot => snapshot.context);
   ```

### Anti-Patterns to Avoid

```typescript
// ❌ NEVER: Direct state mutation
actor.state.context.value = 'new'; 

// ❌ NEVER: Synchronous actor communication
const result = actor.getState(); 

// ❌ NEVER: Shared mutable state
let sharedData = { count: 0 };

// ❌ NEVER: Actor state in closures
const handler = () => console.log(actor.state);

// ❌ NEVER: setTimeout/setInterval
setTimeout(() => actor.send('TIMEOUT'), 1000);
```

---

## 🔄 TDD Workflow

### Phase 1: Test Specification (Agent C)

```typescript
// 1. Agent C writes test specs based on requirements
describe('ActorRef', () => {
  it.todo('should send events to the actor');
  it.todo('should handle ask pattern with timeout');
  it.todo('should allow observation of state changes');
  it.todo('should spawn child actors');
  it.todo('should cleanup on stop');
});
```

### Phase 2: Red Phase (Agent C)

```typescript
// 2. Agent C implements failing tests
it('should send events to the actor', () => {
  const actorRef = createActorRef(testBehavior);
  const event = { type: 'TEST_EVENT' as const };
  
  actorRef.send(event);
  
  // This will fail until implementation exists
  expect(actorRef.getSnapshot().events).toContain(event);
});
```

### Phase 3: Green Phase (Agent A/B)

```typescript
// 3. Agent A or B implements minimum code to pass
export class XStateActorRef implements ActorRef {
  send(event: EventObject): void {
    this.interpreter.send(event);
  }
}
```

### Phase 4: Refactor Phase (All)

```typescript
// 4. All agents collaborate on refactoring
// - Agent A reviews architecture
// - Agent B optimizes performance  
// - Agent C adds edge case tests
```

---

## 📅 Implementation Timeline

### Week 1: Foundation
| Day | Agent A (Tech Lead) | Agent B (Senior) | Agent C (Junior) |
|-----|-------------------|-----------------|-----------------|
| Mon | ActorRef interface design | Mailbox implementation | Test utilities setup |
| Tue | Request/response pattern | Observable basics | ActorRef test specs |
| Wed | Code review + refinements | Event bus design | Mailbox tests |
| Thu | Supervision interface | Operators impl | Observable tests |
| Fri | Integration planning | Performance baseline | Documentation |

### Week 2: Core Implementation
| Day | Agent A (Tech Lead) | Agent B (Senior) | Agent C (Junior) |
|-----|-------------------|-----------------|-----------------|
| Mon | Complex ask() impl | XState adapter | Integration test specs |
| Tue | Supervisor behavior | Component bridge | Request/response tests |
| Wed | Error handling patterns | Subscription mgmt | Error case tests |
| Thu | Code review | Performance tuning | Benchmark setup |
| Fri | Architecture docs | Integration fixes | Example apps |

### Week 3: Integration & Polish
| Day | Agent A (Tech Lead) | Agent B (Senior) | Agent C (Junior) |
|-----|-------------------|-----------------|-----------------|
| Mon | Migration strategy | Legacy adapter | Migration tests |
| Tue | Advanced patterns | Memory optimization | Load tests |
| Wed | Security review | Final optimizations | Security tests |
| Thu | API freeze | Bug fixes | Doc review |
| Fri | Release planning | Final integration | Release notes |

---

## 📡 Communication Protocol

### Daily Updates Format
```markdown
## Daily Update - Agent [A/B/C] - [Date]

### Integration Status
- [ ] ✅ Synced with feature/actor-ref-integration this morning
- [ ] 🔄 PR pending: [your-branch] → integration
- [ ] ⚠️ Conflicts to resolve: [list any conflicts]

### Completed
- [ ] Task 1 with PR link
- [ ] Task 2 with PR link

### In Progress
- [ ] Current task (X% complete)
- [ ] Working branch: feature/actor-ref-[agent]-[feature]

### Ready for Integration
- [ ] Feature X ready for PR review
- [ ] Tests passing: [test results link]

### Blockers
- [ ] Any blocking issues
- [ ] Dependencies on other agents

### Next
- [ ] Tomorrow's planned work
- [ ] Planned merge to integration: [when]
```

### PR Template
```markdown
## PR Type
- [ ] Feature
- [ ] Test
- [ ] Documentation
- [ ] Bug Fix

## Description
[What does this PR do?]

## Test Coverage
- [ ] Unit tests added/updated
- [ ] Integration tests added/updated
- [ ] All tests passing

## Checklist
- [ ] Follows code standards
- [ ] No linting errors
- [ ] Documentation updated
- [ ] Performance impact considered

## Agent
Agent [A/B/C] - [Your Role]
```

### Integration Coordination Protocol

#### Before Starting New Features
1. **Check Integration Branch**: Pull latest from `feature/actor-ref-integration`
2. **Announce Intent**: Post in #actor-spa-dev: "Starting work on [feature] on branch [branch-name]"
3. **Check Dependencies**: Verify no other agent is working on conflicting features

#### Before Merging to Integration
1. **Pre-merge Checklist**:
   - [ ] All tests passing locally
   - [ ] Merged latest integration changes
   - [ ] No linting errors
   - [ ] Documentation updated
   
2. **Announce Merge Intent**: 
   ```markdown
   🔄 **MERGE ALERT** - Agent [A/B/C]
   
   **Branch**: feature/actor-ref-[agent]/[feature]
   **Target**: feature/actor-ref-integration
   **Features**: [list key changes]
   **Impact**: [potential conflicts with other agents]
   **Timeline**: Merging in [timeframe]
   
   @AgentA @AgentB @AgentC - Please review/comment if conflicts expected
   ```

3. **Wait for Acknowledgment**: Give other agents 2 hours to respond during work hours

#### Conflict Resolution
1. **Technical Conflicts**: Agent A (Tech Lead) has final say
2. **Merge Conflicts**: Person who created conflict resolves it within 4 hours
3. **Design Conflicts**: Team discussion in #actor-spa-dev with Agent A arbitration
4. **Test Conflicts**: Agent C coordinates test organization
5. **Integration Blockers**: Escalate to Agent A immediately

#### Emergency Integration Protocol
If integration branch becomes unstable:
1. **Immediate Revert**: Responsible agent reverts breaking changes
2. **Hotfix Branch**: Create `hotfix/integration-fix-[issue]`
3. **Team Notification**: Alert all agents of integration issue
4. **Resolution Timeline**: Fix within 2 hours or rollback further

---

## ✅ Quality Assurance

### Test Coverage Requirements
- **Minimum**: 90% overall coverage
- **New Code**: 95% coverage required
- **Critical Paths**: 100% coverage (ActorRef core, Supervisor)

### Performance Benchmarks
```typescript
// Required benchmarks (Agent C implements, Agent B optimizes)
describe('Performance', () => {
  it('should send 10,000 events/second', () => {
    const result = benchmark(() => actorRef.send(event), 10000);
    expect(result.opsPerSecond).toBeGreaterThan(10000);
  });
  
  it('should handle 1,000 concurrent actors', () => {
    const actors = Array.from({ length: 1000 }, () => spawn(behavior));
    expect(measureMemory()).toBeLessThan(100); // MB
  });
});
```

### Documentation Standards
1. **API Docs**: JSDoc on all public APIs
2. **Examples**: Working example for each feature
3. **Guides**: Step-by-step tutorials
4. **ADRs**: Architecture Decision Records for major choices

### Code Review Checklist
- [ ] Tests pass and coverage meets requirements
- [ ] No linting errors or warnings
- [ ] Follows established patterns
- [ ] Performance impact acceptable
- [ ] Documentation complete
- [ ] No security vulnerabilities
- [ ] Backward compatibility maintained

---

## 🎯 Success Metrics

1. **Zero Integration Conflicts**: Modular design prevents conflicts
2. **High Test Coverage**: >95% coverage maintained
3. **Performance Goals Met**: All benchmarks pass
4. **Clean Architecture**: No coupling between agent work
5. **On-Time Delivery**: 3-week timeline achieved

---

## 🔗 Resources

- **Communication**: #actor-spa-dev on Slack/Discord
- **Documentation**: `/docs/architecture/`
- **Examples**: `/examples/actor-ref/`
- **Benchmarks**: `/benchmarks/`
- **Meeting Notes**: `/docs/meetings/`

---

*This implementation guide ensures all three agents can work effectively in parallel while maintaining high code quality through test-driven development.*