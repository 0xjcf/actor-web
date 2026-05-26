import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const composeFile = 'docker-compose.logistics.yml';
const telemetryDir = '.actor-web/telemetry';
const restUrl = 'http://127.0.0.1:4100';
const workerService = 'worker-runtime';
const providerService = 'provider-runtime';
const providerRuntimeEnabled = process.argv.includes('--provider-runtime');
const composeEnv = providerRuntimeEnabled
  ? {
      ACTOR_WEB_PROVIDER_RUNTIME_ENABLED: '1',
      ACTOR_WEB_PROVIDER_RUNTIME_SOURCE: 'container',
      LOGISTICS_LIFECYCLE_MODE: 'simulation',
    }
  : {};
const composeArgs = providerRuntimeEnabled
  ? ['compose', '-f', composeFile, '--profile', 'provider-runtime']
  : ['compose', '-f', composeFile];

async function main() {
  await ensureDockerDaemonAvailable();

  rmSync(telemetryDir, { recursive: true, force: true });
  mkdirSync(telemetryDir, { recursive: true });

  try {
    await runCompose(['up', '--build', '-d']);
    await waitForWorkerConnected(
      'Expected worker runtime container to connect to server transport'
    );
    if (providerRuntimeEnabled) {
      await waitForProviderConnected(
        'Expected provider runtime container to connect to server transport'
      );
    }

    await createAndVerifyShipment('shipment-docker-1001', 'DOCKER-1001');
    if (providerRuntimeEnabled) {
      await verifyProviderSourceLabel('provider container');
      await waitFor(async () => {
        const shipment = await getJson(`${restUrl}/shipments/current`);
        return shipment?.timeline?.some((entry) => entry?.source === 'provider container');
      }, 'Expected provider container path to stamp shipment timeline entries');
    }

    await waitFor(
      () =>
        telemetryFileContains('server-transport.jsonl', 'peer.connected') &&
        telemetryFileContains('worker-transport.jsonl', 'peer.connected') &&
        (!providerRuntimeEnabled ||
          telemetryFileContains('provider-transport.jsonl', 'peer.connected')),
      'Expected runtime telemetry JSONL files to include peer connection events'
    );
    await waitFor(
      () => serviceIsRunning(workerService),
      'Expected worker runtime container to remain running after routing work completes'
    );
    if (providerRuntimeEnabled) {
      await waitFor(
        () => serviceIsRunning(providerService),
        'Expected provider runtime container to remain running after provider work completes'
      );
    }

    await runCompose(['stop', workerService]);
    await waitForWorkerDisconnected(
      'Expected server runtime status to mark stopped worker container disconnected'
    );
    await waitFor(
      () => telemetryFileContains('server-transport.jsonl', 'peer.disconnected'),
      'Expected server telemetry JSONL file to include worker disconnection event'
    );

    await runCompose(['up', '-d', workerService]);
    await waitForWorkerConnected('Expected worker runtime container to reconnect after restart');
    if (providerRuntimeEnabled) {
      await setProviderMode('manual');
      await verifyProviderSourceLabel('manual UI');
    }
    await createAndVerifyShipment('shipment-docker-1002', 'DOCKER-1002');

    if (providerRuntimeEnabled) {
      await createAndVerifyProviderSignal('shipment-docker-1002', 'LABEL_SCANNED', 'manual UI');
      await createAndVerifyProviderSignal('shipment-docker-1002', 'PACKED_INTO_TRUCK', 'manual UI');
      await runCompose(['stop', providerService]);
      await waitForProviderDisconnected(
        'Expected server runtime status to mark stopped provider container disconnected'
      );
      await waitFor(
        () => telemetryFileContains('server-transport.jsonl', 'peer.disconnected'),
        'Expected server telemetry JSONL file to include provider disconnection event'
      );
      await runCompose(['up', '-d', providerService]);
      await waitForProviderConnected(
        'Expected provider runtime container to reconnect after restart'
      );
      await setProviderMode('simulation');
      await verifyProviderSourceLabel('provider container');
    }

    console.log('Actor-Web logistics Docker Compose smoke passed.');
  } finally {
    await runCompose(['down', '--remove-orphans'], {
      allowFailure: true,
    });
  }
}

async function ensureDockerDaemonAvailable() {
  const result = await new Promise((resolve) => {
    const child = spawn('docker', ['info'], { stdio: 'ignore' });
    child.on('error', () => resolve(1));
    child.on('exit', (code) => resolve(code ?? 1));
  });

  if (result !== 0) {
    throw new Error(
      'Docker daemon is not available. Start Docker Desktop or another Docker daemon, then rerun pnpm examples:logistics:docker:verify.'
    );
  }
}

async function getJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return undefined;
    }

    return await response.json();
  } catch {
    return undefined;
  }
}

function telemetryFileContains(fileName, eventType) {
  const filePath = `${telemetryDir}/${fileName}`;
  return existsSync(filePath) && readFileSync(filePath, 'utf8').includes(`"type":"${eventType}"`);
}

