import type { ProjectionTransportStatus } from './projection-transport.js';
import type { RuntimeTransportAuthPayload } from './runtime-auth.js';
import type {
  ActorEventProjection,
  ActorProjectionEventKind,
  ActorSnapshotProjection,
  ActorTransitionRecord,
} from './runtime-projection.js';
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
      mode?: RuntimeGatewaySubscribeMode;
    }
  | { type: 'unsubscribe'; streamId: string }
  | { type: 'resync'; streamId: string; fromSequence?: number }
  | { type: 'send'; streamId: string; requestId?: string; message: Message }
  | { type: 'ask'; streamId: string; requestId: string; message: Message; timeoutMs?: number }
  | { type: 'ping'; sentAt: string };

export type RuntimeGatewayServerFrame =
  | { type: 'ready'; connectionId: string; heartbeatMs: number; serverTime: string }
  | {
      type: 'snapshot';
      streamId: string;
      sequence: number;
      projection: ActorSnapshotProjection;
    }
  | {
      type: 'event';
      streamId: string;
      sequence: number;
      projection: ActorEventProjection;
    }
  | {
      type: 'transition';
      streamId: string;
      sequence: number;
      transition: ActorTransitionRecord;
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

export type RuntimeGatewaySourceHandle<TSource = unknown, TCommandSource = never> = {
  readonly source: TSource;
  stop(): void | Promise<void>;
} & ([TCommandSource] extends [never]
  ? { readonly commandSource?: never }
  : { readonly commandSource: TCommandSource });

export function createRuntimeGatewaySourceHandle<TSource>(
  source: TSource
): RuntimeGatewaySourceHandle<TSource, never>;
export function createRuntimeGatewaySourceHandle<TSource, TCommandSource>(
  source: TSource,
  commandSource: TCommandSource
): RuntimeGatewaySourceHandle<TSource, TCommandSource>;
export function createRuntimeGatewaySourceHandle<TSource, TCommandSource>(
  source: TSource,
  commandSource?: TCommandSource
): RuntimeGatewaySourceHandle<TSource, TCommandSource> {
  const closeSource = source as { close?: () => void | Promise<void> };
  const closeCommandSource = commandSource as { close?: () => void | Promise<void> } | undefined;

  return {
    source,
    ...(commandSource ? { commandSource } : {}),
    async stop(): Promise<void> {
      await closeSource.close?.();
      if (commandSource && commandSource !== (source as unknown)) {
        await closeCommandSource?.close?.();
      }
    },
  } as RuntimeGatewaySourceHandle<TSource, TCommandSource>;
}

export type RuntimeGatewaySubscribeMode = 'full' | 'command-only';

export type { ActorProjectionEventKind };
