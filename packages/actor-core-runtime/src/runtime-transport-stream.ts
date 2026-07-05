import type { ActorMessage, MessageTransport } from './actor-system.js';

export const DEFAULT_RUNTIME_TRANSPORT_STREAM_INITIAL_CREDIT = 1;

export type RuntimeTransportStreamMessage =
  | RuntimeTransportStreamOpenMessage
  | RuntimeTransportStreamCreditMessage
  | RuntimeTransportStreamChunkMessage
  | RuntimeTransportStreamCloseMessage
  | RuntimeTransportStreamErrorMessage;

export interface RuntimeTransportStreamOpenMessage extends ActorMessage {
  readonly type: '__runtime.stream.open';
  readonly streamId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RuntimeTransportStreamCreditMessage extends ActorMessage {
  readonly type: '__runtime.stream.credit';
  readonly streamId: string;
  readonly credit: number;
}

export interface RuntimeTransportStreamChunkMessage<TPayload = unknown> extends ActorMessage {
  readonly type: '__runtime.stream.chunk';
  readonly streamId: string;
  readonly sequence: number;
  readonly payload: TPayload;
}

export interface RuntimeTransportStreamCloseMessage extends ActorMessage {
  readonly type: '__runtime.stream.close';
  readonly streamId: string;
}

export interface RuntimeTransportStreamErrorMessage extends ActorMessage {
  readonly type: '__runtime.stream.error';
  readonly streamId: string;
  readonly code: string;
  readonly message: string;
}

export interface RuntimeTransportIncomingStream {
  readonly streamId: string;
  readonly source: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RuntimeTransportStreamChunk<TPayload = unknown> {
  readonly streamId: string;
  readonly source: string;
  readonly sequence: number;
  readonly payload: TPayload;
}

export interface RuntimeTransportStreamError {
  readonly streamId: string;
  readonly source: string;
  readonly code: string;
  readonly message: string;
}

export interface RuntimeTransportStreamConsumer<TPayload = unknown> {
  onChunk(chunk: RuntimeTransportStreamChunk<TPayload>): void | Promise<void>;
  onClose?(stream: RuntimeTransportIncomingStream): void | Promise<void>;
  onError?(error: RuntimeTransportStreamError): void | Promise<void>;
}

export type RuntimeTransportStreamHandler<TPayload = unknown> = (
  stream: RuntimeTransportIncomingStream
) =>
  | RuntimeTransportStreamConsumer<TPayload>
  | undefined
  | Promise<RuntimeTransportStreamConsumer<TPayload> | undefined>;

export interface RuntimeTransportWritableStream<TPayload = unknown> {
  readonly streamId: string;
  write(payload: TPayload): Promise<void>;
  close(): Promise<void>;
  error(input: { readonly code: string; readonly message: string }): Promise<void>;
}

export interface RuntimeTransportStreamHost {
  open<TPayload = unknown>(
    destination: string,
    options?: RuntimeTransportStreamOpenOptions
  ): Promise<RuntimeTransportWritableStream<TPayload>>;
  subscribe<TPayload = unknown>(handler: RuntimeTransportStreamHandler<TPayload>): () => void;
  stop(): Promise<void>;
}

export interface RuntimeTransportStreamHostOptions {
  readonly transport: MessageTransport;
  readonly nodeAddress: string;
  readonly initialCredit?: number;
  readonly streamIdFactory?: () => string;
  readonly clock?: () => number;
  readonly onError?: (error: RuntimeTransportStreamHostError) => void;
}

export interface RuntimeTransportStreamOpenOptions {
  readonly streamId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RuntimeTransportStreamHostError {
  readonly code: string;
  readonly message: string;
  readonly source?: string;
  readonly streamId?: string;
  readonly cause?: unknown;
}

type PendingWrite = {
  payload: unknown;
  resolve: () => void;
  reject: (error: Error) => void;
};

type OutgoingStreamState = {
  readonly streamId: string;
  readonly destination: string;
  pendingWrites: PendingWrite[];
  closePending?: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (error: Error) => void;
  };
  nextSequence: number;
  credit: number;
  flushing: boolean;
  closed: boolean;
  closeRequested: boolean;
};

type IncomingStreamState = {
  readonly stream: RuntimeTransportIncomingStream;
  readonly consumer: RuntimeTransportStreamConsumer<unknown>;
  expectedSequence: number;
  closed: boolean;
};

let nextGeneratedStreamId = 0;

function defaultStreamIdFactory(): string {
  nextGeneratedStreamId += 1;
  return `runtime-stream-${Date.now()}-${nextGeneratedStreamId}`;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function createEnvelope(clock: () => number): Pick<ActorMessage, '_timestamp' | '_version'> {
  return {
    _timestamp: clock(),
    _version: '1.0.0',
  };
}

export function createRuntimeTransportStreamOpenMessage(
  input: Readonly<{
    streamId: string;
    metadata?: Readonly<Record<string, unknown>>;
    clock?: () => number;
  }>
): RuntimeTransportStreamOpenMessage {
  const clock = input.clock ?? Date.now;
  return {
    type: '__runtime.stream.open',
    streamId: input.streamId,
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...createEnvelope(clock),
  };
}

export function createRuntimeTransportStreamCreditMessage(
  input: Readonly<{ streamId: string; credit: number; clock?: () => number }>
): RuntimeTransportStreamCreditMessage {
  const clock = input.clock ?? Date.now;
  return {
    type: '__runtime.stream.credit',
    streamId: input.streamId,
    credit: input.credit,
    ...createEnvelope(clock),
  };
}

export function createRuntimeTransportStreamChunkMessage<TPayload>(
  input: Readonly<{ streamId: string; sequence: number; payload: TPayload; clock?: () => number }>
): RuntimeTransportStreamChunkMessage<TPayload> {
  const clock = input.clock ?? Date.now;
  return {
    type: '__runtime.stream.chunk',
    streamId: input.streamId,
    sequence: input.sequence,
    payload: input.payload,
    ...createEnvelope(clock),
  };
}

export function createRuntimeTransportStreamCloseMessage(
  input: Readonly<{ streamId: string; clock?: () => number }>
): RuntimeTransportStreamCloseMessage {
  const clock = input.clock ?? Date.now;
  return {
    type: '__runtime.stream.close',
    streamId: input.streamId,
    ...createEnvelope(clock),
  };
}

export function createRuntimeTransportStreamErrorMessage(
  input: Readonly<{ streamId: string; code: string; message: string; clock?: () => number }>
): RuntimeTransportStreamErrorMessage {
  const clock = input.clock ?? Date.now;
  return {
    type: '__runtime.stream.error',
    streamId: input.streamId,
    code: input.code,
    message: input.message,
    ...createEnvelope(clock),
  };
}

export function isRuntimeTransportStreamMessage(
  message: ActorMessage
): message is RuntimeTransportStreamMessage {
  return (
    message.type === '__runtime.stream.open' ||
    message.type === '__runtime.stream.credit' ||
    message.type === '__runtime.stream.chunk' ||
    message.type === '__runtime.stream.close' ||
    message.type === '__runtime.stream.error'
  );
}

class RuntimeTransportStreamHostImpl implements RuntimeTransportStreamHost {
  private readonly transport: MessageTransport;
  private readonly nodeAddress: string;
  private readonly initialCredit: number;
  private readonly streamIdFactory: () => string;
  private readonly clock: () => number;
  private readonly onError: (error: RuntimeTransportStreamHostError) => void;
  private readonly handlers = new Set<RuntimeTransportStreamHandler<unknown>>();
  private readonly outgoingStreams = new Map<string, OutgoingStreamState>();
  private readonly incomingStreams = new Map<string, IncomingStreamState>();
  private readonly streamMessageQueues = new Map<string, Promise<void>>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(options: RuntimeTransportStreamHostOptions) {
    this.transport = options.transport;
    this.nodeAddress = options.nodeAddress;
    this.initialCredit = normalizePositiveInteger(
      options.initialCredit,
      DEFAULT_RUNTIME_TRANSPORT_STREAM_INITIAL_CREDIT
    );
    this.streamIdFactory = options.streamIdFactory ?? defaultStreamIdFactory;
    this.clock = options.clock ?? Date.now;
    this.onError = options.onError ?? (() => undefined);
    this.unsubscribe = this.transport.subscribe(({ source, message }) => {
      if (!isRuntimeTransportStreamMessage(message)) {
        return;
      }
      void this.enqueueStreamMessage(source, message).catch((error) => {
        this.onError({
          code: 'stream_handler_failed',
          message: toError(error).message,
          source,
          streamId: message.streamId,
          cause: error,
        });
      });
    });
  }

  async open<TPayload = unknown>(
    destination: string,
    options: RuntimeTransportStreamOpenOptions = {}
  ): Promise<RuntimeTransportWritableStream<TPayload>> {
    this.assertRunning();
    const streamId = options.streamId ?? this.streamIdFactory();
    if (this.outgoingStreams.has(streamId) || this.incomingStreams.has(streamId)) {
      throw new Error(`Runtime transport stream "${streamId}" already exists.`);
    }

    const state: OutgoingStreamState = {
      streamId,
      destination,
      pendingWrites: [],
      nextSequence: 1,
      credit: 0,
      flushing: false,
      closed: false,
      closeRequested: false,
    };
    this.outgoingStreams.set(streamId, state);

    try {
      await this.transport.send(
        destination,
        createRuntimeTransportStreamOpenMessage({
          streamId,
          ...(options.metadata ? { metadata: options.metadata } : {}),
          clock: this.clock,
        })
      );
    } catch (error) {
      this.outgoingStreams.delete(streamId);
      throw error;
    }

    return {
      streamId,
      write: (payload: TPayload) => this.write(streamId, payload),
      close: () => this.closeOutgoing(streamId),
      error: (input) => this.errorOutgoing(streamId, input),
    };
  }

  subscribe<TPayload = unknown>(handler: RuntimeTransportStreamHandler<TPayload>): () => void {
    const handlerAsUnknown = handler as RuntimeTransportStreamHandler<unknown>;
    this.handlers.add(handlerAsUnknown);
    return () => {
      this.handlers.delete(handlerAsUnknown);
    };
  }

  async stop(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.unsubscribe();
    for (const state of this.outgoingStreams.values()) {
      this.failOutgoingState(
        state,
        new Error(`Runtime transport stream host ${this.nodeAddress} stopped.`)
      );
    }
    for (const state of this.incomingStreams.values()) {
      await this.failIncomingState(state, {
        code: 'stream_host_stopped',
        message: `Runtime transport stream host ${this.nodeAddress} stopped.`,
      });
    }
    this.outgoingStreams.clear();
    this.incomingStreams.clear();
    this.streamMessageQueues.clear();
    this.handlers.clear();
  }

  private assertRunning(): void {
    if (this.stopped) {
      throw new Error(`Runtime transport stream host ${this.nodeAddress} is stopped.`);
    }
  }

  private write(streamId: string, payload: unknown): Promise<void> {
    this.assertRunning();
    const state = this.outgoingStreams.get(streamId);
    if (!state || state.closed || state.closeRequested) {
      return Promise.reject(new Error(`Runtime transport stream "${streamId}" is closed.`));
    }

    const promise = new Promise<void>((resolve, reject) => {
      state.pendingWrites.push({ payload, resolve, reject });
    });
    this.flushOutgoing(state);
    return promise;
  }

  private async closeOutgoing(streamId: string): Promise<void> {
    this.assertRunning();
    const state = this.outgoingStreams.get(streamId);
    if (!state || state.closed) {
      return;
    }
    if (state.closePending) {
      return state.closePending.promise;
    }
    state.closeRequested = true;
    let resolveClose: () => void = () => undefined;
    let rejectClose: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    state.closePending = { promise, resolve: resolveClose, reject: rejectClose };
    this.finishCloseIfReady(state);
    return promise;
  }

  private async errorOutgoing(
    streamId: string,
    input: { readonly code: string; readonly message: string }
  ): Promise<void> {
    const state = this.outgoingStreams.get(streamId);
    if (!state || state.closed) {
      return;
    }
    state.closed = true;
    this.outgoingStreams.delete(streamId);
    this.failPendingWrites(state, new Error(input.message));
    state.closePending?.reject(new Error(input.message));
    await this.transport.send(
      state.destination,
      createRuntimeTransportStreamErrorMessage({
        streamId,
        code: input.code,
        message: input.message,
        clock: this.clock,
      })
    );
  }

  private flushOutgoing(state: OutgoingStreamState): void {
    if (state.flushing) {
      return;
    }
    state.flushing = true;
    void this.drainOutgoing(state);
  }

  private async drainOutgoing(state: OutgoingStreamState): Promise<void> {
    try {
      while (!state.closed && state.credit > 0 && state.pendingWrites.length > 0) {
        const pending = state.pendingWrites.shift();
        if (!pending) {
          continue;
        }

        const sequence = state.nextSequence;
        state.nextSequence += 1;
        state.credit -= 1;

        try {
          await this.transport.send(
            state.destination,
            createRuntimeTransportStreamChunkMessage({
              streamId: state.streamId,
              sequence,
              payload: pending.payload,
              clock: this.clock,
            })
          );
          pending.resolve();
        } catch (error) {
          const sendError = toError(error);
          pending.reject(sendError);
          this.failOutgoingState(state, sendError);
          return;
        }
      }
    } finally {
      state.flushing = false;
      if (!state.closed && state.credit > 0 && state.pendingWrites.length > 0) {
        this.flushOutgoing(state);
      }
      this.finishCloseIfReady(state);
    }
  }

  private finishCloseIfReady(state: OutgoingStreamState): void {
    if (state.closed || !state.closeRequested || state.flushing || state.pendingWrites.length > 0) {
      return;
    }

    state.closed = true;
    this.outgoingStreams.delete(state.streamId);
    void this.transport
      .send(
        state.destination,
        createRuntimeTransportStreamCloseMessage({ streamId: state.streamId, clock: this.clock })
      )
      .then(
        () => state.closePending?.resolve(),
        (error) => state.closePending?.reject(toError(error))
      );
  }

  private failOutgoingState(state: OutgoingStreamState, error: Error): void {
    state.closed = true;
    this.outgoingStreams.delete(state.streamId);
    this.failPendingWrites(state, error);
    state.closePending?.reject(error);
  }

  private failPendingWrites(state: OutgoingStreamState, error: Error): void {
    for (const pending of state.pendingWrites.splice(0)) {
      pending.reject(error);
    }
  }

  private enqueueStreamMessage(
    source: string,
    message: RuntimeTransportStreamMessage
  ): Promise<void> {
    const previous = this.streamMessageQueues.get(message.streamId) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(() => {
        if (this.stopped) {
          return undefined;
        }
        return this.handleStreamMessage(source, message);
      });
    this.streamMessageQueues.set(message.streamId, task);
    void task
      .finally(() => {
        if (this.streamMessageQueues.get(message.streamId) === task) {
          this.streamMessageQueues.delete(message.streamId);
        }
      })
      .catch(() => undefined);
    return task;
  }

  private async handleStreamMessage(
    source: string,
    message: RuntimeTransportStreamMessage
  ): Promise<void> {
    switch (message.type) {
      case '__runtime.stream.open':
        await this.handleOpen(source, message);
        return;
      case '__runtime.stream.credit':
        this.handleCredit(source, message);
        return;
      case '__runtime.stream.chunk':
        await this.handleChunk(source, message);
        return;
      case '__runtime.stream.close':
        await this.handleClose(source, message);
        return;
      case '__runtime.stream.error':
        await this.handleError(source, message);
        return;
    }
  }

  private async handleOpen(
    source: string,
    message: RuntimeTransportStreamOpenMessage
  ): Promise<void> {
    if (this.incomingStreams.has(message.streamId) || this.outgoingStreams.has(message.streamId)) {
      await this.sendStreamError(source, message.streamId, {
        code: 'duplicate_stream',
        message: `Runtime transport stream "${message.streamId}" is already open.`,
      });
      return;
    }

    const stream: RuntimeTransportIncomingStream = {
      streamId: message.streamId,
      source,
      metadata: message.metadata ?? {},
    };
    const consumer = await this.resolveConsumer(stream);
    if (!consumer) {
      await this.sendStreamError(source, message.streamId, {
        code: 'stream_not_handled',
        message: `Runtime transport stream "${message.streamId}" has no receiver.`,
      });
      return;
    }

    this.incomingStreams.set(message.streamId, {
      stream,
      consumer,
      expectedSequence: 1,
      closed: false,
    });
    await this.grantCredit(source, message.streamId, this.initialCredit);
  }

  private async resolveConsumer(
    stream: RuntimeTransportIncomingStream
  ): Promise<RuntimeTransportStreamConsumer<unknown> | undefined> {
    for (const handler of Array.from(this.handlers)) {
      const consumer = await handler(stream);
      if (consumer) {
        return consumer;
      }
    }
    return undefined;
  }

  private handleCredit(source: string, message: RuntimeTransportStreamCreditMessage): void {
    const state = this.outgoingStreams.get(message.streamId);
    if (!state || state.closed) {
      return;
    }
    if (state.destination !== source) {
      this.reportSourceMismatch(state.destination, source, message.streamId);
      return;
    }
    state.credit += normalizePositiveInteger(message.credit, 0);
    this.flushOutgoing(state);
  }

  private async handleChunk(
    source: string,
    message: RuntimeTransportStreamChunkMessage
  ): Promise<void> {
    const state = this.incomingStreams.get(message.streamId);
    if (!state || state.closed) {
      await this.sendStreamError(source, message.streamId, {
        code: 'unknown_stream',
        message: `Runtime transport stream "${message.streamId}" is not open.`,
      });
      return;
    }
    if (state.stream.source !== source) {
      this.reportSourceMismatch(state.stream.source, source, message.streamId);
      return;
    }

    if (message.sequence !== state.expectedSequence) {
      const error = {
        code: 'sequence_mismatch',
        message: `Runtime transport stream "${message.streamId}" expected sequence ${state.expectedSequence} but received ${message.sequence}.`,
      };
      await this.failIncomingState(state, error);
      await this.sendStreamError(source, message.streamId, error);
      return;
    }

    try {
      await state.consumer.onChunk({
        streamId: message.streamId,
        source,
        sequence: message.sequence,
        payload: message.payload,
      });
    } catch (error) {
      const chunkError = toError(error);
      const streamError = {
        code: 'consumer_failed',
        message: chunkError.message,
      };
      await this.failIncomingState(state, streamError);
      await this.sendStreamError(source, message.streamId, {
        code: streamError.code,
        message: streamError.message,
      });
      return;
    }

    state.expectedSequence += 1;
    await this.grantCredit(source, message.streamId, 1);
  }

  private async handleClose(
    source: string,
    message: RuntimeTransportStreamCloseMessage
  ): Promise<void> {
    const state = this.incomingStreams.get(message.streamId);
    if (!state) {
      return;
    }
    if (state.stream.source !== source) {
      this.reportSourceMismatch(state.stream.source, source, message.streamId);
      return;
    }
    state.closed = true;
    this.incomingStreams.delete(message.streamId);
    await state.consumer.onClose?.(state.stream);
  }

  private async handleError(
    source: string,
    message: RuntimeTransportStreamErrorMessage
  ): Promise<void> {
    const outgoing = this.outgoingStreams.get(message.streamId);
    if (outgoing && outgoing.destination === source) {
      this.failOutgoingState(outgoing, new Error(message.message));
    } else if (outgoing) {
      this.reportSourceMismatch(outgoing.destination, source, message.streamId);
    }

    const incoming = this.incomingStreams.get(message.streamId);
    if (incoming && incoming.stream.source === source) {
      await this.failIncomingState(incoming, {
        code: message.code,
        message: message.message,
      });
    } else if (incoming) {
      this.reportSourceMismatch(incoming.stream.source, source, message.streamId);
    }
  }

  private async failIncomingState(
    state: IncomingStreamState,
    error: { readonly code: string; readonly message: string }
  ): Promise<void> {
    state.closed = true;
    this.incomingStreams.delete(state.stream.streamId);
    try {
      await state.consumer.onError?.({
        streamId: state.stream.streamId,
        source: state.stream.source,
        code: error.code,
        message: error.message,
      });
    } catch (consumerError) {
      this.onError({
        code: 'stream_consumer_error_handler_failed',
        message: toError(consumerError).message,
        source: state.stream.source,
        streamId: state.stream.streamId,
        cause: consumerError,
      });
    }
  }

  private reportSourceMismatch(expected: string, actual: string, streamId: string): void {
    this.onError({
      code: 'stream_source_mismatch',
      message: `Runtime transport stream "${streamId}" expected source "${expected}" but received "${actual}".`,
      source: actual,
      streamId,
    });
  }

  private async grantCredit(source: string, streamId: string, credit: number): Promise<void> {
    await this.transport.send(
      source,
      createRuntimeTransportStreamCreditMessage({ streamId, credit, clock: this.clock })
    );
  }

  private async sendStreamError(
    source: string,
    streamId: string,
    error: { readonly code: string; readonly message: string }
  ): Promise<void> {
    await this.transport.send(
      source,
      createRuntimeTransportStreamErrorMessage({
        streamId,
        code: error.code,
        message: error.message,
        clock: this.clock,
      })
    );
  }
}

export function createRuntimeTransportStreamHost(
  options: RuntimeTransportStreamHostOptions
): RuntimeTransportStreamHost {
  return new RuntimeTransportStreamHostImpl(options);
}
