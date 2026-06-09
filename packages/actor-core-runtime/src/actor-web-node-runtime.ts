import type { ActorRef } from './actor-ref.js';
import type { ActorBehavior, ActorMessage, ActorSystem } from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
import type {
  ActorWebActorContext,
  ActorWebActorDescriptor,
  ActorWebActorInstanceParams,
  ActorWebActorMessage,
  ActorWebNodeDefinition,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

export type ActorWebNodeActorMap<_TTopology extends ActorWebTopology<ActorWebTopologyInput>> = Map<
  string,
  ActorRef<unknown, ActorMessage>
>;

export type ActorWebNodeActorHandle<TActor> = ActorWebActorInstanceParams<TActor> extends never
  ? {
      get(): ActorRef<ActorWebActorContext<TActor>, ActorWebActorMessage<TActor>> | undefined;
      require(): ActorRef<ActorWebActorContext<TActor>, ActorWebActorMessage<TActor>>;
    }
  : {
      instance(
        params: ActorWebActorInstanceParams<TActor>
      ): Promise<ActorRef<ActorWebActorContext<TActor>, ActorWebActorMessage<TActor>>>;
    };

/**
 * Low-level actor handles for a single started topology node.
 * Product proofs that want Ignite-friendly local read-model/command sources
 * should use startActorWebLocalRuntime(...) from actor-web-client instead of
 * adapting these handles by hand.
 */
export type ActorWebNodeActorHandles<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly [K in keyof TTopology['actors']]: ActorWebNodeActorHandle<TTopology['actors'][K]>;
};

export function getActorWebNodeDefinition<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology, nodeKey: keyof TTopology['nodes'] & string): ActorWebNodeDefinition {
  const nodeDefinition = topology.nodes[nodeKey];
  if (!nodeDefinition) {
    throw new Error(`Unknown Actor-Web node "${nodeKey}".`);
  }

  return nodeDefinition;
}

export function getOwnedActorWebActors<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology,
  nodeKey: keyof TTopology['nodes'] & string
): Array<[keyof TTopology['actors'] & string, ActorWebActorDescriptor]> {
  return Object.entries(topology.actors).filter(([, actorDescriptor]) => {
    return actorDescriptor.node === nodeKey;
  }) as Array<[keyof TTopology['actors'] & string, ActorWebActorDescriptor]>;
}

export function materializeActorWebBehavior(
  actorDescriptor: ActorWebActorDescriptor,
  params?: unknown
): ActorBehavior<ActorMessage, ActorMessage> {
  const behavior = actorDescriptor.behavior;
  if (!behavior) {
    throw new Error(`Actor "${actorDescriptor.key}" does not declare behavior.`);
  }

  const resolved = typeof behavior === 'function' ? behavior(params) : behavior;
  // Accept an un-built behavior builder (e.g. defineBehavior().withMachine(m))
  // and build it under the hood so `.build()` stays optional. A factory may also
  // return a builder, so this runs after factory resolution.
  const built =
    resolved &&
    typeof resolved === 'object' &&
    'build' in resolved &&
    typeof (resolved as { build?: unknown }).build === 'function'
      ? (resolved as { build: () => unknown }).build()
      : resolved;
  if (
    !built ||
    typeof built !== 'object' ||
    !('onMessage' in built) ||
    typeof built.onMessage !== 'function'
  ) {
    throw new Error(`Actor "${actorDescriptor.key}" behavior did not resolve to ActorBehavior.`);
  }

  return built as ActorBehavior<ActorMessage, ActorMessage>;
}

export function getActorWebRequiredToolNames(actorDescriptor: ActorWebActorDescriptor): string[] {
  return (actorDescriptor.tools ?? []).map((toolReference) =>
    typeof toolReference === 'string' ? toolReference : toolReference.name
  );
}

export function validateActorWebRequiredTools(
  actorDescriptor: ActorWebActorDescriptor,
  tools: ActorToolRegistry | undefined
): void {
  const missingTools = getActorWebRequiredToolNames(actorDescriptor).filter(
    (toolName) => typeof tools?.[toolName] !== 'function'
  );
  if (missingTools.length > 0) {
    throw new Error(
      `Actor "${actorDescriptor.key}" requires unregistered tool${missingTools.length === 1 ? '' : 's'}: ${missingTools.join(', ')}.`
    );
  }
}

