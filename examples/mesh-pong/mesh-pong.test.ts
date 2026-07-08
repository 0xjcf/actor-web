import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  createActorAgentTools,
} from '@actor-web/agent';
import type { ActorMessage, ActorRef } from '@actor-web/runtime';
import type { BroadcastChannelLike } from '@actor-web/runtime/browser';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createBrowserMlxLlmProvider,
  resolveBrowserMlxProviderConfig,
  type StorageLike,
} from './mlx-provider';
import { startMeshPongBroadcast } from './modes/broadcast';
import { startMeshPongLocal } from './modes/local';
import { startMeshPongWebSocketLoopback } from './modes/websocket';
import {
  MESH_PONG_MODE_PARITY_PROOF,
  MESH_PONG_SHARED_PARITY_PROOF,
  parityProofForMode,
} from './parity-proof';
import type {
  BallCommand,
  ControllerCommand,
  PaddleCommand,
  PlayerSessionCommand,
  PongBallContext,
  PongControllerActorState,
  PongControllerInputResult,
  PongControllerResult,
  PongLobbyCommand,
  PongLobbyState,
  PongMatchStartResult,
  PongPaddleState,
  PongPlayerSessionParams,
  PongPlayerSessionState,
  PongScoreState,
  PongSnapshot,
  ScoreCommand,
} from './pong-contract';
import {
  advanceBall,
  createInitialBallContext,
  createInitialLobby,
  createSyntheticMlxControllerInput,
  DEFAULT_PONG_SEED,
  PONG_FIELD,
  shouldLaunchMlxControllerForSide,
  startLobbyMatch,
  syncLobbySession,
  syncLobbySessionsFromStorage,
} from './pong-contract';
import { pong } from './pong-topology';

type StartedMeshPongRuntime =
  | Awaited<ReturnType<typeof startMeshPongLocal>>
  | Awaited<ReturnType<typeof startMeshPongBroadcast>>
  | Awaited<ReturnType<typeof startMeshPongWebSocketLoopback>>;

const meshPongExamplesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  size(): number {
    return this.channels.size;
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

interface MeshPongTestRefs {
  readonly ball: ActorRef<PongBallContext, BallCommand>;
  readonly score: ActorRef<PongScoreState, ScoreCommand>;
  readonly paddleA: ActorRef<PongPaddleState, PaddleCommand>;
  readonly paddleB: ActorRef<PongPaddleState, PaddleCommand>;
}

interface MeshPongSessionRefs {
  readonly lobby: ActorRef<PongLobbyState, PongLobbyCommand>;
  readonly sessionA: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
  readonly sessionB: ActorRef<PongPlayerSessionState, PlayerSessionCommand>;
}

interface MeshPongControllerRefs {
  readonly left: ActorRef<PongControllerActorState, ControllerCommand>;
  readonly right: ActorRef<PongControllerActorState, ControllerCommand>;
}

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

async function resolvePongRefs(runtime: StartedMeshPongRuntime): Promise<MeshPongTestRefs> {
  const server = serverNode(runtime);
  return {
    ball: server.requireActor('ball') as ActorRef<PongBallContext, BallCommand>,
    score: server.requireActor('score') as ActorRef<PongScoreState, ScoreCommand>,
    paddleA: await waitForActor<PongPaddleState, PaddleCommand>(
      runtime,
      pong.actors.paddleA.address
    ),
    paddleB: await waitForActor<PongPaddleState, PaddleCommand>(
      runtime,
      pong.actors.paddleB.address
    ),
  };
}

async function createPlayerSession(
  runtime: StartedMeshPongRuntime,
  params: PongPlayerSessionParams
): Promise<ActorRef<PongPlayerSessionState, PlayerSessionCommand>> {
  const server = serverNode(runtime);
  return server.actors.playerSession.instance(params);
}

async function resolveSessionRefs(runtime: StartedMeshPongRuntime): Promise<MeshPongSessionRefs> {
  const server = serverNode(runtime);
  return {
    lobby: server.requireActor('lobby') as ActorRef<PongLobbyState, PongLobbyCommand>,
    sessionA: await createPlayerSession(runtime, { sessionId: 'tab-a' }),
    sessionB: await createPlayerSession(runtime, { sessionId: 'tab-b' }),
  };
}

async function resolveControllerRefs(
  runtime: StartedMeshPongRuntime
): Promise<MeshPongControllerRefs> {
  return {
    left: await waitForActor<PongControllerActorState, ControllerCommand>(
      runtime,
      pong.actors.controllerLeft.address
    ),
    right: await waitForActor<PongControllerActorState, ControllerCommand>(
      runtime,
      pong.actors.controllerRight.address
    ),
  };
}

async function currentSnapshot(runtime: StartedMeshPongRuntime): Promise<PongSnapshot> {
  const refs = await resolvePongRefs(runtime);
  const ball = await refs.ball.ask<PongBallContext>({ type: 'GET_BALL' });
  const score = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
  const [left, right] = await Promise.all([
    refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
  ]);

  return {
    ball: ball.ball,
    score,
    paddles: { left, right },
  };
}

async function syncSyntheticMlxSession(
  lobby: ActorRef<PongLobbyState, PongLobbyCommand>,
  side: 'left' | 'right'
): Promise<void> {
  await lobby.send({
    type: 'SYNC_SESSION',
    session: {
      sessionId: `mlx-${side}`,
      controller: 'mlx',
      side,
      ready: true,
    },
  });
}

function createFakeMlxProvider(
  resolveContent: (request: ActorAgentLlmRequest) => string
): ActorAgentLlmProvider {
  return (request) => ({
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: resolveContent(request),
      },
    },
  });
}

