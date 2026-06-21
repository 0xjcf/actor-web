---
'@actor-web/runtime': minor
---

Collapse `ActorAddress` to an opaque, branded path string.

- `ActorAddress` is now a branded `string` (the path IS the address) minted only by `Address.from(input: string | { id; kind?; node? })`. Hand-built or LLM-built object literals can no longer masquerade as an address — the path-vs-fields drift class is eliminated at the type level. Structured reads go through `parse(address): { id, kind, node }`; hot routing keeps the `.includes('/callback/')` fast path and `parseActorPath` stays the wire/ingress parser.
- `ActorWebActorAddress` (the topology DSL's public address type) collapses onto the same branded string (`export type ActorWebActorAddress = ActorAddress`); the topology DSL and example address literals are minted through `Address.from`.
- Directory listing moves from `listByType(type: string)` to a typed `find(query: AddressQuery)` specification (`{ id?, kind?, node? }`), matched by the pure `matchesAddressQuery`.
- The guardian is reconciled onto the uniform sentinel `actor://local/guardian` (wire path moved from the non-uniform `/system/guardian`), and the `guardian` id is reserved by the address factory so no user actor can claim it.

**Breaking:** the exported `ActorAddress` / `ActorWebActorAddress` types are now branded strings (read `address` directly instead of `address.path`; use `parse(address)` for `id`/`kind`/`node`); `directory.listByType(...)` is replaced by `directory.find(query)`; and the guardian wire path changed to `actor://local/guardian`. All nodes in a cluster must upgrade together.
