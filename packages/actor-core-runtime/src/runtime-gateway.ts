import { createHash, randomUUID } from 'node:crypto';
import type { ActorRef } from './actor-ref.js';
import type { ActorAddress, ActorMessage } from './actor-system.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from './projection-transport.js';
import {
  type RuntimeGatewayAuthProvider,
  type RuntimeTransportAuthPayload,
  verifyRuntimeGatewayAuth,
} from './runtime-auth.js';
import {
  actorMessageToRuntimeGatewayEventEnvelope,
  actorSnapshotsToRuntimeGatewayTransitionRecord,
  actorSnapshotToRuntimeGatewayWorkflowSnapshot,
  type RuntimeGatewayEventKind,
  type RuntimeGatewayEventProjection,
  type RuntimeGatewaySnapshotProjection,
  type RuntimeGatewayTransitionRecord,
} from './runtime-gateway-projection.js';
import type { Message } from './types.js';

export interface RuntimeGatewayScopeDescriptor {
  kind: string;
  params?: Record<string, string>;
}

export type RuntimeGatewayErrorCode =
  | 'invalid_frame'
  | 'invalid_scope'
  | 'not_found'
  | 'forbidden'
  | 'unauthorized'
  | 'bad_sequence'
  | 'internal_error';

export type {
  RuntimeGatewayEventEnvelope,
  RuntimeGatewayEventKind,
  RuntimeGatewayEventProjection,
  RuntimeGatewaySnapshotProjection,
  RuntimeGatewayTransitionRecord,
  RuntimeGatewayWorkflowSnapshot,
} from './runtime-gateway-projection.js';

export type RuntimeGatewayClientFrame =
  | {
      type: 'hello';
      lastConnectionId?: string | null;
      clientVersion?: string;
      auth?: RuntimeTransportAuthPayload;
    }
  | {
      type: 'subscribe';
      streamId: string;
      scope: RuntimeGatewayScopeDescriptor;
      fromSequence?: number;
    }
  | { type: 'unsubscribe'; streamId: string }
  | { type: 'resync'; streamId: string; fromSequence?: number }
  | { type: 'send'; streamId: string; message: Message }
  | { type: 'ask'; streamId: string; requestId: string; message: Message; timeoutMs?: number }
  | { type: 'ping'; sentAt: string };

export type RuntimeGatewayServerFrame =
  | { type: 'ready'; connectionId: string; heartbeatMs: number; serverTime: string }
  | {
      type: 'snapshot';
      streamId: string;
      sequence: number;
      projection: RuntimeGatewaySnapshotProjection;
    }
  | {
      type: 'event';
      streamId: string;
      sequence: number;
      projection: RuntimeGatewayEventProjection;
    }
  | {
      type: 'transition';
      streamId: string;
      sequence: number;
      transition: RuntimeGatewayTransitionRecord;
    }
  | {
      type: 'status';
      streamId: string;
      status: ProjectionTransportStatus;
    }
  | {
      type: 'error';
      streamId?: string;
      requestId?: string;
      code: RuntimeGatewayErrorCode;
      message: string;
      recoverable: boolean;
    }
  | { type: 'ack'; streamId: string; requestId?: string }
  | { type: 'reply'; streamId: string; requestId: string; value: unknown }
  | { type: 'pong'; sentAt: string; serverTime: string };

export interface RuntimeGatewayConnectionAdapter<TAuthContext = unknown> {
  readonly authContext: TAuthContext;
  receive(
    listener: (frame: RuntimeGatewayClientFrame) => void,
    onInvalidFrame?: (event: RuntimeGatewayInvalidFrameEvent) => void
  ): () => void;
  onClose(listener: () => void): () => void;
  send(frame: RuntimeGatewayServerFrame): void | Promise<void>;
  close?(): void | Promise<void>;
}

export interface RuntimeGatewayInvalidFrameEvent {
  readonly reason: string;
  readonly detail?: string;
}

export interface RuntimeGatewayObserverEvent {
  readonly type: 'invalid_frame' | 'inbound_queue_overflow';
  readonly connectionId: string;
  readonly timestamp: string;
  readonly message: string;
  readonly queueDepth?: number;
  readonly queueLimit?: number;
  readonly detail?: string;
}

export interface RuntimeGatewayReadModelSource {
  readonly address: ActorAddress;
  snapshot(): RuntimeGatewaySnapshotProjection;
  subscribeSnapshot(listener: (projection: RuntimeGatewaySnapshotProjection) => void): () => void;
  subscribeEvent(listener: (projection: RuntimeGatewayEventProjection) => void): () => void;
  transportStatus(): ProjectionTransportStatus;
  subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void;
  subscribeTransition?(listener: (transition: RuntimeGatewayTransitionRecord) => void): () => void;
}

