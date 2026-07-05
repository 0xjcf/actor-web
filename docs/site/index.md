---
layout: home

hero:
  name: Actor-Web
  text: Pure actor model for the web
  tagline: Location-transparent actors for local and directly connected runtime nodes; dynamic membership and production multi-machine transport remain in progress.
  actions:
    - theme: brand
      text: What is Actor-Web?
      link: /overview/what-is-actor-web
    - theme: alt
      text: Your first actor
      link: /getting-started/your-first-actor
    - theme: alt
      text: Transport status
      link: https://github.com/0xjcf/actor-web/blob/main/docs/spikes/actor-web-external-transport-design.md

features:
  - title: Actors, not call stacks
    details: Behaviors handle one message at a time over isolated state. No shared mutable state, no race conditions by construction.
  - title: Topology-declared runtime
    details: Declare nodes, actors, supervisors, and subscriptions once. The runtime owns placement, lifecycle, and inter-actor event wiring — re-established on every start.
  - title: Type-safe messages & events
    details: Message and event unions flow from defineBehavior through the topology to your UI sources — checked end to end.
---
