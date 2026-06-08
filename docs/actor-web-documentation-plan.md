# Actor-Web Documentation Plan

## Summary

Actor-Web has strong raw material — design docs, two real examples, and a
comprehensive `@actor-web/runtime` README — but no navigable, learning-oriented
documentation site. A newcomer (or a returning maintainer) has no front door.

This plan establishes a **VitePress** documentation site in a dedicated
`docs/site/` workspace package, modeled on the information architecture proven by
`ignite-element` (Astro + Starlight there; VitePress here by choice — lighter,
Vite-native, consistent with the examples build). The effort is mostly **porting
existing decision-oriented docs into learning-oriented pages**, not writing from
scratch.

First delivery is a **walking skeleton**: scaffold the site and navigation, port
Overview + Getting Started + one Concept page (Subscriptions & events, tied to
in-flight work), and wire the typechecked-code-sample guardrail. Remaining
sections fill in afterward.

## Decisions (locked)

- **Tooling**: VitePress, in a `docs/site/` pnpm workspace package.
- **First pass**: walking skeleton (scaffold + nav + 3 seed pages + sample
  typecheck), not the full site.
- **Process**: this plan first, then FAS planning. No scaffolding yet.
- **Design system**: distinct accent on a shared architecture — mirror
  ignite-element's token system (dark-first, radius scale, both-theme coverage,
  WCAG AA contrast CI), but with actor-web's **own accent** (leading candidate:
  amber `#f5a623`), not ignite-element's cyan. See *Design system* below.
- **A11y guardrail**: port ignite-element's Playwright contrast check into CI.

## Reference model: ignite-element

`ignite-element` runs a mature docs site we mirror structurally (not toolwise):

- Dedicated workspace package (`docs/site/`) with its own `package.json` and root
  shortcuts (`pnpm docs:dev` / `docs:build` / `preview`).
- Sections: Overview → Getting Started → Concepts → API → Guides → Migration →
  Community.
- Guardrails: `check-doc-examples.mjs` typechecks every code fence against the
  **real** package types (drift protection with a known-failure baseline);
  markdown lint; a11y/contrast check in CI.
- **ADRs/spikes stay unpublished in `docs/`**; only learning-oriented content
  lives in the published site. We adopt the same separation.

What we deliberately differ on: VitePress instead of Astro + Starlight. Tradeoff:
no shared config/scripts with ignite-element, but lighter setup and a Vite stack
that matches `examples/`. Versioning and an llms-txt export are deferred (see
Open Questions).

## Current state (verified)

- **No site generator** today — loose markdown under `docs/`.
- `docs/API.md` is partial (~100 lines) against a large export surface.
- Design docs are current and well-written but **decision-oriented**
  (`actor-web-topology-source-dx-design.md`,
  `actor-web-xstate-transition-dx-design.md`,
  `actor-web-declarative-subscriptions-design.md`, multi-process demo design,
  ADR-003 spikes).
- `packages/actor-core-runtime/README.md` is comprehensive (OTP patterns,
  testing, principles) — prime Concepts/Guides seed.
- `packages/actor-core-testing/README.md` is **missing**.
- Two strong examples seed tutorials:
  `examples/fas-agent-loop/*`, `examples/ignite-headless-host/*`.
- pnpm monorepo (`pnpm-workspace.yaml`); packages `@actor-web/runtime`,
  `@actor-web/testing`, `@actor-web/cli`.
- Public entry points (`packages/actor-core-runtime/package.json` `exports`):
  `.`, `./browser`, `./topology`, `./node`.

## Goals

- A single navigable site a newcomer can onboard from end to end.
- Learning-oriented pages (concepts + how-to), separate from internal ADRs/spikes.
- Code samples that **cannot silently drift** from the real API.
- Reuse existing material wherever possible; net-new writing only where there is
  a genuine gap (Getting Started, API reference fill-in, testing README).

## Non-goals

- Not rewriting the design docs/ADRs — they remain the internal record.
- Not versioned docs in the first pass (actor-web is pre-1.0).
- Not a *fully custom* VitePress theme (no replaced layout); the design system is
  delivered as token overrides + minimal theme extension on the default theme.
- Not a shared/extracted design-token package across repos in the first pass;
  tokens are site-local (as in ignite-element), revisit extraction later.
- Not auto-generated API docs (e.g. TypeDoc) in the first pass — hand-authored
  reference seeded from the export inventory; revisit automation later.

## Tooling

- **VitePress** site at `docs/site/`, added to `pnpm-workspace.yaml`.
- `docs/site/package.json` scripts: `dev` / `build` / `preview`; root shortcuts
  `docs:dev` / `docs:build` / `docs:preview`.
- **Typechecked samples** via `@shikijs/vitepress-twoslash` — the VitePress-native
  equivalent of ignite-element's `check-doc-examples.mjs`. Twoslash compiles
  fenced TS against the real `@actor-web/runtime` types at build time, surfaces
  hover types, and fails the build on drift. Fences opt out with a `twoslash`
  off-marker where a sample is intentionally partial.
