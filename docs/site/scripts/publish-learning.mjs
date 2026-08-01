import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLISHABLE_LEARNING_EXTENSIONS,
  REQUIRED_LEARNING_PAGES,
} from './learning-publication-contract.mjs';

const docsSiteRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const learningSource = resolve(docsSiteRoot, '../learning');
const learningTarget = resolve(docsSiteRoot, '.vitepress/dist/learning');
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

console.log(`Published Actor-Web Learning to ${learningTarget}`);