function createStorage(entries: Record<string, string>): StorageLike {
  return {
    getItem(key: string) {
      return entries[key] ?? null;
    },
  };
}

async function syncSessionToLobby(
  lobby: ActorRef<PongLobbyState, PongLobbyCommand>,
  session: ActorRef<PongPlayerSessionState, PlayerSessionCommand>
): Promise<void> {
  const state = await session.ask<PongPlayerSessionState>({ type: 'GET_SESSION' });
  await lobby.send({ type: 'SYNC_SESSION', session: state });
}

async function centerPaddles(
  runtime: StartedMeshPongRuntime,
  refs: Pick<MeshPongTestRefs, 'paddleA' | 'paddleB'>
): Promise<void> {
  const centerY = PONG_FIELD.height / 2 - PONG_FIELD.paddleHeight / 2;
  await refs.paddleA.send({ type: 'SET_PADDLE', y: centerY });
  await refs.paddleB.send({ type: 'SET_PADDLE', y: centerY });
  await flush(runtime);
}

async function stepSimulation(
  runtime: StartedMeshPongRuntime,
  refs: MeshPongTestRefs
): Promise<void> {
  await centerPaddles(runtime, refs);

  const [left, right] = await Promise.all([
    refs.paddleA.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
    refs.paddleB.ask<PongPaddleState>({ type: 'GET_PADDLE' }),
  ]);
  await refs.ball.send({ type: 'SET_PADDLES', leftY: left.y, rightY: right.y });
  await refs.ball.send({ type: 'TICK' });
  await flush(runtime);
}

async function driveUntilNextScore(
  runtime: StartedMeshPongRuntime,
  refs: MeshPongTestRefs,
  currentSequenceLength: number
): Promise<PongScoreState> {
  for (let tick = 0; tick < 40; tick += 1) {
    await stepSimulation(runtime, refs);

    const score = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
    if (score.sequence.length > currentSequenceLength) {
      return score;
    }
  }

  throw new Error('Mesh Pong did not score within the expected tick window.');
}

