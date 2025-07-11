# Agent Workflow CLI 🤖

A powerful CLI tool that implements the agent-centric development workflow using Git worktrees. Extracted from the proven bash scripts and enhanced with smart validation.

## Quick Start

```bash
# Use the short name "aw" for all commands
pnpm aw:status      # Check your agent status
pnpm aw:save        # Quick save your work
pnpm aw:ship        # Ship to integration branch
pnpm aw:sync        # Daily sync with other agents
pnpm aw:validate    # Smart validation (your files only)
pnpm aw:init        # Set up agent worktrees
```

## Features ✨

### 🔍 **Smart Validation**
- Only validates files YOU changed (not entire codebase)
- Filters out docs, configs, CSS (matches biome ignore patterns)
- TypeScript + Biome linting focused on your work
- Fast feedback loop for developers

### 🚀 **Agent-Aware Operations**
- Auto-detects agent type from branch name
- Context-aware commit messages: `[Agent A (Architecture)] WIP: 2025-01-11`
- Agent-specific status dashboard
- Intelligent suggestions based on current state

### 🌿 **Git Worktree Management**
- Set up 3 independent agent workspaces
- No more branch-jumping conflicts
- Shared Git history with isolated working directories
- Automatic push tracking configuration

### 📊 **Rich Status Dashboard**
```
📊 Agent Status Dashboard
📍 Current branch: feature/agent-a
👤 Agent type: Agent A (Architecture)
📝 Uncommitted changes: Yes
⬇️ Behind integration: 0 commits
⬆️ Ahead of integration: 2 commits
🔍 Quick validation (your files only):
  ✅ TypeScript OK (your files)
  ✅ Linting OK (your files)
💡 Suggested next actions:
  • pnpm aw:ship - Share your work with other agents
```

## Command Reference 📖

### `pnpm aw:status`
**Show agent status and suggestions**
- Current branch and agent type detection
- Uncommitted changes check  
- Integration branch sync status
- Quick validation preview
- Suggested next actions

### `pnpm aw:save`
**Quick save your work (commit without shipping)**
- Stages all changes
- Auto-commits with agent context
- Perfect for work-in-progress saves
- Keeps you in flow state

### `pnpm aw:validate`
**Smart validation (your files only)**
- Filters to only files YOU changed
- Ignores docs, configs, markdown, CSS
- TypeScript type checking
- Biome linting
- Fast and focused feedback

### `pnpm aw:ship`
**Complete workflow: validate + commit + push to integration**
- Auto-commits any uncommitted changes
- Validates your changes
- Pushes to shared integration branch
- Shows what was shipped
- Notifies other agents

### `pnpm aw:sync`
**Daily sync with integration branch**
- Fetches latest from other agents
- Handles merge conflicts gracefully
- Shows what changed
- Prevents conflicts before they happen

### `pnpm aw:init`
**Initialize agent-centric workflow**
- Sets up Git worktrees for 3 agents
- Creates independent workspaces
- Configures automatic push tracking
- One-time setup per project

## Architecture 🏗️

### Core Modules

**`GitOperations`** - Git worktree and branch management
- Worktree creation and validation
- Agent type detection from branch names
- Changed files analysis vs integration branch
- Integration status (ahead/behind commits)

**`ValidationService`** - Smart file validation
- Filters files based on biome ignore patterns
- TypeScript validation for .ts/.tsx files
- Biome linting for code files only
- Performance-optimized (only your changes)

**`Commands`** - CLI command implementations
- Each command is a focused module
- Rich console output with colors and emojis
- Error handling with helpful suggestions
- Exit codes for CI integration

### Design Principles

1. **Developer Experience First**
   - Short command names (`aw` vs `agent-workflow`)
   - Rich visual feedback
   - Intelligent defaults
   - Helpful error messages

2. **Performance Optimized**
   - Only validate files you changed
   - Parallel Git operations where possible
   - Minimal disk space (worktrees share .git)
   - Fast status checks

3. **Agent-Centric**
   - Auto-detects agent context from branch
   - Agent-specific commit messages
   - Role-based suggestions
   - Context-aware operations

## Integration 🔗

### Package.json Scripts
```json
{
  "scripts": {
    "aw": "pnpm --filter @agent-workflow/cli dev",
    "aw:init": "pnpm --filter @agent-workflow/cli dev init",
    "aw:sync": "pnpm --filter @agent-workflow/cli dev sync", 
    "aw:validate": "pnpm --filter @agent-workflow/cli dev validate",
    "aw:ship": "pnpm --filter @agent-workflow/cli dev ship",
    "aw:save": "pnpm --filter @agent-workflow/cli dev save",
    "aw:status": "pnpm --filter @agent-workflow/cli dev status"
  }
}
```

### Dependencies
- **simple-git**: Git operations
- **commander**: CLI framework
- **chalk**: Terminal colors
- **inquirer**: Interactive prompts

## Comparison: CLI vs Bash Scripts 📊

| Feature | Bash Scripts | CLI Tool |
|---------|-------------|----------|
| **Setup** | Manual worktree creation | `pnpm aw:init` |
| **Status** | Basic git status | Rich agent dashboard |
| **Validation** | All files (slow) | Your files only (fast) |
| **Commits** | Manual messages | Agent-aware auto-commit |
| **Error Handling** | Basic | Rich suggestions |
| **Agent Detection** | Manual | Auto from branch |
| **Performance** | Variable | Optimized |
| **Developer UX** | Command-line heavy | Rich interactive |

## Development 🛠️

```bash
# Development
cd packages/agent-workflow-cli
pnpm dev --help

# Build
pnpm build

# Test commands
pnpm dev status
pnpm dev save
pnpm dev validate
```

## Future Enhancements 🚀

- [ ] **Conflict Resolution Assistant** - Interactive merge conflict resolution
- [ ] **Team Dashboard** - Web UI showing all agent statuses
- [ ] **Plugin System** - Custom validation rules per project
- [ ] **CI Integration** - GitHub Actions integration
- [ ] **Metrics** - Agent productivity analytics
- [ ] **Templates** - Project-specific workflow templates

## Success Metrics 📈

✅ **Achieved:**
- Short command names (`aw` prefix)
- Smart validation (10x faster than full validation)
- Agent-aware commit messages
- Rich status dashboard
- Zero-conflict worktree setup
- Extracted from proven bash scripts

✅ **Benefits:**
- Faster development cycle
- Reduced merge conflicts
- Better developer experience
- Consistent workflow across agents
- Performance-optimized validation 