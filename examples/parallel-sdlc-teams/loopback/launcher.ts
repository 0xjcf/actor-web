import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ControlConfig, WorkerConfig } from './peer.js';
import type { Operation } from './process.js';
import type { Lane } from './topology.js';

type Ready = { pid: number; gatewayUrl: string; transportUrl: string };
export const credential = () => randomBytes(32).toString('base64url');
export function credentials() {
  return { checkout: credential(), profile: credential() };
}

export async function launch(config: ControlConfig | WorkerConfig) {
  const cli = createRequire(import.meta.url).resolve('vite-node/vite-node.mjs');
  const child = fork(
    cli,
    ['--config', 'examples/vitest.config.ts', 'examples/parallel-sdlc-teams/loopback/process.ts'],
    {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      env: { PATH: process.env.PATH, NODE_ENV: 'production' },
    }
  );
  let sequence = 0;
  const pending = new Map<number, (error?: Error, value?: unknown) => void>();
  function wait<T>(id: number) {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${config.role} timed out`));
      }, 15000);
      pending.set(id, (error, value) => {
        clearTimeout(timer);
        pending.delete(id);
        if (error) reject(error);
        else resolve(value as T);
      });
    });
  }
  child.on(
    'message',
    (message: { boot?: boolean; id: number; value?: unknown; error?: string }) => {
      if (message.boot) child.send(config);
      else
        pending.get(message.id)?.(
          message.error ? new Error(message.error) : undefined,
          message.value
        );
    }
  );
  const closed = new Promise<void>((resolve) =>
    child.once('close', () => {
      for (const finish of pending.values()) finish(new Error(`${config.role} exited`));
      resolve();
    })
  );
  child.on('error', (error) => {
    for (const finish of pending.values()) finish(error);
  });
  try {
    const ready = await wait<Ready>(0);
    return {
      ready,
      call<T = unknown>(op: Operation, lane?: Lane) {
        if (!child.connected) throw new Error(`${config.role} exited`);
        const id = ++sequence;
        const result = wait<T>(id);
        child.send({ id, op, lane });
        return result;
      },
      async stop() {
        if (child.connected) child.send({ op: 'stop' });
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        try {
          await closed;
        } finally {
          clearTimeout(timer);
        }
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    await closed;
    throw error;
  }
}

export async function startCluster(viewers = credentials(), retainedDirectory?: string) {
  if (!viewers.checkout || !viewers.profile || viewers.checkout === viewers.profile)
    throw new Error('Provide distinct workspace viewer credentials');
  const token = credential();
  const peers = credentials();
  const root = retainedDirectory ?? (await mkdtemp(join(tmpdir(), 'sdlc-run-')));
  const children: Awaited<ReturnType<typeof launch>>[] = [];
  const stop = async () => {
    await Promise.all(children.map((child) => child.stop()));
    if (!retainedDirectory) await rm(root, { recursive: true, force: true });
  };
  async function worker(role: Lane, controlUrl: string) {
    const host = await launch({
      directory: join(root, role),
      role,
      controlToken: token,
      token: peers[role],
      controlUrl,
    });
    children.push(host);
    return host;
  }
  try {
    const control = await launch({
      role: 'control',
      token,
      peers,
      viewers,
      directory: join(root, 'control'),
    });
    children.push(control);
    const checkout = await worker('checkout', control.ready.transportUrl);
    const profile = await worker('profile', control.ready.transportUrl);
    await control.call('recover');
    return { control, checkout, profile, viewers, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
