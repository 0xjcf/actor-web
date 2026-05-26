import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createLogisticsRuntimeGatewayServer } from '../examples/ignite-headless-host/server-runtime-gateway';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examplesDir = path.resolve(rootDir, 'examples');
const viteConfig = path.resolve(examplesDir, 'vite.config.ts');
const defaultPort = 4173;

const host = process.env.HOST ?? '127.0.0.1';
const lifecycleMode = process.env.LIFECYCLE_MODE === 'manual' ? 'manual' : 'simulation';

function resolvePort(rawPort: string | undefined): number {
  if (rawPort === undefined) {
    return defaultPort;
  }

  const trimmedPort = rawPort.trim();
  if (!/^\d+$/.test(trimmedPort)) {
    console.warn(
      `Invalid PORT value "${rawPort}". Falling back to ${defaultPort} for the logistics demo server.`
    );
    return defaultPort;
  }

  const parsedPort = Number(trimmedPort);
  if (Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535) {
    return parsedPort;
  }

  console.warn(
    `Invalid PORT value "${rawPort}". Falling back to ${defaultPort} for the logistics demo server.`
  );
  return defaultPort;
}

const port = resolvePort(process.env.PORT);

const gateway = createLogisticsRuntimeGatewayServer({ host, lifecycleMode });
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
const providerUrl = new URL('/ignite-headless-host/provider.html', localUrl).toString();

console.log('\nActor-Web Logistics Control Tower');
console.log(`  UI:        ${pageUrl}`);
console.log(`  Provider:  ${providerUrl}`);
console.log(`  REST:      ${restUrl}`);
console.log(`  Gateway:   ${gatewayUrl}`);
console.log(`  Transport: ${transportUrl}`);
console.log(`  Mode:      ${lifecycleMode}`);
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
