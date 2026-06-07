import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import '@shikijs/vitepress-twoslash/style.css';
import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import './tokens.css';

// Extend the default VitePress theme: token-driven design system (tokens.css)
// plus the Twoslash hover plugin for type-checked code samples.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.use(TwoslashFloatingVue);
  },
} satisfies Theme;
