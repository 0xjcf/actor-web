# Persistent Integrations Memory

Append external API contracts, auth mechanisms, rate limits, SDK versions, and known limitations here. Do not overwrite prior entries.

[2026-04-22] **FAS shared contracts**: `packages/actor-core-runtime/package.json` currently consumes `@franchise/shared-contracts` through a local `file:../../../fas/packages/shared-contracts` dependency. The integration surface is `packages/actor-core-runtime/src/integration/fas-shared-contracts.ts`.
[2026-04-22] **ignite-element target bridge**: Actor-Web has docs for the future ignite-element adapter bridge, but no implemented bridge package yet. Treat `docs/examples/ignite-element-host.md` and `docs/examples/ignite-element-actor-web-north-star.md` as target-state examples until implementation lands.
[2026-04-22] **External APIs**: No network API, OAuth, OIDC, SSO, webhook, or rate-limit contract is currently evidenced in Actor-Web source.

[2026-04-23] **Auth integrations**: OAuth/OIDC/SSO files found at `packages/actor-core-runtime/src/otp-message-plan-processor.ts`.
