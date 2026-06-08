#!/usr/bin/env node
/**
 * Docs theme contrast guardrail (VitePress).
 *
 * Renders the BUILT docs site (docs/site/.vitepress/dist) in headless Chromium,
 * in both the dark and light themes, and computes the WCAG contrast ratio for key
 * chrome (appearance toggle, search) and content (nav, sidebar, outline, inline
 * code, links, custom-block tips). Fails when any element is below threshold:
 *   - UI controls:  >= 3:1
 *   - text/content: >= 4.5:1
 *
 * It renders the real page so it catches un-themed defaults a token-only check
 * would miss. The contrast math composites alpha over the nearest opaque backdrop
 * so translucent fills (inline code, custom blocks) are measured as they render.
 *
 * Usage:
 *   node scripts/check-contrast.mjs          # expects .vitepress/dist to exist
 *   pnpm check:contrast   (build first)      # see package.json
 */

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE_ROOT = fileURLToPath(new URL('..', import.meta.url)); // docs/site
const DIST = join(SITE_ROOT, '.vitepress', 'dist');
const BASE = ''; // VitePress `base` is '/' (no prefix) until deploy sets one

const UI = 3; // WCAG AA for UI components / large text
const TEXT = 4.5; // WCAG AA for body text

// selector -> { sel, min }. Absent selectors on a page are skipped.
const SELECTORS = {
  appearanceToggle: { sel: '.VPSwitchAppearance', min: UI },
  searchButton: { sel: '.VPNavBarSearch button', min: UI },
  navLink: { sel: '.VPNavBarMenuLink', min: TEXT },
  sidebarLink: { sel: '.VPSidebar a', min: TEXT },
  outlineLink: { sel: '.VPDocAsideOutline a', min: TEXT },
  inlineCode: { sel: '.vp-doc :not(pre) > code', min: TEXT },
  docLink: { sel: '.vp-doc a', min: TEXT },
  tipBlock: { sel: '.vp-doc .custom-block.tip p', min: TEXT },
};

// Pages chosen to cover every selector at least once across both themes.
const PAGES = ['/', '/getting-started/your-first-actor', '/concepts/subscriptions-and-events'];
const THEMES = ['dark', 'light'];

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

/** Minimal static file server for the built site. */
function startServer() {
  const server = createServer(async (req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (BASE && urlPath.startsWith(BASE)) urlPath = urlPath.slice(BASE.length);
      if (!urlPath || urlPath === '/') urlPath = '/index.html';
      let filePath = normalize(join(DIST, urlPath));
      if (!filePath.startsWith(DIST)) {
        res.writeHead(403).end('forbidden');
        return;
      }
      let info = await stat(filePath).catch(() => null);
      if (info?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        info = await stat(filePath).catch(() => null);
      }
      if (!info && !extname(filePath)) {
        filePath = `${filePath}.html`;
        info = await stat(filePath).catch(() => null);
      }
      if (!info) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, {
        'content-type': MIME[extname(filePath)] || 'application/octet-stream',
      });
      res.end(body);
    } catch {
      res.writeHead(500).end('error');
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

/** Runs in the page: alpha-aware WCAG contrast ratio per selector. */
function auditInPage(selectorMap) {
  const parse = (s) => {
    const m = (s.match(/[\d.]+/g) || [0, 0, 0, 1]).map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  });
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const solidBg = (el) => {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c.a === 1) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255 };
  };
  const ratio = (el) => {
    const cs = getComputedStyle(el);
    const back = solidBg(el);
    const fg = over(parse(cs.color), back);
    const ownBg = parse(cs.backgroundColor);
    const effBg = ownBg.a < 1 ? over(ownBg, back) : ownBg;
    const hi = Math.max(lum(fg), lum(effBg));
    const lo = Math.min(lum(fg), lum(effBg));
    return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
  };
  const out = {};
  for (const [key, sel] of Object.entries(selectorMap)) {
    const el = document.querySelector(sel);
    out[key] = el ? ratio(el) : null;
  }
  return out;
}

async function main() {
  if (!(await stat(DIST).catch(() => null))) {
    console.error(`[contrast] No build found at ${DIST}. Run \`vitepress build\` first.`);
    process.exit(2);
  }

  const { server, port } = await startServer();
  const origin = `http://127.0.0.1:${port}${BASE}`;
  const browser = await chromium.launch();
  const failures = [];
  const rows = [];

  try {
    for (const theme of THEMES) {
      const context = await browser.newContext();
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('vitepress-theme-appearance', t);
        } catch {}
      }, theme);
      const page = await context.newPage();

      for (const path of PAGES) {
        await page.goto(`${origin}${path}`, { waitUntil: 'load' });
        const selMap = Object.fromEntries(Object.entries(SELECTORS).map(([k, v]) => [k, v.sel]));
        const got = await page.evaluate(auditInPage, selMap);
        for (const [key, value] of Object.entries(got)) {
          if (value == null) continue; // selector absent on this page
          const min = SELECTORS[key].min;
          const ok = value >= min;
          rows.push({ theme, path, key, value, min, ok });
          if (!ok) failures.push({ theme, path, key, value, min });
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('\nDocs theme contrast guardrail (VitePress)');
  console.log('─'.repeat(72));
  for (const r of rows) {
    const mark = r.ok ? '✓' : '✗';
    console.log(
      `${mark} ${r.theme.padEnd(5)} ${r.key.padEnd(16)} ${String(r.value).padStart(6)} (min ${r.min})  ${r.path}`
    );
  }
  console.log('─'.repeat(72));

  if (failures.length) {
    console.error(`\n✗ ${failures.length} contrast failure(s) below threshold:`);
    for (const f of failures) {
      console.error(`  - [${f.theme}] ${f.key} = ${f.value}:1 (needs ${f.min}:1) on ${f.path}`);
    }
    console.error(
      '\nDrive the element from the theme tokens (--vp-c-*) so it inherits AA contrast in both themes.'
    );
    process.exit(1);
  }

  if (rows.length === 0) {
    console.error('[contrast] No selectors matched on any page — check selectors/pages.');
    process.exit(2);
  }

  console.log(`\n✓ All ${rows.length} contrast checks pass AA in both themes.`);
}

main().catch((err) => {
  console.error('[contrast] unexpected error:', err);
  process.exit(2);
});
