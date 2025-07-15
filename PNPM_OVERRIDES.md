# PNPM Overrides Documentation

## Overview

The `package.json` file contains PNPM overrides that serve as **temporary workarounds** for known issues in monorepo environments.

## Current Overrides

```json
{
  "pnpm": {
    "overrides": {
      "tinypool": "^1.1.1",
      "vitest": "^2.1.4"
    }
  }
}
```

## Why These Overrides Are Needed

These overrides resolve critical issues in our monorepo setup:

### 1. Module Resolution Errors
- **Issue**: PNPM's hoisting behavior in monorepos can cause module resolution conflicts
- **Impact**: Build failures and runtime errors when dependencies can't be resolved correctly
- **Solution**: Override specific versions to ensure consistent resolution across workspace packages

### 2. CI Test Failures
- **Issue**: Test environment inconsistencies due to version mismatches between packages
- **Impact**: Flaky tests, false negatives in CI pipeline
- **Solution**: Pin specific versions to ensure test stability

## References

- **GitHub Issue #6055**: Related monorepo module resolution issues
- **CI Failure Discussion**: See related CI failure logs and discussions for context

## Alternative Solutions

### Using `resolutions` Field
If npm compatibility is needed, consider using the `resolutions` field instead:

```json
{
  "resolutions": {
    "tinypool": "^1.1.1",
    "vitest": "^2.1.4"
  }
}
```

## Maintenance Notes

### ⚠️ **IMPORTANT**: These are temporary workarounds

- **Review regularly**: Check if upstream issues have been resolved
- **Remove when possible**: Once the underlying PNPM/monorepo issues are fixed, remove these overrides
- **Monitor for updates**: Keep track of PNPM releases that may address these issues

### Regular Review Process

1. **Monthly check**: Review PNPM release notes for relevant fixes
2. **Test removal**: Periodically try removing overrides to see if issues persist
3. **Update versions**: If overrides are still needed, consider updating to newer versions
4. **Document changes**: Update this file when overrides are modified or removed

## Troubleshooting

### If removing overrides causes issues:
1. Check for new PNPM releases
2. Review monorepo configuration
3. Consider updating workspace dependencies
4. Consult PNPM documentation for monorepo best practices

### Signs that overrides can be removed:
- Tests pass consistently without them
- No module resolution errors in development
- CI pipeline runs successfully
- All workspace packages build correctly

## Related Files

- `package.json` - Contains the actual overrides
- `pnpm-workspace.yaml` - Monorepo configuration
- `SCRIPT_ORGANIZATION.md` - Script organization documentation 