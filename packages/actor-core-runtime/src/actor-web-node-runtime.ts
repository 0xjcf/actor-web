import type { ActorRef } from './actor-ref.js';
import type { ActorBehavior, ActorMessage, ActorSystem } from './actor-system.js';
import type { ActorToolRegistry } from './actor-tools.js';
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
    validateActorWebRequiredTools(actorDescriptor, tools);
    const actorRef = await system.spawn(materializeActorWebBehavior(actorDescriptor), {
      id: actorDescriptor.id,
    });
    actors.set(actorKey, actorRef);
  }
}
