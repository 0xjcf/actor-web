import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

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

interface GatewayFrame {
  readonly type: string;
  readonly code?: string;
  readonly message?: string;
  readonly recoverable?: boolean;
  readonly streamId?: string;
  readonly projection?: {
    readonly context?: ShipmentResponse;
  };
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

    const recoveredWorker = spawnExampleProcess(
      'worker-recovered',
      ['examples/ignite-headless-host/logistics-worker-process.ts'],
      {
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: workerTelemetryPath,
      }
    );
    readyProcesses.push(recoveredWorker);

    await waitForReadyLine<LogisticsWorkerReadyPayload>(recoveredWorker, 'LOGISTICS_WORKER_READY ');
    const recoveredStatus = await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.workerConnected &&
        status.transport.workerPeer?.connected === true &&
        (status.transport.telemetry?.reconnectCount ?? 0) >= 1,
      'Expected server runtime status to mark restarted worker process reconnected'
    );
    expect(recoveredStatus.transport.telemetry?.reconnectCount).toBeGreaterThanOrEqual(1);
    expect(recoveredStatus.transport.telemetry?.duplicateFramesDropped).toBe(0);

    const recoveredResponse = await fetch(`${serverReady.restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-multiprocess-1002',
        destination: 'Denver depot',
        reference: 'MP-1002',
      }),
    });
    expect(recoveredResponse.status).toBe(202);
    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-multiprocess-1002' &&
        shipment.status === 'route-assigned' &&
        shipment.carrier === 'Northline Express',
      'Expected restarted worker process to resume route planning'
    );

    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"peer.disconnected"');
    expect(readFileSync(workerTelemetryPath, 'utf8')).toContain('"type":"peer.connected"');
  }, 30_000);

  it('rejects unauthenticated worker joins, accepts authenticated peers, and resyncs browser observers', async () => {
    const telemetryDirectory = mkdtempSync(join(tmpdir(), 'actor-web-logistics-auth-'));
    tempDirectories.push(telemetryDirectory);
    const serverTelemetryPath = join(telemetryDirectory, 'server-transport.jsonl');
    const workerTelemetryPath = join(telemetryDirectory, 'worker-transport.jsonl');
    const runtimeAuthToken = 'runtime-secret';
    const gatewayAuthToken = 'gateway-secret';
    const server = spawnExampleProcess(
      'server',
      ['examples/ignite-headless-host/logistics-server-process.ts'],
      {
        ACTOR_WEB_GATEWAY_AUTH_TOKEN: gatewayAuthToken,
        ACTOR_WEB_GATEWAY_PORT: '0',
        ACTOR_WEB_REST_PORT: '0',
        ACTOR_WEB_RUNTIME_AUTH_TOKEN: runtimeAuthToken,
        ACTOR_WEB_TELEMETRY_JSONL: serverTelemetryPath,
        ACTOR_WEB_TRANSPORT_OUTBOUND_QUEUE_LIMIT: '7',
        ACTOR_WEB_TRANSPORT_PORT: '0',
        LOGISTICS_LIFECYCLE_MODE: 'manual',
      }
    );
    readyProcesses.push(server);

    const serverReady = await waitForReadyLine<LogisticsServerReadyPayload>(
      server,
      'LOGISTICS_SERVER_READY '
    );

    const rejectedWorker = spawnExampleProcess(
      'worker-rejected',
      ['examples/ignite-headless-host/logistics-worker-process.ts'],
      {
        ACTOR_WEB_RUNTIME_AUTH_TOKEN: 'wrong-secret',
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
      }
    );
    readyProcesses.push(rejectedWorker);

    const rejectedStatus = await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.workerConnected === false &&
        status.transport.workerPeer?.state === 'rejected' &&
        status.transport.workerPeer?.rejectedReason === 'Shared runtime secret rejected.' &&
        (status.transport.telemetry?.handshakeRejectedCount ?? 0) >= 1,
      'Expected server runtime to reject unauthenticated worker joins'
    );
    expect(rejectedStatus.transport.telemetry?.outboundQueueLimit).toBe(7);
    expect(rejectedStatus.transport.telemetry?.handshakeRejectedCount).toBeGreaterThanOrEqual(1);
    expect(rejectedStatus.transport.telemetry?.backpressureDropCount).toBe(0);
    expect(rejectedStatus.transport.telemetry?.duplicateFramesDropped).toBe(0);

    await stopManagedProcess(rejectedWorker);

    const worker = spawnExampleProcess(
      'worker',
      ['examples/ignite-headless-host/logistics-worker-process.ts'],
      {
        ACTOR_WEB_RUNTIME_AUTH_TOKEN: runtimeAuthToken,
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: workerTelemetryPath,
      }
    );
    readyProcesses.push(worker);
    await waitForReadyLine<LogisticsWorkerReadyPayload>(worker, 'LOGISTICS_WORKER_READY ');

    await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.workerConnected &&
        status.transport.workerPeer?.connected === true &&
        (status.transport.telemetry?.handshakeAcceptedCount ?? 0) >= 1,
      'Expected server runtime to accept authenticated worker joins'
    );

    const rejectedBrowser = await connectRejectedGatewayClient(
      serverReady.gatewayUrl,
      'wrong-gateway-secret'
    );
    expect(rejectedBrowser).toMatchObject({
      type: 'error',
      code: 'unauthorized',
      message: 'Gateway authentication rejected.',
      recoverable: false,
    });

    const browser = await connectGatewayClient(serverReady.gatewayUrl, gatewayAuthToken);
    try {
      await subscribeShipmentStream(browser.socket, browser.frames, 'shipment-browser-1');

      const response = await fetch(`${serverReady.restUrl}/shipments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shipmentId: 'shipment-auth-1001',
          destination: 'Phoenix hub',
          reference: 'AUTH-1001',
        }),
      });
      expect(response.status).toBe(202);

      await waitForGatewayFrame(
        browser.frames,
        (frame) =>
          frame.type === 'snapshot' &&
          frame.projection?.context?.shipmentId === 'shipment-auth-1001' &&
          frame.projection?.context?.status === 'route-assigned',
        'Expected authenticated browser observer to receive shipment projection'
      );
    } finally {
      browser.socket.close();
    }

    const reconnectedBrowser = await connectGatewayClient(serverReady.gatewayUrl, gatewayAuthToken);
    try {
      await subscribeShipmentStream(
        reconnectedBrowser.socket,
        reconnectedBrowser.frames,
        'shipment-browser-2'
      );
      const resyncedSnapshot = await waitForGatewayFrame(
        reconnectedBrowser.frames,
        (frame) =>
          frame.type === 'snapshot' &&
          frame.projection?.context?.shipmentId === 'shipment-auth-1001' &&
          frame.projection?.context?.status === 'route-assigned',
        'Expected reconnected browser observer to resubscribe and resync the shipment snapshot'
      );
      expect(resyncedSnapshot.projection?.context).toMatchObject({
        shipmentId: 'shipment-auth-1001',
        status: 'route-assigned',
      });
    } finally {
      reconnectedBrowser.socket.close();
    }

    await Promise.all(readyProcesses.splice(0).map(stopManagedProcess));
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"auth.rejected"');
    expect(readFileSync(serverTelemetryPath, 'utf8')).toContain('"type":"auth.accepted"');
    expect(readFileSync(workerTelemetryPath, 'utf8')).toContain('"type":"auth.accepted"');
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

    await stopManagedProcess(provider);
    await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.providerConnected === false &&
        status.transport.providerPeer?.connected === false,
      'Expected server runtime status to mark stopped provider process disconnected'
    );

    const recoveredProvider = spawnExampleProcess(
      'provider-recovered',
      ['examples/ignite-headless-host/logistics-provider-process.ts'],
      {
        ACTOR_WEB_SERVER_TRANSPORT_URL: serverReady.transportUrl,
        ACTOR_WEB_TELEMETRY_JSONL: providerTelemetryPath,
      }
    );
    readyProcesses.push(recoveredProvider);
    await waitForReadyLine<LogisticsProviderReadyPayload>(
      recoveredProvider,
      'LOGISTICS_PROVIDER_READY '
    );

    const recoveredProviderStatus = await waitForRuntimeStatus(
      serverReady.restUrl,
      (status) =>
        status.transport.providerConnected === true &&
        status.transport.providerPeer?.connected === true &&
        (status.transport.providerPeer?.reconnectCount ?? 0) >= 1,
      'Expected server runtime status to mark restarted provider process reconnected'
    );
    expect(recoveredProviderStatus.transport.providerPeer?.reconnectCount).toBeGreaterThanOrEqual(
      1
    );

    const secondShipmentResponse = await fetch(`${serverReady.restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-process-1002',
        destination: 'Detroit transfer yard',
        reference: 'PP-1002',
      }),
    });
    expect(secondShipmentResponse.status).toBe(202);

    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-provider-process-1002' &&
        shipment.status === 'route-assigned',
      'Expected restarted provider prove-out to create a fresh shipment before the next provider signal'
    );

    const outboundResponse = await fetch(`${serverReady.restUrl}/provider/signals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-provider-process-1002',
        signal: 'LABEL_SCANNED',
      }),
    });
    expect(outboundResponse.status).toBe(202);

    await waitForShipment(
      serverReady.restUrl,
      (shipment) =>
        shipment.shipmentId === 'shipment-provider-process-1002' &&
        shipment.providerSignal === 'LABEL_SCANNED' &&
        shipment.timeline?.[0]?.source === 'manual UI',
      'Expected restarted provider process to resume provider workflow'
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
    readonly telemetry?: {
      readonly outboundQueueDepth: number;
      readonly outboundQueueLimit: number;
      readonly outboundFramesDropped: number;
      readonly backpressureDropCount: number;
      readonly duplicateFramesDropped: number;
      readonly handshakeAcceptedCount: number;
      readonly handshakeRejectedCount: number;
      readonly reconnectCount: number;
    };
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
      readonly reconnectCount?: number;
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
      readonly reconnectCount?: number;
    };
  };
}

function waitForSocketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function collectFrames(socket: WebSocket): {
  nextFrame(timeoutMs?: number): Promise<GatewayFrame>;
} {
  const frames: GatewayFrame[] = [];
  const waiters = new Set<(frame: GatewayFrame) => void>();
  socket.on('message', (data) => {
    const frame = JSON.parse(Buffer.from(data as Buffer).toString('utf8')) as GatewayFrame;
    const waiter = Array.from(waiters)[0];
    if (waiter) {
      waiters.delete(waiter);
      waiter(frame);
      return;
    }

    frames.push(frame);
  });

  return {
    nextFrame(timeoutMs = 10_000): Promise<GatewayFrame> {
      const frame = frames.shift();
      if (frame) {
        return Promise.resolve(frame);
      }

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error(`Gateway frame did not arrive within ${timeoutMs}ms.`));
        }, timeoutMs);
        const waiter = (queuedFrame: GatewayFrame): void => {
          clearTimeout(timeout);
          resolve(queuedFrame);
        };
        waiters.add(waiter);
      });
    },
  };
}

async function connectGatewayClient(
  gatewayUrl: string,
  authToken?: string
): Promise<{ readonly socket: WebSocket; readonly frames: ReturnType<typeof collectFrames> }> {
  const socket = new WebSocket(gatewayUrl);
  const frames = collectFrames(socket);
  await waitForSocketOpen(socket);
  socket.send(
    JSON.stringify({
      type: 'hello',
      clientVersion: 'logistics-multiprocess-test',
      ...(authToken ? { auth: { scheme: 'token', token: authToken } } : {}),
    })
  );
  const ready = await waitForGatewayFrame(
    frames,
    (frame) => frame.type === 'ready',
    'Expected gateway client to receive a ready frame'
  );
  expect(ready.type).toBe('ready');
  return { socket, frames };
}

