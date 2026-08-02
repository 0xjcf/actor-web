export const PUBLISHABLE_LEARNING_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.png',
  '.svg',
  '.webp',
]);

export const REQUIRED_LEARNING_PAGES = [
  'index.html',
  'week-01-javascript-event-loop-and-actor-mailboxes.html',
  'guide/01-javascript-concurrency-and-mailboxes.html',
  'workbook/01-javascript-concurrency-and-mailboxes.html',
  'labs/week-01-event-loop-and-mailbox.html',
];

export const ACTOR_WEB_DOCS_ORIGIN = 'https://0xjcf.github.io/actor-web/';

export const REQUIRED_LEARNING_ROUTES = REQUIRED_LEARNING_PAGES.map((page) =>
  page === 'index.html' ? 'learning/' : `learning/${page}`
);
