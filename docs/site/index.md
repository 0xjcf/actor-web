---
layout: home

hero:
  name: Actor-Web
  text: Pure actor model for the web
  tagline: Location-transparent actors for JavaScript/TypeScript, inspired by Erlang/OTP.
  actions:
    - theme: brand
      text: What is Actor-Web?
      link: /overview/what-is-actor-web
    - theme: alt
      text: Your first actor
      link: /getting-started/your-first-actor

features:
  - title: Actors, not call stacks
    details: Behaviors handle one message at a time over isolated state. No shared mutable state, no race conditions by construction.
  - title: Topology-declared runtime
    details: Declare nodes, actors, and supervisors once. The runtime owns placement, lifecycle, and (soon) inter-actor subscriptions.
  - title: Type-safe messages & events
    details: Message and event unions flow from defineBehavior through the topology to your UI sources — checked end to end.
---
