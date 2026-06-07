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
  // Deployment base (e.g. GitHub Pages "/actor-web/") is decided in docs task D6.
  markdown: {
    // Typecheck every ```ts twoslash fence against the real @actor-core/runtime
    // types at build time — drift breaks the build.
    codeTransformers: [transformerTwoslash()],
  },
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/overview/what-is-actor-web' },
      { text: 'Getting Started', link: '/getting-started/your-first-actor' },
      { text: 'Concepts', link: '/concepts/subscriptions-and-events' },
    ],
    sidebar: [
      {
        text: 'Overview',
        items: [{ text: 'What is Actor-Web?', link: '/overview/what-is-actor-web' }],
      },
      {
        text: 'Getting Started',
        items: [{ text: 'Your first actor', link: '/getting-started/your-first-actor' }],
      },
      {
        text: 'Concepts',
        items: [{ text: 'Subscriptions & events', link: '/concepts/subscriptions-and-events' }],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/0xjcf/actor-web' }],
    search: { provider: 'local' },
  },
});
