import { describe, expect, it } from 'vitest';
import { setup } from 'xstate';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage } from '../actor-system.js';
import { createActorRef } from '../create-actor-ref.js';

const machine = setup({
  types: {
    context: {} as Record<string, never>,
    events: {} as ActorMessage,
  },
}).createMachine({
  id: 'parent-contract',
  initial: 'idle',
  context: {},
  states: {
    idle: {},
  },
});

describe('createActorRef', () => {
  it('exposes the actual parent ActorRef on spawned children', () => {
    const parent = createActorRef(machine, { id: 'parent' }) as ActorRef & {
      spawn: (
        behavior: typeof machine,
        options?: { id?: string }
      ) => ActorRef & {
        parent?: ActorRef;
      };
    };

    const child = parent.spawn(machine, { id: 'child' });

    expect(child.parent).toBe(parent);
  });
});
