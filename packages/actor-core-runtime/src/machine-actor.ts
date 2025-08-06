/**
 * @module actor-core/runtime/machine-actor
 * @description XState machine actor wrapper implementing ActorInstance interface
 *
 * This module provides a wrapper around XState actors to make them compatible
 * with the polymorphic ActorInstance interface, enabling mixed actor types
 * in the actor system.
 */

import type { Actor, AnyStateMachine, EventFrom, SnapshotFrom } from 'xstate';
import { assign, createActor } from 'xstate';
import type { ActorInstance } from './actor-instance.js';
import type { ActorMessage } from './actor-system.js';
import type { ActorSnapshot, ActorStatus, Message } from './types.js';

/**
 * System dependencies that can be injected into XState actors
 */
export interface MachineActorDependencies {
  emit?: (event: ActorMessage) => void;
  logger?: (msg: string, data?: unknown) => void;
  system?: unknown;
}

/**
 * Extended snapshot type for XState v5 compatibility
 */
interface XStateSnapshot {
  value?: unknown;
  context?: unknown;
  status?: string;
  error?: unknown;
  matches?: (state: string) => boolean;
  can?: (event: unknown) => boolean;
  hasTag?: (tag: string) => boolean;
  toJSON?: () => object;
  nextEvents?: string[];
}

/**
 * Wrapper around XState actors to provide ActorInstance compatibility.
 * This allows XState actors to be stored polymorphically with other actor types.
 *
 * The MachineActor manages the XState actor lifecycle and provides integration
 * with the actor system's features like event emission and logging.
 */
export class MachineActor<
  TMachine extends AnyStateMachine = AnyStateMachine,
  TDeps extends MachineActorDependencies = MachineActorDependencies,