- **markdownlint** — already configured (`.markdownlint.jsonc`,
  `lint:md`/`format:md`); extend coverage to `docs/site/`.
- Deployment target: GitHub Pages (confirm in Open Questions); set VitePress
  `base` accordingly.
- **Design system**: `.vitepress/theme/tokens.css` as the single source of truth
  for tokens, registered via a theme extension (`.vitepress/theme/index.ts` with
  `extends: DefaultTheme`). See *Design system*.
- **Contrast/a11y CI**: `docs/site/scripts/check-contrast.mjs` (ported from
  ignite-element) + a workflow gating PRs that touch `docs/site/**`.

## Design system

Mirror ignite-element's *architecture and discipline*; differ in *identity*. The
two sibling sites should read as a family of equal craft, not as the same
product — so actor-web gets its own accent while sharing the structural system.

### Principles (from ignite-element, adopted)

- **Token-driven, dark-first.** Every token defined for both `:root` (dark base)
  and `.dark`-vs-light so nothing falls through to un-themed VitePress defaults.
- **Component rules read from `var(--vp-*)` / custom tokens**, never hardcoded
  hex.
- **Shared 3-step radius scale**: `--radius-sm: 6px`, `--radius-md: 8px`,
  `--radius-lg: 12px`.
- **Shared dark background** `#0d1324` and slate text ramp; only the accent hue
  diverges.

### Token mapping (Starlight → VitePress)

| ignite-element (`--sl-*`) | actor-web (`--vp-*` / custom) |
|---|---|
| `--sl-color-accent` | `--vp-c-brand-1` |
| accent-high | `--vp-c-brand-2` |
| accent-low | `--vp-c-brand-soft` / `--brand-low` |
| `--sl-color-bg` / `--panel` | `--vp-c-bg` / `--vp-c-bg-alt` / `--vp-c-bg-soft` |
| `--sl-color-text` / `-soft` | `--vp-c-text-1` / `-2` / `-3` |
| `--sl-color-hairline` | `--vp-c-divider` |
| `--radius-*` | `--radius-*` (same names) |
| logo light/dark | `themeConfig.logo` |

### Accent (proposed)

Leading candidate **Amber** (recommended), with two alternatives. All checked
dark-first against the shared `--vp-c-bg: #0d1324`.

| Candidate | brand-1 | brand-2 (hover/links) | brand-low | on-accent ink | Contrast on `#0d1324` |
|---|---|---|---|---|---|
| **Amber (recommended)** | `#f5a623` | `#ffc15c` | `#3a2a0d` | `#1a1204` | ~8.9:1 |
| Violet | `#7c5cff` | `#a78bfa` | `#1e1640` | `#0b0a1a` | 4.1:1 UI; links use brand-2 (6.6:1) |
| Emerald | `#34d399` | `#6ee7b7` | `#0c2f24` | `#04140d` | ~9.4:1 |

Amber maximizes distinction from ignite-element's cyan and has the most WCAG
headroom. Final hue is a sign-off item; the token architecture is identical
regardless of which accent wins.

### Accessibility guardrail (ported)

Port `check-contrast.mjs`: render the built VitePress site in Playwright
Chromium, assert WCAG AA in **both** themes — ≥3:1 for UI/large, ≥4.5:1 for body
text — across nav, sidebar, TOC, inline code, links, and callouts; plus a
geometry check that interactive controls use the `--radius-*` tokens and have
non-zero padding. Selectors are retargeted to VitePress DOM
(`.VPNav`, `.VPSidebar`, `.vp-doc a`, `.vp-doc :not(pre) > code`, custom blocks).
Run in CI on PRs touching `docs/site/**`.

## Information architecture

Sidebar/nav (VitePress `themeConfig.sidebar`). **Seeded from** notes which
existing source each page is ported/refactored from; **net-new** marks pages
written fresh.

- **Overview**
  - What is Actor-Web? — *seeded from* root README, runtime README
  - Why the actor model / core principles — *seeded from* runtime README
- **Getting Started**
  - Installation — *net-new (small)*
  - Your first actor (counter) — *net-new*
  - Topology + local runtime — *net-new*, references `startActorWebLocalRuntime`
- **Concepts**
  - Actors & behaviors (`defineActor`) — *seeded from* runtime README,
    xstate design doc
  - Messages: `send` / `ask` / `emit` / `MessagePlan` — *seeded from* runtime
    README, message-plan source
  - State: context & xstate FSM integration — *seeded from*
    `actor-web-xstate-transition-dx-design.md`
  - Topology, nodes, supervisors — *seeded from*
    `actor-web-topology-source-dx-design.md`
  - Supervision & fault tolerance — *seeded from* runtime README
  - **Subscriptions & events** — *seeded from*
    `actor-web-declarative-subscriptions-design.md` (published view of in-flight
    work)
  - Sources & the gateway (`readModel` / `commandSource`) — *seeded from*
    topology design doc, `docs/examples/ignite-element-host.md`
  - Tools (functional core / imperative shell) — *seeded from* runtime README
  - Transport & multi-node — *seeded from*
    `actor-web-multi-process-deployment-demo-design.md`,
    `spikes/actor-web-external-transport-design.md`
