import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTOR_WEB_DOCS_ORIGIN,
  PUBLISHABLE_LEARNING_EXTENSIONS,
  REQUIRED_LEARNING_PAGES,
  REQUIRED_LEARNING_ROUTES,
} from './learning-publication-contract.mjs';

const docsSiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learningSource = resolve(docsSiteRoot, '../learning');
const siteTarget = resolve(docsSiteRoot, '.vitepress/dist');
const learningTarget = resolve(siteTarget, 'learning');
const sitemapTarget = resolve(siteTarget, 'sitemap.xml');
for (const page of REQUIRED_LEARNING_PAGES) {
  if (!existsSync(resolve(learningSource, page))) {
    throw new Error(`Required learning page is missing: ${resolve(learningSource, page)}`);
  }
}

rmSync(learningTarget, { force: true, recursive: true });
mkdirSync(dirname(learningTarget), { recursive: true });
cpSync(learningSource, learningTarget, {
  recursive: true,
  filter(source) {
    return statSync(source).isDirectory() || PUBLISHABLE_LEARNING_EXTENSIONS.has(extname(source));
  },
});

for (const page of REQUIRED_LEARNING_PAGES) {
  if (!existsSync(resolve(learningTarget, page))) {
    throw new Error(`Learning page was not copied into the Pages artifact: ${page}`);
  }
}

if (!existsSync(sitemapTarget)) {
  throw new Error(`VitePress sitemap is missing: ${sitemapTarget}`);
}

let sitemap = readFileSync(sitemapTarget, 'utf8');
const missingSitemapEntries = REQUIRED_LEARNING_ROUTES.map(
  (route) => new URL(route, ACTOR_WEB_DOCS_ORIGIN).href
).filter((location) => !sitemap.includes(`<loc>${location}</loc>`));
if (missingSitemapEntries.length > 0) {
  const entries = missingSitemapEntries
    .map((location) => `<url><loc>${location}</loc></url>`)
    .join('');
  if (!sitemap.includes('</urlset>')) {
    throw new Error(`VitePress sitemap has no closing urlset element: ${sitemapTarget}`);
  }
  sitemap = sitemap.replace('</urlset>', `${entries}</urlset>`);
  writeFileSync(sitemapTarget, sitemap);
}

for (const route of REQUIRED_LEARNING_ROUTES) {
  const location = new URL(route, ACTOR_WEB_DOCS_ORIGIN).href;
  if (!sitemap.includes(`<loc>${location}</loc>`)) {
    throw new Error(`Learning route was not added to the sitemap: ${location}`);
  }
}

console.log(
  `Published Actor-Web Learning to ${learningTarget} with ${REQUIRED_LEARNING_ROUTES.length} sitemap routes`
);
