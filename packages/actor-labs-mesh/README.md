# @actor-web/labs-mesh

Experimental mesh membership, directory propagation, and next-hop routing for
Actor-Web runtimes.

`@actor-web/labs-mesh` is an optional overlay above `@actor-web/runtime`. It
keeps transports single-hop while giving runtime hosts deterministic mesh
building blocks for:

- SWIM-style membership records with incarnation ordering
- anti-entropy directory propagation for actor ownership
- next-hop route selection through the existing `RemoteMessageRouter` seam

This package owns reachability. It does not own lattice artifacts, workflow
semantics, transport media, or cross-node supervision.