- **API Reference**
  - `@actor-web/runtime` (`.`) — *seeded from* `API.md` + export inventory
  - `@actor-web/runtime/topology` — topology DSL (`actor`/`node`/`supervisor`/
    `tool`, `defineActorWebTopology`)
  - `@actor-web/runtime/browser` — sources/clients
  - `@actor-web/runtime/node` — `serveActorWebNode`, HTTP ingress
  - `@actor-web/testing` — *net-new* (also add the missing package README)
- **Guides**
  - Ignite Element integration — *seeded from*
    `docs/examples/ignite-element-host.md`, north-star doc
  - xstate transitions (how-to) — *seeded from* xstate design doc
  - Multi-process deployment — *seeded from* demo design + logistics example
  - Coordinating actors (choreography via emit) — *seeded from* subscriptions
    design doc
  - Testing actors — *seeded from* runtime README testing section
- **Operations**
  - Production operations — *seeded from*
    `docs/operations/actor-web-production-operations.md`
- **Community**
  - Support & links — *net-new (tiny)*

Internal docs (ADRs, spikes, design docs) remain under `docs/` and are **not**
in the site nav. Optionally add a single published "Design docs & ADRs" link out
for contributors.

## Walking-skeleton scope (first FAS task)

Deliver and verify end to end:

1. Scaffold `docs/site/` VitePress package; add to `pnpm-workspace.yaml`; root
   `docs:*` scripts.
2. Establish the **design system**: `.vitepress/theme/tokens.css` (dark-first,
   both themes, radius scale) + theme extension; apply the chosen accent
   (default amber) and shared bg/text ramp.
3. Configure nav/sidebar with the full IA above (pages can be stubs).
4. Author three real pages:
   - Overview → What is Actor-Web?
   - Getting Started → Your first actor (counter)
   - Concepts → Subscriptions & events (ties to current work)
5. Wire `@shikijs/vitepress-twoslash`; make the counter sample typecheck against
   real types; `docs:build` fails on drift.
6. Port the **contrast/a11y guardrail** (`check-contrast.mjs`) + CI workflow;
   the three seed pages pass WCAG AA in both themes.
7. Extend markdownlint to `docs/site/`.
8. `docs:dev` runs locally; `docs:build` + contrast check succeed in CI.

This proves tooling + guardrail + IA before bulk content is written.

## FAS task breakdown (proposed sequencing)

Each is a separate task/commit through the FAS pipeline.

- **D1. Scaffold + walking skeleton** (scope above) — includes the design-system
  tokens (chosen accent), twoslash typecheck, and the contrast/a11y CI guardrail.
  Establishes the site and its visual system together so later content inherits
  both. If D1 proves large, split D1b = contrast guardrail + CI as a fast follow.
- **D2. Concepts section** — port the remaining concept pages from design docs +
  runtime README.
- **D3. API Reference** — expand `API.md` into per-entry-point reference; add
  `@actor-web/testing` README + page.
- **D4. Guides** — port integration/xstate/multi-process/testing guides from
  design docs + examples.
- **D5. Getting Started completion + Operations + Community** — finish tutorials,
  port the ops runbook, add community page.
- **D6. (optional) Deploy** — GitHub Pages workflow; decide versioning/llms-txt.

D1 is independent and unblocks the rest. D2–D5 can run in parallel once D1 lands,
since each section seeds from distinct sources.

## Risks and mitigations

- **Doc drift** — mitigated by twoslash typechecking samples against real types
  (the single most important guardrail; do not defer past D1).
- **Decision-docs leaking into learning-docs** — keep ADRs/spikes out of nav;
  reframe ported content from "why we decided" to "how to use."
- **API reference rot** — hand-authored first; if it proves hard to maintain,
  evaluate TypeDoc generation in a later task.
- **Scope creep** — the walking skeleton intentionally ships 3 pages, not the
  whole site, to validate the setup cheaply.

## Open questions

- **Deployment**: GitHub Pages (matching ignite-element) vs. another host? Sets
  the VitePress `base`.
- **Versioning**: defer until 1.0, or stand up VitePress multi-version early?
  Leaning defer.
- **llms-txt**: ignite-element exports an LLM-friendly bundle (useful for FAS
  agents). Add a VitePress equivalent now or later? Leaning later.
- **Examples placement**: keep `examples/` as runnable code and link from docs,
  or also embed snippets via twoslash imports? Leaning link + selective embed.
- **Monorepo placement**: `docs/site/` (recommended, matches ignite-element) vs.
  a top-level `site/`. Leaning `docs/site/`.
- **Accent sign-off**: amber `#f5a623` (recommended) vs. violet/emerald
  alternatives. Architecture is identical regardless; only the hue tokens change.
- **Shared token package**: keep tokens site-local now; revisit extracting a
  shared `packages/design-tokens` consumed by both sites once both stabilize.