export interface RuntimeGatewayCommandSource extends RuntimeGatewayReadModelSource {
  send?(message: Message): Promise<void>;
  ask?<TResponse = unknown>(message: Message, timeoutMs?: number): Promise<TResponse>;
}

export type RuntimeGatewaySource = RuntimeGatewayCommandSource;

export type RuntimeGatewayScopeResolver<TAuthContext = unknown> = (
  scope: RuntimeGatewayScopeDescriptor,
  authContext: TAuthContext
) => Promise<RuntimeGatewaySource | null>;

export interface CreateRuntimeGatewaySourceOptions {
  workflowId?: string;
  taskId?: string;
  taskTitle?: string;
  correlationId?: string;
  eventKind?: RuntimeGatewayEventKind;
  sourceActor?: string;
  now?: () => Date;
}

export interface CreateRuntimeGatewayHubOptions<TAuthContext = unknown> {
  resolveScope: RuntimeGatewayScopeResolver<TAuthContext>;
  heartbeatMs?: number;
  replayBufferSize?: number;
  inboundQueueLimit?: number;
  replayStorage?: RuntimeGatewayReplayStorageProvider;
  onReplayStorageError?: (event: RuntimeGatewayReplayStorageErrorEvent) => void;
  observer?: (event: RuntimeGatewayObserverEvent) => void;
  auth?: RuntimeGatewayAuthProvider<{
    readonly connectionId: string;
    readonly clientVersion?: string;
  }>;
}

export class RuntimeGatewayScopeError extends Error {
  constructor(
    readonly code: Exclude<
      RuntimeGatewayErrorCode,
      'invalid_frame' | 'internal_error' | 'bad_sequence'
    >,
    message: string,
    readonly recoverable = true
  ) {
    super(message);
    this.name = 'RuntimeGatewayScopeError';
  }
}

function requireSnapshotSubscription(
  actorRef: ActorRef<unknown, ActorMessage>
): (listener: (snapshot: ReturnType<typeof actorRef.getSnapshot>) => void) => () => void {
  if (typeof actorRef.subscribeSnapshot !== 'function') {
    throw new Error(
      'ActorRef does not expose snapshot subscriptions. Use a ref that exposes subscribeSnapshot().'
    );
  }

  return actorRef.subscribeSnapshot.bind(actorRef);
}

function getTransportStatus(actorRef: ActorRef<unknown, ActorMessage>): ProjectionTransportStatus {
  return actorRef.getTransportStatus?.() ?? createProjectionTransportStatus('local');
}

function subscribeTransportStatus(
  actorRef: ActorRef<unknown, ActorMessage>,
  listener: (status: ProjectionTransportStatus) => void
): () => void {
  if (typeof actorRef.subscribeTransportStatus === 'function') {
    return actorRef.subscribeTransportStatus(listener);
  }

  listener(getTransportStatus(actorRef));
  return () => {};
}

export function createRuntimeGatewayReadModelSource(
  actorRef: ActorRef<unknown, ActorMessage>,
  options: CreateRuntimeGatewaySourceOptions = {}
): RuntimeGatewayReadModelSource {
  const subscribeActorSnapshot = requireSnapshotSubscription(actorRef);
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  let lastEventType: string | null = null;

  const toSnapshotProjection = (
    snapshot: ReturnType<typeof actorRef.getSnapshot>
  ): RuntimeGatewaySnapshotProjection => {
    const updatedAt = (options.now ?? (() => new Date()))().toISOString();

    return {
      address: actorRef.address,
      workflowSnapshot: actorSnapshotToRuntimeGatewayWorkflowSnapshot({
        snapshot,
        workflowId: options.workflowId ?? actorRef.address.path,
        actorId: actorRef.address.id,
        taskId: options.taskId ?? actorRef.address.id,
        taskTitle: options.taskTitle ?? actorRef.address.id,
        createdAt,
        updatedAt,
        correlationId: options.correlationId ?? actorRef.address.path,
        lastEventType,
      }),
      value: snapshot.value,
      context: snapshot.context,
    };
  };

  const toEventProjection = (event: ActorMessage): RuntimeGatewayEventProjection => {
    lastEventType = event.type;

    return {
      address: actorRef.address,
      envelope: actorMessageToRuntimeGatewayEventEnvelope(
        event as unknown as ActorMessage & Record<string, unknown>,
        {
          id: randomUUID(),
          kind: options.eventKind ?? 'fact',
          occurredAt: (options.now ?? (() => new Date()))().toISOString(),
          sourceActor: options.sourceActor ?? actorRef.address.path,
          workflowId: options.workflowId,
          taskId: options.taskId,
          correlationId: options.correlationId,
        }
      ),
    };
  };

  return {
    address: actorRef.address,
    snapshot(): RuntimeGatewaySnapshotProjection {
      return toSnapshotProjection(actorRef.getSnapshot());
    },
    subscribeSnapshot(
      listener: (projection: RuntimeGatewaySnapshotProjection) => void
    ): () => void {
      listener(toSnapshotProjection(actorRef.getSnapshot()));

      return subscribeActorSnapshot((snapshot) => {
        listener(toSnapshotProjection(snapshot));
      });
    },
    subscribeEvent(listener: (projection: RuntimeGatewayEventProjection) => void): () => void {
      if (typeof actorRef.subscribeEvent !== 'function') {
        return () => {};
      }

      try {
        return actorRef.subscribeEvent((event) => {
          listener(toEventProjection(event));
        });
      } catch {
        return () => {};
      }
    },
    transportStatus(): ProjectionTransportStatus {
      return getTransportStatus(actorRef);
    },
    subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void {
      return subscribeTransportStatus(actorRef, listener);
    },
    subscribeTransition(
      listener: (transition: RuntimeGatewayTransitionRecord) => void
    ): () => void {
      let previousSnapshot: ReturnType<typeof actorRef.getSnapshot> | null = actorRef.getSnapshot();

      return subscribeActorSnapshot((snapshot) => {
        if (!previousSnapshot) {
          previousSnapshot = snapshot;
          return;
        }

        const transition = actorSnapshotsToRuntimeGatewayTransitionRecord({
          fromSnapshot: previousSnapshot,
          toSnapshot: snapshot,
        });
        previousSnapshot = snapshot;

        if (
          transition.fromPhase === transition.toPhase &&
          transition.fromStatus === transition.toStatus
        ) {
          return;
        }

        listener(transition);
      });
    },
  };
}