export function createActorWebNodeToolAccess<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology, nodeKey: keyof TTopology['nodes'] & string): Record<string, string[]> {
  return Object.fromEntries(
    getOwnedActorWebActors(topology, nodeKey).map(([, actorDescriptor]) => [
      actorDescriptor.address.path,
      getActorWebRequiredToolNames(actorDescriptor),
    ])
  );
}

export function isParameterizedActorWebActor(actorDescriptor: ActorWebActorDescriptor): boolean {
  return typeof actorDescriptor.id === 'function';
}

async function spawnActorWebActorInstance(
  system: ActorSystem,
  actorKey: string,
  actorDescriptor: ActorWebActorDescriptor,
  actors: Map<string, ActorRef<unknown, ActorMessage>>,
  inFlightActors: Map<string, Promise<ActorRef<unknown, ActorMessage>>>,
  toolAccess: Record<string, string[]>,
  tools: ActorToolRegistry | undefined,
  params?: unknown
): Promise<ActorRef<unknown, ActorMessage>> {
  validateActorWebRequiredTools(actorDescriptor, tools);
  const address = actorDescriptor.resolveAddress(params as never);
  const cacheKey = isParameterizedActorWebActor(actorDescriptor)
    ? `${actorKey}:${address.id}`
    : actorKey;
  const cached = actors.get(cacheKey);
  if (cached) {
    return cached;
  }

  const inFlight = inFlightActors.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const spawnPromise = (async (): Promise<ActorRef<unknown, ActorMessage>> => {
    const existing = await system.lookup(address.path);
    if (existing) {
      actors.set(cacheKey, existing);
      if (!isParameterizedActorWebActor(actorDescriptor)) {
        actors.set(actorKey, existing);
      }

      return existing;
    }

    toolAccess[address.path] = getActorWebRequiredToolNames(actorDescriptor);
    const actorRef = await system.spawn(materializeActorWebBehavior(actorDescriptor, params), {
      id: address.id,
      supervised: Boolean(actorDescriptor.supervision),
    });
    actors.set(cacheKey, actorRef);
    if (!isParameterizedActorWebActor(actorDescriptor)) {
      actors.set(actorKey, actorRef);
    }

    return actorRef;
  })();

  inFlightActors.set(cacheKey, spawnPromise);
  try {
    return await spawnPromise;
  } finally {
    inFlightActors.delete(cacheKey);
  }
}

export function createActorWebNodeActorHandles<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(
  system: ActorSystem,
  topology: TTopology,
  nodeKey: keyof TTopology['nodes'] & string,
  actors: ActorWebNodeActorMap<TTopology>,
  toolAccess: Record<string, string[]>,
  tools?: ActorToolRegistry
): ActorWebNodeActorHandles<TTopology> {
  const inFlightActors = new Map<string, Promise<ActorRef<unknown, ActorMessage>>>();
  return Object.fromEntries(
    Object.entries(topology.actors).map(([actorKey, actorDescriptor]) => {
      const ensureOwned = (): void => {
        if (actorDescriptor.node !== nodeKey) {
          throw new Error(`Actor-Web node "${nodeKey}" does not own actor "${actorKey}".`);
        }
      };

      return [
        actorKey,
        {
          get() {
            return actors.get(actorKey);
          },
          require() {
            const actorRef = actors.get(actorKey);
            if (!actorRef) {
              throw new Error(`Actor-Web node did not spawn actor "${actorKey}".`);
            }

            return actorRef;
          },
          async instance(params?: unknown) {
            ensureOwned();
            return spawnActorWebActorInstance(
              system,
              actorKey,
              actorDescriptor,
              actors,
              inFlightActors,
              toolAccess,
              tools,
              params
            );
          },
        },
      ];
    })
  ) as unknown as ActorWebNodeActorHandles<TTopology>;
}

export async function spawnOwnedActorWebActors<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(
  system: ActorSystem,
  topology: TTopology,
  nodeKey: keyof TTopology['nodes'] & string,
  actors: ActorWebNodeActorMap<TTopology>,
  tools?: ActorToolRegistry
): Promise<void> {
  for (const [actorKey, actorDescriptor] of getOwnedActorWebActors(topology, nodeKey)) {
    if (isParameterizedActorWebActor(actorDescriptor)) {
      continue;
    }

    validateActorWebRequiredTools(actorDescriptor, tools);
    const actorRef = await system.spawn(materializeActorWebBehavior(actorDescriptor), {
      id: actorDescriptor.resolveId(),
      supervised: Boolean(actorDescriptor.supervision),
    });
    actors.set(actorKey, actorRef);
  }
}
