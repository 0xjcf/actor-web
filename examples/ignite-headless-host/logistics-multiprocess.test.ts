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

    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
    expect(readFileSync(workerTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
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

async function stopManagedProcess(process: ManagedProcess): Promise<void> {
  if (process.child.exitCode !== null || process.child.signalCode !== null) {
    return;
  }

  process.child.kill('SIGTERM');
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (process.child.exitCode === null && process.child.signalCode === null) {
        process.child.kill('SIGKILL');
      }
      resolve();
    }, 2_000);

    process.child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

interface RuntimeStatusResponse {
  readonly transport: {
    readonly connectedNodes: readonly string[];
    readonly workerConnected: boolean;
  };
}

async function waitForRuntimeStatus(
  restUrl: string,
  predicate: (status: RuntimeStatusResponse) => boolean,
  message: string
): Promise<RuntimeStatusResponse> {
  return waitFor(async () => {
    const response = await fetch(`${restUrl}/runtime/status`);
    if (!response.ok) {
      return undefined;
    }

    const status = (await response.json()) as RuntimeStatusResponse;
    return predicate(status) ? status : undefined;
  }, message);
}

interface ShipmentResponse {
  readonly shipmentId?: string | null;
  readonly status?: string;
  readonly carrier?: string | null;
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
  message: string,
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

  throw new Error(message);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
