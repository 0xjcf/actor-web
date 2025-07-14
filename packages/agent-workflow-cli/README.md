# Agent Workflow CLI

Agent-centric development workflow automation for modern software teams.

## Installation

```bash
# Install dependencies
pnpm install

# Build the CLI
pnpm build

# Link for global usage
pnpm link --global
```

## Commands

### Core Workflow

- `aw save [message]` - Save current work with intelligent context analysis
- `aw ship` - Ship work to integration branch with validation
- `aw sync` - Sync with integration branch
- `aw status` - Check current workflow status
- `aw validate` - Validate current work using smart analysis

### Agent Coordination

- `aw agents:status` - Check status across all agent branches
- `aw agents:sync` - Sync changes between agents
- `aw agents:conflicts` - Detect and resolve conflicts

### Advanced Git Operations

- `aw actor:create` - Create new actor worktree
- `aw actor:status` - Check actor worktree status
- `aw actor:worktrees` - Manage actor worktrees

## Context Analysis Configuration

The CLI provides intelligent commit message context generation that can be customized for your project.

### Configuration File: `.aw-context.json`

Create a `.aw-context.json` file in your project root to customize how the CLI analyzes and categorizes your changes:

```json
{
  "patterns": {
    "components": {
      "filePatterns": ["**/components/**", "**/src/components/**"],
      "displayName": "UI Components",
      "priority": 1
    },
    "api": {
      "filePatterns": ["**/api/**", "**/backend/**", "**/server/**"],
      "displayName": "API Layer",
      "priority": 2
    },
    "database": {
      "filePatterns": ["**/migrations/**", "**/schemas/**", "**/models/**"],
      "displayName": "Database",
      "priority": 3
    },
    "tests": {
      "filePatterns": ["**/*.test.*", "**/*.spec.*", "**/test/**"],
      "displayName": "Tests",
      "priority": 4
    },
    "docs": {
      "filePatterns": ["**/*.md", "**/docs/**"],
      "displayName": "Documentation",
      "priority": 5
    }
  },
  "analysis": {
    "maxModules": 3,
    "separator": " | ",
    "fallbackMessage": "files across project"
  }
}
```

### Configuration Options

#### `patterns`
Define categories of files and how to identify them:

- **`filePatterns`**: Array of glob patterns to match files
- **`displayName`**: Human-readable name for the category
- **`priority`**: Lower numbers appear first in context (1 = highest priority)

#### `analysis`
Control how the analysis is presented:

- **`maxModules`**: Maximum number of categories to show in context
- **`separator`**: String to separate different categories  
- **`fallbackMessage`**: Message when no patterns match

### Example Output

With proper configuration, your commit messages will have meaningful context:

```
feat(frontend): Add user authentication with JWT tokens

Agent: Agent B (Frontend)  
Context: UI Components: 3 files | API Layer: 2 files | Tests: 4 files
Date: 2025-07-14
Branch: feature/agent-b

[actor-web] Agent B (Frontend) - Add user authentication with JWT tokens
```

### Default Patterns

If no configuration file is provided, the CLI uses sensible defaults:

- **Tests**: `**/*.test.*`, `**/*.spec.*`, `**/test/**`, `**/tests/**`
- **Components**: `**/components/**`, `**/src/components/**`  
- **Core**: `**/core/**`, `**/src/core/**`
- **Utilities**: `**/utils/**`, `**/utilities/**`, `**/helpers/**`
- **Documentation**: `**/*.md`, `**/docs/**`, `**/documentation/**`
- **Configuration**: `**/package.json`, `**/tsconfig*`, `**/.env*`, `**/config/**`

## Usage Examples

### Basic Save
```bash
# Uses intelligent context analysis with generic message
aw save

# Provides specific description with analyzed context  
aw save "Add user authentication system"
```

### Ship to Integration
```bash
# Validates and ships to integration branch
aw ship
```

### Check Status
```bash
# Shows current agent status and pending changes
aw status
```

## Development

```bash
# Install dependencies
pnpm install

# Development mode with hot reload
pnpm dev

# Run tests
pnpm test

# Build for production
pnpm build
``` 