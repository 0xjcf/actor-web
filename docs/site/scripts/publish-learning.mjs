import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const docsSiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learningSource = resolve(docsSiteRoot, '../learning');
const learningTarget = resolve(docsSiteRoot, '.vitepress/dist/learning');
const publishableExtensions = new Set(['.css', '.html', '.js', '.json', '.png', '.svg', '.webp']);
const requiredPages = [
  'index.html',
  'week-01-javascript-event-loop-and-actor-mailboxes.html',
  'guide/01-javascript-concurrency-and-mailboxes.html',
  'workbook/01-javascript-concurrency-and-mailboxes.html',
  'labs/week-01-event-loop-and-mailbox.html',
];

for (const page of requiredPages) {
  if (!existsSync(resolve(learningSource, page))) {
    throw new Error(`Required learning page is missing: ${resolve(learningSource, page)}`);
  }
}

rmSync(learningTarget, { force: true, recursive: true });
mkdirSync(dirname(learningTarget), { recursive: true });
cpSync(learningSource, learningTarget, {
  recursive: true,
  filter(source) {
    return statSync(source).isDirectory() || publishableExtensions.has(extname(source));
  },
});

for (const page of requiredPages) {
  if (!existsSync(resolve(learningTarget, page))) {
    throw new Error(`Learning page was not copied into the Pages artifact: ${page}`);
  }
}

console.log(`Published Actor-Web Learning to ${learningTarget}`);