async function connectRejectedGatewayClient(
  gatewayUrl: string,
  authToken: string
): Promise<GatewayFrame> {
  const socket = new WebSocket(gatewayUrl);
  const frames = collectFrames(socket);
  await waitForSocketOpen(socket);
  socket.send(
    JSON.stringify({
      type: 'hello',
      clientVersion: 'logistics-multiprocess-test',
      auth: { scheme: 'token', token: authToken },
    })
  );
  try {
    const rejected = await waitForGatewayFrame(
      frames,
      (frame) => frame.type === 'error',
      'Expected gateway client to receive an auth rejection frame'
    );
    expect(rejected.type).toBe('error');
    return rejected;
  } finally {
    socket.close();
  }
}

async function subscribeShipmentStream(
  socket: WebSocket,
  frames: ReturnType<typeof collectFrames>,
  streamId: string
): Promise<void> {
  socket.send(
    JSON.stringify({
      type: 'subscribe',
      streamId,
      scope: { kind: 'shipment' },
    })
  );
  await waitForGatewayFrame(
    frames,
    (frame) => frame.type === 'status' && frame.streamId === streamId,
    'Expected gateway client to receive subscription status'
  );
}

async function waitForGatewayFrame(
  frames: ReturnType<typeof collectFrames>,
  predicate: (frame: GatewayFrame) => boolean,
  message: string,
  timeoutMs = 10_000
): Promise<GatewayFrame> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const frame = await frames.nextFrame(timeoutMs);
    if (predicate(frame)) {
      return frame;
    }
  }

  throw new Error(message);
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
