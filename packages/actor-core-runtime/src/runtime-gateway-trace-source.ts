import type { AgentExecutionTrace } from './agent-execution-contract.js';
import { isAgentExecutionTrace } from './agent-execution-contract.js';
import type {
  RuntimeGatewayTraceFact,
  RuntimeGatewayTraceProjection,
} from './runtime-gateway-shared.js';

export interface RuntimeGatewayTraceSourceInput {
  readonly address: string;
}

export interface CreateRuntimeGatewayTraceSourceOptions {
  readonly bufferSize?: number;
  readonly now?: () => Date;
}

export type RuntimeGatewayTraceSource<TSource extends RuntimeGatewayTraceSourceInput> = TSource & {
  latestTrace(): RuntimeGatewayTraceProjection | null;
  subscribeTrace(listener: (projection: RuntimeGatewayTraceProjection) => void): () => void;
  appendTrace(trace: AgentExecutionTrace | unknown): RuntimeGatewayTraceProjection;
  appendTraceFact(fact: RuntimeGatewayTraceFact): RuntimeGatewayTraceProjection;
};

function createTraceCursor(address: string, sequence: number): string {
  return `trace:${address}:${sequence}`;
}

function toTraceProjection(
  address: string,
  sequence: number,
  observedAt: string,
  trace: AgentExecutionTrace | null,
  fact: RuntimeGatewayTraceFact | null
): RuntimeGatewayTraceProjection {
  return {
    address,
    cursor: createTraceCursor(address, sequence),
    observedAt,
    trace,
    fact,
  };
}

export function createRuntimeGatewayTraceSource<TSource extends RuntimeGatewayTraceSourceInput>(
  source: TSource,
  options: CreateRuntimeGatewayTraceSourceOptions = {}
): RuntimeGatewayTraceSource<TSource> {
  const listeners = new Set<(projection: RuntimeGatewayTraceProjection) => void>();
  const bufferSize = options.bufferSize ?? 64;
  const now = options.now ?? (() => new Date());
  let sequence = 0;
  let projections: RuntimeGatewayTraceProjection[] = [];
  let latestTraceProjection: RuntimeGatewayTraceProjection | null = null;

  const storeProjection = (
    trace: AgentExecutionTrace | null,
    fact: RuntimeGatewayTraceFact | null,
    observedAt = now().toISOString()
  ): RuntimeGatewayTraceProjection => {
    sequence += 1;
    const projection = toTraceProjection(source.address, sequence, observedAt, trace, fact);
    if (projection.trace) {
      latestTraceProjection = projection;
    }
    projections = [...projections, projection];
    if (bufferSize > 0 && projections.length > bufferSize) {
      const droppedCount = projections.length - bufferSize + 1;
      projections = projections.slice(-bufferSize);
      sequence += 1;
      const overflowProjection = toTraceProjection(source.address, sequence, observedAt, null, {
        code: 'trace_buffer_overflow',
        message: 'Dropped older traces while applying bounded backpressure.',
        droppedCount,
      });
      projections = [...projections, overflowProjection].slice(-bufferSize);
      for (const listener of Array.from(listeners)) {
        listener(projection);
      }
      for (const listener of Array.from(listeners)) {
        listener(overflowProjection);
      }
      return projection;
    }

    for (const listener of Array.from(listeners)) {
      listener(projection);
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
        return storeProjection(trace, null);
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