export function createRuntimeGatewayCommandSource(
  actorRef: ActorRef<unknown, ActorMessage>,
  options: CreateRuntimeGatewaySourceOptions = {}
): RuntimeGatewayCommandSource {
  const source = createRuntimeGatewayReadModelSource(actorRef, options);

  return {
    ...source,
    async send(message: ActorMessage): Promise<void> {
      await actorRef.send(message);
    },
    async ask<TResponse = unknown>(message: Message, timeoutMs?: number): Promise<TResponse> {
      return actorRef.ask<TResponse>(message, timeoutMs);
    },
  };
}

export function createRuntimeGatewaySource(
  actorRef: ActorRef<unknown, ActorMessage>,
  options: CreateRuntimeGatewaySourceOptions = {}
): RuntimeGatewaySource {
  return createRuntimeGatewayCommandSource(actorRef, options);
}

type RuntimeGatewayStreamState = {
  replaySessionId: string;
  replayStorageStreamId: string;
  source: RuntimeGatewaySource;
  sequence: number;
  replayFrames: RuntimeGatewayReplayFrame[];
  lastSnapshot: RuntimeGatewaySnapshotProjection | null;
  unsubscribeSnapshot: () => void;
  unsubscribeEvent: () => void;
  unsubscribeStatus: () => void;
  unsubscribeTransition: () => void;
};

const OUTBOUND_SEND_FAILURE_THRESHOLD = 3;
const OUTBOUND_SEND_ATTEMPT_TIMEOUT_MS = 5000;
const DEFAULT_INBOUND_QUEUE_LIMIT = 64;

export type RuntimeGatewayReplayFrame = Extract<
  RuntimeGatewayServerFrame,
  { type: 'snapshot' | 'event' | 'transition' }
>;

export interface RuntimeGatewayReplayStorageProvider {
  loadFrames(
    replaySessionId: string,
    streamId: string
  ): RuntimeGatewayReplayFrame[] | Promise<RuntimeGatewayReplayFrame[]>;
  storeFrames(
    replaySessionId: string,
    streamId: string,
    frames: RuntimeGatewayReplayFrame[]
  ): void | Promise<void>;
}

export interface RuntimeGatewayReplayStorageErrorEvent {
  operation: 'load' | 'store';
  replaySessionId: string;
  streamId: string;
  error: unknown;
  frameCount?: number;
}

type RuntimeGatewayReplayFrameDraft = RuntimeGatewayReplayFrame extends infer TFrame
  ? TFrame extends RuntimeGatewayReplayFrame
    ? Omit<TFrame, 'sequence'>
    : never
  : never;

function runtimeGatewayReplayStorageKey(replaySessionId: string, streamId: string): string {
  return `${replaySessionId}::${streamId}`;
}

function toCanonicalAuthOwnerValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (Array.isArray(value)) {
    const normalizedEntries = value.flatMap((entry) => {
      const normalizedValue = toCanonicalAuthOwnerValue(entry);
      return normalizedValue === null ? [] : [normalizedValue];
    });
    return normalizedEntries.length > 0 ? normalizedEntries : null;
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, entryValue]) => {
        const normalizedValue = toCanonicalAuthOwnerValue(entryValue);
        return normalizedValue === null ? [] : ([[key, normalizedValue]] as const);
      });

    return normalizedEntries.length > 0 ? Object.fromEntries(normalizedEntries) : null;
  }

  return null;
}

function stableRuntimeGatewayAuthOwnerKey(authContext: unknown): string | null {
  const canonicalValue = toCanonicalAuthOwnerValue(authContext);
  if (canonicalValue === null) {
    return null;
  }

  return `auth:${createHash('sha256').update(JSON.stringify(canonicalValue)).digest('base64url')}`;
}

function toCanonicalScopeValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => toCanonicalScopeValue(entry));
  }

  if (typeof value === 'object') {
    const normalizedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, toCanonicalScopeValue(entryValue)] as const);

    return Object.fromEntries(normalizedEntries);
  }

  return String(value);
}

function canonicalRuntimeGatewayScope(scope: RuntimeGatewayScopeDescriptor): string {
  return JSON.stringify(
    toCanonicalScopeValue({
      kind: scope.kind,
      params: scope.params ?? {},
    })
  );
}

function runtimeGatewayReplayStorageStreamId(
  streamId: string,
  scope: RuntimeGatewayScopeDescriptor
): string {
  return `${streamId}::${canonicalRuntimeGatewayScope(scope)}`;
}

function replayFrameAddress(frame: RuntimeGatewayReplayFrame): ActorAddress | null {
  if (frame.type === 'snapshot' || frame.type === 'event') {
    return frame.projection.address;
  }

  return null;
}

function addressesMatch(left: ActorAddress, right: ActorAddress): boolean {
  return left.id === right.id && left.type === right.type && left.path === right.path;
}

function restoredReplayFramesMatchSource(
  frames: RuntimeGatewayReplayFrame[],
  source: RuntimeGatewaySource
): boolean {
  if (frames.length === 0) {
    return true;
  }

  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const address = replayFrameAddress(frames[index] as RuntimeGatewayReplayFrame);
    if (!address) {
      continue;
    }

    return addressesMatch(address, source.address);
  }

  return false;
}

function normalizeInboundQueueLimit(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_INBOUND_QUEUE_LIMIT;
  }

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_INBOUND_QUEUE_LIMIT;
  }

  return value;
}

