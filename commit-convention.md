# Commit Convention Standards - Actor Web Architecture

> **Purpose**: Establish clear, readable, and contextual commit standards for all agents working on the actor-web-architecture project.

## 🎯 **Core Principles**

1. **Conventional Commits**: All commits MUST follow the [Conventional Commits](https://www.conventionalcommits.org/) specification
2. **Agent Context**: Every commit MUST identify the agent and their role 
3. **Descriptive**: Commit messages MUST provide enough context to understand the work completed
4. **Date Synchronization**: All agents MUST use the current system date (never hardcode dates)
5. **Consistency**: All agents follow the same format and conventions

---

## 📋 **Commit Message Format**

### **Standard Structure**
```
<type>(<scope>): <description>

<body>

<footer>
```

### **Agent-Enhanced Structure**
```
<type>(<scope>): <description>

Agent: <agent-identifier>
Files: <changed-files-summary>
Context: <additional-context>

[actor-web] <agent-name> - <work-category>
```

---

## 🔤 **Commit Types**

| Type | Description | When to Use |
|------|-------------|-------------|
| `feat` | New feature implementation | Adding new functionality, components, services |
| `fix` | Bug fixes and corrections | Fixing errors, resolving issues, patching problems |
| `refactor` | Code restructuring without behavior change | Improving code structure, performance, readability |
| `test` | Adding or updating tests | Test files, test utilities, testing infrastructure |
| `docs` | Documentation changes | README, guides, inline comments, architectural docs |
| `style` | Code style/formatting changes | Linting fixes, formatting, code style improvements |
| `perf` | Performance improvements | Optimizations, efficiency improvements |
| `build` | Build system or dependencies | Package.json, build scripts, CI/CD, tooling |
| `ci` | CI/CD configuration changes | GitHub Actions, build pipelines, automation |
| `chore` | Maintenance tasks | File moves, cleanup, minor updates |

---

## 🎭 **Agent Identifiers**

| Agent | Identifier | Role | Example Scope |
|-------|------------|------|---------------|
| **Agent A** | `Agent A (Architecture)` | Core architecture, system design | `core`, `architecture`, `actor-ref` |
| **Agent B** | `Agent B (Implementation)` | Services, features, integration | `services`, `implementation`, `integration` |
| **Agent C** | `Agent C (Testing)` | Testing, validation, cleanup | `tests`, `validation`, `quality` |
| **Agent D** | `Agent D (Documentation)` | Documentation, guides, examples | `docs`, `examples`, `guides` |

---

## 🎯 **Scope Guidelines**

### **Architecture Scopes** (Agent A)
- `core` - Core actor system, fundamentals
- `actor-ref` - Actor reference implementations 
- `architecture` - System design, patterns
- `types` - Type definitions, interfaces
- `integration` - Framework integrations (XState, etc.)

### **Implementation Scopes** (Agent B)
- `services` - Business logic, service layer
- `components` - UI components, component bridge
- `observables` - Observable implementations
- `animation` - Animation services
- `accessibility` - A11y features
- `persistence` - Data persistence, storage

### **Testing Scopes** (Agent C)
- `tests` - Test files, test suites
- `fixtures` - Test data, mocks, utilities
- `e2e` - End-to-end testing
- `validation` - Code validation, quality checks
- `performance` - Performance testing

### **General Scopes**
- `build` - Build system, tooling
- `config` - Configuration files
- `deps` - Dependencies, package management
- `security` - Security improvements
- `dx` - Developer experience

---

## 💬 **Message Examples**

### ✅ **Good Examples**

```bash
# New feature implementation
feat(actor-ref): implement actor lifecycle management

Agent: Agent A (Architecture)
Files: src/core/actor-ref.ts, src/core/lifecycle.ts
Context: Added start, stop, and restart capabilities for actor instances

[actor-web] Agent A (Architecture) - core implementation

# Bug fix with context
fix(observables): resolve memory leak in subscription cleanup

Agent: Agent B (Implementation) 
Files: src/core/observables/observable.ts
Context: Fixed unsubscribed observables not being garbage collected

[actor-web] Agent B (Implementation) - bug fix

# Test implementation
test(actor-ref): add comprehensive lifecycle test suite

Agent: Agent C (Testing)
Files: src/core/actor-ref.test.ts, src/testing/fixtures/lifecycle.ts
Context: Cover start, stop, restart scenarios with edge cases

[actor-web] Agent C (Testing) - test coverage

# Documentation update
docs(architecture): update actor supervision patterns guide

Agent: Agent A (Architecture)
Files: docs/architecture/supervision-patterns.md
Context: Added error handling and recovery strategies

[actor-web] Agent A (Architecture) - documentation

# Refactoring work
refactor(services): improve animation service performance

Agent: Agent B (Implementation)
Files: src/core/animation-services.ts, src/core/animation-services.test.ts
Context: Optimized frame calculations and reduced memory allocations

[actor-web] Agent B (Implementation) - performance optimization
```

### ❌ **Bad Examples**

```bash
# Too vague
fix: update code

# No agent context
feat: add new stuff

# Past/future dates
[Agent A] WIP: 2025-10-07

# No conventional commit structure
Updated some files for the feature

# Missing scope
feat: implement actor system
```

---

## 📅 **Date Synchronization Rules**

### **CRITICAL**: Date Standards

1. **NEVER hardcode dates** in commit messages or documentation
2. **ALWAYS use current system date** via utilities
3. **Use ISO format** for dates: `YYYY-MM-DD`
4. **Use proper timezone** considerations for documentation timestamps

### **Utility Functions**

```bash
# Get current date (use in scripts)
CURRENT_DATE=$(date +"%Y-%m-%d")

# Get current datetime with timezone
CURRENT_DATETIME=$(date +"%Y-%m-%d %H:%M:%S %Z")

# For documentation headers
CURRENT_ISO=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
```

### **Documentation Date Format**

```markdown
---
title: "Document Title"
author: "Agent A (Architecture)"
date: "2025-07-11"  # Always current date when creating/updating
updated: "2025-07-11"  # Update when making significant changes
---
```

---

## 🔧 **Implementation Guidelines**

### **For Scripts and CLI Tools**

1. **Auto-detect agent type** from branch name or git context
2. **Generate conventional commit messages** with proper structure
3. **Include file change summary** (up to 5 files, then "...")
4. **Always use current date** from system
5. **Validate commit message format** before committing

### **For Agents**

1. **Review generated commit messages** before accepting
2. **Add custom context** when the auto-generated message lacks detail
3. **Use appropriate commit types** based on the work performed
4. **Include breaking changes** in footer when applicable
5. **Reference issues/PRs** when relevant

### **For Code Reviews**

1. **Commit messages should tell a story** of what was accomplished
2. **Each commit should be atomic** - one logical change per commit
3. **Commit history should be clean** and easy to follow
4. **Breaking changes must be clearly marked** in commit footer

---

## 🚀 **Agent Workflow Integration**

### **Hybrid System Architecture**

Our commit system uses a **hybrid approach** that combines both shell-based and actor-based operations:

- **🎭 Actor-Based System**: Uses XState machines for structured git operations
- **🐚 Shell-Based System**: Provides immediate CLI functionality
- **🌉 Bridge System**: Automatically chooses the best available method

### **Quick Commands**

```bash
# Enhanced hybrid commands (uses best available system)
./scripts/actor-bridge.sh commit           # Smart conventional commit
./scripts/actor-bridge.sh generate-message # Generate commit message
./scripts/actor-bridge.sh validate-dates   # Validate dates in files
./scripts/actor-bridge.sh status          # Show system status

# Traditional shell commands (always available)
./scripts/agent-workflow.sh commit        # Shell-based commit
./scripts/agent-workflow.sh save          # Quick save
./scripts/agent-workflow.sh ship          # Full workflow

# Package.json shortcuts
pnpm bridge:commit                         # Hybrid commit
pnpm bridge:generate                       # Hybrid message generation
pnpm bridge:status                         # System status
```

### **System Detection**

The bridge system automatically detects available capabilities:

- ✅ **Actor system available**: Uses enhanced git-actor.ts with XState
- ⚠️ **Actor system unavailable**: Falls back to shell scripts
- 🔧 **Configurable**: Supports both `[actor-web]` and `[actor-workflow-cli]` tags

### **Enhanced Features**

#### **Actor-Based System** (packages/agent-workflow-cli/src/actors/git-actor.ts)
- **Structured state management** with XState
- **Type-safe operations** with full TypeScript support
- **Event-driven architecture** for better integration
- **Enhanced commit message generation** with smart analysis
- **Date validation** with configurable thresholds
- **Project-aware tagging** (`[actor-web]` vs `[actor-workflow-cli]`)

#### **Shell-Based System** (scripts/agent-workflow.sh)
- **Immediate availability** - works without setup
- **Conventional commit generation** with file analysis
- **Configurable project tags** via commit-config.sh
- **Date synchronization** with strict validation
- **Agent context detection** from branch names

### **Implementation Strategy**

1. **Development Phase**: Use shell scripts for immediate functionality
2. **Integration Phase**: Actor system provides enhanced capabilities
3. **Production Phase**: Seamless hybrid operation with automatic fallback

---

## 📚 **Breaking Changes**

When introducing breaking changes, use this format:

```
feat(core)!: redesign actor reference API

Agent: Agent A (Architecture)
Files: src/core/actor-ref.ts, src/core/types.ts
Context: Simplified API surface and improved type safety

BREAKING CHANGE: Actor.create() now requires explicit type parameter.
Migration: Change Actor.create() to Actor.create<MyActorType>()

[actor-web] Agent A (Architecture) - breaking change
```

---

## 🔍 **Validation Rules**

All commits MUST pass these validations:

1. ✅ **Format**: Follows conventional commit structure
2. ✅ **Agent**: Includes agent identifier in body/footer
3. ✅ **Scope**: Uses appropriate scope for the agent's work
4. ✅ **Description**: Clear, present-tense description of changes
5. ✅ **Files**: Summary of changed files included
6. ✅ **Date**: Uses current date (no hardcoded dates)
7. ✅ **Length**: Subject line ≤ 50 characters, body lines ≤ 72 characters

---

## 🎯 **Goals**

By following these conventions, we achieve:

- **📖 Readable History**: Anyone can understand what was done and why
- **🤖 Agent Coordination**: Clear attribution and context for parallel work
- **🔍 Easy Navigation**: Filter commits by type, scope, or agent
- **📊 Better Analytics**: Track progress and contributions by agent
- **🚀 Automated Workflows**: Enable smart automation based on commit patterns
- **📅 Synchronized Documentation**: Consistent, current date information

---

*This document is maintained by all agents and should be updated when commit conventions evolve.* 