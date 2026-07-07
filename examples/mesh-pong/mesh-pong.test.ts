import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import type { BroadcastChannelLike } from '@actor-web/runtime/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { startMeshPongBroadcast } from './modes/broadcast';
import { startMeshPongLocal } from './modes/local';
import { startMeshPongWebSocketLoopback } from './modes/websocket';
import type {
  BallCommand,
  PongBallContext,
  PongPaddleState,
  PongScoreState,
  ScoreCommand,
} from './pong-contract';
import { DEFAULT_PONG_SEED, PONG_FIELD } from './pong-contract';
import { pong } from './pong-topology';

type StartedMeshPongRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongWebSocketLoopback>>;

class FakeBroadcastChannelNetwork {
  private readonly channels = new Set<FakeBroadcastChannel>();

  create = (name: string): BroadcastChannelLike => {
    const channel = new FakeBroadcastChannel(name, this);
    this.channels.add(channel);
    return channel;
  };

  delete(channel: FakeBroadcastChannel): void {
    this.channels.delete(channel);
  }

  publish(sender: FakeBroadcastChannel, data: unknown): void {
    for (const channel of Array.from(this.channels)) {
      if (channel !== sender && channel.name === sender.name) {
        channel.deliver(data);
      }
    }
  }
}

class FakeBroadcastChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<EventListener>();
  private closed = false;

  constructor(
    readonly name: string,
    private readonly network: FakeBroadcastChannelNetwork
  ) {}

  postMessage(data: unknown): void {
    if (this.closed) {
      throw new Error(`BroadcastChannel ${this.name} is closed.`);
    }
    this.network.publish(this, data);
  }

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === 'message') {
      this.listeners.delete(listener);
    }
  }

  deliver(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.listeners.clear();
    this.network.delete(this);
  }
}

const startedRuntimes: StartedMeshPongRuntime[] = [];

afterEach(async () => {
  await Promise.allSettled(startedRuntimes.splice(0).map((runtime) => runtime.stop()));
});

async function flush(runtime: StartedMeshPongRuntime): Promise<void> {
  if ('flush' in runtime) {
    await runtime.flush();
    return;
  }

  await Promise.all(Object.values(runtime.nodes).map((nodeRuntime) => nodeRuntime?.system.flush()));
}

function serverNode(runtime: StartedMeshPongRuntime) {
  if ('server' in runtime) {
    return runtime.server;
  }

  const server = runtime.nodes.server;
  if (!server) {
    throw new Error('Mesh Pong local runtime did not start the server node.');
  }
  return server;
}

async function waitForActor<TContext, TMessage extends ActorMessage>(
  runtime: StartedMeshPongRuntime,
  address: string
): Promise<ActorRef<TContext, TMessage>> {
  const server = serverNode(runtime);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const actorRef = await server.system.lookup<TContext, TMessage>(address);
    if (actorRef) {
      return actorRef;
    }
    await flush(runtime);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  throw new Error(`Timed out resolving Mesh Pong actor ${address} from the server node.`);
}

async function runScoreSequence(runtime: StartedMeshPongRuntime): Promise<string[]> {
  const server = serverNode(runtime);
  const ball = server.requireActor('ball') as ActorRef<PongBallContext, BallCommand>;
  const score = server.requireActor('score') as ActorRef<PongScoreState, ScoreCommand>;
  const paddleA = await waitForActor<
    PongPaddleState,
    { type: 'SET_PADDLE'; y: number } | { type: 'GET_PADDLE' }
  >(runtime, pong.actors.paddleA.address);
  const paddleB = await waitForActor<
    PongPaddleState,
    { type: 'SET_PADDLE'; y: number } | { type: 'GET_PADDLE' }
  >(runtime, pong.actors.paddleB.address);

  const centerY = PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2;

  await ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
  await score.send({ type: 'RESET_SCORE' });
  await flush(runtime);

  for (let tick = 0; tick < 28; tick += 1) {
    await paddleA.send({ type: 'SET_PADDLE', y: centerY });
    await paddleB.send({ type: 'SET_PADDLE', y: centerY });
    await flush(runtime);

    const [left, right] = await Promise.all([
      paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
      paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    ]);
    await ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
    await ball.send({ type: 'TICK' });
    await flush(runtime);
  }

  const finalScore = await score.ask<PongScoreState>({ type: 'GET_SCORE' });
  return finalScore.sequence.map(
    (point) => `${point.scorer}:${point.left}-${point.right}:r${point.rally}:t${point.tick}`
  );
}

async function captureSequence(
  start: () => Promise<StartedMeshPongRuntime>
): Promise<readonly string[]> {
  const runtime = await start();
  startedRuntimes.push(runtime);
  return runScoreSequence(runtime);
}

describe('Mesh Pong transport parity', () => {
  it('produces the same deterministic score sequence for local, broadcast, and websocket runtimes', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();

    const [local, broadcast, websocket] = await Promise.all([
      captureSequence(() => startMeshPongLocal()),
      captureSequence(() =>
        startMeshPongBroadcast({
          channelName: 'mesh-pong-parity',
          broadcastChannelFactory: broadcastNetwork.create,
        })
      ),
      captureSequence(() => startMeshPongWebSocketLoopback()),
    ]);

    expect(local.length).toBeGreaterThan(0);
    expect(broadcast).toEqual(local);
    expect(websocket).toEqual(local);
  });
});