export function createRuntimeGatewayHub<TAuthContext = unknown>(
  options: CreateRuntimeGatewayHubOptions<TAuthContext>
): {
  attach(connection: RuntimeGatewayConnectionAdapter<TAuthContext>): () => void;
} {
  const heartbeatMs = options.heartbeatMs ?? 15000;
  const replayBufferSize = options.replayBufferSize ?? 256;
  const inboundQueueLimit = normalizeInboundQueueLimit(options.inboundQueueLimit);
  const replayStorage = options.replayStorage;
  const onReplayStorageError = options.onReplayStorageError;
  const observer = options.observer;
  const replayPersistQueue = new Map<string, Promise<void>>();

  return {
    attach(connection: RuntimeGatewayConnectionAdapter<TAuthContext>): () => void {
      const connectionId = randomUUID();
      const streams = new Map<string, RuntimeGatewayStreamState>();
      let greeted = false;
      let replaySessionId: string = connectionId;
      let replayOwnerKey: string | null = stableRuntimeGatewayAuthOwnerKey(connection.authContext);
      let authenticatedAuthContext = connection.authContext;
      const pendingFrames: RuntimeGatewayClientFrame[] = [];
      let processingFrame = false;
      let terminated = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;
      let nextSendAttemptId = 0;
      let nextSendOutcomeToProcess = 1;
      let consecutiveSendFailures = 0;
      const settledSendOutcomes = new Map<number, 'success' | 'failure'>();
      const sendAttemptTimeouts = new Map<number, ReturnType<typeof setTimeout>>();

      const cleanupStream = (streamId: string): void => {
        const stream = streams.get(streamId);
        if (!stream) {
          return;
        }

        void Promise.resolve(stream.unsubscribeSnapshot()).catch(() => {});
        void Promise.resolve(stream.unsubscribeEvent()).catch(() => {});
        void Promise.resolve(stream.unsubscribeStatus()).catch(() => {});
        void Promise.resolve(stream.unsubscribeTransition()).catch(() => {});
        streams.delete(streamId);
      };

      const cleanupAll = (): void => {
        pendingFrames.length = 0;
        for (const streamId of Array.from(streams.keys())) {
          cleanupStream(streamId);
        }
      };

      const emitObserverEvent = (
        event: Omit<RuntimeGatewayObserverEvent, 'connectionId'>
      ): void => {
        if (!observer) {
          return;
        }

        try {
          observer({
            connectionId,
            ...event,
          });
        } catch {
          // Observer hooks must not make gateway cleanup unsafe.
        }
      };

      const clearIdleTimer = (): void => {
        if (idleTimer === null) {
          return;
        }

        clearTimeout(idleTimer);
        idleTimer = null;
      };

      const clearSendAttemptTimeout = (attemptId: number): void => {
        const timeout = sendAttemptTimeouts.get(attemptId);
        if (!timeout) {
          return;
        }

        clearTimeout(timeout);
        sendAttemptTimeouts.delete(attemptId);
      };

      const clearSendAttemptTimeouts = (): void => {
        for (const timeout of sendAttemptTimeouts.values()) {
          clearTimeout(timeout);
        }
        sendAttemptTimeouts.clear();
      };

      const terminateConnection = (): void => {
        if (terminated) {
          return;
        }

        terminated = true;
        clearIdleTimer();
        clearSendAttemptTimeouts();
        cleanupAll();
        void Promise.resolve(connection.close?.()).catch(() => {});
      };

      const armIdleTimer = (): void => {
        clearIdleTimer();
        if (terminated || heartbeatMs <= 0) {
          return;
        }

        idleTimer = setTimeout(() => {
          idleTimer = null;
          terminateConnection();
        }, heartbeatMs);
      };

      const markConnectionActive = (): void => {
        if (terminated) {
          return;
        }

        armIdleTimer();
      };

      const send = (frame: RuntimeGatewayServerFrame): void => {
        if (terminated) {
          return;
        }

        const processSettledSendOutcomes = (): void => {
          while (!terminated && settledSendOutcomes.has(nextSendOutcomeToProcess)) {
            const outcome = settledSendOutcomes.get(nextSendOutcomeToProcess);
            settledSendOutcomes.delete(nextSendOutcomeToProcess);
            nextSendOutcomeToProcess += 1;

            if (outcome === 'success') {
              consecutiveSendFailures = 0;
              continue;
            }

            consecutiveSendFailures += 1;
            if (consecutiveSendFailures >= OUTBOUND_SEND_FAILURE_THRESHOLD) {
              terminateConnection();
            }
          }
        };

        const attemptId = nextSendAttemptId + 1;
        nextSendAttemptId = attemptId;
        let settled = false;
        const recordSendOutcome = (outcome: 'success' | 'failure'): void => {
          if (terminated || settled) {
            return;
          }

          settled = true;
          clearSendAttemptTimeout(attemptId);
          settledSendOutcomes.set(attemptId, outcome);
          processSettledSendOutcomes();
        };

        try {
          sendAttemptTimeouts.set(
            attemptId,
            setTimeout(() => {
              // Late settles must not rewrite newer failure accounting once this attempt times out.
              sendAttemptTimeouts.delete(attemptId);
              recordSendOutcome('failure');
            }, OUTBOUND_SEND_ATTEMPT_TIMEOUT_MS)
          );
          void Promise.resolve(connection.send(frame)).then(
            () => {
              recordSendOutcome('success');
            },
            () => {
              recordSendOutcome('failure');
            }
          );
        } catch {
          recordSendOutcome('failure');
        }
      };

      const rejectIngress = (
        code: RuntimeGatewayErrorCode,
        message: string,
        event: Omit<RuntimeGatewayObserverEvent, 'connectionId' | 'message'>
      ): void => {
        emitObserverEvent({
          ...event,
          message,
        });
        sendError(code, message, false);
        terminateConnection();
      };

      const sendError = (
        code: RuntimeGatewayErrorCode,
        message: string,
        recoverable: boolean,
        streamId?: string,
        requestId?: string
      ): void => {
        send({
          type: 'error',
          ...(streamId !== undefined ? { streamId } : {}),
          ...(requestId !== undefined ? { requestId } : {}),
          code,
          message,
          recoverable,
        });
      };

      const sendStatus = (streamId: string, status: ProjectionTransportStatus): void => {
        send({
          type: 'status',
          streamId,
          status,
        });
      };

      const reportReplayStorageError = (event: RuntimeGatewayReplayStorageErrorEvent): void => {
        if (!onReplayStorageError) {
          return;
        }

        try {
          onReplayStorageError(event);
        } catch {}
      };

      const nextSequence = (stream: RuntimeGatewayStreamState): number => {
        stream.sequence += 1;
        return stream.sequence;
      };

      const trimReplayFrames = (
        frames: RuntimeGatewayReplayFrame[]
      ): RuntimeGatewayReplayFrame[] => {
        if (replayBufferSize <= 0) {
          return [];
        }

        return frames.slice(-replayBufferSize);
      };

      const latestSnapshotFromFrames = (
        frames: RuntimeGatewayReplayFrame[]
      ): RuntimeGatewaySnapshotProjection | null => {
        for (let index = frames.length - 1; index >= 0; index -= 1) {
          const frame = frames[index];
          if (frame?.type === 'snapshot') {
            return frame.projection;
          }
        }

        return null;
      };

      const persistReplayFrames = (streamId: string, stream: RuntimeGatewayStreamState): void => {
        if (!replayStorage) {
          return;
        }

        const replayKey = runtimeGatewayReplayStorageKey(
          stream.replaySessionId,
          stream.replayStorageStreamId
        );
        const frames = [...stream.replayFrames];
        const previousPersist = replayPersistQueue.get(replayKey) ?? Promise.resolve();
        const nextPersist = previousPersist
          .catch(() => {})
          .then(() =>
            replayStorage.storeFrames(stream.replaySessionId, stream.replayStorageStreamId, frames)
          )
          .catch((error) => {
            reportReplayStorageError({
              operation: 'store',
              replaySessionId: stream.replaySessionId,
              streamId,
              error,
              frameCount: frames.length,
            });
          });
        replayPersistQueue.set(replayKey, nextPersist);
        void nextPersist.finally(() => {
          if (replayPersistQueue.get(replayKey) === nextPersist) {
            replayPersistQueue.delete(replayKey);
          }
        });
      };

      const rememberReplayFrame = (
        streamId: string,
        stream: RuntimeGatewayStreamState,
        frame: RuntimeGatewayReplayFrame
      ): void => {
        stream.replayFrames = trimReplayFrames([...stream.replayFrames, frame]);
        persistReplayFrames(streamId, stream);
      };

      const sendSequenced = (
        streamId: string,
        stream: RuntimeGatewayStreamState,
        frame: RuntimeGatewayReplayFrameDraft
      ): void => {
        const sequencedFrame = {
          ...frame,
          sequence: nextSequence(stream),
        } as RuntimeGatewayReplayFrame;
        rememberReplayFrame(streamId, stream, sequencedFrame);
        send(sequencedFrame);
      };

      const subscribeStream = async (
        streamId: string,
        scope: RuntimeGatewayScopeDescriptor
      ): Promise<void> => {
        if (terminated) {
          return;
        }

        cleanupStream(streamId);

        let source: RuntimeGatewaySource | null = null;
        try {
          source = await options.resolveScope(scope, authenticatedAuthContext);
        } catch (error) {
          if (terminated) {
            return;
          }

          if (error instanceof RuntimeGatewayScopeError) {
            sendError(error.code, error.message, error.recoverable, streamId);
            return;
          }

          sendError(
            'internal_error',
            error instanceof Error ? error.message : 'Internal gateway resolver error.',
            false,
            streamId
          );
          return;
        }

        if (!source) {
          sendError('not_found', 'Requested runtime scope was not found.', true, streamId);
          return;
        }

        const replayStorageStreamId = runtimeGatewayReplayStorageStreamId(streamId, scope);
        const restoredReplayFrames = replayStorage
          ? await Promise.resolve()
              .then(() => replayStorage.loadFrames(replaySessionId, replayStorageStreamId))
              .then((frames) => trimReplayFrames(frames))
              .catch((error) => {
                reportReplayStorageError({
                  operation: 'load',
                  replaySessionId,
                  streamId,
                  error,
                });
                return [];
              })
          : [];
        const replayFrames = restoredReplayFramesMatchSource(restoredReplayFrames, source)
          ? restoredReplayFrames
          : [];

        if (terminated) {
          return;
        }

        const stream: RuntimeGatewayStreamState = {
          replaySessionId,
          replayStorageStreamId,
          source,
          sequence: replayFrames.at(-1)?.sequence ?? 0,
          replayFrames,
          lastSnapshot: latestSnapshotFromFrames(replayFrames),
          unsubscribeSnapshot: () => {},
          unsubscribeEvent: () => {},
          unsubscribeStatus: () => {},
          unsubscribeTransition: () => {},
        };
        streams.set(streamId, stream);

        stream.unsubscribeStatus = source.subscribeTransportStatus((status) => {
          sendStatus(streamId, status);
        });

        stream.unsubscribeSnapshot = source.subscribeSnapshot((projection) => {
          stream.lastSnapshot = projection;
          sendSequenced(streamId, stream, {
            type: 'snapshot',
            streamId,
            projection,
          });
        });

        stream.unsubscribeEvent = source.subscribeEvent((projection) => {
          sendSequenced(streamId, stream, {
            type: 'event',
            streamId,
            projection,
          });
        });

        stream.unsubscribeTransition = source.subscribeTransition
          ? source.subscribeTransition((transition) => {
              sendSequenced(streamId, stream, {
                type: 'transition',
                streamId,
                transition,
              });
            })
          : () => {};
      };

      const resyncStream = (streamId: string, fromSequence?: number): void => {
        const stream = streams.get(streamId);
        if (!stream) {
          sendError('not_found', 'Cannot resync an unsubscribed stream.', true, streamId);
          return;
        }

        if (
          fromSequence !== undefined &&
          (!Number.isFinite(fromSequence) || fromSequence < 0 || !Number.isInteger(fromSequence))
        ) {
          sendError('bad_sequence', 'fromSequence must be a non-negative integer.', true, streamId);
          return;
        }

        sendStatus(streamId, createProjectionTransportStatus('replaying'));
        const replayFrames =
          fromSequence === undefined
            ? []
            : stream.replayFrames.filter((frame) => frame.sequence >= fromSequence);
        const canReplay =
          fromSequence !== undefined &&
          replayFrames.length > 0 &&
          replayFrames[0]?.sequence === fromSequence &&
          replayFrames.every((frame, index) => frame.sequence === fromSequence + index);

        if (canReplay) {
          for (const frame of replayFrames) {
            send(frame);
          }
        } else {
          const projection = stream.source.snapshot();
          stream.lastSnapshot = projection;
          sendSequenced(streamId, stream, {
            type: 'snapshot',
            streamId,
            projection,
          });
        }
        sendStatus(streamId, stream.source.transportStatus());
      };

      const isValidMessage = (message: unknown): message is Message =>
        Boolean(
          message &&
            typeof message === 'object' &&
            'type' in message &&
            typeof (message as { type?: unknown }).type === 'string' &&
            (message as { type: string }).type.trim().length > 0
        );

      const commandStream = (streamId: string): RuntimeGatewayStreamState | null => {
        if (typeof streamId !== 'string' || streamId.trim().length === 0) {
          sendError('invalid_frame', 'command requires a non-empty streamId.', true);
          return null;
        }

        const stream = streams.get(streamId);
        if (!stream) {
          sendError('not_found', 'Cannot send command to an unsubscribed stream.', true, streamId);
          return null;
        }

        return stream;
      };

      const sendCommand = async (streamId: string, message: unknown): Promise<void> => {
        const stream = commandStream(streamId);
        if (!stream) {
          return;
        }

        if (!isValidMessage(message)) {
          sendError('invalid_frame', 'send requires a valid actor message.', true, streamId);
          return;
        }

        if (!stream.source.send) {
          sendError('forbidden', 'Runtime scope does not accept commands.', false, streamId);
          return;
        }

        try {
          await stream.source.send(message);
          send({ type: 'ack', streamId });
        } catch (error) {
          sendError(
            'internal_error',
            error instanceof Error ? error.message : 'Runtime command failed.',
            false,
            streamId
          );
        }
      };

      const askCommand = async (
        streamId: string,
        requestId: unknown,
        message: unknown,
        timeoutMs?: unknown
      ): Promise<void> => {
        const stream = commandStream(streamId);
        if (!stream) {
          return;
        }

        if (typeof requestId !== 'string' || requestId.trim().length === 0) {
          sendError('invalid_frame', 'ask requires a non-empty requestId.', true, streamId);
          return;
        }

        if (!isValidMessage(message)) {
          sendError(
            'invalid_frame',
            'ask requires a valid actor message.',
            true,
            streamId,
            requestId
          );
          return;
        }

        const normalizedTimeoutMs =
          timeoutMs === undefined
            ? undefined
            : typeof timeoutMs === 'number' &&
                Number.isFinite(timeoutMs) &&
                timeoutMs > 0 &&
                Number.isInteger(timeoutMs)
              ? timeoutMs
              : null;

        if (normalizedTimeoutMs === null) {
          sendError(
            'invalid_frame',
            'timeoutMs must be a positive integer.',
            true,
            streamId,
            requestId
          );
          return;
        }

        if (!stream.source.ask) {
          sendError(
            'forbidden',
            'Runtime scope does not accept ask commands.',
            false,
            streamId,
            requestId
          );
          return;
        }

        try {
          const value = await stream.source.ask(message, normalizedTimeoutMs);
          send({ type: 'reply', streamId, requestId, value });
        } catch (error) {
          sendError(
            'internal_error',
            error instanceof Error ? error.message : 'Runtime ask failed.',
            false,
            streamId,
            requestId
          );
        }
      };

      const isValidScopeDescriptor = (scope: unknown): scope is RuntimeGatewayScopeDescriptor =>
        Boolean(
          scope &&
            typeof scope === 'object' &&
            'kind' in scope &&
            typeof (scope as RuntimeGatewayScopeDescriptor).kind === 'string' &&
            (scope as RuntimeGatewayScopeDescriptor).kind.trim().length > 0 &&
            (!('params' in scope) ||
              (scope as RuntimeGatewayScopeDescriptor).params === undefined ||
              ((scope as RuntimeGatewayScopeDescriptor).params !== null &&
                typeof (scope as RuntimeGatewayScopeDescriptor).params === 'object'))
        );

      const receiveFrame = async (frame: RuntimeGatewayClientFrame): Promise<void> => {
        if (!frame || typeof frame !== 'object' || typeof frame.type !== 'string') {
          sendError('invalid_frame', 'Gateway frame must be an object with a type field.', true);
          return;
        }

        if (frame.type !== 'hello' && !greeted) {
          sendError('invalid_frame', 'Send hello before subscribing to runtime streams.', true);
          return;
        }

        switch (frame.type) {
          case 'hello': {
            if (options.auth) {
              const auth = await verifyRuntimeGatewayAuth(options.auth, {
                auth: frame.auth,
                connectionId,
                clientVersion: frame.clientVersion,
              });
              if (!auth.ok) {
                sendError('unauthorized', auth.reason, false);
                terminateConnection();
                return;
              }
              authenticatedAuthContext =
                auth.authContext === undefined
                  ? connection.authContext
                  : (auth.authContext as TAuthContext);
            }
            greeted = true;
            replayOwnerKey = stableRuntimeGatewayAuthOwnerKey(authenticatedAuthContext);
            const requestedReplaySessionId =
              typeof frame.lastConnectionId === 'string' && frame.lastConnectionId.trim().length > 0
                ? frame.lastConnectionId.trim()
                : connectionId;
            replaySessionId = replayOwnerKey
              ? `${replayOwnerKey}::${requestedReplaySessionId}`
              : connectionId;
            send({
              type: 'ready',
              connectionId,
              heartbeatMs,
              serverTime: new Date().toISOString(),
            });
            return;
          }
          case 'ping':
            send({
              type: 'pong',
              sentAt: frame.sentAt,
              serverTime: new Date().toISOString(),
            });
            return;
          case 'unsubscribe':
            if (typeof frame.streamId !== 'string' || frame.streamId.trim().length === 0) {
              sendError('invalid_frame', 'unsubscribe requires a non-empty streamId.', true);
              return;
            }
            cleanupStream(frame.streamId);
            return;
          case 'resync':
            if (typeof frame.streamId !== 'string' || frame.streamId.trim().length === 0) {
              sendError('invalid_frame', 'resync requires a non-empty streamId.', true);
              return;
            }
            resyncStream(frame.streamId, frame.fromSequence);
            return;
          case 'send':
            await sendCommand(frame.streamId, frame.message);
            return;
          case 'ask':
            await askCommand(frame.streamId, frame.requestId, frame.message, frame.timeoutMs);
            return;
          case 'subscribe':
            if (typeof frame.streamId !== 'string' || frame.streamId.trim().length === 0) {
              sendError('invalid_frame', 'subscribe requires a non-empty streamId.', true);
              return;
            }
            if (!isValidScopeDescriptor(frame.scope)) {
              sendError('invalid_scope', 'subscribe requires a valid scope descriptor.', true);
              return;
            }
            await subscribeStream(frame.streamId, frame.scope);
            return;
        }
      };

      const processNextFrame = (): void => {
        if (processingFrame || terminated) {
          return;
        }

        const frame = pendingFrames.shift();
        if (!frame) {
          return;
        }

        processingFrame = true;
        void receiveFrame(frame)
          .catch((error) => {
            sendError(
              'internal_error',
              error instanceof Error ? error.message : 'Internal gateway frame handling error.',
              false
            );
          })
          .finally(() => {
            processingFrame = false;
            processNextFrame();
          });
      };

      const unsubscribeReceive = connection.receive(
        (frame) => {
          if (terminated) {
            return;
          }

          if (pendingFrames.length >= inboundQueueLimit) {
            rejectIngress('invalid_frame', 'Gateway inbound queue limit exceeded.', {
              type: 'inbound_queue_overflow',
              timestamp: new Date().toISOString(),
              queueDepth: pendingFrames.length,
              queueLimit: inboundQueueLimit,
            });
            return;
          }

          markConnectionActive();
          pendingFrames.push(frame);
          processNextFrame();
        },
        (event) => {
          if (terminated) {
            return;
          }

          rejectIngress('invalid_frame', event.reason, {
            type: 'invalid_frame',
            timestamp: new Date().toISOString(),
            detail: event.detail,
          });
        }
      );
      const unsubscribeClose = connection.onClose(() => {
        terminated = true;
        clearIdleTimer();
        clearSendAttemptTimeouts();
        cleanupAll();
      });

      armIdleTimer();

      return () => {
        terminated = true;
        clearIdleTimer();
        unsubscribeReceive();
        unsubscribeClose();
        cleanupAll();
      };
    },
  };
}
