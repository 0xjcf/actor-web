/// <reference lib="webworker" />

import { startCheckoutServiceWorkerRuntime } from './worker-runtime';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

startCheckoutServiceWorkerRuntime();
