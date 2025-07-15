# Script Organization

This document explains the organization of npm scripts in `package.json` for better maintainability and clarity.

## Core Development Scripts (Top Level)

These are the most commonly used scripts kept at the top level for easy access:

- `build` - Build the library
- `dev` - Run development mode with watch
- `test` - Run tests
- `lint` - Run linting
- `format` - Format code
- `typecheck` - Run TypeScript type checking
- `clean` - Clean build artifacts
- `prepublishOnly` - Pre-publish setup

## Grouped Scripts (Namespaced)

### Testing Scripts (`test:*`)
- `test:coverage` - Run tests with coverage
- `test:watch` - Run tests in watch mode
- `test:ui` - Run tests with UI
- `test:debug` - Run tests in debug mode

### Linting & Formatting Scripts (`lint:*`, `format:*`)
- `lint:fix` - Run linting with auto-fix
- `format:imports` - Format with import organization
- `format:all` - Format everything

### Dependency Management (`deps:*`)
- `deps:check` - Check dependencies
- `deps:clean` - Clean dependencies and reinstall

### Examples (`examples:*`)
- `examples:dev` - Run examples in development
- `examples:build` - Build examples

### Agent Workflow CLI (`aw:*`)
Modern agent workflow system (recommended):
- `aw` - Main CLI entry point
- `aw:help` - Show help
- `aw:init` - Initialize agent workflow
- `aw:sync` - Sync with integration branch
- `aw:validate` - Validate work
- `aw:ship` - Ship to integration
- `aw:save` - Save work
- `aw:status` - Show status
- `aw:commit` - Enhanced commit
- `aw:generate` - Generate commit messages

### Utility Scripts (`utils:*`)
- `utils:date` - Date utilities
- `utils:date-scan` - Scan for date issues
- `utils:date-fix` - Fix date issues
- `utils:commit-config` - Commit configuration
- `utils:commit-sample` - Create commit samples
- `utils:validate-dates` - Validate dates

### Legacy Scripts (`legacy:*`)
⚠️ **Deprecated**: These scripts are maintained for backward compatibility but should be migrated to the `aw:*` equivalents:
- `legacy:agent` - Legacy agent workflow
- `legacy:sync` - Legacy sync
- `legacy:push` - Legacy push
- `legacy:validate` - Legacy validate
- `legacy:status` - Legacy status
- `legacy:setup` - Legacy setup
- `legacy:commit` - Legacy commit
- `legacy:save` - Legacy save
- `legacy:ship` - Legacy ship

## Removed Scripts

The following scripts were removed during reorganization:
- `wallaby-replacement` - Replaced by `test:ui`
- `agent-a:push`, `agent-b:push`, `agent-c:push` - Use `aw:ship` instead
- `agent-a:sync`, `agent-b:sync`, `agent-c:sync` - Use `aw:sync` instead
- `bridge:*` - Consolidated into `aw:*` commands
- `actor:*` - Consolidated into `aw:*` commands
- Top-level `date`, `commit`, `save`, etc. - Moved to namespaced versions

## Migration Guide

### From Legacy to Modern Workflow

| Legacy Command | Modern Equivalent |
|---------------|------------------|
| `pnpm save` | `pnpm aw:save` |
| `pnpm ship` | `pnpm aw:ship` |
| `pnpm status` | `pnpm aw:status` |
| `pnpm sync` | `pnpm aw:sync` |
| `pnpm validate` | `pnpm aw:validate` |
| `pnpm commit` | `pnpm aw:commit` |
| `pnpm agent-a:push` | `pnpm aw:ship` |

### Script Organization Benefits

1. **Improved Discoverability**: Related scripts are grouped together
2. **Reduced Clutter**: Fewer top-level scripts
3. **Clear Naming**: Namespace prefixes indicate purpose
4. **Better Maintainability**: Easy to find and modify related scripts
5. **Backward Compatibility**: Legacy scripts preserved with clear deprecation path

## Best Practices

1. Keep most commonly used scripts at the top level
2. Use namespaces for related functionality
3. Consolidate similar scripts with parameters when possible
4. Document deprecated scripts clearly
5. Provide migration paths for legacy scripts

## Related Documentation

- `PNPM_OVERRIDES.md` - Documentation for PNPM overrides and workarounds
- `package.json` - Contains the npm scripts and configuration
- `pnpm-workspace.yaml` - Monorepo configuration 