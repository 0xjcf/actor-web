import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const composeFile = 'docker-compose.logistics.yml';
const telemetryDir = '.actor-web/telemetry';
const restUrl = 'http://127.0.0.1:4100';

async function main() {
  await ensureDockerDaemonAvailable();

  rmSync(telemetryDir, { recursive: true, force: true });
  mkdirSync(telemetryDir, { recursive: true });

  let composeStarted = false;
  try {
    await run('docker', ['compose', '-f', composeFile, 'up', '--build', '-d']);
    composeStarted = true;
    await waitFor(async () => {
      const status = await getJson(`${restUrl}/runtime/status`);
      return status?.transport?.workerConnected === true;
    }, 'Expected worker runtime container to connect to server transport');

    const response = await fetch(`${restUrl}/shipments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shipmentId: 'shipment-docker-1001',
        destination: 'Chicago warehouse',
        reference: 'DOCKER-1001',
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
        shipment?.shipmentId === 'shipment-docker-1001' &&
        shipment?.status === 'route-assigned' &&
        typeof shipment?.carrier === 'string'
      );
    }, 'Expected server runtime to apply worker-owned route plan');

    await waitFor(
      () =>
        telemetryFileContains('server-transport.jsonl', 'peer.connected') &&
        telemetryFileContains('worker-transport.jsonl', 'peer.connected'),
      'Expected server and worker telemetry JSONL files to include peer connection events'
    );
    await waitFor(
      () => containerIsRunning('actor-web-logistics-worker-runtime-1'),
      'Expected worker runtime container to remain running after routing work completes'
    );

    console.log('Actor-Web logistics Docker Compose smoke passed.');
  } finally {
    if (composeStarted) {
      await run('docker', ['compose', '-f', composeFile, 'down', '--remove-orphans'], {
        allowFailure: true,
      });
    }
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

async function containerIsRunning(containerName) {
  const status = await capture('docker', [
    'inspect',
    containerName,
    '--format',
    '{{.State.Status}}',
  ]);
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

async function run(command, args, options = {}) {
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });

  if (result !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
