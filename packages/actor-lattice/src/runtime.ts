import type {
  ActorRef,
  ActorWebTopology,
  ActorWebTopologyInput,
  StartedActorWebLocalRuntime,
} from '@actor-web/runtime';
import { deriveDependencyId } from './dependency.js';
import type { DependencyDefinition, LatticeMessage, RegisteredDependency } from './protocol.js';
import { LATTICE_ACTOR_META, LATTICE_DEPENDENCIES_META } from './topology.js';

export interface LatticeRuntimeScheduler {
  readonly now: () => number;
  scheduleEvery(intervalMs: number, task: () => Promise<void> | void): () => Promise<void> | void;
}

export interface WireLatticeRuntimeOptions {
  readonly scheduler?: LatticeRuntimeScheduler;
  readonly timeoutCheckIntervalMs?: number | false;
}

const defaultScheduler: LatticeRuntimeScheduler = {
  now: () => Date.now(),
  scheduleEvery(intervalMs, task) {
    const timer = setInterval(() => {
      void Promise.resolve(task()).catch(() => undefined);
    }, intervalMs);
    return () => clearInterval(timer);
  },
};

function reportTimeoutCheckError(actorKey: string, error: unknown) {
  console.error(`[actor-web/lattice] Failed CHECK_ACTIVATION_TIMEOUTS for "${actorKey}".`, error);
}

function isLatticeActorDefinition(definition: unknown): boolean {
  return (
    typeof definition === 'object' &&
    definition !== null &&
    LATTICE_ACTOR_META in (definition as Record<string, unknown>)
  );
}

export function collectLatticeActors<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  topology: TTopology
): readonly string[] {
  return Object.entries(topology.actors)
    .filter(([, definition]) => isLatticeActorDefinition(definition))
    .map(([actorKey]) => actorKey);
}

export function collectLatticeRegistrations<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology): readonly RegisteredDependency[] {
  return Object.entries(topology.actors).flatMap(([actorKey, definition]) => {
    const dependencies = (definition as unknown as Record<string, unknown>)[
      LATTICE_DEPENDENCIES_META
    ] as readonly DependencyDefinition[] | undefined;

    return (dependencies ?? []).map((dependency) => ({
      ...dependency,
      actorKey,
      dependencyId:
        dependency.id ??
        deriveDependencyId(dependency.lattice, actorKey, dependency.requires, dependency.mode),
      mode: dependency.mode ?? 'once',
    }));
  });
}

export function collectLatticeSubscriptions<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(topology: TTopology) {
  const subscriptions = new Map<string, { from: string; to: string; events: string[] }>();

  for (const dependency of collectLatticeRegistrations(topology)) {
    const key = `${dependency.lattice}:${dependency.actorKey}`;
    if (subscriptions.has(key)) {
      continue;
    }
    subscriptions.set(key, {
      from: dependency.lattice,
      to: dependency.actorKey,
      events: ['DEPENDENCY_SATISFIED', 'ACTIVATION_TIMED_OUT'],
    });
  }

  return [...subscriptions.values()];
}

export async function wireLatticeRuntime<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  runtime: StartedActorWebLocalRuntime<TTopology>,
  options: WireLatticeRuntimeOptions = {}
) {
  const registrations = collectLatticeRegistrations(runtime.topology);
  const subscriptions = collectLatticeSubscriptions(runtime.topology);
  const latticeActors = collectLatticeActors(runtime.topology);
  const teardowns: Array<() => Promise<void> | void> = [];
  const startedNodes = Object.values(runtime.nodes).filter(
    (node): node is NonNullable<(typeof runtime.nodes)[keyof typeof runtime.nodes]> =>
      node !== undefined
  );

  const hostNodeFor = (key: string) => {
    for (const startedNode of startedNodes) {
      if (startedNode.getActor(key)) {
        return startedNode;
      }
    }
    throw new Error(`Actor-Web local runtime did not start actor "${key}".`);
  };

  for (const subscription of subscriptions) {
    const publisher = runtime.requireActor(
      subscription.from as keyof TTopology['actors'] & string
    ) as unknown as ActorRef;
    const subscriber = runtime.requireActor(
      subscription.to as keyof TTopology['actors'] & string
    ) as unknown as ActorRef;
    const publisherSystem = hostNodeFor(subscription.from).system;
    const teardown = await publisherSystem.subscribe(publisher, {
      subscriber,
      events: [...subscription.events],
    });
    teardowns.push(teardown);
  }

  if (options.timeoutCheckIntervalMs !== false && latticeActors.length > 0) {
    const intervalMs = options.timeoutCheckIntervalMs ?? 1_000;
    const scheduler = options.scheduler ?? defaultScheduler;
    const stopTimeoutChecks = scheduler.scheduleEvery(intervalMs, async () => {
      const now = scheduler.now();
      const results = await Promise.allSettled(
        latticeActors.map(async (actorKey) => {
          const latticeActor = runtime.requireActor(
            actorKey as keyof TTopology['actors'] & string
          ) as unknown as {
            send(message: LatticeMessage): Promise<void>;
          };
          await latticeActor.send({
            type: 'CHECK_ACTIVATION_TIMEOUTS',
            now,
          });
          return actorKey;
        })
      );

      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          reportTimeoutCheckError(latticeActors[index] ?? 'unknown', result.reason);
        }
      });
    });
    teardowns.push(stopTimeoutChecks);
  }

  for (const registration of registrations) {
    const latticeActor = runtime.requireActor(
      registration.lattice as keyof TTopology['actors'] & string
    ) as unknown as {
      send(message: LatticeMessage): Promise<void>;
    };
    await latticeActor.send({
      type: 'REGISTER_DEPENDENCY',
      dependency: registration,
      registeredAt: Date.now(),
    });
  }

  return {
    registrations,
    latticeActors,
    teardowns,
    async stop() {
      for (const teardown of teardowns.reverse()) {
        await teardown();
      }
    },
  };
}
