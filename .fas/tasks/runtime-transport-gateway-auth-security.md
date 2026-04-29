# Runtime transport and gateway auth security

## Summary

Add optional authentication hooks for Actor-Web runtime peer handshakes and gateway clients while preserving the existing local-demo defaults.

## Implementation Notes

- Extend runtime transport handshakes with optional auth metadata.
- Add runtime-native auth provider/result types for transport and gateway usage.
- Wire auth through Node and browser WebSocket transports, `serveActorWebNode`, `startActorWebNode`, `createActorWebSource`, and `createActorWebClient`.
- Reject unauthenticated peers/clients before peer registration or gateway stream attachment.
- Emit auth telemetry without logging token values.

## Verification

- Runtime transport auth acceptance and rejection tests.
- Gateway auth acceptance and rejection tests.
- Existing unauthenticated examples and tests continue to pass by default.
