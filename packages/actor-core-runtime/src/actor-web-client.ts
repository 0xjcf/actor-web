import type { ActorWebGatewaySocket, ActorWebSourceGatewayOptions } from './actor-web-source.js';
import {
  type ClosableActorWebReadModelSource,
  type ClosableActorWebSource,
  createActorWebReadModelSource,
  createActorWebSource,
} from './actor-web-source.js';
import type {
  ActorWebActorContext,
  ActorWebActorEvent,
  ActorWebActorMessage,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

export interface ActorWebClientOptions {
  readonly gateway: ActorWebSourceGatewayOptions;
  readonly createSocket?: (url: string) => ActorWebGatewaySocket;
  readonly clientVersion?: string;
}

export type ActorWebClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ClosableActorWebSource<
      ActorWebActorContext<TTopology['actors'][K]>,
      ActorWebActorMessage<TTopology['actors'][K]>,
      ActorWebActorEvent<TTopology['actors'][K]>
    >;
  };
  close(): void;
};

/**
 * Projection-only client for UI and Ignite Element hosts. This is the default
 * browser/client surface when a shared topology is available.
 */
export type ActorWebReadModelClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly actors: {
    readonly [K in keyof TTopology['actors']]: ClosableActorWebReadModelSource<
      ActorWebActorContext<TTopology['actors'][K]>,
      ActorWebActorEvent<TTopology['actors'][K]>
    >;
  };
  close(): void;
};

export function createActorWebClient<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  options: ActorWebClientOptions
): ActorWebClient<TTopology> {
  const openedSources = new Set<ClosableActorWebSource>();
  const actors = {} as ActorWebClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableActorWebSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        source ??= createActorWebSource({
          actor,
          gateway: options.gateway,
          streamId: `actor-web-${key}`,
          clientVersion: options.clientVersion,
          ...(options.createSocket ? { createSocket: options.createSocket } : {}),
        });
        openedSources.add(source);
        return source;
      },
    });
  }

  return {
    actors,
    close(): void {
      for (const source of Array.from(openedSources)) {
        source.close();
      }
      openedSources.clear();
    },
  };
}

export function createActorWebReadModelClient<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology, options: ActorWebClientOptions): ActorWebReadModelClient<TTopology> {
  const openedSources = new Set<ClosableActorWebReadModelSource>();
  const actors = {} as ActorWebReadModelClient<TTopology>['actors'];

  for (const [key, actor] of Object.entries(topology.actors)) {
    let source: ClosableActorWebReadModelSource | null = null;
    Object.defineProperty(actors, key, {
      enumerable: true,
      get() {
        source ??= createActorWebReadModelSource({
          actor,
          gateway: options.gateway,
          streamId: `actor-web-${key}`,
          clientVersion: options.clientVersion,
          ...(options.createSocket ? { createSocket: options.createSocket } : {}),
        });
        openedSources.add(source);
        return source;
      },
    });
  }

  return {
    actors,
    close(): void {
      for (const source of Array.from(openedSources)) {
        source.close();
      }
      openedSources.clear();
    },
  };
}
