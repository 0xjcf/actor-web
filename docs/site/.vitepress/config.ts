import { transformerTwoslash } from '@shikijs/vitepress-twoslash';
import { defineConfig } from 'vitepress';

// Information architecture mirrors docs/actor-web-documentation-plan.md.
// Sections beyond the three seed pages are stubbed in later docs tasks (D2-D6).
export default defineConfig({
  title: 'Actor-Web',
  description:
    'Pure actor model for JavaScript/TypeScript — location-transparent actors, inspired by Erlang/OTP.',
  cleanUrls: true,
  lastUpdated: true,
  // GitHub Pages project site: deployed by .github/workflows/docs.yml to
  // https://0xjcf.github.io/actor-web/ — base must match the repo subpath.
  base: '/actor-web/',
  sitemap: {
    hostname: 'https://0xjcf.github.io/actor-web/',
  },
  markdown: {
    // Typecheck every ```ts twoslash fence against the real @actor-web/runtime
    // types at build time — drift breaks the build.
    codeTransformers: [transformerTwoslash()],
  },
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/overview/what-is-actor-web' },
      { text: 'Getting Started', link: '/getting-started/your-first-actor' },
      { text: 'Concepts', link: '/concepts/actors-and-behaviors' },
      { text: 'Guides', link: '/guides/ignite-element' },
      { text: 'API', link: '/api/' },
      { text: 'Community', link: '/community' },
    ],
    sidebar: [
      {
        text: 'Overview',
        items: [{ text: 'What is Actor-Web?', link: '/overview/what-is-actor-web' }],
      },
      {
        text: 'Getting Started',
        items: [
          { text: 'Installation', link: '/getting-started/installation' },
          { text: 'Your first actor', link: '/getting-started/your-first-actor' },
          { text: 'Topology & local runtime', link: '/getting-started/topology-and-runtime' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Actors & behaviors', link: '/concepts/actors-and-behaviors' },
          { text: 'Messages — send, ask, emit', link: '/concepts/messages' },
          { text: 'State & machines', link: '/concepts/state-and-machines' },
          { text: 'Subscriptions & events', link: '/concepts/subscriptions-and-events' },
          { text: 'Topology, nodes & supervisors', link: '/concepts/topology' },
          { text: 'Supervision & fault tolerance', link: '/concepts/supervision' },
          { text: 'Sources & the gateway', link: '/concepts/sources-and-gateway' },
          { text: 'Tools', link: '/concepts/tools' },
          { text: 'Transport & multi-node', link: '/concepts/transport' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Ignite Element integration', link: '/guides/ignite-element' },
          { text: 'Headless agent runtime', link: '/guides/agent-runtime' },
          { text: 'Using XState machines', link: '/guides/xstate-transitions' },
          { text: 'Coordinating actors', link: '/guides/coordinating-actors' },
          { text: 'Multi-process deployment', link: '/guides/multi-process-deployment' },
          { text: 'Testing actors', link: '/guides/testing-actors' },
        ],
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/api/' },
          { text: 'defineBehavior', link: '/api/define-behavior' },
          { text: 'Topology', link: '/api/topology' },
          { text: 'Runtimes', link: '/api/runtimes' },
          { text: '@actor-web/testing', link: '/api/testing' },
        ],
      },
      {
        text: 'Operations',
        items: [{ text: 'Production operations', link: '/operations/production' }],
      },
      {
        text: 'Community',
        items: [{ text: 'Community & support', link: '/community' }],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/0xjcf/actor-web' }],
    search: { provider: 'local' },
  },
});
