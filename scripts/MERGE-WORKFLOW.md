# Agent Merge Workflow Guide

This guide describes how to use the merge scripts for syncing changes between different agent branches in the Actor-Web project.

## Available Scripts

### 1. Daily Integration Sync (`pnpm sync`)
Syncs your current branch with the central integration branch. This should be run daily before starting work.

```bash
pnpm sync
```

**What it does:**
- Fetches latest changes from `feature/actor-ref-integration`
- Shows incoming commits and contributors
- Merges integration changes into your current branch
- Categorizes changes by agent responsibility

### 2. Agent-Specific Merge Scripts

#### Merge Agent A Changes (`pnpm merge-a`)
Pulls architecture and design changes from Agent A (Tech Lead).

```bash
pnpm merge-a
```

**Typical files from Agent A:**
- `supervisor.ts`, `actor-ref.ts`, `request-response.ts`
- Architecture documentation (`*.md`)
- Interface definitions

#### Merge Agent B Changes (`pnpm merge-b`)
Pulls implementation changes from Agent B (Senior Developer).

```bash
pnpm merge-b
```

**Typical files from Agent B:**
- `mailbox.ts`, `observable.ts`, `event-bus.ts`
- Adapter implementations
- Performance optimizations

#### Merge Agent C Changes (`pnpm merge-c`)
Pulls test files and utilities from Agent C (Junior Developer).

```bash
pnpm merge-c
```

**Typical files from Agent C:**
- `*.test.ts`, `*.spec.ts` files
- Test utilities and fixtures
- Benchmark files
- Documentation examples

## Recommended Workflow

### Daily Routine

1. **Morning Sync** (Before starting work):
   ```bash
   # Pull latest integration changes
   pnpm sync
   
   # Run tests to ensure everything works
   pnpm test
   pnpm typecheck
   ```

2. **Agent-Specific Syncs** (As needed):
   ```bash
   # If you need specific changes from another agent
   pnpm merge-a  # For architecture changes
   pnpm merge-b  # For implementation changes
   pnpm merge-c  # For test updates
   ```

3. **Before Pushing** (End of work session):
   ```bash
   # Ensure tests pass
   pnpm test
   pnpm lint
   pnpm typecheck
   
   # Push your changes
   git push origin your-branch
   ```

## Script Features

All merge scripts include:
- **Automatic stashing** of uncommitted changes
- **Preview** of incoming commits before merge
- **Conflict detection** and guidance
- **Category-based change summary**
- **Automatic stash restoration** after merge

## Handling Merge Conflicts

If conflicts occur during merge:

1. The script will list conflicting files
2. Resolve conflicts manually using your editor
3. For architecture conflicts: Agent A (Tech Lead) has final say
4. For implementation conflicts: Coordinate with Agent B
5. For test conflicts: Prefer the most comprehensive test

After resolving:
```bash
git add .
git commit
git stash pop  # If you had stashed changes
```

## Best Practices

1. **Run `pnpm sync` daily** - Stay up to date with integration branch
2. **Communicate before big merges** - Announce in team channel
3. **Test after every merge** - Ensure nothing breaks
4. **Use agent-specific merges sparingly** - Only when you need specific changes
5. **Keep integration branch stable** - Never push breaking changes

## Branch Structure Reminder

```
feature/actor-ref-integration (Central hub)
├── feature/actor-ref-architecture (Tech Lead - Agent A)
├── feature/actor-ref-implementation (Senior Dev - Agent B)
└── feature/actor-ref-tests (Junior Dev - Agent C)
```

## Troubleshooting

**Script not found:**
```bash
chmod +x scripts/*.sh  # Make scripts executable
```

**Remote branch not found:**
```bash
git fetch --all  # Fetch all remote branches
```

**Stash conflicts:**
```bash
git stash list     # View all stashes
git stash show -p  # View stash contents
git stash drop     # Remove problematic stash
```