> implements ActorInstance
{
  public readonly id: string;
  private actor?: Actor<TMachine>;
  private snapshot: ActorSnapshot;
  private readonly machine: TMachine;
  private dependencies: TDeps;

  constructor(id: string, machine: TMachine, initialDeps: TDeps = {} as TDeps) {
    this.id = id;
    this.machine = machine;
    this.dependencies = initialDeps;

    // Initialize default snapshot
    this.snapshot = {
      value: 'idle',
      context: {},
      status: 'idle',
      error: undefined,
      matches: () => false,
      can: () => true,
      hasTag: () => false,
      toJSON: () => ({ value: 'idle', context: {} }),
    };
  }

  /**
   * Start the XState actor
   */
  start(): void {
    if (this.actor) {
      return; // Already started
    }

    // Extend the machine with UPDATE_DEPS handler
    const machineWithDeps = this.machine.provide({
      actions: {
        updateDeps: assign({
          deps: ({ context }, event) => {
            // Type guard to check if this is an UPDATE_DEPS event
            if (
              event &&
              typeof event === 'object' &&
              'type' in event &&
              event.type === 'UPDATE_DEPS' &&
              'deps' in event
            ) {
              return {
                ...(context.deps || {}),
                ...(event.deps || {}),
              };
            }
            return context.deps || {};
          },
        }),
      },
    });

    // Create the actor with dependencies in the input
    this.actor = createActor(machineWithDeps, {
      id: this.id,
      input: {
        ...this.machine.config.context,
        deps: this.dependencies,
      },
    }) as Actor<TMachine>;

    // Subscribe to state changes
    this.actor.subscribe((state) => {
      // Update our snapshot
      this.snapshot = this.buildSnapshot(state);

      // Emit transition events
      if (this.dependencies.emit) {
        const stateSnapshot = state as XStateSnapshot;

        this.dependencies.emit({
          type: 'xstate.transition',
          value: stateSnapshot.value,
          context: stateSnapshot.context,
          actorId: this.id,
          _timestamp: Date.now(),
          _version: '1.0.0',
        } as ActorMessage);
      }

      // Log transitions
      if (this.dependencies.logger) {
        const stateSnapshot = state as XStateSnapshot;
        this.dependencies.logger('State transition', {
          actorId: this.id,
          value: stateSnapshot.value,
          status: stateSnapshot.status,
        });
      }
    });

    // Start the actor
    this.actor.start();
  }

  /**
   * Send an event to the actor
   */
  send<T extends { type: string }>(event: T): void {
    if (!this.actor) {
      throw new Error(`Actor ${this.id} not started`);
    }
    this.actor.send(event as EventFrom<TMachine>);
  }

  /**
   * Ask the actor a question and wait for a response
   */
  async ask<T>(_message: Message, _timeout?: number): Promise<T> {
    // For now, return a placeholder implementation
    // This will be properly implemented with the actor system integration
    throw new Error(`Ask pattern not yet implemented for MachineActor ${this.id}`);
  }

  /**
   * Stop the actor
   */
  stop(): void {
    if (this.actor) {
      this.actor.stop();
      this.actor = undefined;

      // Reset snapshot
      this.snapshot = {
        value: 'idle',
        context: {},
        status: 'idle',
        error: undefined,
        matches: () => false,
        can: () => true,
        hasTag: () => false,
        toJSON: () => ({ value: 'idle', context: {} }),
      };
    }
  }

  /**
   * Update dependencies at runtime
   */
  updateDependencies(deps: Partial<TDeps>): void {
    this.dependencies = { ...this.dependencies, ...deps };

    // Send UPDATE_DEPS event if actor is running
    if (this.actor) {
      this.send({ type: 'UPDATE_DEPS', deps });
    }
  }

  /**
   * Get current snapshot
   */
  getSnapshot(): ActorSnapshot {
    return this.snapshot;
  }

  /**
   * Get current status
   */
  get status(): ActorStatus {
    return this.snapshot.status;
  }

  /**
   * Get actor type
   */
  getType(): 'machine' {
    return 'machine';
  }

  /**
   * Get the underlying XState actor
   */
  getXStateActor(): Actor<TMachine> | undefined {
    return this.actor;
  }

  /**
   * Get internal state for debugging
   */
  getInternalState(): unknown {
    return {
      type: 'machine',
      id: this.id,
      started: !!this.actor,
      xstateId: this.actor?.id,
      snapshot: this.snapshot,
      dependencies: this.dependencies,
    };
  }

  /**
   * Build ActorSnapshot from XState snapshot
   */
  private buildSnapshot(xstateSnapshot: SnapshotFrom<TMachine>): ActorSnapshot {
    const snapshot = xstateSnapshot as XStateSnapshot;

    // Determine status based on XState v5 snapshot
    let status: ActorStatus = 'idle';
    if (snapshot.status === 'active') {
      status = 'running';
    } else if (snapshot.status === 'done' || snapshot.status === 'stopped') {
      status = 'stopped';
    } else if (snapshot.error) {
      status = 'error';
    }

    return {
      value: snapshot.value ?? 'active',
      context: snapshot.context ?? {},
      status,
      error: snapshot.error instanceof Error ? snapshot.error : undefined,
      matches: (state: string) => {
        return typeof snapshot.matches === 'function' ? snapshot.matches(state) : false;
      },
      can: (event: ActorMessage | string) => {
        if (typeof snapshot.can === 'function') {
          const eventType = typeof event === 'string' ? event : event.type;
          return snapshot.can(eventType);
        }
        // Check nextEvents if available
        const eventType = typeof event === 'string' ? event : event.type;
        return Array.isArray(snapshot.nextEvents) ? snapshot.nextEvents.includes(eventType) : false;
      },
      hasTag: (tag: string) => {
        return typeof snapshot.hasTag === 'function' ? snapshot.hasTag(tag) : false;
      },
      toJSON: () => {
        return typeof snapshot.toJSON === 'function'
          ? snapshot.toJSON()
          : { value: snapshot.value, context: snapshot.context };
      },
    };
  }
}

/**
 * Type guard to check if an actor is a machine-based actor
 */
export function isMachineActor(actor: unknown): actor is MachineActor<AnyStateMachine> {
  return actor instanceof MachineActor;
}

/**
 * Create a MachineActor from an XState machine
 */
export function createMachineActor<
  T extends AnyStateMachine,
  D extends MachineActorDependencies = MachineActorDependencies,
>(id: string, machine: T, deps: D = {} as D): MachineActor<T, D> {
  return new MachineActor(id, machine, deps);
}
