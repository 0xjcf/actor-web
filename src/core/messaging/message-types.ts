/**
 * @module framework/core/messaging/message-types
 * @description Shared message type definitions for actor communication
 * @author Agent C - [Date]
 */

// Shared message types that all agents will use

export type ActorEvent<T = unknown> = {
  type: string;
  payload?: T;
  metadata?: EventMetadata;
};

export type Query<TRequest = unknown, TResponse = unknown> = {
  type: 'query';
  request: string;
  params?: TRequest;
  responseType?: TResponse; // For type inference
};

export type EventMetadata = {
  timestamp: number;
  source?: string;
  correlationId?: string;
  causationId?: string;
  userId?: string;
  sessionId?: string;
};

export type ActorMessage<T = unknown> = ActorEvent<T> | Query<T> | SystemMessage;

export type SystemMessage =
  | { type: 'actor.started'; actorId: string }
  | { type: 'actor.stopped'; actorId: string }
  | { type: 'actor.error'; actorId: string; error: Error }
  | { type: 'actor.restarted'; actorId: string; attempt: number };

export interface RequestEnvelope<T = unknown> {
  id: string;
  query: Query<T>;
  timestamp: number;
  timeout?: number;
}

export interface ResponseEnvelope<T = unknown> {
  id: string;
  result?: T;
  error?: Error;
  timestamp: number;
}

export type MailboxOverflowStrategy = 'drop-oldest' | 'drop-newest' | 'reject' | 'expand';

export interface MailboxConfig {
  maxSize: number;
  overflowStrategy: MailboxOverflowStrategy;
  warnThreshold?: number; // Percentage (0-100)
}
