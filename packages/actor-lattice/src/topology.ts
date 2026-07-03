import { type ActorWebActorDefinition, actor } from '@actor-web/runtime/topology';
import { createLatticeActor, type LatticeJournal } from './lattice-actor.js';
import type { DependencyDefinition } from './protocol.js';

export const LATTICE_DEPENDENCIES_META = '__actorWebLatticeDependencies';
export const LATTICE_ACTOR_META = '__actorWebLatticeActor';

type LatticeDependencyActorDefinition<
  TId extends string,
  TNode extends string,
  TBehavior,
> = ActorWebActorDefinition<TId, TNode, TBehavior> & {
  readonly dependencies: readonly DependencyDefinition[];
};

type LatticeDependencyMetadata = {
  readonly [LATTICE_DEPENDENCIES_META]: readonly DependencyDefinition[];
};

export function lattice<TId extends string, TNode extends string>(definition: {
  readonly id: TId;
  readonly node: TNode;
  readonly timeoutMs?: number;
  readonly journal?: LatticeJournal;
}) {
  return {
    ...actor({
      id: definition.id,
      node: definition.node,
      behavior: createLatticeActor({
        latticeId: definition.id,
        timeoutMs: definition.timeoutMs,
        journal: definition.journal,
      }),
    }),
    [LATTICE_ACTOR_META]: {
      latticeId: definition.id,
      timeoutMs: definition.timeoutMs ?? 30_000,
    },
  };
}

function attachDependencies<TDefinition extends object>(
  definition: TDefinition,
  dependencies: readonly DependencyDefinition[]
): TDefinition & LatticeDependencyMetadata {
  return {
    ...definition,
    [LATTICE_DEPENDENCIES_META]: dependencies,
  };
}

export function dependsOn<TId extends string, TNode extends string, TBehavior>(
  definition: LatticeDependencyActorDefinition<TId, TNode, TBehavior>
): ActorWebActorDefinition<TId, TNode, TBehavior> & LatticeDependencyMetadata {
  const { dependencies: bakedDependencies, ...actorDefinition } = definition;
  return attachDependencies(actor(actorDefinition), bakedDependencies);
}
