# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) —
intent-to-release notes that drive versioning and changelogs.

- Add one with `pnpm changeset`.
- `@actor-web/runtime` and `@actor-web/testing` are a **fixed** group (released
  in lockstep). `@actor-web/cli` is **ignored** here until its test suite is
  green; it will be released separately.
