import type { ActorRef } from './actor-ref.js';
import type { ActorBehavior, ActorMessage, ActorSystem } from './actor-system.js';
import type {
  ActorWebActorDescriptor,
  ActorWebNodeDefinition,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

export type ActorWebNodeActorMap<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = Map<
  keyof TTopology['actors'] & string,
  ActorRef<unknown, ActorMessage>
>;

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
  actorDescriptor: ActorWebActorDescriptor
): ActorBehavior<ActorMessage, ActorMessage> {
  const behavior = actorDescriptor.behavior;
  if (!behavior) {
    throw new Error(`Actor "${actorDescriptor.key}" does not declare behavior.`);
  }

  const resolved = typeof behavior === 'function' ? behavior() : behavior;
  if (
    !resolved ||
    typeof resolved !== 'object' ||
    !('onMessage' in resolved) ||
    typeof resolved.onMessage !== 'function'
  ) {
    throw new Error(`Actor "${actorDescriptor.key}" behavior did not resolve to ActorBehavior.`);
  }

  return resolved as ActorBehavior<ActorMessage, ActorMessage>;
}

export async function spawnOwnedActorWebActors<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
>(
  system: ActorSystem,
  topology: TTopology,
  nodeKey: keyof TTopology['nodes'] & string,
  actors: ActorWebNodeActorMap<TTopology>
): Promise<void> {
  for (const [actorKey, actorDescriptor] of getOwnedActorWebActors(topology, nodeKey)) {
    const actorRef = await system.spawn(materializeActorWebBehavior(actorDescriptor), {
      id: actorDescriptor.id,
    });
    actors.set(actorKey, actorRef);
  }
}
