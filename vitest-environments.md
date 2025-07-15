# Vitest Environment Configuration

This project uses multiple vitest configurations to handle different testing environments:

## Configuration Files

### 1. Root Configuration (`vitest.config.ts`)
- **Environment**: `happy-dom` (browser-like)
- **Purpose**: Tests DOM-based functionality
- **Includes**: 
  - `src/**/*.{test,spec}.{js,ts}` (main framework tests)
  - `packages/actor-core-testing/src/**/*.{test,spec}.{js,ts}` (testing utilities)
- **Setup**: Uses `./tests/setup.ts` for DOM-related test setup

### 2. CLI Package (`packages/agent-workflow-cli/vitest.config.ts`)
- **Environment**: `node` (Node.js)
- **Purpose**: Tests CLI functionality, git operations, file system access
- **Includes**: `src/**/*.{test,spec}.{js,ts}` (within CLI package)
- **Setup**: Uses `./tests/setup.ts` (CLI-specific setup)

### 3. Runtime Package (`packages/actor-core-runtime/vitest.config.ts`)
- **Environment**: `node` (Node.js)
- **Purpose**: Tests core runtime functionality, actor systems, distributed services
- **Includes**: `src/**/*.{test,spec}.{js,ts}` (within runtime package)
- **Setup**: No setup file (Node.js doesn't need DOM setup)

## Test Scripts

From the root directory:

```bash
# Run all tests in sequence
pnpm test

# Run specific environment tests
pnpm test:dom      # DOM tests (happy-dom)
pnpm test:cli      # CLI tests (node)
pnpm test:runtime  # Runtime tests (node)

# Alternative: run all tests
pnpm test:all      # Same as pnpm test
```

## Environment Separation Benefits

1. **Proper Environment Isolation**: DOM tests use browser APIs, CLI/runtime tests use Node.js APIs
2. **No Duplicate Runs**: Each test file runs only in its appropriate environment
3. **Faster Test Execution**: No need to load DOM environment for Node.js tests
4. **Correct Dependencies**: Each environment has access to the right global objects
5. **Better Error Messages**: Environment-specific failures are clearer

## Test Distribution

- **DOM Tests**: ~623 tests (UI components, accessibility, form validation, etc.)
- **CLI Tests**: ~47 tests (git operations, input validation, workflow automation)
- **Runtime Tests**: ~16 tests (actor directory, core runtime functionality)

## Troubleshooting

If you see errors like "Element is not defined" in Node.js tests, ensure:
1. The test file is using the correct vitest config for its environment
2. Node.js tests don't try to use DOM-specific setup files
3. The `environment` setting matches the test requirements

## Future Considerations

- Consider adding a `jsdom` environment config if more complex DOM testing is needed
- May add separate configs for integration tests vs unit tests
- Could add performance testing configs with different timeout settings 