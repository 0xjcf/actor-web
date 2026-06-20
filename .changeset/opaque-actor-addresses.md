---
'@actor-web/runtime': minor
---

Make actor addresses opaque and mint them through one canonical factory.

- `ActorAddress.type: string` is now `kind: 'actor' | 'callback'`.
- Actor address paths drop the redundant `/actor/` segment: an actor is now `actor://<node>/<id>` (callback addresses keep `actor://<node>/callback/<id>`).
- All actor addresses are minted through a single pure factory `createActorAddress(id, node?, kind?)` with one canonical local-node normalization — `node` is always set and `'local'` is the canonical marker. `createLocalActorAddress(id)` and `createRemoteActorAddress(id, node)` drop their former `type` parameter.

**Breaking:** the exported `ActorAddress` / `ActorWebActorAddress` types, the `createActorAddress` signature, and the actor address path format have changed. All nodes in a cluster must upgrade together — the actor address wire format is not interoperable across this change (callback addresses are unaffected).