async function createAndVerifyShipment(shipmentId, reference) {
  const response = await fetch(`${restUrl}/shipments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      shipmentId,
      destination: 'Chicago warehouse',
      reference,
    }),
  });
  if (response.status !== 202) {
    throw new Error(`Expected shipment create to return 202, got ${response.status}`);
  }

  const accepted = await response.json();
  if (accepted.status !== 'route-assigned') {
    throw new Error(`Expected route-assigned shipment, got ${JSON.stringify(accepted)}`);
  }

  await waitFor(async () => {
    const shipment = await getJson(`${restUrl}/shipments/current`);
    return (
      shipment?.shipmentId === shipmentId &&
      shipment?.status === 'route-assigned' &&
      typeof shipment?.carrier === 'string'
    );
  }, `Expected server runtime to apply worker-owned route plan for ${shipmentId}`);
}

async function createAndVerifyProviderSignal(shipmentId, signal, expectedSourceLabel) {
  const response = await fetch(`${restUrl}/provider/signals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      shipmentId,
      signal,
    }),
  });
  if (response.status !== 202) {
    throw new Error(`Expected provider signal ${signal} to return 202, got ${response.status}`);
  }

  await waitFor(async () => {
    const shipment = await getJson(`${restUrl}/shipments/current`);
    const timelineEntry = shipment?.timeline?.find((entry) => entry?.signal === signal);
    return (
      shipment?.shipmentId === shipmentId &&
      shipment?.providerSignal === signal &&
      timelineEntry?.signal === signal &&
      timelineEntry?.source === expectedSourceLabel
    );
  }, `Expected provider signal ${signal} to be applied through ${expectedSourceLabel}`);
}

async function setProviderMode(mode) {
  const response = await fetch(`${restUrl}/provider/mode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (response.status !== 202) {
    throw new Error(`Expected provider mode ${mode} to return 202, got ${response.status}`);
  }

  await waitFor(async () => {
    const status = await getJson(`${restUrl}/provider/status`);
    return status?.mode === mode;
  }, `Expected provider mode to become ${mode}`);
}

async function waitForWorkerConnected(message) {
  await waitFor(async () => {
    const status = await getJson(`${restUrl}/runtime/status`);
    return (
      status?.transport?.workerConnected === true &&
      status?.transport?.workerPeer?.connected === true &&
      status?.transport?.workerPeer?.fresh === true
    );
  }, message);
}

async function waitForProviderConnected(message) {
  await waitFor(async () => {
    const status = await getJson(`${restUrl}/runtime/status`);
    return (
      status?.transport?.providerConnected === true &&
      status?.transport?.providerPeer?.connected === true &&
      status?.transport?.providerPeer?.fresh === true
    );
  }, message);
}

async function waitForWorkerDisconnected(message) {
  await waitFor(async () => {
    const status = await getJson(`${restUrl}/runtime/status`);
    return (
      status?.transport?.workerConnected === false &&
      status?.transport?.workerPeer?.connected === false &&
      status?.transport?.workerPeer?.fresh === false
    );
  }, message);
}

async function waitForProviderDisconnected(message) {
  await waitFor(async () => {
    const status = await getJson(`${restUrl}/runtime/status`);
    return (
      status?.transport?.providerConnected === false &&
      status?.transport?.providerPeer?.connected === false &&
      status?.transport?.providerPeer?.fresh === false
    );
  }, message);
}

async function verifyProviderSourceLabel(expectedSourceLabel) {
  await waitFor(async () => {
    const status = await getJson(`${restUrl}/runtime/status`);
    return status?.provider?.sourceLabel === expectedSourceLabel;
  }, `Expected runtime status to expose provider source label ${expectedSourceLabel}`);
}

async function serviceIsRunning(serviceName) {
  const containerId = (await captureCompose(['ps', '-q', serviceName])).trim();
  if (!containerId) {
    return false;
  }

  const status = await capture('docker', ['inspect', containerId, '--format', '{{.State.Status}}']);
  return status.trim() === 'running';
}

async function waitFor(predicate, message, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(message);
}

async function capture(command, args) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) =>
      resolve({
        code: 1,
        stderr: Buffer.from(String(error)),
        stdout: Buffer.alloc(0),
      })
    );
    child.on('exit', (code) =>
      resolve({
        code: code ?? 1,
        stderr: Buffer.concat(stderr),
        stdout: Buffer.concat(stdout),
      })
    );
  });

  if (result.code !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.code}: ${result.stderr.toString('utf8')}`
    );
  }

  return result.stdout.toString('utf8');
}

async function captureCompose(args) {
  return capture('docker', [...composeArgs, ...args]);
}

async function run(command, args, options = {}) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...composeEnv,
      },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });

  if (result !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result}`);
  }
}

async function runCompose(args, options = {}) {
  await run('docker', [...composeArgs, ...args], options);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
