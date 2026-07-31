import type { AgentExecutionTrace } from './agent-execution-contract.js';
import { isAgentExecutionTrace, sanitizeAgentExecutionTrace } from './agent-execution-contract.js';
import type {
  RuntimeGatewayTraceFact,
  RuntimeGatewayTraceProjection,
} from './runtime-gateway-shared.js';
import {
  normalizeRuntimeGatewayTraceBufferSize,
  toRuntimeGatewayTraceProjection,
} from './runtime-gateway-shared.js';

export interface RuntimeGatewayTraceSourceInput {
  readonly address: string;
}

export interface CreateRuntimeGatewayTraceSourceOptions {
  /** Maximum retained projections. Values below one are clamped to one. */
  readonly bufferSize?: number;
  readonly now?: () => Date;
}

export type RuntimeGatewayTraceSource<TSource extends RuntimeGatewayTraceSourceInput> = TSource & {
  latestTrace(): RuntimeGatewayTraceProjection | null;
  subscribeTrace(listener: (projection: RuntimeGatewayTraceProjection) => void): () => void;
  appendTrace(trace: AgentExecutionTrace | unknown): RuntimeGatewayTraceProjection;
  appendTraceFact(fact: RuntimeGatewayTraceFact): RuntimeGatewayTraceProjection;
};

export function createRuntimeGatewayTraceSource<TSource extends RuntimeGatewayTraceSourceInput>(
  source: TSource,
  options: CreateRuntimeGatewayTraceSourceOptions = {}
): RuntimeGatewayTraceSource<TSource> {
  const listeners = new Set<(projection: RuntimeGatewayTraceProjection) => void>();
  const bufferSize = normalizeRuntimeGatewayTraceBufferSize(options.bufferSize);
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  let projections: RuntimeGatewayTraceProjection[] = [];
  let latestTraceProjection: RuntimeGatewayTraceProjection | null = null;

  const notifyListeners = (projection: RuntimeGatewayTraceProjection): void => {
    for (const listener of Array.from(listeners)) {
      try {
        listener(projection);
      } catch {
        // Trace observers are advisory and must not affect authoritative runtime behavior.
      }
    }
  };

  const storeProjection = (
    trace: AgentExecutionTrace | null,
    fact: RuntimeGatewayTraceFact | null,
    observedAt = now().toISOString()
  ): RuntimeGatewayTraceProjection => {
    sequence += 1;
    const projection = toRuntimeGatewayTraceProjection(
      source.address,
      sequence,
      observedAt,
      trace,
      fact
    );
    if (projection.trace) {
      latestTraceProjection = projection;
    }
    projections = [...projections, projection];
    notifyListeners(projection);
    if (projections.length > bufferSize) {
      const droppedCount = projections.length - bufferSize;
      projections = projections.slice(-bufferSize);
      sequence += 1;
      const overflowProjection = toRuntimeGatewayTraceProjection(
        source.address,
        sequence,
        observedAt,
        null,
        {
          code: 'trace_buffer_overflow',
          message: 'Dropped older traces while applying bounded backpressure.',
          droppedCount,
        }
      );
      notifyListeners(overflowProjection);
    }

    return projection;
  };

  return {
    ...source,
    latestTrace() {
      return latestTraceProjection;
    },
    subscribeTrace(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    appendTrace(trace) {
      if (isAgentExecutionTrace(trace)) {
        return storeProjection(sanitizeAgentExecutionTrace(trace), null);
      }

      return storeProjection(null, {
        code: 'trace_malformed',
        message: 'Trace input did not satisfy the AgentExecutionTrace contract.',
        detail:
          typeof trace === 'object' && trace !== null
            ? 'invalid_shape'
            : `invalid_primitive:${typeof trace}`,
      });
    },
    appendTraceFact(fact) {
      return storeProjection(null, fact);
    },
  };
}
