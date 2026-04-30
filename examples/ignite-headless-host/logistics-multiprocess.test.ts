import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface LogisticsServerReadyPayload {
  readonly restUrl: string;
  readonly gatewayUrl: string;
  readonly transportUrl: string;
  readonly lifecycleMode: 'manual' | 'simulation';
}

interface LogisticsWorkerReadyPayload {
  readonly nodeAddress: string;
  readonly serverTransportUrl: string;
  readonly connectedNodes: readonly string[];
}

interface LogisticsProviderReadyPayload {
  readonly nodeAddress: string;
  readonly serverTransportUrl: string;
  readonly connectedNodes: readonly string[];
}

interface ManagedProcess {
  readonly name: string;
  readonly child: ChildProcess;
  readonly output: string[];
  buffer: string;
}

const readyProcesses: ManagedProcess[] = [];
const tempDirectories: string[] = [];

describe('logistics multi-process deployment prove-out', () => {
  afterEach(async () => {
    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('routes REST shipments through a worker-owned actor in a separate process', async () => {
    const telemetryDirectory = mkdtempSync(join(tmpdir(), 'actor-web-logistics-telemetry-'));
    tempDirectories.push(telemetryDirectory);
    const serverTelemetryPath = join(telemetryDirectory, 'server-transport.jsonl');
    const workerTelemetryPath = join(telemetryDirectory, 'worker-transport.jsonl');
    const server = spawnExampleProcess(
      'server',
      ['examples/ignite-headless-host/logistics-server-process.ts'],
      {
        ACTOR_WEB_GATEWAY_PORT: '0',
        ACTOR_WEB_REST_PORT: '0',
        ACTOR_WEB_TELEMETRY_JSONL: serverTelemetryPath,
        ACTOR_WEB_TRANSPORT_PORT: '0',
        LOGISTICS_LIFECYCLE_MODE: 'manual',
      }
    );
    readyProcesses.push(server);

    const serverReady = await waitForReadyLine<LogisticsServerReadyPayload>(
      server,
      'LOGISTICS_SERVER_READY '
    );

    const worker = spawnExampleProcess(
      'worker',
      ['examples/ignite-headless-host/logistics-worker-process.ts'],
      {
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: workerTelemetryPath,
      }
    );
    readyProcesses.push(worker);

    const workerReady = await waitForReadyLine<LogisticsWorkerReadyPayload>(
      worker,
      'LOGISTICS_WORKER_READY '
    );
    expect(workerReady).toMatchObject({
      nodeAddress: 'logistics-worker-runtime',
      serverTransportUrl: serverReady.transportUrl,
    });

    await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) => status.transport.workerConnected,
      'Expected server runtime to observe worker process transport connection'
    );

    const response = await fetch(`${serverReady.restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-multiprocess-1001',
        destination: 'Chicago warehouse',
        reference: 'MP-1001',
      }),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      shipmentId: 'shipment-multiprocess-1001',
      status: 'route-assigned',
    });

    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-multiprocess-1001' &&
        shipment.status === 'route-assigned' &&
        shipment.carrier === 'Northline Express',
      'Expected separate worker process to plan and return a route'
    );

    await stopManagedProcess(worker);
    await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        !status.transport.workerConnected &&
        status.transport.workerPeer?.connected === false &&
        status.transport.workerPeerFresh === false,
      'Expected server runtime status to mark stopped worker process disconnected'
    );

    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
    expect(readFileSync(workerTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
  }, 30_000);

  it('routes provider workflow through a separate provider process when enabled', async () => {
    const telemetryDirectory = mkdtempSync(join(tmpdir(), 'actor-web-logistics-provider-'));
    tempDirectories.push(telemetryDirectory);
    const serverTelemetryPath = join(telemetryDirectory, 'server-transport.jsonl');
    const workerTelemetryPath = join(telemetryDirectory, 'worker-transport.jsonl');
    const providerTelemetryPath = join(telemetryDirectory, 'provider-transport.jsonl');
    const server = spawnExampleProcess(
      'server',
      ['examples/ignite-headless-host/logistics-server-process.ts'],
      {
        ACTOR_WEB_GATEWAY_PORT: '0',
        ACTOR_WEB_REST_PORT: '0',
        ACTOR_WEB_TELEMETRY_JSONL: serverTelemetryPath,
        ACTOR_WEB_TRANSPORT_PORT: '0',
        ACTOR_WEB_PROVIDER_RUNTIME_ENABLED: '1',
        ACTOR_WEB_PROVIDER_RUNTIME_SOURCE: 'process',
        LOGISTICS_LIFECYCLE_MODE: 'manual',
      }
    );
    readyProcesses.push(server);

    const serverReady = await waitForReadyLine<LogisticsServerReadyPayload>(
      server,
      'LOGISTICS_SERVER_READY '
    );

    const worker = spawnExampleProcess(
      'worker',
      ['examples/ignite-headless-host/logistics-worker-process.ts'],
      {
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: workerTelemetryPath,
      }
    );
    readyProcesses.push(worker);

    const provider = spawnExampleProcess(
      'provider',
      ['examples/ignite-headless-host/logistics-provider-process.ts'],
      {
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: providerTelemetryPath,
      }
    );
    readyProcesses.push(provider);

    await waitForReadyLine<LogisticsWorkerReadyPayload>(worker, 'LOGISTICS_WORKER_READY ');
    const providerReady = await waitForReadyLine<LogisticsProviderReadyPayload>(
      provider,
      'LOGISTICS_PROVIDER_READY '
    );
    expect(providerReady).toMatchObject({
      nodeAddress: 'logistics-provider-runtime',
      serverTransportUrl: serverReady.transportUrl,
    });

    await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.workerConnected === true &&
        status.transport.providerConnected === true &&
        status.provider?.runtimeEnabled === true &&
        status.provider?.sourceLabel === 'manual UI',
      'Expected server runtime to observe worker and provider process transport connections'
    );

    const response = await fetch(`${serverReady.restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-process-1001',
        destination: 'Chicago warehouse',
        reference: 'PP-1001',
      }),
    });
    expect(response.status).toBe(202);

    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-provider-process-1001' &&
        shipment.status === 'route-assigned' &&
        shipment.providerSignal == null,
      'Expected provider-enabled manual mode to preserve the existing manual queue stop'
    );

    const labelResponse = await fetch(`${serverReady.restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-process-1001',
        signal: 'LABEL_SCANNED',
      }),
    });
    expect(labelResponse.status).toBe(202);

    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-provider-process-1001' &&
        shipment.providerSignal === 'LABEL_SCANNED' &&
        shipment.timeline?.[0]?.source === 'manual UI',
      'Expected provider process to own provider-specific signal workflow while preserving manual UI labeling'
    );

    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
    expect(readFileSync(workerTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
    expect(readFileSync(providerTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
  }, 30_000);
});

function spawnExampleProcess(
  name: string,
  entryArgs: readonly string[],
  env: Record<string, string> = {}
): ManagedProcess {
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['exec', 'vite-node', '--config', 'examples/vite.config.ts', ...entryArgs],
    {
      cwd: process.cwd(),
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const managed: ManagedProcess = {
    name,
    child,
    output: [],
    buffer: '',
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => appendProcessOutput(managed, chunk));
  child.stderr?.on('data', (chunk: string) => appendProcessOutput(managed, chunk));

  return managed;
}

function appendProcessOutput(process: ManagedProcess, chunk: string): void {
  process.buffer += chunk;
  const lines = process.buffer.split(/\r?\n/);
  process.buffer = lines.pop() ?? '';
  process.output.push(...lines);
}

async function waitForReadyLine<T>(
  process: ManagedProcess,
  prefix: string,
  timeoutMs = 15_000
): Promise<T> {
  const startedAt = Date.now();
  let exitCode: number | null = null;
  process.child.once('exit', (code) => {
    exitCode = code;
  });

  while (Date.now() - startedAt < timeoutMs) {
    const line = process.output.find((entry) => entry.startsWith(prefix));
    if (line) {
      return JSON.parse(line.slice(prefix.length)) as T;
    }

    if (exitCode !== null) {
      throw new Error(
        `${process.name} process exited with code ${exitCode} before ready line.\n${process.output.join('\n')}`
      );
    }

    await wait(25);
  }

  throw new Error(
    `${process.name} process did not print ${prefix.trim()}.\n${process.output.join('\n')}`
  );
}

async function stopManagedProcess(managed: ManagedProcess): Promise<void> {
  if (managed.child.exitCode !== null || managed.child.signalCode !== null) {
    return;
  }

  signalManagedProcess(managed, 'SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (managed.child.exitCode === null && managed.child.signalCode === null) {
        signalManagedProcess(managed, 'SIGKILL');
      }
      resolve();
    }, 2_000);

    managed.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function signalManagedProcess(managed: ManagedProcess, signal: NodeJS.Signals): void {
  if (!managed.child.pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      managed.child.kill(signal);
      return;
    }

    process.kill(-managed.child.pid, signal);
  } catch {
    // The process may have already exited between the status check and signal.
  }
}

interface RuntimeStatusResponse {
  readonly provider?: {
    readonly runtimeEnabled?: boolean;
    readonly sourceLabel?: string;
  };
  readonly transport: {
    readonly connectedNodes: readonly string[];
    readonly workerConnected: boolean;
    readonly workerPeerFresh?: boolean;
    readonly workerPeer?: {
      readonly state: string;
      readonly connected: boolean;
      readonly fresh: boolean;
      readonly staleAfterMs: number;
      readonly lastSeenAt?: string;
      readonly disconnectedAt?: string;
      readonly rejectedReason?: string;
      readonly staleReason?: string;
    };
    readonly providerConnected?: boolean;
    readonly providerPeerFresh?: boolean;
    readonly providerPeer?: {
      readonly state: string;
      readonly connected: boolean;
      readonly fresh: boolean;
      readonly staleAfterMs: number;
      readonly lastSeenAt?: string;
      readonly disconnectedAt?: string;
      readonly rejectedReason?: string;
      readonly staleReason?: string;
    };
  };
}

async function waitForRuntimeStatus(
  restUrl: string,
  predicate: (status: RuntimeStatusResponse) => boolean,
  message: string
): Promise<RuntimeStatusResponse> {
  let lastStatus: RuntimeStatusResponse | undefined;
  return waitFor(
    async () => {
      const response = await fetch(`${restUrl}/runtime/status`);
      if (!response.ok) {
        return undefined;
      }

      const status = (await response.json()) as RuntimeStatusResponse;
      lastStatus = status;
      return predicate(status) ? status : undefined;
    },
    () => `${message}. Last status: ${JSON.stringify(lastStatus)}`
  );
}

interface ShipmentResponse {
  readonly shipmentId?: string | null;
  readonly status?: string;
  readonly carrier?: string | null;
  readonly providerSignal?: string | null;
  readonly timeline?: Array<{
    readonly source?: string;
  }>;
}

async function waitForShipment(
  restUrl: string,
  predicate: (shipment: ShipmentResponse) => boolean,
  message: string
): Promise<ShipmentResponse> {
  return waitFor(async () => {
    const response = await fetch(`${restUrl}/shipments/current`);
    if (!response.ok) {
      return undefined;
    }

    const shipment = (await response.json()) as ShipmentResponse;
    return predicate(shipment) ? shipment : undefined;
  }, message);
}

async function waitFor<T>(
  read: () => Promise<T | undefined>,
  message: string | (() => string),
  timeoutMs = 10_000
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();
    if (value !== undefined) {
      return value;
    }

    await wait(50);
  }

  throw new Error(typeof message === 'function' ? message() : message);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