async function runScoreSequence(runtime: StartedMeshPongRuntime): Promise<string[]> {
  const refs = await resolvePongRefs(runtime);

  await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
  await refs.score.send({ type: 'RESET_SCORE' });
  await flush(runtime);

  for (let tick = 0; tick < 28; tick += 1) {
    await stepSimulation(runtime, refs);
  }

  const finalScore = await refs.score.ask<PongScoreState>({ type: 'GET_SCORE' });
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
  it('creates one player session actor per browser session', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);

    const { sessionA, sessionB } = await resolveSessionRefs(runtime);

    expect(sessionA.address).toBe('actor://pong-server/player-session-tab-a');
    expect(sessionB.address).toBe('actor://pong-server/player-session-tab-b');
    expect(sessionA.address).not.toBe(sessionB.address);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await flush(runtime);

    await expect(sessionA.ask<PongPlayerSessionState>({ type: 'GET_SESSION' })).resolves.toEqual({
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    });
  });

  it('requires both human controller slots to be ready before starting a two-player match', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { lobby, sessionA, sessionB } = await resolveSessionRefs(runtime);

    await lobby.send({ type: 'RESET_LOBBY' });
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'missing-controller',
      missing: ['left', 'right'],
    });

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await syncSessionToLobby(lobby, sessionA);
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'missing-controller',
      missing: ['right'],
    });

    await sessionB.send({ type: 'CLAIM_SIDE', side: 'right' });
    await sessionB.send({ type: 'SET_READY', ready: true });
    const input = await sessionB.ask<PongControllerInputResult>({
      type: 'MOVE_CONTROLLER',
      direction: 'up',
    });
    await syncSessionToLobby(lobby, sessionB);
    await flush(runtime);

    expect(input).toEqual({
      ok: true,
      sessionId: 'tab-b',
      side: 'right',
      direction: 'up',
      amount: PONG_FIELD.paddleStep,
    });
    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'human', right: 'human' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 2,
        controllers: { left: 'human', right: 'human' },
      },
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'tab-b', controller: 'human', side: 'right', ready: true },
      ],
    });
  });

  it('returns data failures for malformed player-session and lobby commands', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const { lobby, sessionA } = await resolveSessionRefs(runtime);

    await expect(
      sessionA.ask<PongControllerInputResult>({
        type: 'MOVE_CONTROLLER',
        direction: 'sideways',
      } as unknown as PlayerSessionCommand)
    ).resolves.toEqual({
      ok: false,
      sessionId: 'tab-a',
      reason: 'invalid-command',
    });

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await flush(runtime);

    await expect(
      sessionA.ask<PongControllerInputResult>({
        type: 'UNKNOWN_COMMAND',
      } as unknown as PlayerSessionCommand)
    ).resolves.toEqual({
      ok: false,
      sessionId: 'tab-a',
      reason: 'invalid-command',
    });

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
      } as unknown as PongLobbyCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'UNKNOWN_COMMAND',
      } as unknown as PongLobbyCommand)
    ).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      missing: [],
    });
  });

  it('starts one-player human plus MLX controller mode and emits bounded controller intents', async () => {
    const runtime = await startMeshPongLocal({
      tools: createActorAgentTools({
        llm: createFakeMlxProvider(() => '{"direction":"down","amount":999}'),
      }),
    });
    startedRuntimes.push(runtime);
    const { lobby, sessionA } = await resolveSessionRefs(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await sessionA.send({ type: 'CLAIM_SIDE', side: 'left' });
    await sessionA.send({ type: 'SET_READY', ready: true });
    await syncSessionToLobby(lobby, sessionA);
    await syncSyntheticMlxSession(lobby, 'right');
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 1,
          controllers: { left: 'human', right: 'mlx' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 1,
        controllers: { left: 'human', right: 'mlx' },
      },
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'mlx-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });

    const result = await controllers.right.ask<PongControllerResult>({
      type: 'RUN_CONTROLLER',
      snapshot: await currentSnapshot(runtime),
    });

    expect(result).toEqual({
      ok: true,
      side: 'right',
      direction: 'down',
      amount: PONG_FIELD.paddleStep,
      provider: 'llm',
    });
  });

  it('returns invalid-response when the LLM amount is malformed', async () => {
    for (const content of [
      '{"direction":"down","amount":null}',
      '{"direction":"down","amount":false}',
      '{"direction":"down","amount":""}',
      '{"direction":"down","amount":"   "}',
      '{"direction":"down","amount":{}}',
      '{"direction":"down","amount":"Infinity"}',
      '{"direction":"down","amount":"NaN"}',
    ]) {
      const runtime = await startMeshPongLocal({
        tools: createActorAgentTools({
          llm: createFakeMlxProvider(() => content),
        }),
      });
      startedRuntimes.push(runtime);
      const controllers = await resolveControllerRefs(runtime);

      await expect(
        controllers.right.ask<PongControllerResult>({
          type: 'RUN_CONTROLLER',
          snapshot: await currentSnapshot(runtime),
        })
      ).resolves.toEqual({
        ok: false,
        side: 'right',
        reason: 'invalid-response',
        error: {
          code: 'LLM_INVALID_RESPONSE',
          message: 'LLM controller must return JSON with direction and amount.',
        },
      });
    }
  });

  it('reads browser MLX config from local storage overrides', () => {
    const config = resolveBrowserMlxProviderConfig(
      createStorage({
        'actor-web.mesh-pong.mlx.enabled': 'true',
        'actor-web.mesh-pong.mlx.endpoint': 'http://127.0.0.1:1234/v1/',
        'actor-web.mesh-pong.mlx.model': 'mlx-test-model',
        'actor-web.mesh-pong.mlx.api-key': 'local-key',
      })
    );

    expect(config).toEqual({
      enabled: true,
      endpoint: 'http://127.0.0.1:1234/v1',
      model: 'mlx-test-model',
      apiKey: 'local-key',
    });
  });

  it('calls an openai-compatible local MLX endpoint when browser MLX is enabled', async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = createBrowserMlxLlmProvider({
      config: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080/v1',
        model: 'mlx-local',
        apiKey: 'secret',
      },
      fetchImpl: (async (url, init) => {
        fetchCalls.push({ url: String(url), init });
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '{"direction":"up","amount":7}' } }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          }),
        } as Response;
      }) as typeof fetch,
    });

    await expect(
      provider(
        {
          system: 'Play Pong.',
          messages: [{ role: 'user', content: '{"side":"left"}' }],
          tools: [],
        } as ActorAgentLlmRequest,
        {} as never
      )
    ).resolves.toEqual({
      ok: true,
      value: {
        message: {
          role: 'assistant',
          content: '{"direction":"up","amount":7}',
        },
        usage: {
          inputTokens: 4,
          outputTokens: 2,
          totalTokens: 6,
        },
      },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      url: 'http://127.0.0.1:8080/v1/chat/completions',
      init: {
        method: 'POST',
        signal: expect.any(AbortSignal),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer secret',
        },
      },
    });
  });

  it('times out browser MLX endpoint calls that do not settle', async () => {
    let observedSignal: AbortSignal | undefined;
    const provider = createBrowserMlxLlmProvider({
      config: {
        enabled: true,
        endpoint: 'http://127.0.0.1:8080/v1',
        model: 'mlx-local',
      },
      timeoutMs: 1,
      fetchImpl: (async (_url, init) => {
        observedSignal = init?.signal as AbortSignal | undefined;
        return new Promise<Response>((_resolve, reject) => {
          observedSignal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }) as typeof fetch,
    });

    await expect(
      provider(
        {
          messages: [{ role: 'user', content: '{"side":"right"}' }],
          tools: [],
        } as ActorAgentLlmRequest,
        {} as never
      )
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'LLM_PROVIDER_FAILED',
        message:
          'Local MLX request timed out after 1ms for http://127.0.0.1:8080/v1/chat/completions.',
      },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it('starts LLM-vs-LLM mode through controller actors with a deterministic fake provider', async () => {
    const runtime = await startMeshPongLocal({
      tools: createActorAgentTools({
        llm: createFakeMlxProvider((request) =>
          JSON.parse(request.messages.at(-1)?.content ?? '{}').side === 'left'
            ? '{"direction":"up","amount":12}'
            : '{"direction":"down","amount":9}'
        ),
      }),
    });
    startedRuntimes.push(runtime);
    const { lobby } = await resolveSessionRefs(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await syncSyntheticMlxSession(lobby, 'left');
    await syncSyntheticMlxSession(lobby, 'right');
    await flush(runtime);

    await expect(
      lobby.ask<PongMatchStartResult>({
        type: 'START_MATCH',
        mode: {
          playerCount: 2,
          controllers: { left: 'mlx', right: 'mlx' },
        },
      })
    ).resolves.toEqual({
      ok: true,
      mode: {
        playerCount: 2,
        controllers: { left: 'mlx', right: 'mlx' },
      },
      controllers: [
        { sessionId: 'mlx-left', controller: 'mlx', side: 'left', ready: true },
        { sessionId: 'mlx-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });

    const snapshot = await currentSnapshot(runtime);
    await expect(
      controllers.left.ask<PongControllerResult>({ type: 'RUN_CONTROLLER', snapshot })
    ).resolves.toEqual({
      ok: true,
      side: 'left',
      direction: 'up',
      amount: 12,
      provider: 'llm',
    });
    await expect(
      controllers.right.ask<PongControllerResult>({ type: 'RUN_CONTROLLER', snapshot })
    ).resolves.toEqual({
      ok: true,
      side: 'right',
      direction: 'down',
      amount: 9,
      provider: 'llm',
    });
  });

  it('preserves active MLX match mode and synthetic controller slots during storage sync', () => {
    const humanSession: PongPlayerSessionState = {
      sessionId: 'tab-a',
      controller: 'human',
      side: 'left',
      ready: true,
    };
    const startedLobby = startLobbyMatch(
      syncLobbySession(syncLobbySession(createInitialLobby(), humanSession), {
        sessionId: 'mlx-right',
        controller: 'mlx',
        side: 'right',
        ready: true,
      }),
      {
        playerCount: 1,
        controllers: { left: 'human', right: 'mlx' },
      }
    ).lobby;

    expect(syncLobbySessionsFromStorage(startedLobby, [humanSession])).toEqual({
      ...startedLobby,
      sessions: [
        humanSession,
        {
          sessionId: 'mlx-right',
          controller: 'mlx',
          side: 'right',
          ready: true,
        },
      ],
      controllers: [
        { sessionId: 'tab-a', controller: 'human', side: 'left', ready: true },
        { sessionId: 'mlx-right', controller: 'mlx', side: 'right', ready: true },
      ],
    });
  });

  it('elects only the match owner tab to launch MLX controller turns', () => {
    const mode = {
      playerCount: 2,
      controllers: { left: 'mlx', right: 'human' },
    } as const;

    expect(
      shouldLaunchMlxControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'left',
      })
    ).toBe(true);
    expect(
      shouldLaunchMlxControllerForSide({
        browserSessionId: 'tab-b',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'left',
      })
    ).toBe(false);
    expect(
      shouldLaunchMlxControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: 'tab-a',
        mode,
        side: 'right',
      })
    ).toBe(false);
    expect(
      shouldLaunchMlxControllerForSide({
        browserSessionId: 'tab-a',
        matchOwnerSessionId: null,
        mode,
        side: 'left',
      })
    ).toBe(false);
  });

  it('creates the synthetic controller-input payload that observer tabs replay for MLX turns', () => {
    expect(
      createSyntheticMlxControllerInput({
        ok: true,
        provider: 'llm',
        side: 'right',
        direction: 'down',
        amount: 9,
      })
    ).toEqual({
      ok: true,
      sessionId: 'mlx-right',
      side: 'right',
      direction: 'down',
      amount: 9,
    });
  });

  it('projects missing or unavailable LLM controller providers as data', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const controllers = await resolveControllerRefs(runtime);

    await expect(
      controllers.left.ask<PongControllerResult>({
        type: 'RUN_CONTROLLER',
        snapshot: await currentSnapshot(runtime),
      })
    ).resolves.toEqual({
      ok: false,
      side: 'left',
      reason: 'llm-unavailable',
      error: {
        code: 'LLM_TOOL_UNAVAILABLE',
        message: 'Actor tool "llm" is not registered.',
      },
    });
  });

  it('keeps the score actor as the only source of scoreboard totals', async () => {
    const runtime = await startMeshPongLocal();
    startedRuntimes.push(runtime);
    const refs = await resolvePongRefs(runtime);

    await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
    await refs.score.send({ type: 'RESET_SCORE' });
    await flush(runtime);

    const firstScore = await driveUntilNextScore(runtime, refs, 0);
    await refs.ball.send({ type: 'RESET_BALL', seed: DEFAULT_PONG_SEED });
    await flush(runtime);

    const secondScore = await driveUntilNextScore(runtime, refs, firstScore.sequence.length);
    const latestPoint = secondScore.sequence[secondScore.sequence.length - 1];
    expect(secondScore.left + secondScore.right).toBe(firstScore.left + firstScore.right + 1);
    expect(latestPoint.left).toBe(secondScore.left);
    expect(latestPoint.right).toBe(secondScore.right);
  });

  it('does not bounce a ball that was already behind a paddle face', () => {
    const baseContext = createInitialBallContext(DEFAULT_PONG_SEED);
    const leftPaddleRight = PONG_FIELD.paddleMargin + PONG_FIELD.paddleWidth;
    const ballY = baseContext.leftPaddleY + 10;

    const result = advanceBall({
      ...baseContext,
      ball: {
        ...baseContext.ball,
        x: leftPaddleRight - PONG_FIELD.ballRadius - 1,
        y: ballY,
        vx: -PONG_FIELD.ballSpeedX,
        vy: 0,
      },
    });

    expect(result.context.ball.vx).toBeLessThan(0);
    expect(result.context.ball.x).toBeLessThan(leftPaddleRight);
  });

  it('cleans up partially started broadcast nodes when startup fails', async () => {
    const broadcastNetwork = new FakeBroadcastChannelNetwork();
    let createdChannels = 0;

    await expect(
      startMeshPongBroadcast({
        channelName: 'mesh-pong-broadcast-startup-failure',
        broadcastChannelFactory: (channelName) => {
          createdChannels += 1;
          if (createdChannels === 2) {
            throw new Error('broadcast channel setup failed');
          }
          return broadcastNetwork.create(channelName);
        },
      })
    ).rejects.toThrow('broadcast channel setup failed');

    expect(broadcastNetwork.size()).toBe(0);
  });

  it('keeps the browser proof panel tied to shared behavior and mode-only startup files', () => {
    expect(MESH_PONG_SHARED_PARITY_PROOF).toMatchObject({
      topologyFile: 'pong-topology.ts',
      behaviorFile: 'pong-behaviors.ts',
      validationGate: 'mesh-pong.test.ts: local = broadcast = websocket',
    });
    expect(MESH_PONG_SHARED_PARITY_PROOF.actors).toEqual(['ball', 'score', 'paddleA', 'paddleB']);

    expect(Object.keys(MESH_PONG_MODE_PARITY_PROOF).sort()).toEqual(['broadcast', 'local', 'mesh']);

    for (const [mode, proof] of Object.entries(MESH_PONG_MODE_PARITY_PROOF)) {
      expect(proof).toBe(parityProofForMode(mode as keyof typeof MESH_PONG_MODE_PARITY_PROOF));
      expect(proof.startupFile).toBe(`modes/${mode}.ts`);
      expect(proof.nodeLayout).toBe('server / a / b');
    }
  });

  it('keeps the Mesh Pong browser entry on the browser-safe agent/runtime boundary', async () => {
    const agentEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, '../packages/actor-agent/src/index.ts'),
      'utf8'
    );

    expect(agentEntrypoint).toContain("from '@actor-web/runtime/browser'");
    expect(agentEntrypoint).not.toContain("import { defineBehavior } from '@actor-web/runtime';");
  });

  it('keeps ready-button copy distinct for ready and not-ready sessions', async () => {
    const uiEntrypoint = await readFile(
      path.resolve(meshPongExamplesDir, 'mesh-pong/ui/main.ts'),
      'utf8'
    );

    expect(uiEntrypoint).toContain("session?.ready ? 'Ready' : 'Mark ready'");
    expect(uiEntrypoint).not.toContain("session?.ready ? 'Ready' : 'Ready'");
  });

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
