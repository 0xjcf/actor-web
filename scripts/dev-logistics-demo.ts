import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createLogisticsRuntimeGatewayServer } from '../examples/ignite-headless-host/server-runtime-gateway';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.resolve(rootDir, 'examples');
const viteConfig = path.resolve(examplesDir, 'vite.config.ts');

const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '4173', 10);

const gateway = createLogisticsRuntimeGatewayServer({ host });
await gateway.start();

const restUrl = gateway.getRestUrl();
const gatewayUrl = gateway.getGatewayUrl();
const transportUrl = gateway.getTransportUrl();

if (!restUrl || !gatewayUrl || !transportUrl) {
  await gateway.stop();
  throw new Error('Logistics gateway did not expose REST, gateway, and transport URLs.');
}

process.env.VITE_ACTOR_WEB_REST_URL = restUrl;
process.env.VITE_ACTOR_WEB_GATEWAY_URL = gatewayUrl;
process.env.VITE_ACTOR_WEB_TRANSPORT_URL = transportUrl;

const vite = await createViteServer({
  configFile: viteConfig,
  root: examplesDir,
  clearScreen: false,
  server: {
    host,
    port,
  },
});

await vite.listen();

const localUrl = vite.resolvedUrls?.local[0] ?? `http://${host}:${port}/`;
const pageUrl = new URL('/ignite-headless-host/', localUrl).toString();

console.log('\nActor-Web Logistics Control Tower');
console.log(`  UI:        ${pageUrl}`);
console.log(`  REST:      ${restUrl}`);
console.log(`  Gateway:   ${gatewayUrl}`);
console.log(`  Transport: ${transportUrl}`);
console.log('\nOpen DevTools Network and filter by Fetch/XHR and WS.');
vite.printUrls();

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  await Promise.allSettled([vite.close(), gateway.stop()]);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void stop().finally(() => {
      process.exit(0);
    });
  });
}
