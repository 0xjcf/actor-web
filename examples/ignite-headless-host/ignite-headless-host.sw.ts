/// <reference lib="webworker" />

import { startLogisticsServiceWorkerRuntime } from './worker-runtime';

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

startLogisticsServiceWorkerRuntime();
