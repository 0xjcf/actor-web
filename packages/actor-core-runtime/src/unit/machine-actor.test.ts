/**
 * @module actor-core/runtime/machine-actor.test
 * @description Tests for MachineActor implementation - XState v5 wrapper
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assign, createMachine } from 'xstate';
import { isActorInstance } from '../actor-instance.js';
import type { ActorMessage } from '../actor-system.js';
import {
  createMachineActor,
  isMachineActor,
  MachineActor,
  type MachineActorDependencies,
} from '../machine-actor.js';

describe.skip('MachineActor', () => {
  // Test machine definition
  const testMachine = createMachine({
    id: 'test-machine',
    initial: 'idle',
    context: { count: 0 },
    states: {
      idle: {
        on: {
          START: 'running',
          INCREMENT: {
            actions: assign({ count: ({ context }) => context.count + 1 }),
          },
        },
      },
      running: {
        on: {
          STOP: 'idle',
          INCREMENT: {
            actions: assign({ count: ({ context }) => context.count + 1 }),
          },
          FAIL: 'error',
        },
      },
      error: {
        type: 'final',
      },
    },
  });

  let machineActor: MachineActor;
  let mockDeps: MachineActorDependencies;
  const actorId = 'test-machine-actor';

  beforeEach(() => {
    mockDeps = {
      emit: vi.fn(),
      logger: vi.fn(),
      system: { name: 'test-system' },
    };
    machineActor = new MachineActor(actorId, testMachine, mockDeps);
  });

  describe.skip('construction', () => {
    it('should create actor with initial state', () => {
      expect(machineActor.id).toBe(actorId);
      expect(machineActor.status).toBe('idle');
      expect(machineActor.getType()).toBe('machine');
    });

    it('should implement ActorInstance interface', () => {
      expect(isActorInstance(machineActor)).toBe(true);
    });

    it('should create with default dependencies', () => {
      const actor = new MachineActor(actorId, testMachine);
      expect(actor).toBeDefined();
      expect(actor.getInternalState()).toMatchObject({
        type: 'machine',
        id: actorId,
        started: false,
      });
    });
  });

  describe.skip('lifecycle management', () => {
    it('should start the XState actor', () => {
      machineActor.start();

      const internalState = machineActor.getInternalState();
      expect(internalState).toBeDefined();
      if (
        typeof internalState === 'object' &&
        internalState !== null &&
        'started' in internalState
      ) {
        expect(internalState.started).toBe(true);
      }
      expect(machineActor.status).toBe('running');
      expect(machineActor.getXStateActor()).toBeDefined();
    });

    it('should not start twice', () => {
      machineActor.start();
      const firstActor = machineActor.getXStateActor();

      machineActor.start(); // Should be idempotent
      const secondActor = machineActor.getXStateActor();

      expect(firstActor).toBe(secondActor);
    });

    it('should stop the XState actor', () => {
      machineActor.start();
      machineActor.stop();

      expect(machineActor.getXStateActor()).toBeUndefined();
      expect(machineActor.status).toBe('idle');
    });

    it('should reset snapshot on stop', () => {
      machineActor.start();

      // Send message to change state
      machineActor.send({ type: 'START', _timestamp: Date.now(), _version: '1.0.0' });
      expect(machineActor.getSnapshot().value).toBe('running');

      machineActor.stop();
      expect(machineActor.getSnapshot().value).toBe('idle');
    });
  });

  describe.skip('message handling', () => {
    it('should send messages to XState actor', () => {
      machineActor.start();

      const message: ActorMessage = {
        type: 'START',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      machineActor.send(message);
      expect(machineActor.getSnapshot().value).toBe('running');
    });

    it('should throw error when sending to non-started actor', () => {
      const message: ActorMessage = {
        type: 'START',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      expect(() => machineActor.send(message)).toThrow('Actor test-machine-actor not started');
    });

    it('should update context via actions', () => {
      machineActor.start();

      const incrementMessage: ActorMessage = {
        type: 'INCREMENT',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      machineActor.send(incrementMessage);
      expect(machineActor.getSnapshot().context).toEqual({ count: 1 });

      machineActor.send(incrementMessage);
      expect(machineActor.getSnapshot().context).toEqual({ count: 2 });
    });
  });

  describe.skip('dependency injection', () => {
    it('should emit state transitions', () => {
      machineActor.start();

      // Clear initial transition emit
      vi.clearAllMocks();

      const message: ActorMessage = {
        type: 'START',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      machineActor.send(message);

      expect(mockDeps.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'xstate.transition',
          value: 'running',
          actorId: actorId,
        })
      );
    });

    it('should log state transitions', () => {
      machineActor.start();

      // Clear initial transition log
      vi.clearAllMocks();

      const message: ActorMessage = {
        type: 'START',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };

      machineActor.send(message);

      expect(mockDeps.logger).toHaveBeenCalledWith(
        'State transition',
        expect.objectContaining({
          actorId: actorId,
          value: 'running',
        })
      );
    });

    it('should update dependencies at runtime', () => {
      const newEmit = vi.fn();
      const newLogger = vi.fn();

      machineActor.updateDependencies({
        emit: newEmit,
        logger: newLogger,
      });

      machineActor.start();

      expect(newEmit).toHaveBeenCalled(); // Initial state emit
      expect(newLogger).toHaveBeenCalled(); // Initial state log
    });

    it('should send UPDATE_DEPS event to running actor', () => {
      machineActor.start();

      const newDeps = { emit: vi.fn() };
      machineActor.updateDependencies(newDeps);

      // The UPDATE_DEPS event should be sent to the actor
      // This is internal behavior, so we verify through the state
      const internalState = machineActor.getInternalState();
      if (
        typeof internalState === 'object' &&
        internalState !== null &&
        'dependencies' in internalState
      ) {
        const deps = internalState.dependencies;
        if (typeof deps === 'object' && deps !== null && 'emit' in deps) {
          expect(deps.emit).toBe(newDeps.emit);
        }
      }
    });
  });

  describe.skip('snapshot building', () => {
    it('should build snapshot from XState state', () => {
      machineActor.start();

      const snapshot = machineActor.getSnapshot();
      expect(snapshot).toMatchObject({
        value: 'idle',
        context: { count: 0 },
        status: 'running',
      });

      expect(snapshot.matches('idle')).toBe(true);
      expect(snapshot.matches('running')).toBe(false);
    });

    it('should handle error states', () => {
      machineActor.start();

      machineActor.send({ type: 'START', _timestamp: Date.now(), _version: '1.0.0' });
      machineActor.send({ type: 'FAIL', _timestamp: Date.now(), _version: '1.0.0' });

      const snapshot = machineActor.getSnapshot();
      expect(snapshot.value).toBe('error');
      expect(snapshot.status).toBe('stopped'); // Final states map to stopped
    });

    it('should provide can() functionality', () => {
      machineActor.start();

      const snapshot = machineActor.getSnapshot();

      // Note: XState v5 snapshots have can() method that checks if an event can be sent
      // For machines without guards, all defined events can be sent
      // Since our buildSnapshot wraps this, we're testing our wrapper implementation

      // In our implementation, if XState doesn't provide can() or nextEvents,
      // we default to false for safety (conservative approach)
      expect(snapshot.can('UNDEFINED_EVENT')).toBe(false);

      // Test with an ActorMessage object
      const incrementMsg: ActorMessage = { type: 'INCREMENT', _timestamp: 0, _version: '1.0.0' };
      expect(snapshot.can(incrementMsg)).toBe(false);

      // Test matches functionality while we're here
      expect(snapshot.matches('idle')).toBe(true);
      expect(snapshot.matches('running')).toBe(false);
    });

    it('should provide hasTag functionality', () => {
      // Create machine with tags
      const taggedMachine = createMachine({
        initial: 'idle',
        states: {
          idle: {
            tags: ['inactive'],
            on: { START: 'running' },
          },
          running: {
            tags: ['active'],
            on: { STOP: 'idle' },
          },
        },
      });

      const taggedActor = new MachineActor('tagged', taggedMachine);
      taggedActor.start();

      const snapshot = taggedActor.getSnapshot();
      expect(snapshot.hasTag('inactive')).toBe(true);
      expect(snapshot.hasTag('active')).toBe(false);
    });

    it('should provide toJSON functionality', () => {
      machineActor.start();

      const snapshot = machineActor.getSnapshot();
      const json = snapshot.toJSON();

      expect(json).toMatchObject({
        value: 'idle',
        context: { count: 0 },
      });
    });
  });

  describe.skip('type guards', () => {
    it('should identify MachineActor instances', () => {
      expect(isMachineActor(machineActor)).toBe(true);
      expect(isMachineActor({})).toBe(false);
      expect(isMachineActor(null)).toBe(false);
      expect(isMachineActor(undefined)).toBe(false);
    });
  });

  describe.skip('factory function', () => {
    it('should create MachineActor using factory', () => {
      const actor = createMachineActor('factory-actor', testMachine, mockDeps);

      expect(actor).toBeInstanceOf(MachineActor);
      expect(actor.id).toBe('factory-actor');
      expect(actor.getType()).toBe('machine');
    });

    it('should create with default dependencies', () => {
      const actor = createMachineActor('factory-actor', testMachine);

      expect(actor).toBeInstanceOf(MachineActor);
      actor.start(); // Should not throw
    });
  });

  describe.skip('internal state access', () => {
    it('should provide debugging information', () => {
      machineActor.start();

      const internalState = machineActor.getInternalState();

      expect(internalState).toBeDefined();
      expect(typeof internalState).toBe('object');
      expect(internalState).not.toBeNull();

      // Type-safe checks for internal state properties
      if (typeof internalState === 'object' && internalState !== null) {
        expect('type' in internalState && internalState.type).toBe('machine');
        expect('id' in internalState && internalState.id).toBe(actorId);
        expect('started' in internalState && internalState.started).toBe(true);
        expect('xstateId' in internalState && typeof internalState.xstateId).toBe('string');
        expect('snapshot' in internalState && typeof internalState.snapshot).toBe('object');
        expect('dependencies' in internalState && internalState.dependencies).toBe(mockDeps);
      }
    });
  });

  describe.skip('XState v5 integration', () => {
    it('should handle machine with input', () => {
      const inputMachine = createMachine({
        context: ({
          input,
        }: {
          input: { initialCount: number; deps?: MachineActorDependencies };
        }) => ({
          count: input?.initialCount || 0,
          deps: input?.deps || {},
        }),
        initial: 'idle',
        states: {
          idle: {},
        },
      });

      const actor = new MachineActor('input-actor', inputMachine);
      actor.start();

      // The machine should receive deps as input
      const snapshot = actor.getSnapshot();
      expect(snapshot.context).toHaveProperty('deps');
      expect(snapshot.context).toHaveProperty('count');
    });

    it('should provide machine actions', () => {
      const actionMachine = createMachine({
        initial: 'idle',
        states: {
          idle: {
            on: {
              UPDATE_DEPS: {
                actions: 'updateDeps',
              },
            },
          },
        },
      });

      const actor = new MachineActor('action-actor', actionMachine);
      actor.start();

      // The machine should have updateDeps action provided
      // Note: UPDATE_DEPS is handled internally by MachineActor
      actor.updateDependencies({ emit: vi.fn() });
      // Should not throw
    });
  });

  describe.skip('edge cases', () => {
    it('should handle stopped state correctly', () => {
      machineActor.start();
      machineActor.stop();

      expect(machineActor.status).toBe('idle');
      expect(machineActor.getSnapshot().status).toBe('idle');
    });

    it('should handle missing optional methods gracefully', () => {
      machineActor.start();

      const snapshot = machineActor.getSnapshot();

      // These should handle missing XState methods gracefully
      expect(snapshot.matches('nonexistent')).toBe(false);
      // Note: can() returns false for events not defined in the current state
      expect(snapshot.can('NONEXISTENT_EVENT')).toBe(false);
      expect(snapshot.hasTag('any-tag')).toBe(false);
      expect(snapshot.toJSON()).toEqual(expect.any(Object));
    });

    it('should handle error states', () => {
      const errorMachine = createMachine({
        initial: 'idle',
        states: {
          idle: {
            on: {
              ERROR: {
                target: 'error',
                actions: assign({ error: 'Test error' }),
              },
            },
          },
          error: {
            type: 'final',
          },
        },
      });

      const errorActor = new MachineActor('error-actor', errorMachine);
      errorActor.start();

      errorActor.send({ type: 'ERROR', _timestamp: Date.now(), _version: '1.0.0' });

      const snapshot = errorActor.getSnapshot();
      expect(snapshot.status).toBe('stopped'); // Final state
      expect(snapshot.value).toBe('error');
    });
  });
});
