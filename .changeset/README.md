# Changesets

This directory holds [changesets](https://github.com/changesets/changesets) —
intent-to-release notes that drive versioning and changelogs.

- Add one with `pnpm changeset`.
- `@actor-web/runtime` and `@actor-web/testing` are a **fixed** group (released
  in lockstep).
- `@actor-web/cli` releases separately once its packed-artifact smoke contract
  is green.
