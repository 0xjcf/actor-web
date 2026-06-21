/**
 * @module actor-core/runtime/actor-system-impl
 * @description Production implementation of the ActorSystem interface
 *
 * This module provides:
 * 1. Actor lifecycle management (spawn, stop, restart) using pure actor model
 * 2. Message routing with location transparency
 * 3. Supervision strategies for fault tolerance
 * 4. Directory service with Orleans-style caching
 * 5. Statistics and monitoring capabilities
 * 6. Event broker and discovery services as core system actors
 *
 * The implementation follows pure actor model principles:
 * - All communication via async message passing
 * - No shared state between actors
 * - Location transparency for distributed systems
 * - Fault tolerance through supervision hierarchies
 * - Business message correlation for ask patterns
 *
 * @example
 * ```typescript
 * const system = createActorSystem({
 *   nodeAddress: 'node-1',
 *   directory: { maxCacheSize: 10000 }
 * });
 *
 * await system.start();
 *
 * const actor = await system.spawn(defineBehavior({
 *   machine: myMachine,
 *   onMessage: async ({ message, machine, dependencies }) => {
 *     // Pure actor behavior with MessagePlan response
 *     return { type: 'PROCESSED', data: message.payload };
 *   }
 * }));
 *
 * await actor.send({ type: 'HELLO', payload: 'World' });
 * ```
 *
 * @author Agent A (Tech Lead) - Actor-Core Framework
 * @version 1.0.0
 */

import { createMachine } from 'xstate';
// ✅ CONTEXT ISOLATION: Actor context manager for identity boundaries
import * as ActorContextManager from './actor-context-manager.js';
import type { ActorInstance } from './actor-instance.js';
import type { ActorEventSubscriptionOptions, ActorRef } from './actor-ref.js';
import type {
  ActorAddress,
  ActorBehavior,
  ActorDependencies,
  ActorMessage,
  ActorPID,
  ActorStats,
  ActorSupervisionPolicy,
  ActorSupervisionStrategy,
  ActorSystem,
  ClusterState,
  MessageTransport,
  SpawnOptions,
} from './actor-system.js';
import { isLocalAddress, parseActorPath } from './actor-system.js';
import { createGuardianActor, GUARDIAN_ADDRESS } from './actor-system-guardian.js';
import { type ActorToolRegistry, createActorToolbox } from './actor-tools.js';
import { createSystemEventActor, type SystemEventPayload } from './actors/system-event-actor.js';
// ✅ UNIFIED API DESIGN Phase 2.1: Auto-publishing system for event subscriptions
import { AutoPublishingRegistry } from './auto-publishing.js';
import { ContextActor } from './context-actor.js';
import { type CorrelationManager, createCorrelationManager } from './correlation-manager.js';
import { DistributedActorDirectory } from './distributed-actor-directory.js';
import type { FluentBehaviorBuilder } from './fluent-behavior-builder.js';
import { Logger } from './logger.js';
import { MachineActor } from './machine-actor.js';
import { getMachineFromBehavior } from './machine-registry.js';
import { DeadLetterQueue } from './messaging/dead-letter-queue.js';
import { InterceptorChain } from './messaging/interceptor-chain.js';
import type {
  InterceptorOptions,
  MessageContext,
  MessageInterceptor,
} from './messaging/interceptors.js';
import { createMessageContext } from './messaging/interceptors.js';
import { type BoundedMailbox, createMailbox } from './messaging/mailbox.js';
import { OTPMessagePlanProcessor } from './otp-message-plan-processor.js';
import {
  createProjectionTransportStatus,
  type ProjectionTransportStatus,
} from './projection-transport.js';
// ✅ PURE ACTOR MODEL: Import pure behavior handler and OTP message plan processor
import { type PureActorBehavior, PureActorBehaviorHandler } from './pure-behavior-handler.js';
// ✅ PURE ACTOR MODEL: Import XState-based timeout management
import { PureXStateTimeoutManager } from './pure-xstate-utilities.js';
import {
  actorMessageToEventEnvelope,
  actorRuntimeProjectionToActorSnapshot,
  actorSnapshotsToTransitionRecord,
  actorSnapshotToRuntimeSnapshot,
  eventEnvelopeToActorMessage,
} from './runtime-projection.js';
import {
  isRuntimeProtocolMessage,
  type RuntimeDirectoryEntry,
  type RuntimeEventProjection,
  type RuntimeProtocolMessage,
  type RuntimeSnapshotProjection,
} from './runtime-transport-protocol.js';
import { StatelessActor } from './stateless-actor.js';
import type { ContextOf, MessageOf } from './type-helpers.js';
import type { ActorSnapshot, JsonValue, Message } from './types.js';
import { createActorAddress, generateCorrelationId, parse } from './utils/factories.js';

// ✅ Define specific message types for type safety
interface SpawnChildMessage extends ActorMessage {
  type: 'SPAWN_CHILD';
  childId: string;
  childPath: string;
  supervision: string;
}

interface SystemEventMessage extends ActorMessage {
  type: 'EMIT_SYSTEM_EVENT';
  systemEventType: string;
  systemTimestamp: number;
  systemData: unknown;
}

interface ActorFailedMessage extends ActorMessage {
  type: 'ACTOR_FAILED';
  actorId: string;
  actorPath: string;
  error: string;
  directive: string;
}

interface ActorProjectionState {
  createdAt: string;
  updatedAt: string;
  correlationId: string;
  lastEventType: string | null;
  sequence: number;
}

interface RemoteProjectionWatcher {
  address: ActorAddress;
  snapshot: ActorSnapshot<unknown>;
  snapshotListeners: Set<(snapshot: ActorSnapshot<unknown>) => void>;
  eventSubscribers: Set<{
    listener: (event: ActorMessage) => void;
    types?: readonly string[];
  }>;
  statusListeners: Set<(status: ProjectionTransportStatus) => void>;
  status: ProjectionTransportStatus;
  snapshotSubscribed: boolean;
  eventSubscribed: boolean;
}

interface OutboundRemoteProjectionSubscribers {
  snapshotNodes: Set<string>;
  eventNodes: Set<string>;
}

type MacrotaskScheduler = (callback: () => void) => void;

const scheduleMacrotask: MacrotaskScheduler = (() => {
  const maybeSetImmediate = (
    globalThis as typeof globalThis & { setImmediate?: MacrotaskScheduler }
  ).setImmediate;

  if (typeof maybeSetImmediate === 'function') {
    return (callback: () => void) => maybeSetImmediate(callback);
  }

  return (callback: () => void) => {
    setTimeout(callback, 0);
  };
})();

const log = Logger.namespace('ACTOR_SYSTEM');

// Supervision strategy constants — system-wide defaults applied to actors
// spawned without a per-actor supervision policy.
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_WINDOW_MS = 30000; // 30 seconds
const RESTART_BACKOFF_MS = 1000; // 1 second

const SUPPORTED_SUPERVISION_STRATEGIES: readonly ActorSupervisionStrategy[] = [
  'restart',
  'resume',
  'stop',
  'escalate',
];

/**
 * Input facts for a supervision decision: the failed actor's policy (if any)
 * and its restart bookkeeping.
 */
export interface SupervisionDecisionInput {
  readonly policy?: ActorSupervisionPolicy;
  readonly restartCount: number;
  readonly lastRestartTimeMs: number;
  readonly nowMs: number;
}

/**
 * The supervision decision for one failure:
 *
 * - `restart` — respawn the actor; `restartCount` is the effective count
 *   after window expiry is applied, `maxRestarts` is the effective bound.
 * - `stop-permanent` — the restart bound was exceeded; stop for good.
 * - `stop` — the policy says never restart.
 * - `escalate` — hand the failure up: in a widening supervisor group the
 *   shell substitutes a bounded restart; otherwise stop and emit a distinct
 *   escalation event.
 * - `resume` — keep the actor running with its current state; the failed
 *   message is skipped.
 */
export type SupervisionDecision =
  | { readonly kind: 'restart'; readonly restartCount: number; readonly maxRestarts: number }
  | {
      readonly kind: 'stop-permanent';
      readonly restartCount: number;
      readonly maxRestarts: number;
    }
  | { readonly kind: 'stop' }
  | { readonly kind: 'escalate' }
  | { readonly kind: 'resume' };

/**
 * Pure decision core for the supervision failure path. Deterministic — the
 * caller supplies the clock and restart bookkeeping; the imperative shell
 * (`applySupervisionStrategy`) executes the returned decision.
 *
 * `maxRestarts`/`withinMs` from the policy bound the `restart` strategy and
 * fall back to the system-wide defaults (3 restarts within 30 seconds).
 */
export function resolveSupervisionDecision(input: SupervisionDecisionInput): SupervisionDecision {
  const strategy = input.policy?.strategy ?? 'restart';

  if (strategy === 'stop') {
    return { kind: 'stop' };
  }
  if (strategy === 'escalate') {
    return { kind: 'escalate' };
  }
  if (strategy === 'resume') {
    return { kind: 'resume' };
  }

  const maxRestarts = input.policy?.maxRestarts ?? MAX_RESTART_ATTEMPTS;
  const withinMs = input.policy?.withinMs ?? RESTART_WINDOW_MS;
  const windowExpired = input.restartCount > 0 && input.nowMs - input.lastRestartTimeMs > withinMs;
  const effectiveCount = windowExpired ? 0 : input.restartCount;

  if (effectiveCount >= maxRestarts) {
    return { kind: 'stop-permanent', restartCount: effectiveCount, maxRestarts };
  }

  return { kind: 'restart', restartCount: effectiveCount, maxRestarts };
}

/**
 * One topology supervisor() group as registered with the actor system.
 * `children` are actor PATHS in declaration order (declaration order is the
 * topology `children` array order, preserved by defineActorWebTopology).
 */
export interface SupervisorGroupConfig {
  readonly key: string;
  readonly strategy: 'one-for-one' | 'one-for-all' | 'rest-for-one' | 'escalate';
  readonly children: readonly string[];
}

/**
 * Input facts for a tree supervision decision. `childDecision` is the
 * already-resolved per-actor decision (the caller substitutes
 * strategy: 'restart' bounds for escalating children in widening groups
 * before calling, so this core stays pure and clock-free).
 */
export interface TreeSupervisionDecisionInput {
  readonly childDecision: SupervisionDecision;
  readonly group?: SupervisorGroupConfig;
  readonly failedChildPath: string;
}

/**
 * The group-level decision for one failure:
 * - `pass-through` — no group, one-for-one, non-member path, or a
 *   stop/resume child decision (deliberate containment); the per-actor
 *   path handles it exactly as today.
 * - `restart-group` — stop `stopOrder` (reverse declaration order), then
 *   respawn `respawnOrder` (declaration order).
 * - `give-up-group` — stop ALL children in reverse declaration order and
 *   emit one actorEscalated; the system itself never stops.
 */
export type TreeSupervisionDecision =
  | { readonly kind: 'pass-through' }
  | {
      readonly kind: 'restart-group';
      readonly stopOrder: readonly string[];
      readonly respawnOrder: readonly string[];
    }
  | {
      readonly kind: 'give-up-group';
      readonly stopOrder: readonly string[];
      readonly reason: 'max-restarts-exceeded' | 'supervisor-escalated';
    };

/**
 * Pure decision core for supervisor() group semantics. Deterministic and
 * clock-free — the shell resolves the per-actor decision first and executes
 * the returned group action.
 */
export function resolveTreeSupervisionDecision(
  input: TreeSupervisionDecisionInput
): TreeSupervisionDecision {
  const { childDecision, group, failedChildPath } = input;
  if (!group || !group.children.includes(failedChildPath)) {
    return { kind: 'pass-through' };
  }
  if (childDecision.kind === 'stop' || childDecision.kind === 'resume') {
    return { kind: 'pass-through' };
  }
  const allReversed = [...group.children].reverse();
  if (group.strategy === 'escalate') {
    return { kind: 'give-up-group', stopOrder: allReversed, reason: 'supervisor-escalated' };
  }
  if (group.strategy === 'one-for-one') {
    return { kind: 'pass-through' };
  }
  if (childDecision.kind === 'stop-permanent') {
    return { kind: 'give-up-group', stopOrder: allReversed, reason: 'max-restarts-exceeded' };
  }
  // restart (or a raw escalate, which the shell normally substitutes first):
  // widen per the group strategy.
  const failedIndex = group.children.indexOf(failedChildPath);
  const respawnOrder =
    group.strategy === 'one-for-all' ? [...group.children] : group.children.slice(failedIndex);
  return {
    kind: 'restart-group',
    stopOrder: [...respawnOrder].reverse(),
    respawnOrder,
  };
}

/**
 * Directory configuration for actor lookup
 */
export interface DirectoryConfig {
  maxCacheSize?: number;
  cacheTtl?: number;
  cleanupInterval?: number;
}

/**
 * Configuration for the actor system
 */
export interface ActorSystemConfig {
  /**
   * Unique identifier for this node in the cluster
   */
  nodeAddress: string;

  /**
   * Maximum number of concurrent actors (default: 10000)
   */
  maxActors?: number;

  /**
   * Enable debug logging (default: false)
   */
  debug?: boolean;

  /**
   * Directory configuration for actor lookup
   */
  directory?: DirectoryConfig;

  /**
   * Message delivery timeout in milliseconds
   */
  messageTimeout?: number;

  /**
   * Default ask timeout in milliseconds
   */
  defaultAskTimeout?: number;

  /**
   * Graceful shutdown timeout in milliseconds
   */
  shutdownTimeout?: number;

  /**
   * Optional cross-node runtime transport.
   */
  transport?: MessageTransport;

  /**
   * Runtime-native tool implementations exposed to actor dependencies.
   */
  tools?: ActorToolRegistry;

  /**
   * Optional per-actor tool allow list keyed by actor path.
   */
  toolAccess?: Record<string, readonly string[]>;

  /**
   * Topology supervisor groups owned by this node. Children are actor paths
   * in declaration order.
   */
  supervisors?: readonly SupervisorGroupConfig[];
}

function createSystemInstancePrefix(nodeAddress: string): string {
  const nodeFragment = nodeAddress
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const entropy = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return nodeFragment ? `${nodeFragment}-${entropy}` : entropy;
}

/**
 * Normalize a behavior to the PureActorBehavior format for internal use
 */
function normalizeBehavior<TMessage, TEmitted>(
  behavior: ActorBehavior<TMessage, TEmitted>
): PureActorBehavior<ActorMessage, ActorMessage> & { context?: unknown } {
  // Convert to pure actor behavior format with proper type handling
  return {
    context: behavior.context,
    onMessage: behavior.onMessage as unknown as PureActorBehavior<
      ActorMessage,
      ActorMessage
    >['onMessage'],
    onStart: behavior.onStart as unknown as PureActorBehavior<
      ActorMessage,
      ActorMessage
    >['onStart'],
    onStop: behavior.onStop as unknown as PureActorBehavior<ActorMessage, ActorMessage>['onStop'],
  };
}

/**
 * Production implementation of ActorSystem
 */
export class ActorSystemImpl implements ActorSystem {
  private actors = new Map<string, PureActorBehavior<ActorMessage, ActorMessage>>();
  private actorInstances = new Map<string, ActorInstance>();
  private actorBehaviorHandlers = new Map<string, PureActorBehaviorHandler>();
  private actorSnapshots = new Map<string, ActorSnapshot<unknown>>();
  private actorMailboxes = new Map<string, BoundedMailbox>();
  private actorProcessingLoops = new Map<string, boolean>(); // Track active processing loops
  private actorProcessingActive = new Map<string, boolean>(); // Track if loop is currently processing
  private directory: DistributedActorDirectory;
  private subscribers = new Map<string, Set<(message: ActorMessage) => void>>();
  private snapshotSubscribers = new Map<string, Set<(snapshot: ActorSnapshot<unknown>) => void>>();
  private actorEventSubscribers = new Map<
    string,
    Set<{
      listener: (event: ActorMessage) => void;
      types?: readonly string[];
    }>
  >();
  private actorProjectionState = new Map<string, ActorProjectionState>();
  private remoteProjectionWatchers = new Map<string, RemoteProjectionWatcher>();
  private outboundRemoteProjectionSubscribers = new Map<
    string,
    OutboundRemoteProjectionSubscribers
  >();
  // Publisher-side: cross-node topology subscription edges this node forwards
  // emitted events to. Keyed on the local publisher actor path. Not persisted —
  // recovered by subscriber-node re-handshake on reconnect.
  private topologyRemoteSubscribers = new Map<
    string,
    Set<{ node: string; subscriberPath: string; events?: readonly string[] }>
  >();
  // Subscriber-side: cross-node edges this node initiated, kept so we can replay
  // the subscribe handshakes when a publisher node reconnects. Keyed on the
  // publisher node address. Not persisted.
  private outboundTopologySubscriptions = new Map<
    string,
    Set<{ publisherPath: string; subscriberPath: string; events?: readonly string[] }>
  >();
  private transportSubscriptionStop: (() => void) | null = null;

  // System event and cluster event actors
  private guardianActorAddress?: ActorAddress;
  private systemEventActorAddress?: ActorAddress;
  private clusterEventActorAddress?: ActorAddress;
  // ✅ PURE ACTOR MODEL: Core system service actors
  private discoveryServiceActorAddress?: ActorAddress;

  private running = false;
  private clusterState: ClusterState = {
    nodes: [],
    leader: '',
    status: 'down',
  };
  private actorStats = new Map<string, ActorStats & { startTime: number }>();
  private correlationManager: CorrelationManager;
  private shutdownHandlers = new Set<() => Promise<void>>();
  private actorStarted = new Map<string, boolean>(); // Track whether onStart has been called
  private actorRestartCounts = new Map<string, number>(); // Track restart attempts per actor
  private actorLastRestartTime = new Map<string, number>(); // Track last restart time per actor
  private actorSupervisionPolicies = new Map<string, ActorSupervisionPolicy>(); // Per-actor policy from SpawnOptions.supervision
  // Original (pre-normalization) behavior per actor path. Machine lookups key
  // on behavior object identity (machine-registry WeakMap), and normalization
  // produces a fresh object — so a supervised restart must respawn from the
  // original reference or a machine-backed actor would silently come back as
  // a context/stateless actor.
  private actorOriginalBehaviors = new Map<string, ActorBehavior<unknown, unknown>>();
  // Topology supervisor() groups owned by this node (key → group) and the
  // reverse child-path index. `restartingGroups` is the re-entrancy guard:
  // failures surfacing from members while their group action is in flight are
  // logged and swallowed — the group action already covers them.
  private supervisorGroups = new Map<string, SupervisorGroupConfig>();
  private actorSupervisorGroupKeys = new Map<string, string>();
  private restartingGroups = new Set<string>();

  // ✅ PURE ACTOR MODEL: XState timeout manager for system scheduling
  private systemTimeoutManager = new PureXStateTimeoutManager();
  // ✅ PURE ACTOR MODEL: OTP message plan processor for all behaviors
  private messagePlanProcessor: OTPMessagePlanProcessor;

  // Interceptor chains
  private globalInterceptors = new InterceptorChain();
  private actorInterceptors = new WeakMap<ActorPID, InterceptorChain>();
  private messageContexts = new WeakMap<ActorMessage, MessageContext>();

  // Removed callback maps - using pure actor model message passing instead
  private clusterEventCallbacks = new Map<
    string,
    (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  >();

  // System event callbacks for subscribeToSystemEvents
  private systemEventCallbacks = new Map<
    string,
    (event: { type: string; [key: string]: unknown }) => void
  >();

  // Dead letter queue
  private deadLetterQueue: DeadLetterQueue;

  // ✅ UNIFIED API DESIGN Phase 2.1: Auto-publishing registry for event subscriptions
  private autoPublishingRegistry: AutoPublishingRegistry;

  // Test mode flag - when true, messages are processed synchronously
  private testMode = false;
  private nextActorSequence = 0;
  private readonly systemInstancePrefix: string;

  constructor(private readonly config: ActorSystemConfig) {
    this.systemInstancePrefix = createSystemInstancePrefix(config.nodeAddress);
    for (const group of config.supervisors ?? []) {
      this.supervisorGroups.set(group.key, group);
      for (const childPath of group.children) {
        if (this.actorSupervisorGroupKeys.has(childPath)) {
          log.warn('Actor path declared in multiple supervisor groups; last declaration wins', {
            path: childPath,
            group: group.key,
          });
        }
        this.actorSupervisorGroupKeys.set(childPath, group.key);
      }
    }
    this.directory = new DistributedActorDirectory({
      nodeAddress: config.nodeAddress,
      maxCacheSize: config.directory?.maxCacheSize ?? 10000,
      cacheTtl: config.directory?.cacheTtl ?? 5 * 60 * 1000,
      cleanupInterval: config.directory?.cleanupInterval ?? 60 * 1000,
    });

    // Initialize correlation manager for ask pattern
    this.correlationManager = createCorrelationManager({
      defaultTimeout: config.defaultAskTimeout ?? 5000,
      enableDebugLogging: config.debug ?? false,
    });

    this.deadLetterQueue = new DeadLetterQueue();

    // ✅ UNIFIED API DESIGN Phase 2.1: Initialize auto-publishing registry
    this.autoPublishingRegistry = new AutoPublishingRegistry();

    // ✅ PURE ACTOR MODEL: Initialize OTP message plan processor
    this.messagePlanProcessor = new OTPMessagePlanProcessor();

    // ✅ PURE ACTOR MODEL: Initialize XState timeout scheduler
    // this.systemScheduler = createActor(timeoutSchedulerMachine);
    // this.systemScheduler.start();

    if (config.debug) {
      // Debug logging is enabled via environment variable
      log.debug('Debug mode enabled');
    }
  }

  private generateActorId(): string {
    const actorSequence = this.nextActorSequence;
    this.nextActorSequence += 1;
    return `actor-${this.systemInstancePrefix}-${actorSequence}`;
  }

  private getLocalActorCount(): number {
    return this.actorInstances.size;
  }

  /**
   * Start the actor system
   */
  async start(): Promise<void> {
    if (this.running) {
      log.debug('System already running, skipping start');
      return;
    }

    log.info('Starting actor system', {
      nodeAddress: this.config.nodeAddress,
      maxActors: this.config.maxActors ?? 'unlimited',
      timestamp: Date.now(),
    });

    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'up',
    };

    this.running = true;

    if (this.config.transport) {
      // Transports dispatch listeners without awaiting them, so a rejection
      // here (e.g. an error reply sent to a peer that already disconnected)
      // would surface as an unhandled rejection instead of a logged fact.
      this.transportSubscriptionStop = this.config.transport.subscribe(({ source, message }) => {
        if (!isRuntimeProtocolMessage(message)) {
          return;
        }

        void this.handleRuntimeProtocolMessage(source, message).catch((error) => {
          log.warn('Runtime protocol message handling failed', {
            source,
            messageType: message.type,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
    }

    log.debug('Spawning guardian actor');
    // Spawn guardian actor first - it supervises all other actors
    const guardianActor = await createGuardianActor(this);
    this.guardianActorAddress = guardianActor.address;

    log.debug('Guardian actor spawned', {
      guardianPath: this.guardianActorAddress,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
    });

    // ✅ PURE ACTOR MODEL: Spawn core system actors

    log.debug('Spawning system event actor');
    // Spawn system event actor (updated to use defineBehavior)
    const systemEventBehavior = createSystemEventActor();
    const systemEventActor = await this.spawn(systemEventBehavior, {
      id: 'system-event-actor',
    });
    this.systemEventActorAddress = systemEventActor.address;

    log.debug('System event actor spawned', {
      systemEventPath: this.systemEventActorAddress,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
    });

    log.debug('Emitting system started event');
    // Emit system started event
    await this.emitSystemEvent({
      eventType: 'started',
      timestamp: Date.now(),
    });

    log.info('Actor system started with core services', {
      guardian: this.guardianActorAddress,
      systemEventActor: this.systemEventActorAddress,
      totalActors: this.actors.size,
      totalMailboxes: this.actorMailboxes.size,
      totalProcessingLoops: this.actorProcessingLoops.size,
      activeProcessing: this.actorProcessingActive.size,
    });
  }

  /**
   * Stop the actor system (no parameters)
   */
  async stop(): Promise<void>;
  /**
   * Stop a specific actor (with PID parameter)
   */
  async stop(pid: ActorPID): Promise<void>;
  /**
   * Implementation that handles both overloads
   */
  async stop(pid?: ActorPID): Promise<void> {
    if (pid === undefined) {
      // No parameter - stop the entire system
      return this.stopSystem();
    }
    // PID parameter - stop a specific actor
    return this.stopActor(pid);
  }

  /**
   * Internal method to stop the entire system
   */
  private async stopSystem(): Promise<void> {
    if (!this.running) {
      return;
    }

    log.info('Stopping actor system');
    this.running = false;

    // Update cluster state
    this.clusterState = {
      ...this.clusterState,
      status: 'down',
    };

    // Emit shutdown event
    await this.emitSystemEvent({ eventType: 'stopping', timestamp: Date.now() });

    // Execute shutdown handlers
    const shutdownPromises = Array.from(this.shutdownHandlers).map((handler) => handler());

    // Stop all actors gracefully — except the system event actor, which must
    // outlive its peers so their actorStopping/actorStopped emissions still
    // have a live mailbox to land in (otherwise every stop dead-letters).
    const systemEventPath = this.systemEventActorAddress;
    const stopPromises: Promise<void>[] = [];
    for (const [path, _behavior] of Array.from(this.actors)) {
      if (path === systemEventPath) {
        continue;
      }
      const actor = await this.lookup(path);
      if (actor) {
        stopPromises.push(this.stopActor(actor));
      }
    }

    // ✅ PURE ACTOR MODEL: Use XState timeout manager for shutdown timeout
    const shutdownTimeout = this.config.shutdownTimeout ?? 30000;

    try {
      await Promise.race([
        Promise.all([...shutdownPromises, ...stopPromises]),
        new Promise<void>((_, reject) => {
          this.systemTimeoutManager.setTimeout(() => {
            reject(new Error('Shutdown timeout'));
          }, shutdownTimeout);
        }),
      ]);
    } catch (error) {
      log.error('Error during shutdown', { error });
    }

    // Emit the final event while the system event actor is still alive, then
    // stop it last — after this point no actor remains to emit about.
    await this.emitSystemEvent({ eventType: 'stopped', timestamp: Date.now() });
    if (systemEventPath) {
      const systemEventActor = await this.lookup(systemEventPath);
      if (systemEventActor) {
        await this.stopActor(systemEventActor);
      }
    }

    // Stop the system timeout manager
    this.systemTimeoutManager.destroy();

    // Clear directory
    await this.directory.cleanup();

    if (this.transportSubscriptionStop) {
      this.transportSubscriptionStop();
      this.transportSubscriptionStop = null;
    }

    // Cleanup request manager - handled automatically on system shutdown
  }

  /**
   * Internal method to stop a specific actor.
   *
   * `reason` tags the terminal `actorStopped` system event (for example
   * `supervision-stop` or `max-restarts-exceeded`). Exactly one
   * `actorStopped` event is emitted per stop — callers must not emit their
   * own; they pass the reason here instead.
   */
  private async stopActor(pid: ActorPID, reason?: string): Promise<void> {
    // Access the address from the PID interface
    const address = pid.address;
    const path = address;

    // Emit stopping event
    await this.emitSystemEvent({
      eventType: 'actorStopping',
      timestamp: Date.now(),
      data: { address: address },
    });

    // Call onStop if behavior has it
    const behavior = this.actors.get(path);
    if (behavior?.onStop) {
      try {
        // Create default machine and dependencies for onStop
        const defaultMachine = createMachine({
          id: `actor-${path}`,
          initial: 'active',
          states: { active: {} },
        });
        // Create MachineActor wrapper for consistency
        const machineDependencies = {
          emit: (event: ActorMessage) => {
            this.publishActorEvent(address, event);
          },
          logger: (msg: string, data?: unknown) => log.debug(msg, data),
          system: this,
        };
        const machineActorInstance = new MachineActor(path, defaultMachine, machineDependencies);
        machineActorInstance.start();

        // Create ActorRef for self reference
        const selfRef = new ActorPIDImpl(address, this) as unknown as ActorRef<unknown>;

        const dependencies: ActorDependencies = {
          actorId: path,
          actor: machineActorInstance,
          self: selfRef,
          emit: (event: unknown) => {
            this.publishActorEvent(address, event);
          },
          send: async () => {}, // Simple no-op for onStop
          ask: async <T>() => Promise.resolve({} as T), // Simple no-op for onStop
          tools: createActorToolbox(
            this.config.tools,
            {
              actorId: path,
              nodeAddress: this.config.nodeAddress,
            },
            this.config.toolAccess?.[path]
          ),
          logger: Logger.namespace(`ACTOR_${path}`),
          correlationManager: this.correlationManager,
        };

        await behavior.onStop({
          actor: machineActorInstance,
          dependencies,
          tools: dependencies.tools,
        });
      } catch (error) {
        log.error('Error in actor onStop', { path, error });
      }
    }

    // Stop the message processing loop
    this.actorProcessingLoops.delete(path);
    this.actorProcessingActive.delete(path);

    // Clean up mailbox
    const mailbox = this.actorMailboxes.get(path);
    if (mailbox) {
      mailbox.stop();
      this.actorMailboxes.delete(path);
    }

    // ✅ PURE ACTOR MODEL: Clean up actor instance and behavior handler
    const actorInstance = this.actorInstances.get(path);
    const lastKnownSnapshot =
      this.actorSnapshots.get(path) ??
      actorInstance?.getSnapshot() ??
      this.createFallbackSnapshot();
    if (actorInstance) {
      actorInstance.stop();
      this.actorInstances.delete(path);
    }
    const stoppedSnapshot = this.createFallbackSnapshot('stopped', lastKnownSnapshot);
    this.actorSnapshots.set(path, stoppedSnapshot);
    this.notifySnapshotSubscribers(path, stoppedSnapshot);
    await this.publishRemoteSnapshotProjection(address, stoppedSnapshot, lastKnownSnapshot);
    this.actorEventSubscribers.delete(path);
    this.actorBehaviorHandlers.delete(path);

    // Remove from local actors
    this.actors.delete(path);
    this.actorOriginalBehaviors.delete(path);
    this.actorStarted.delete(path);

    // Clean up restart tracking and the per-actor supervision policy. A
    // supervised restart re-passes the policy through spawn and restores the
    // restart bookkeeping after the respawn (see restartActorWithLimits).
    this.actorRestartCounts.delete(path);
    this.actorLastRestartTime.delete(path);
    this.actorSupervisionPolicies.delete(path);

    // Unregister from directory
    await this.directory.unregister(address);
    await this.broadcastDirectoryUnregister(address);

    // Clear stats
    this.actorStats.delete(path);
    this.actorProjectionState.delete(path);
    this.outboundRemoteProjectionSubscribers.delete(path);

    log.debug('Actor stopped', {
      path,
      totalActors: this.getLocalActorCount(),
    });

    await this.emitSystemEvent({
      eventType: 'actorStopped',
      timestamp: Date.now(),
      data: reason !== undefined ? { address: address, reason } : { address: address },
    });
  }

  /**
   * Register a shutdown handler
   */
  onShutdown(handler: () => Promise<void>): void {
    this.shutdownHandlers.add(handler);
  }

  /**
   * Spawn a new actor with proper type inference
   * Clean approach: single generic overload that extracts types
   */
  async spawn<B extends FluentBehaviorBuilder<ActorMessage, unknown, unknown, unknown>>(
    builder: B,
    options?: SpawnOptions
  ): Promise<ActorRef<ContextOf<B>, MessageOf<B>>>;

  async spawn<TMsg extends ActorMessage, TEmitted, TCtx>(
    behavior: ActorBehavior<TMsg, TEmitted> & { context?: TCtx },
    options?: SpawnOptions
  ): Promise<ActorRef<TCtx, TMsg>>;

  async spawn(
    behaviorOrBuilder:
      | FluentBehaviorBuilder<ActorMessage, unknown, unknown, unknown>
      | ActorBehavior,
    options?: SpawnOptions
  ): Promise<ActorRef<unknown, ActorMessage>> {
    if (!this.running) {
      throw new Error('Actor system is not running');
    }

    // Handle FluentBehaviorBuilder or direct ActorBehavior
    let actualBehavior: ActorBehavior;

    if ('build' in behaviorOrBuilder && typeof behaviorOrBuilder.build === 'function') {
      // It's a FluentBehaviorBuilder - build it
      const spec = behaviorOrBuilder.build();
      actualBehavior = {
        context: spec.initialContext as JsonValue | undefined,
        onMessage: (spec.handler || (() => {})) as unknown as ActorBehavior['onMessage'],
        onStart: spec.startHandler,
        onStop: spec.stopHandler,
      };
    } else {
      // It's already an ActorBehavior
      actualBehavior = behaviorOrBuilder as ActorBehavior;
    }

    const id = options?.id || this.generateActorId();

    // Check max actors limit
    if (this.config.maxActors && this.getLocalActorCount() >= this.config.maxActors) {
      throw new Error(`Maximum actor limit reached: ${this.config.maxActors}`);
    }

    // The guardian id is reserved in mint(), so the system's own root-supervisor
    // bootstrap uses the deliberate GUARDIAN_ADDRESS sentinel rather than minting.
    const address =
      id === 'guardian' ? GUARDIAN_ADDRESS : createActorAddress(id, this.config.nodeAddress);
    // Opaque path key reused for the per-actor registries below (behavior
    // unchanged: this is the same string the old inline mint produced).
    const path = address;

    // Store the per-actor supervision policy so the failure path can honor
    // strategy/maxRestarts/withinMs. Validate the strategy at runtime for
    // non-TypeScript consumers — silently accepting an unknown strategy would
    // fall back to defaults and misrepresent the policy contract.
    if (options?.supervision) {
      if (!SUPPORTED_SUPERVISION_STRATEGIES.includes(options.supervision.strategy)) {
        throw new Error(
          `Unsupported supervision strategy "${String(options.supervision.strategy)}" for actor "${id}". ` +
            `Supported strategies: ${SUPPORTED_SUPERVISION_STRATEGIES.join(', ')}.`
        );
      }
      const { maxRestarts, withinMs } = options.supervision;
      if (maxRestarts !== undefined && (!Number.isInteger(maxRestarts) || maxRestarts < 0)) {
        throw new Error(
          `Invalid supervision maxRestarts "${String(maxRestarts)}" for actor "${id}". ` +
            'Expected a non-negative integer.'
        );
      }
      if (withinMs !== undefined && (!Number.isFinite(withinMs) || withinMs <= 0)) {
        throw new Error(
          `Invalid supervision withinMs "${String(withinMs)}" for actor "${id}". ` +
            'Expected a positive finite number of milliseconds.'
        );
      }
      this.actorSupervisionPolicies.set(path, options.supervision);
    }

    // Store the behavior with type-safe normalization
    const normalizedBehavior = normalizeBehavior(actualBehavior as ActorBehavior<unknown, unknown>);
    this.actors.set(path, normalizedBehavior);
    // Keep the original reference so a supervised restart can respawn from it
    // (machine registrations key on this object's identity, which
    // normalizeBehavior does not preserve).
    this.actorOriginalBehaviors.set(path, actualBehavior as ActorBehavior<unknown, unknown>);

    // ✅ PURE ACTOR MODEL: Create appropriate actor type based on behavior
    const existingMachine = getMachineFromBehavior(
      actualBehavior as ActorBehavior<unknown, unknown>
    );
    let actorInstance: ActorInstance;

    if (existingMachine) {
      log.debug('Using machine from behavior', { actorId: id });
      // Create MachineActor wrapper with dependency injection
      const dependencies = {
        emit: (event: ActorMessage) => {
          this.publishActorEvent(address, event);
        },
        logger: (msg: string, data?: unknown) => log.debug(msg, data),
        system: this,
      };
      actorInstance = new MachineActor(id, existingMachine, dependencies);
    } else if (normalizedBehavior.context && Object.keys(normalizedBehavior.context).length > 0) {
      log.debug('Creating context-based actor', {
        actorId: id,
        initialContext: normalizedBehavior.context,
      });
      // Context-based actors use ContextActor for stateful behaviors
      actorInstance = new ContextActor(id, normalizedBehavior.context);
    } else {
      log.debug('Creating stateless actor', {
        actorId: id,
        hasContext: !!normalizedBehavior.context,
        contextKeys: normalizedBehavior.context ? Object.keys(normalizedBehavior.context) : [],
      });
      // Stateless actors for maximum performance with no state
      actorInstance = new StatelessActor(id);
    }

    // Start the actor instance
    actorInstance.start();

    // Store in polymorphic map
    this.actorInstances.set(path, actorInstance);
    this.actorSnapshots.set(path, actorInstance.getSnapshot());
    this.actorProjectionState.set(path, {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      correlationId: path,
      lastEventType: null,
      sequence: 0,
    });

    // ✅ PURE ACTOR MODEL: Create and store behavior handler for this actor
    const behaviorHandler = new PureActorBehaviorHandler(this.messagePlanProcessor);
    this.actorBehaviorHandlers.set(path, behaviorHandler);

    // Register in directory
    log.debug('Registering actor in directory', {
      actorPath: path,
      nodeAddress: this.config.nodeAddress,
    });
    await this.directory.register(address, this.config.nodeAddress);
    await this.broadcastDirectoryRegister(address);
    log.debug('Actor registered in directory', {
      actorPath: path,
    });

    // Initialize stats with extended properties
    this.actorStats.set(path, {
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: 0,
      startTime: Date.now(),
    });

    // ✅ UNIFIED API DESIGN Phase 2.1: Analyze behavior for auto-publishing
    this.autoPublishingRegistry.analyzeActorBehavior(
      path,
      normalizedBehavior as ActorBehavior<ActorMessage, unknown>
    );

    // Create mailbox for the actor
    const mailbox = createMailbox.dropping(1000);
    this.actorMailboxes.set(path, mailbox);

    // Initialize onStart tracking
    this.actorStarted.set(path, false);

    // Start message processing loop for this actor
    this.startMessageProcessingLoop(address, normalizedBehavior);

    log.debug('Actor spawned', {
      id,
      kind: parse(address).kind,
      path,
      totalActors: this.getLocalActorCount(),
    });

    await this.emitSystemEvent({
      eventType: 'actorSpawned',
      timestamp: Date.now(),
      data: { address },
    });

    // Notify guardian about the new child (if it's not the guardian itself)
    if (this.guardianActorAddress && parse(address).id !== 'guardian') {
      const spawnChildMessage: SpawnChildMessage = {
        type: 'SPAWN_CHILD',
        childId: parse(address).id,
        childPath: address,
        supervision: 'resume',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };
      await this.enqueueMessage(this.guardianActorAddress, spawnChildMessage);
    }

    // Create typed ActorRef using ActorPIDImpl which properly sends messages through the system
    // This ensures messages go through the mailbox system instead of instance.send()
    return new ActorPIDImpl(address, this) as unknown as ActorRef<unknown, ActorMessage>;
  }

  /**
   * Lookup an actor by path
   */
  async lookup<TContext = unknown, TMessage extends ActorMessage = ActorMessage>(
    path: string
  ): Promise<ActorRef<TContext, TMessage> | undefined> {
    const address = parseActorPath(path);
    if (!address) {
      return undefined;
    }

    let location = await this.directory.lookup(address);
    const node = this.getAddressNode(address);
    if (!location && node && this.config.transport?.isConnected(node)) {
      await this.requestDirectorySync(node);
      location = await this.directory.lookup(address);
    }
    if (!location) {
      return undefined;
    }

    if (location !== this.config.nodeAddress) {
      await this.primeRemoteProjectionWatcher(address);
    }

    return new ActorPIDImpl(address, this) as unknown as ActorRef<TContext, TMessage>;
  }

  /**
   * List all actors in the system
   */
  async listActors(): Promise<ActorAddress[]> {
    const allActors = await this.directory.getAll();
    const results: ActorAddress[] = [];

    for (const [path, location] of Array.from(allActors)) {
      if (location === this.config.nodeAddress) {
        results.push(parseActorPath(path));
      }
    }

    return results;
  }

  /**
   * Get system statistics
   */
  async getSystemStats(): Promise<{
    totalActors: number;
    messagesPerSecond: number;
    uptime: number;
    clusterState: ClusterState;
  }> {
    const now = Date.now();
    let totalMessages = 0;
    let totalUptime = 0;

    for (const stats of Array.from(this.actorStats.values())) {
      totalMessages += stats.messagesProcessed;
      totalUptime += (now - stats.startTime) / 1000;
    }

    const messagesPerSecond = totalUptime > 0 ? totalMessages / totalUptime : 0;

    return {
      totalActors: this.getLocalActorCount(),
      messagesPerSecond,
      uptime: totalUptime,
      clusterState: this.clusterState,
    };
  }

  /**
   * Join a cluster of nodes
   */
  async join(nodes: string[]): Promise<void> {
    if (this.config.transport) {
      for (const node of nodes) {
        if (node === this.config.nodeAddress || this.config.transport.isConnected(node)) {
          continue;
        }

        await this.config.transport.connect(node);
      }
    }

    this.clusterState = {
      nodes: Array.from(new Set([...this.clusterState.nodes, ...nodes])),
      leader: this.clusterState.leader,
      status: 'up',
    };

    log.debug('Joined cluster', {
      nodes,
      clusterState: this.clusterState,
    });
  }

  /**
   * Leave the cluster
   */
  async leave(): Promise<void> {
    if (this.config.transport) {
      for (const node of this.config.transport.getConnectedNodes()) {
        await this.config.transport.disconnect(node);
      }
    }

    this.clusterState = {
      nodes: [this.config.nodeAddress],
      leader: this.config.nodeAddress,
      status: 'leaving',
    };

    log.debug('Left cluster', {
      clusterState: this.clusterState,
    });
  }

  /**
   * Get current cluster state
   */
  getClusterState(): ClusterState {
    return { ...this.clusterState };
  }

  /**
   * Emit a system event to all subscribers
   */
  private async emitSystemEvent(event: SystemEventPayload): Promise<void> {
    if (!this.systemEventActorAddress) {
      log.debug('Skipping system event emission before system event actor initialization', {
        eventType: event.eventType,
      });
      return;
    }

    // Once the system event actor's mailbox is gone (its own teardown, or a
    // direct stop), emitting would only produce dead letters — skip quietly.
    if (!this.actorMailboxes.has(this.systemEventActorAddress)) {
      log.debug('Skipping system event emission after system event actor shutdown', {
        eventType: event.eventType,
      });
      return;
    }

    const message: SystemEventMessage = {
      type: 'EMIT_SYSTEM_EVENT',
      systemEventType: event.eventType,
      systemTimestamp: event.timestamp,
      systemData: event.data ?? null,
      _timestamp: Date.now(),
      _version: '1.0.0',
    };

    await this.enqueueMessage(this.systemEventActorAddress, message);
  }

  /**
   * Subscribe to system events
   */
  subscribeToSystemEvents(
    listener: (event: { type: string; [key: string]: unknown }) => void
  ): () => void {
    // In pure actor model, we should create an actor to receive events
    // For now, we'll directly subscribe to the system event actor
    if (!this.systemEventActorAddress) {
      log.warn('System event actor not initialized');
      return () => {};
    }

    log.debug(
      '🔍 SUBSCRIBE TO SYSTEM EVENTS: systemEventActorAddress:',
      this.systemEventActorAddress
    );

    // Create a unique callback path for this listener
    const callbackPath = `actor://${this.config.nodeAddress}/callback/${generateCorrelationId()}`;

    // Store the callback in a map so we can invoke it when we receive notifications
    if (!this.systemEventCallbacks) {
      this.systemEventCallbacks = new Map<
        string,
        (event: { type: string; [key: string]: unknown }) => void
      >();
    }
    this.systemEventCallbacks.set(callbackPath, listener);

    // Send SUBSCRIBE_TO_SYSTEM_EVENTS message to the system event actor
    const subscribeMessage = {
      type: 'SUBSCRIBE_TO_SYSTEM_EVENTS',
      subscriberPath: callbackPath,
      // Don't filter events - we want all system events
    };

    log.debug('🔍 SUBSCRIBE TO SYSTEM EVENTS: Sending subscription message', {
      subscriberPath: callbackPath,
      systemEventActor: this.systemEventActorAddress,
    });

    // Send the subscription message
    this.enqueueMessage(this.systemEventActorAddress, subscribeMessage).catch((err) => {
      log.error('Failed to subscribe to system events', { error: err });
    });

    log.debug('🔍 SUBSCRIBE TO SYSTEM EVENTS: Subscription registered synchronously', {
      callbackPath,
    });

    // Return unsubscribe function
    return () => {
      // Send unsubscribe message if system event actor is still available
      if (this.systemEventActorAddress) {
        const unsubscribeMessage = {
          type: 'UNSUBSCRIBE_FROM_SYSTEM_EVENTS',
          subscriberPath: callbackPath,
        };

        this.enqueueMessage(this.systemEventActorAddress, unsubscribeMessage).catch((err) => {
          log.error('Failed to unsubscribe from system events', { error: err });
        });
      }

      // Remove callback
      if (this.systemEventCallbacks) {
        this.systemEventCallbacks.delete(callbackPath);
      }
    };
  }

  /**
   * Subscribe to cluster events
   */
  subscribeToClusterEvents(
    listener: (event: { type: 'node-up' | 'node-down' | 'leader-changed'; node: string }) => void
  ): () => void {
    // Create a unique ID for this callback
    const callbackId = `callback-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    this.clusterEventCallbacks.set(callbackId, listener);

    // Subscribe to the cluster event actor
    const unsubscribe = this.subscribeToClusterEventActor(callbackId);

    // Emit initial leader-changed event
    listener({
      type: 'leader-changed',
      node: this.config.nodeAddress,
    });

    // Return unsubscribe function
    return () => {
      unsubscribe();
      this.clusterEventCallbacks.delete(callbackId);
    };
  }

  /**
   * Register a global message interceptor
   * Global interceptors apply to all actors in the system
   *
   * @param interceptor - The interceptor implementation
   * @param options - Registration options including priority and filters
   * @returns Interceptor ID for management
   */
  registerGlobalInterceptor(interceptor: MessageInterceptor, options?: InterceptorOptions): string {
    const id = this.globalInterceptors.register(interceptor, options);
    this.globalInterceptors.setScope('global');
    log.debug('Registered global interceptor', { id, priority: options?.priority || 0 });
    return id;
  }

  /**
   * Register an actor-specific message interceptor
   * These run after global interceptors for the specific actor
   *
   * @param actor - The actor PID to register the interceptor for
   * @param interceptor - The interceptor implementation
   * @param options - Registration options
   * @returns Interceptor ID for management
   */
  registerActorInterceptor(
    actor: ActorPID,
    interceptor: MessageInterceptor,
    options?: InterceptorOptions
  ): string {
    let chain = this.actorInterceptors.get(actor);
    if (!chain) {
      chain = new InterceptorChain();
      this.actorInterceptors.set(actor, chain);
    }

    const id = chain.register(interceptor, options);
    chain.setScope('actor');
    log.debug('Registered actor interceptor', {
      actor: actor.address,
      id,
      priority: options?.priority || 0,
    });
    return id;
  }

  /**
   * Unregister a global interceptor
   */
  unregisterGlobalInterceptor(id: string): boolean {
    const result = this.globalInterceptors.unregister(id);
    if (result) {
      log.debug('Unregistered global interceptor', { id });
    }
    return result;
  }

  /**
   * Unregister an actor-specific interceptor
   */
  unregisterActorInterceptor(actor: ActorPID, id: string): boolean {
    const chain = this.actorInterceptors.get(actor);
    if (!chain) return false;

    const result = chain.unregister(id);
    if (result) {
      log.debug('Unregistered actor interceptor', { actor: actor.address, id });
    }
    return result;
  }

  /**
   * Enable/disable a global interceptor (for circuit breaker)
   */
  setGlobalInterceptorEnabled(id: string, enabled: boolean): boolean {
    return this.globalInterceptors.setEnabled(id, enabled);
  }

  /**
   * Enable/disable an actor-specific interceptor
   */
  setActorInterceptorEnabled(actor: ActorPID, id: string, enabled: boolean): boolean {
    const chain = this.actorInterceptors.get(actor);
    if (!chain) return false;
    return chain.setEnabled(id, enabled);
  }

  /**
   * Get interceptor statistics for monitoring
   */
  getInterceptorStatistics(): {
    global: Map<string, unknown>;
    actors: Map<string, Map<string, unknown>>;
  } {
    const actorStats = new Map<string, Map<string, unknown>>();

    // We can't iterate WeakMap, so we'd need to track actor PIDs separately
    // For now, return what we have
    return {
      global: this.globalInterceptors.getStatistics(),
      actors: actorStats,
    };
  }

  /**
   * Subscribe to actor messages (internal method)
   */
  subscribeToActor(
    address: ActorAddress,
    messageType: string,
    handler: (message: ActorMessage) => void
  ): () => void {
    const key = `${address}:${messageType}`;

    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }

    this.subscribers.get(key)?.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.subscribers.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscribers.delete(key);
        }
      }
    };
  }

  /**
   * Subscribe to cluster event actor
   */
  private subscribeToClusterEventActor(callbackId: string): () => void {
    if (!this.clusterEventActorAddress) {
      log.warn('Cluster event actor not initialized');
      return () => {};
    }

    // Subscribe to cluster event notifications
    return this.subscribeToActor(
      this.clusterEventActorAddress,
      'CLUSTER_EVENT_NOTIFICATION',
      (message) => {
        const callback = this.clusterEventCallbacks.get(callbackId);
        if (callback && typeof message === 'object' && message !== null) {
          // Transform cluster event message to callback format
          if ('eventType' in message && 'node' in message) {
            const eventType = String(message.eventType);
            if (['node-up', 'node-down', 'leader-changed'].includes(eventType)) {
              callback({
                type: eventType as 'node-up' | 'node-down' | 'leader-changed',
                node: String(message.node),
              });
            }
          }
        }
      }
    );
  }

  /**
   * Enqueue a message to an actor's mailbox (fire-and-forget)
   */
  async enqueueMessage(address: ActorAddress, message: ActorMessage): Promise<void> {
    log.debug('enqueueMessage called', {
      actorPath: address,
      messageType: message.type,
      message,
    });

    // Get or create message context
    let context = this.messageContexts.get(message);
    if (!context) {
      context = createMessageContext({
        correlationId: message._correlationId,
      });
      this.messageContexts.set(message, context);
    }

    // Execute global beforeSend interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message._sender || null,
        'send',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by global interceptor', {
          messageType: message.type,
          target: address,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    // Execute actor-specific beforeSend interceptors if any
    // We'll need the actual PID later, for now skip actor-specific interceptors in beforeSend
    const actorPid = null;
    if (actorPid) {
      const actorChain = this.actorInterceptors.get(actorPid);
      if (actorChain && actorChain.size > 0) {
        const result = await actorChain.execute(
          processedMessage,
          message._sender || null,
          'send',
          context
        );

        if (!result.continue || !result.message) {
          log.debug('Message filtered by actor interceptor', {
            messageType: message.type,
            target: address,
          });
          return;
        }

        processedMessage = result.message;
        context = result.context;
      }
    }

    // Update context for the processed message
    this.messageContexts.set(processedMessage, context);

    // Check if this is a callback path (for system event subscriptions)
    if (address.includes('/callback/')) {
      log.debug('🔍 ENQUEUE MESSAGE DEBUG: Callback path detected', {
        callbackPath: address,
        messageType: processedMessage.type,
      });

      // Handle callback-based delivery
      if (processedMessage.type === 'SYSTEM_EVENT_NOTIFICATION' && this.systemEventCallbacks) {
        const callback = this.systemEventCallbacks.get(address);
        if (callback) {
          log.debug('🔍 ENQUEUE MESSAGE DEBUG: Invoking callback', {
            callbackPath: address,
            eventType:
              'eventType' in processedMessage ? processedMessage.eventType : processedMessage.type,
          });

          const eventData: {
            type: string;
            eventType?: string;
            timestamp: number;
            [key: string]: unknown;
          } = {
            type:
              'eventType' in processedMessage
                ? String(processedMessage.eventType)
                : processedMessage.type,
            eventType:
              'eventType' in processedMessage
                ? String(processedMessage.eventType)
                : processedMessage.type,
            timestamp:
              'timestamp' in processedMessage
                ? Number(processedMessage.timestamp)
                : processedMessage._timestamp || Date.now(),
          };

          if ('data' in processedMessage && processedMessage.data !== undefined) {
            eventData.data = processedMessage.data;
          }

          // Invoke callback
          callback(eventData);
          return; // Message delivered via callback
        }
      }

      // Callback not found - add to dead letter queue
      log.warn('Callback not found for path', { path: address });
      this.deadLetterQueue.add(processedMessage, address, 'Callback not found', 1);
      return;
    }

    // A `local`-node address (e.g. the guardian sentinel actor://local/guardian)
    // is node-private: it denotes "the local node" wherever it is evaluated, so it
    // must always route locally and must never consult the directory location.
    // Cross-node directory sync can otherwise overwrite the shared `local` key with
    // a peer's node, which would route the guardian remotely and the peer would
    // route it straight back — an unbounded transport ping-pong.
    const location = isLocalAddress(address)
      ? this.config.nodeAddress
      : await this.directory.lookup(address);

    log.debug('Directory lookup result', {
      actorPath: address,
      location,
      nodeAddress: this.config.nodeAddress,
    });

    if (!location) {
      log.debug('Actor not found in directory', {
        actorPath: address,
      });
      log.error('Actor not found', { path: address });
      this.deadLetterQueue.add(processedMessage, address, 'Actor not found in directory', 1);
      return;
    }

    // If remote, deliver to remote actor
    if (location !== this.config.nodeAddress) {
      log.debug('🔍 ENQUEUE MESSAGE DEBUG: Delivering to remote actor', {
        actorPath: address,
        location,
        nodeAddress: this.config.nodeAddress,
      });
      await this.deliverMessageRemote(location, address, processedMessage);
      return;
    }

    // Local actor - enqueue to mailbox
    const mailbox = this.actorMailboxes.get(address);
    log.debug('Local actor mailbox lookup', {
      actorPath: address,
      hasMailbox: !!mailbox,
      totalMailboxes: this.actorMailboxes.size,
      allMailboxKeys: Array.from(this.actorMailboxes.keys()),
    });

    if (!mailbox) {
      log.debug('Mailbox not found', {
        actorPath: address,
      });
      log.error('Mailbox not found for actor', { path: address });
      this.deadLetterQueue.add(processedMessage, address, 'Mailbox not found for actor', 1);
      return;
    }

    try {
      const enqueued = mailbox.enqueue(processedMessage);
      if (!enqueued && typeof enqueued === 'boolean') {
        log.warn('Message dropped due to full mailbox', {
          actor: address,
          messageType: processedMessage.type,
        });
        this.deadLetterQueue.add(
          processedMessage,
          address,
          'Message dropped due to full mailbox',
          1
        );
      } else if (enqueued) {
        // Message was successfully enqueued
        log.debug('🔍 MAILBOX DEBUG: Message enqueued successfully', {
          actorPath: address,
          messageType: processedMessage.type,
        });

        // Check if we need to restart the processing loop
        const isProcessing = this.actorProcessingActive.get(address) || false;
        const hasLoop = this.actorProcessingLoops.get(address) || false;

        log.debug('🔍 MAILBOX DEBUG: Checking processing status', {
          actorPath: address,
          isProcessing,
          hasLoop,
          totalActiveActors: this.actorProcessingActive.size,
          totalLoops: this.actorProcessingLoops.size,
        });

        if (hasLoop && !isProcessing) {
          // The loop exists but is idle, wake it up
          const behavior = this.actors.get(address);
          log.debug('🔍 MAILBOX DEBUG: Waking up idle processing loop', {
            actorPath: address,
            hasBehavior: !!behavior,
          });

          if (behavior) {
            // Double-check to prevent race conditions
            if (
              this.actorProcessingLoops.get(address) &&
              !this.actorProcessingActive.get(address)
            ) {
              this.actorProcessingActive.set(address, true);
              // Yield to the next macrotask to break out of the current processing turn
              scheduleMacrotask(() => this.processActorMessages(address, behavior));
            }
          }
        }

        // In test mode, process message immediately
        if (this.testMode) {
          const behavior = this.actors.get(address);
          if (behavior && !mailbox.isEmpty()) {
            // Process one message synchronously
            const message = mailbox.dequeue();
            if (message) {
              try {
                await this.deliverMessageLocal(address, message);
              } catch (error) {
                log.error('Error processing message in test mode', {
                  actor: address,
                  messageType: message.type,
                  error: error instanceof Error ? error.message : 'Unknown error',
                });
                // Apply supervision strategy
                await this.applySupervisionStrategy(address, error);
              }
            }
          }
        }
      }
    } catch (error) {
      log.error('Failed to enqueue message', {
        actor: address,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.deadLetterQueue.add(
        processedMessage,
        address,
        `Failed to enqueue message: ${error instanceof Error ? error.message : 'Unknown error'}`,
        1,
        error instanceof Error ? error : undefined
      );
    }
  }

  /**
   * Start the message processing loop for an actor
   */
  private startMessageProcessingLoop(
    address: ActorAddress,
    behavior: PureActorBehavior<ActorMessage, ActorMessage>
  ): void {
    // Mark this actor as having an active processing loop
    this.actorProcessingLoops.set(address, true);
    // Mark as actively processing immediately to prevent race conditions
    this.actorProcessingActive.set(address, true);

    // Start processing on the next macrotask so browser workers can run this path too
    scheduleMacrotask(() => this.processActorMessages(address, behavior));
  }

  /**
   * Process messages from an actor's mailbox
   */
  private async processActorMessages(
    address: ActorAddress,
    behavior: PureActorBehavior<ActorMessage, ActorMessage>
  ): Promise<void> {
    const startTime = Date.now();
    const processId = Math.random().toString(36).substring(7);

    log.debug('processActorMessages called', {
      actorPath: address,
      processId,
      timestamp: startTime,
      activeProcessingCount: this.actorProcessingActive.size,
      totalLoops: this.actorProcessingLoops.size,
      isProcessingActive: this.actorProcessingActive.get(address),
      hasProcessingLoop: this.actorProcessingLoops.get(address),
    });

    const mailbox = this.actorMailboxes.get(address);
    if (!mailbox || !this.actorProcessingLoops.get(address)) {
      log.debug('Early exit - no mailbox or loop disabled', {
        actorPath: address,
        processId,
        hasMailbox: !!mailbox,
        hasProcessingLoop: !!this.actorProcessingLoops.get(address),
        exitTime: Date.now() - startTime,
      });
      this.actorProcessingActive.set(address, false);
      return;
    }

    // Mark as actively processing
    this.actorProcessingActive.set(address, true);

    log.debug('Starting message processing batch', {
      actorPath: address,
      processId,
      mailboxSize: mailbox.size(),
      isEmpty: mailbox.isEmpty(),
    });

    // Process all available messages in a batch
    let processed = 0;
    const maxMessages = 100; // Safety limit to prevent infinite processing

    while (
      !mailbox.isEmpty() &&
      this.actorProcessingLoops.get(address) &&
      processed < maxMessages
    ) {
      const message = mailbox.dequeue();

      log.debug('Processing message', {
        actorPath: address,
        processId,
        messageType: message?.type,
        hasMessage: !!message,
        processed,
        remainingInMailbox: mailbox.size(),
      });

      if (message) {
        try {
          await this.deliverMessageLocal(address, message);
          processed++;
        } catch (error) {
          log.error('Error processing message', {
            actor: address,
            processId,
            messageType: message.type,
            error: error instanceof Error ? error.message : 'Unknown error',
            processed,
          });

          // Apply supervision strategy
          await this.applySupervisionStrategy(address, error);
        }
      }
    }

    // Safety check for infinite loop protection
    if (processed >= maxMessages) {
      log.error('Hit message processing limit - possible infinite loop', {
        actorPath: address,
        processId,
        processed,
        mailboxSize: mailbox.size(),
      });
      this.actorProcessingActive.set(address, false);
      return;
    }

    const hasMoreMessages = !mailbox.isEmpty();
    const shouldContinue = this.actorProcessingLoops.get(address);

    log.debug('Batch complete, checking continuation', {
      actorPath: address,
      processId,
      processed,
      hasMoreMessages,
      shouldContinue,
      mailboxSize: mailbox.size(),
      duration: Date.now() - startTime,
    });

    // Check if there are more messages (could have arrived while processing)
    if (hasMoreMessages && shouldContinue) {
      log.debug('Scheduling next processing round', {
        actorPath: address,
        processId,
        nextProcessId: 'will-be-generated',
      });
      // More messages available, continue processing
      // Yield before the next processing round to avoid monopolizing the event loop
      scheduleMacrotask(() => this.processActorMessages(address, behavior));
    } else {
      log.debug('Processing complete, marking idle', {
        actorPath: address,
        processId,
        reason: hasMoreMessages ? 'loop disabled' : 'no more messages',
        duration: Date.now() - startTime,
      });
      // No more messages, mark as idle
      this.actorProcessingActive.set(address, false);
    }
  }

  /**
   * Ask an actor and wait for response
   * Uses correlation manager for proper response handling
   */
  async askActor<T>(address: ActorAddress, message: ActorMessage, timeout: number): Promise<T> {
    log.debug('🔍 ASK: Starting askActor with correlation manager');

    if (this.isKnownRemoteAddress(address)) {
      return this.requestRemoteActorAsk<T>(address, message, timeout);
    }

    return this.askLocalActor(address, message, timeout);
  }

  private async askLocalActor<T>(
    address: ActorAddress,
    message: ActorMessage,
    timeout: number
  ): Promise<T> {
    // Import ask pattern safeguards
    const { createAskTimeout } = await import('./ask-pattern-safeguards.js');

    // Generate correlation ID
    const correlationId = this.correlationManager.generateId();
    log.debug('🔍 ASK: Generated correlationId:', correlationId);

    // Register the request with correlation manager to get a promise
    // Use a much longer timeout for correlation manager so our AskPatternTimeout always wins
    const responsePromise = this.correlationManager.registerRequest<T>(correlationId, timeout * 10);

    // Create timeout promise with helpful error message
    const { promise: timeoutPromise, cancel: cancelTimeout } = createAskTimeout(
      address,
      message.type,
      correlationId,
      timeout
    );

    // Send the message with correlation ID
    const messageWithCorrelation: ActorMessage = {
      ...message,
      _correlationId: correlationId,
      _timestamp: message._timestamp || Date.now(),
      _version: message._version || '1.0.0',
    };

    log.debug('🔍 ASK: Sending message with correlation:', {
      messageType: messageWithCorrelation.type,
      correlationId,
      targetAddress: address,
    });

    await this.enqueueMessage(address, messageWithCorrelation);

    log.debug('🔍 ASK: Waiting for response...');

    try {
      // Race between response and timeout
      const response = await Promise.race([responsePromise, timeoutPromise]);
      cancelTimeout(); // Cancel timeout if we got a response
      log.debug('🔍 ASK: Got response:', response);

      // The correlation manager returns the ActorMessage
      // For flat message structure, extract the response data from the message
      if (
        response &&
        typeof response === 'object' &&
        'type' in response &&
        '_timestamp' in response &&
        '_version' in response
      ) {
        // Extract response data from flat message structure
        const message = response as ActorMessage;
        log.debug('🔍 ASK PATTERN DEBUG: Processing response', {
          actorPath: address,
          messageType: message.type,
          hasCorrelationId: !!message._correlationId,
          correlationId: message._correlationId,
          message,
        });

        const {
          type: _type,
          _timestamp,
          _version,
          _correlationId,
          _sender,
          ...responseData
        } = message;

        log.debug('🔍 ASK PATTERN DEBUG: Extracted response data', {
          actorPath: address,
          responseData,
          responseDataKeys: Object.keys(responseData),
          hasValueField: 'value' in responseData,
        });

        // If response data contains only a 'value' field, return the value directly
        if (Object.keys(responseData).length === 1 && 'value' in responseData) {
          const value = (responseData as { value: T }).value;
          log.debug('🔍 ASK PATTERN DEBUG: Returning value field', {
            actorPath: address,
            value,
          });
          return value;
        }

        // If response data contains only a 'payload' field (for arrays), return the payload directly
        if (Object.keys(responseData).length === 1 && 'payload' in responseData) {
          const payload = (responseData as { payload: T }).payload;
          log.debug('🔍 ASK PATTERN DEBUG: Returning payload field', {
            actorPath: address,
            payload,
            isArray: Array.isArray(payload),
          });
          return payload;
        }

        // Otherwise return the response data object (excluding envelope fields)
        log.debug('🔍 ASK PATTERN DEBUG: Returning response data object', {
          actorPath: address,
          responseData,
        });
        return responseData as T;
      }

      // If response is not an ActorMessage, return it as is
      return response;
    } catch (error) {
      // Cancel timeout if it's still pending
      cancelTimeout();

      // If this is our AskPatternTimeout, clean up the correlation manager
      if (error instanceof Error && error.name === 'AskPatternTimeout') {
        // Cancel the pending request in correlation manager
        this.correlationManager.handleTimeout(correlationId);
      }

      throw error;
    }
  }

  /**
   * Stop an actor by address (internal method)
   */
  async stopActorInternal(address: ActorAddress): Promise<void> {
    if (this.isKnownRemoteAddress(address)) {
      await this.requestRemoteActorStop(address);
      return;
    }

    // Find the actor in our local actors map
    if (this.actors.has(address)) {
      // Create a temporary PID to call the public stop method
      const pid = new ActorPIDImpl(address, this);
      await this.stopActor(pid);
    }
  }

  /**
   * Check if an actor is alive (internal method)
   */
  async isActorAliveInternal(address: ActorAddress): Promise<boolean> {
    const location = await this.directory.lookup(address);
    return location !== undefined;
  }

  /**
   * Get actor statistics (internal method)
   */
  async getActorStatsInternal(address: ActorAddress): Promise<{
    messagesReceived: number;
    messagesProcessed: number;
    errors: number;
    uptime: number;
  }> {
    if (this.isKnownRemoteAddress(address)) {
      return this.requestRemoteActorStats(address);
    }

    const stats = this.actorStats.get(address);
    if (!stats) {
      return {
        messagesReceived: 0,
        messagesProcessed: 0,
        errors: 0,
        uptime: 0,
      };
    }

    const now = Date.now();
    return {
      ...stats,
      uptime: (now - stats.startTime) / 1000,
    };
  }

  getActorSnapshotInternal(address: ActorAddress): ActorSnapshot<unknown> {
    if (this.isKnownRemoteAddress(address)) {
      return this.getOrCreateRemoteProjectionWatcher(address).snapshot;
    }

    return this.getLocalActorSnapshot(address);
  }

  subscribeToActorSnapshots(
    address: ActorAddress,
    listener: (snapshot: ActorSnapshot<unknown>) => void
  ): () => void {
    if (this.isKnownRemoteAddress(address)) {
      return this.subscribeToRemoteActorSnapshots(address, listener);
    }

    return this.subscribeToLocalActorSnapshots(address, listener);
  }

  subscribeToActorEvents(
    address: ActorAddress,
    listener: (event: ActorMessage) => void,
    options: ActorEventSubscriptionOptions = {}
  ): () => void {
    if (this.isKnownRemoteAddress(address)) {
      return this.subscribeToRemoteActorEvents(address, listener, options);
    }

    return this.subscribeToLocalActorEvents(address, listener, options);
  }

  getActorTransportStatusInternal(address: ActorAddress): ProjectionTransportStatus {
    if (this.isKnownRemoteAddress(address)) {
      return this.getOrCreateRemoteProjectionWatcher(address).status;
    }

    return createProjectionTransportStatus('local');
  }

  subscribeToActorTransportStatus(
    address: ActorAddress,
    listener: (status: ProjectionTransportStatus) => void
  ): () => void {
    if (this.isKnownRemoteAddress(address)) {
      const watcher = this.getOrCreateRemoteProjectionWatcher(address);
      watcher.statusListeners.add(listener);
      listener(watcher.status);

      return () => {
        watcher.statusListeners.delete(listener);
      };
    }

    listener(createProjectionTransportStatus('local'));
    return () => {};
  }

  private getLocalActorSnapshot(path: string): ActorSnapshot<unknown> {
    const actorInstance = this.actorInstances.get(path);
    if (actorInstance) {
      const snapshot = actorInstance.getSnapshot();
      this.actorSnapshots.set(path, snapshot);
      return snapshot;
    }

    return this.actorSnapshots.get(path) ?? this.createFallbackSnapshot();
  }

  private subscribeToLocalActorSnapshots(
    path: string,
    listener: (snapshot: ActorSnapshot<unknown>) => void
  ): () => void {
    const key = path;
    if (!this.snapshotSubscribers.has(key)) {
      this.snapshotSubscribers.set(key, new Set());
    }

    this.snapshotSubscribers.get(key)?.add(listener);

    return () => {
      const listeners = this.snapshotSubscribers.get(key);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.snapshotSubscribers.delete(key);
        }
      }
    };
  }

  private subscribeToLocalActorEvents(
    path: string,
    listener: (event: ActorMessage) => void,
    options: ActorEventSubscriptionOptions = {}
  ): () => void {
    const key = path;
    if (!this.actorEventSubscribers.has(key)) {
      this.actorEventSubscribers.set(key, new Set());
    }

    const subscriber = {
      listener,
      types: options.types,
    };

    this.actorEventSubscribers.get(key)?.add(subscriber);

    return () => {
      const subscribers = this.actorEventSubscribers.get(key);
      if (subscribers) {
        subscribers.delete(subscriber);
        if (subscribers.size === 0) {
          this.actorEventSubscribers.delete(key);
        }
      }
    };
  }

  private getAddressNode(address: ActorAddress): string | undefined {
    return parse(address).node;
  }

  private isKnownRemoteAddress(address: ActorAddress): boolean {
    // A `local`-node address (e.g. the guardian sentinel actor://local/guardian)
    // is node-private: `local` means "this node" wherever evaluated, so it is never
    // a remote target. Without this guard the ask/stop/stats/snapshot paths route
    // the guardian off-node and fail with "transport is not configured".
    if (isLocalAddress(address)) {
      return false;
    }
    const node = this.getAddressNode(address);
    return Boolean(node && node !== this.config.nodeAddress);
  }

  /**
   * Get directory stats (internal method)
   */
  getDirectoryStats() {
    return this.directory.getCacheStats();
  }

  /**
   * Check if the system is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Get the default ask timeout
   */
  getDefaultAskTimeout(): number {
    return this.config.defaultAskTimeout ?? 5000;
  }

  /**
   * Create an event message from an emitted event
   */
  private createEventMessage(address: ActorAddress, event: unknown): ActorMessage {
    log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Creating event message', {
      addressPath: address,
      event,
      eventType: typeof event,
      isActorMessage: this.isActorMessage(event),
    });

    // If event is already an ActorMessage, return it
    if (this.isActorMessage(event)) {
      log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Event is already ActorMessage', {
        eventType: event.type,
      });
      return event;
    }

    // Check if event has a type property safely
    let eventType = 'ACTOR_EVENT';
    if (event && typeof event === 'object' && 'type' in event && typeof event.type === 'string') {
      eventType = event.type;
    }

    // Create the event message with proper envelope
    // For type safety, we'll create a message that extends ActorMessage
    const eventMessage = {
      type: eventType,
      _sender: address,
      _timestamp: Date.now(),
      _version: '1.0.0',
      // Add event payload if it's not null/undefined
      ...(event !== null && event !== undefined && { eventPayload: event }),
    } as ActorMessage & { eventPayload?: unknown };

    log.debug('🔍 CREATE EVENT MESSAGE DEBUG: Created event message', {
      eventMessage,
      eventType: eventMessage.type,
    });

    return eventMessage;
  }

  /**
   * Type guard to check if an object is an ActorMessage
   */
  private isActorMessage(obj: unknown): obj is ActorMessage {
    return (
      typeof obj === 'object' &&
      obj !== null &&
      'type' in obj &&
      '_timestamp' in obj &&
      '_version' in obj
    );
  }

  private publishActorEvent(address: ActorAddress, event: unknown): void {
    const eventMessage = this.createEventMessage(address, event);

    log.debug('🔍 PUBLISH EVENT DEBUG: Publishing actor event', {
      actorPath: address,
      eventType: eventMessage.type,
    });

    this.updateActorProjectionState(address, {
      updatedAt: new Date().toISOString(),
      lastEventType: eventMessage.type,
      correlationId:
        eventMessage._correlationId ?? this.getActorProjectionState(address).correlationId,
    });
    this.autoPublishingRegistry.trackEmittedEvent(address, eventMessage.type);
    this.notifyActorEventSubscribers(address, eventMessage);
    this.emitEventToSubscribers(address, eventMessage);
    void this.publishRemoteActorEvent(address, eventMessage);
    void this.forwardTopologyEventToRemoteSubscribers(address, eventMessage);
  }

  /**
   * Deliver message to local actor
   */
  private async deliverMessageLocal(address: ActorAddress, message: ActorMessage): Promise<void> {
    log.debug('🔍 DELIVER LOCAL DEBUG: deliverMessageLocal called', {
      actorPath: address,
      messageType: message.type,
    });

    log.debug('Delivering message to local actor', {
      path: address,
      messageType: message.type,
    });

    const behavior = this.actors.get(address);
    if (!behavior) {
      log.debug('🔍 DELIVER LOCAL DEBUG: Behavior not found', {
        actorPath: address,
      });
      throw new Error(`Local actor not found: ${address}`);
    }

    // ✅ PURE ACTOR MODEL: Get stored actor instance and behavior handler
    const actorInstance = this.actorInstances.get(address);
    const behaviorHandler = this.actorBehaviorHandlers.get(address);

    log.debug('🔍 DELIVER LOCAL DEBUG: Actor components lookup', {
      actorPath: address,
      hasBehavior: !!behavior,
      hasActorInstance: !!actorInstance,
      hasBehaviorHandler: !!behaviorHandler,
    });

    if (!actorInstance || !behaviorHandler) {
      log.debug('🔍 DELIVER LOCAL DEBUG: Missing components', {
        actorPath: address,
        actorInstance: !!actorInstance,
        behaviorHandler: !!behaviorHandler,
      });
      throw new Error(`Actor instance or behavior handler not found: ${address}`);
    }

    // ✅ CONTEXT ISOLATION: Establish actor identity boundary
    const actorContext = ActorContextManager.createContext(
      address,
      message._correlationId,
      `msg-${Date.now()}`
    );

    return ActorContextManager.safeRun(
      actorContext,
      async () => {
        return this.processMessageWithContext(
          address,
          message,
          behavior,
          actorInstance,
          behaviorHandler
        );
      },
      address
    );
  }

  /**
   * Process message within actor context
   */
  private async processMessageWithContext(
    address: ActorAddress,
    message: ActorMessage,
    behavior: PureActorBehavior<ActorMessage, ActorMessage> & { context?: unknown },
    actorInstance: ActorInstance,
    behaviorHandler: PureActorBehaviorHandler
  ): Promise<void> {
    // Get message context
    let context =
      this.messageContexts.get(message) ||
      createMessageContext({
        correlationId: message._correlationId,
      });

    // Execute global beforeReceive interceptors
    let processedMessage = message;
    if (this.globalInterceptors.size > 0) {
      const result = await this.globalInterceptors.execute(
        message,
        message._sender || null,
        'receive',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by global interceptor in receive', {
          messageType: message.type,
          actor: address,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    // Get actor PID for actor-specific interceptors
    const actorPid: ActorPID = {
      address,
      stop: async () => this.stopActorInternal(address),
      send: async <T extends { type: string }>(msg: T) => this.enqueueMessage(address, msg),
      ask: async <TResponse = JsonValue>(msg: Message) =>
        this.askActor<TResponse>(address, msg, this.config.defaultAskTimeout ?? 5000),
      isAlive: async () => (await this.directory.lookup(address)) !== undefined,
      getStats: async () => this.getActorStatsInternal(address),
    };

    // Execute actor-specific beforeReceive interceptors
    const actorChain = this.actorInterceptors.get(actorPid);
    if (actorChain && actorChain.size > 0) {
      const result = await actorChain.execute(
        processedMessage,
        processedMessage._sender || null,
        'receive',
        context
      );

      if (!result.continue || !result.message) {
        log.debug('Message filtered by actor interceptor in receive', {
          messageType: processedMessage.type,
          actor: address,
        });
        return;
      }

      processedMessage = result.message;
      context = result.context;
    }

    const stats = this.actorStats.get(address);

    try {
      // ✅ PURE ACTOR MODEL: Use createActorDependencies method for consistent dependency creation
      const dependencies = this.createActorDependencies(address, actorInstance);

      // Call onStart if this is the first time
      if (!this.actorStarted.get(address)) {
        log.debug('🔍 PROCESS MESSAGE DEBUG: Calling onStart for first time', {
          actorPath: address,
          behaviorType: typeof behavior,
          hasOnStart: behavior && 'onStart' in behavior,
          onStartType: behavior && 'onStart' in behavior ? typeof behavior.onStart : 'N/A',
        });

        log.debug('Calling onStart for actor', { path: address });

        await behaviorHandler.handleStart(
          behavior as PureActorBehavior<unknown, ActorMessage>,
          actorInstance,
          dependencies
        );

        log.debug('🔍 PROCESS MESSAGE DEBUG: onStart completed', {
          actorPath: address,
        });

        this.actorStarted.set(address, true);
      }

      // Update stats
      if (stats) {
        this.actorStats.set(address, {
          ...stats,
          messagesReceived: stats.messagesReceived + 1,
        });
      }

      // ✅ PURE ACTOR MODEL: Use behavior handler for message processing
      log.debug('🔍 PROCESS MESSAGE DEBUG: About to call behaviorHandler.handleMessage', {
        actorPath: address,
        messageType: processedMessage.type,
        behaviorHandlerType: typeof behaviorHandler,
        hasBehaviorHandler: !!behaviorHandler,
      });

      await behaviorHandler.handleMessage(
        behavior as PureActorBehavior<ActorMessage, ActorMessage>,
        processedMessage,
        actorInstance,
        dependencies
      );

      const previousSnapshot = this.cloneSnapshot(
        this.actorSnapshots.get(address) ?? actorInstance.getSnapshot()
      );
      const latestSnapshot = actorInstance.getSnapshot();
      this.updateActorProjectionState(address, {
        updatedAt: new Date().toISOString(),
        correlationId: processedMessage._correlationId ?? address,
      });
      this.actorSnapshots.set(address, latestSnapshot);
      const snapshotChanged = !this.snapshotsAreEquivalent(previousSnapshot, latestSnapshot);
      if (snapshotChanged) {
        this.notifySnapshotSubscribers(address, latestSnapshot);
        await this.publishRemoteSnapshotProjection(address, latestSnapshot, previousSnapshot);
      }

      log.debug('🔍 PROCESS MESSAGE DEBUG: behaviorHandler.handleMessage completed', {
        actorPath: address,
        messageType: processedMessage.type,
      });

      // Update processed message stats
      if (stats) {
        const updatedStats = this.actorStats.get(address) || {
          messagesReceived: 0,
          messagesProcessed: 0,
          errors: 0,
          uptime: 0,
          startTime: Date.now(),
        };
        this.actorStats.set(address, {
          ...updatedStats,
          messagesProcessed: updatedStats.messagesProcessed + 1,
        });
      }

      // Handle ask pattern responses - handled by MessagePlan processor now
      // No manual correlation needed

      // Notify message subscribers
      this.notifyMessageSubscribers(address, processedMessage);

      // Execute afterProcess interceptors
      if (this.globalInterceptors.size > 0) {
        await this.globalInterceptors.executeAfterProcess(
          processedMessage,
          null, // No direct result from pure actor handler
          address,
          context
        );
      }

      if (actorChain && actorChain.size > 0) {
        await actorChain.executeAfterProcess(processedMessage, null, address, context);
      }
    } catch (error) {
      log.debug('🔍 PROCESS MESSAGE DEBUG: Error in processMessageWithContext', {
        actorPath: address,
        messageType: processedMessage.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        hasCorrelationId: !!processedMessage._correlationId,
        correlationId: processedMessage._correlationId,
      });

      // If this is an ask pattern request (has correlation ID), reject the promise
      if (processedMessage._correlationId) {
        const err =
          error instanceof Error ? error : new Error('Unknown error in message processing');
        this.correlationManager.handleError(processedMessage._correlationId, err);
      }

      // Handle actor processing errors
      if (stats) {
        const updatedStats = this.actorStats.get(address);
        if (updatedStats) {
          this.actorStats.set(address, {
            ...updatedStats,
            errors: updatedStats.errors + 1,
          });
        }
      }

      log.error('Error processing message', {
        actor: address,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Execute onError interceptors
      const errorObj = error instanceof Error ? error : new Error(String(error));
      await this.executeErrorInterceptors(errorObj, processedMessage, address, context, actorChain);

      throw error;
    }
  }

  /**
   * Emit event to subscribers using auto-publishing registry
   *
   * ✅ PURE ACTOR MODEL: Events are enqueued directly to subscriber mailboxes
   * following Erlang/OTP patterns where Pid ! Message is synchronous enqueue
   */
  private emitEventToSubscribers(address: ActorAddress, eventMessage: ActorMessage): void {
    const publisherId = address;

    // ✅ UNIFIED API DESIGN Phase 2.1: Use auto-publishing registry for event distribution
    const subscribers = this.autoPublishingRegistry.getSubscribersForEvent(
      publisherId,
      eventMessage.type
    );

    log.debug('🔍 EMIT EVENT DEBUG: Emitting to subscribers', {
      publisherId,
      eventType: eventMessage.type,
      subscriberCount: subscribers.length,
      subscribers: subscribers.map((s) => s.address),
    });

    // ✅ DIRECT MAILBOX ENQUEUE: Send event to each subscriber's mailbox directly
    // This matches Erlang/OTP and Akka patterns where events are just messages
    for (const subscriber of subscribers) {
      log.debug('🔍 EMIT EVENT DEBUG: Direct enqueue to subscriber', {
        publisherId,
        subscriberId: subscriber.address,
        eventType: eventMessage.type,
        eventMessage,
      });

      try {
        // Direct enqueue to mailbox - no async boundary
        // This ensures events are available immediately in tests
        // and maintains deterministic ordering with other messages
        this.enqueueMessage(subscriber.address, eventMessage).catch((error) => {
          // Log as dead letter if enqueue fails (e.g., mailbox full)
          log.debug('🔍 EMIT EVENT DEBUG: Event dropped (dead letter)', {
            subscriberId: subscriber.address,
            eventType: eventMessage.type,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });

          log.warn('Event dropped - dead letter', {
            publisherId,
            subscriberId: subscriber.address,
            eventType: eventMessage.type,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        });
      } catch (syncError) {
        // Handle any synchronous errors from enqueue attempt
        log.error('Failed to enqueue event', {
          publisherId,
          subscriberId: subscriber.address,
          eventType: eventMessage.type,
          error: syncError instanceof Error ? syncError.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * Notify message subscribers
   */
  private notifyMessageSubscribers(address: ActorAddress, message: ActorMessage): void {
    // Notify subscribers for all message types
    const allKey = `${address}:*`;
    const allSubscribers = this.subscribers.get(allKey);
    if (allSubscribers) {
      for (const handler of Array.from(allSubscribers)) {
        handler(message);
      }
    }

    // Notify subscribers for specific message type
    const key = `${address}:${message.type}`;
    const subscribers = this.subscribers.get(key);
    if (subscribers) {
      for (const handler of Array.from(subscribers)) {
        handler(message);
      }
    }
  }

  private notifySnapshotSubscribers(path: string, snapshot: ActorSnapshot<unknown>): void {
    const subscribers = this.snapshotSubscribers.get(path);
    if (!subscribers) {
      return;
    }

    for (const listener of Array.from(subscribers)) {
      listener(snapshot);
    }
  }

  private notifyActorEventSubscribers(address: ActorAddress, event: ActorMessage): void {
    const subscribers = this.actorEventSubscribers.get(address);
    if (!subscribers) {
      return;
    }

    for (const subscriber of Array.from(subscribers)) {
      if (
        subscriber.types &&
        subscriber.types.length > 0 &&
        !subscriber.types.includes(event.type)
      ) {
        continue;
      }

      subscriber.listener(event);
    }
  }

  private async handleRuntimeProtocolMessage(
    source: string,
    message: RuntimeProtocolMessage
  ): Promise<void> {
    switch (message.type) {
      case '__runtime.transport.connected':
        await this.handleTransportConnected(message.nodeAddress);
        return;
      case '__runtime.transport.disconnected':
        await this.handleTransportDisconnected(message.nodeAddress);
        return;
      case '__runtime.directory.register':
        this.directory.applyRemoteEntry(message.entry);
        return;
      case '__runtime.directory.unregister':
        this.directory.removeRemoteEntry(message.address);
        return;
      case '__runtime.directory.sync.request':
        await this.sendTransportMessage(source, {
          type: '__runtime.directory.sync.response',
          requestId: message.requestId,
          entries: this.directory.exportEntries(),
          _timestamp: Date.now(),
          _version: '1.0.0',
        });
        return;
      case '__runtime.directory.sync.response':
      case '__runtime.remote.ask.response':
      case '__runtime.remote.snapshot.fetch.response':
      case '__runtime.remote.stop.response':
      case '__runtime.remote.stats.response':
        this.correlationManager.handleResponse(message.requestId, message);
        return;
      case '__runtime.remote.ask.error':
      case '__runtime.remote.snapshot.fetch.error':
      case '__runtime.remote.stop.error':
      case '__runtime.remote.stats.error':
        this.correlationManager.handleError(message.requestId, new Error(message.errorMessage));
        return;
      case '__runtime.remote.send':
        await this.enqueueMessage(message.address, message.message);
        return;
      case '__runtime.remote.ask.request':
        try {
          const payload = await this.askLocalActor(
            message.address,
            message.message,
            message.timeout
          );
          await this.sendTransportMessage(source, {
            type: '__runtime.remote.ask.response',
            requestId: message.requestId,
            payload,
            _timestamp: Date.now(),
            _version: '1.0.0',
          });
        } catch (error) {
          await this.sendRuntimeRequestError(
            source,
            '__runtime.remote.ask.error',
            message.requestId,
            error
          );
        }
        return;
      case '__runtime.remote.snapshot.fetch.request':
        try {
          await this.sendTransportMessage(source, {
            type: '__runtime.remote.snapshot.fetch.response',
            requestId: message.requestId,
            payload: this.createSnapshotProjection(
              message.address,
              this.getLocalActorSnapshot(message.address)
            ),
            _timestamp: Date.now(),
            _version: '1.0.0',
          });
        } catch (error) {
          await this.sendRuntimeRequestError(
            source,
            '__runtime.remote.snapshot.fetch.error',
            message.requestId,
            error
          );
        }
        return;
      case '__runtime.remote.snapshot.subscribe':
        await this.addOutboundRemoteProjectionSubscriber(message.address, source, 'snapshot');
        return;
      case '__runtime.remote.snapshot.unsubscribe':
        this.removeOutboundRemoteProjectionSubscriber(message.address, source, 'snapshot');
        return;
      case '__runtime.remote.snapshot.update':
        this.handleRemoteSnapshotProjection(message.payload);
        return;
      case '__runtime.remote.event.subscribe':
        await this.addOutboundRemoteProjectionSubscriber(message.address, source, 'event');
        return;
      case '__runtime.remote.event.unsubscribe':
        this.removeOutboundRemoteProjectionSubscriber(message.address, source, 'event');
        return;
      case '__runtime.remote.event.update':
        this.handleRemoteEventProjection(message.payload);
        return;
      case '__runtime.topology.subscribe':
        // `source` (the verified sending node) is the subscriber's node — never
        // trust a node field in the message body.
        this.registerTopologyRemoteSubscriber({
          publisherPath: message.publisherPath,
          subscriberNode: source,
          subscriberPath: message.subscriberPath,
          ...(message.events ? { events: message.events } : {}),
        });
        return;
      case '__runtime.topology.unsubscribe':
        this.removeTopologyRemoteSubscriber(message.publisherPath, source, message.subscriberPath);
        return;
      case '__runtime.topology.event': {
        // parseActorPath throws on a malformed path, so guard it here to route a
        // bad payload to the targeted drop/warn rather than the generic
        // protocol-error catch.
        let subscriberAddress: ActorAddress | undefined;
        try {
          subscriberAddress = parseActorPath(message.subscriberPath);
        } catch {
          subscriberAddress = undefined;
        }
        if (subscriberAddress) {
          const eventMessage = eventEnvelopeToActorMessage(message.payload.envelope);
          await this.enqueueMessage(subscriberAddress, eventMessage);
        } else {
          log.warn('Dropped cross-node topology event with an unparseable subscriber path', {
            source,
            subscriberPath: message.subscriberPath,
          });
        }
        return;
      }
      case '__runtime.remote.stop.request':
        try {
          await this.stopActorInternal(message.address);
          await this.sendTransportMessage(source, {
            type: '__runtime.remote.stop.response',
            requestId: message.requestId,
            payload: { stopped: true },
            _timestamp: Date.now(),
            _version: '1.0.0',
          });
        } catch (error) {
          await this.sendRuntimeRequestError(
            source,
            '__runtime.remote.stop.error',
            message.requestId,
            error
          );
        }
        return;
      case '__runtime.remote.stats.request':
        try {
          await this.sendTransportMessage(source, {
            type: '__runtime.remote.stats.response',
            requestId: message.requestId,
            payload: await this.getActorStatsInternal(message.address),
            _timestamp: Date.now(),
            _version: '1.0.0',
          });
        } catch (error) {
          await this.sendRuntimeRequestError(
            source,
            '__runtime.remote.stats.error',
            message.requestId,
            error
          );
        }
        return;
    }
  }

  private getActorProjectionState(path: string): ActorProjectionState {
    const existingState = this.actorProjectionState.get(path);
    if (existingState) {
      return existingState;
    }

    const now = new Date().toISOString();
    const createdState: ActorProjectionState = {
      createdAt: now,
      updatedAt: now,
      correlationId: path,
      lastEventType: null,
      sequence: 0,
    };
    this.actorProjectionState.set(path, createdState);
    return createdState;
  }

  private updateActorProjectionState(
    path: string,
    updates: Partial<Omit<ActorProjectionState, 'createdAt' | 'sequence'>> & {
      sequence?: number;
    }
  ): ActorProjectionState {
    const currentState = this.getActorProjectionState(path);
    const nextState: ActorProjectionState = {
      ...currentState,
      ...updates,
      createdAt: currentState.createdAt,
      sequence: updates.sequence ?? currentState.sequence,
    };
    this.actorProjectionState.set(path, nextState);
    return nextState;
  }

  private nextActorProjectionSequence(path: string): number {
    const state = this.getActorProjectionState(path);
    const nextSequence = state.sequence + 1;
    this.actorProjectionState.set(path, {
      ...state,
      sequence: nextSequence,
    });
    return nextSequence;
  }

  private currentActorProjectionSequence(path: string): number {
    return this.getActorProjectionState(path).sequence;
  }

  private createRemoteProjectionWatcher(address: ActorAddress): RemoteProjectionWatcher {
    const node = this.getAddressNode(address) ?? '';
    return {
      address,
      snapshot: this.createFallbackSnapshot(),
      snapshotListeners: new Set(),
      eventSubscribers: new Set(),
      statusListeners: new Set(),
      status: createProjectionTransportStatus(
        this.config.transport?.isConnected(node) ? 'replaying' : 'disconnected',
        {
          reason: this.config.transport ? undefined : 'No runtime transport configured',
        }
      ),
      snapshotSubscribed: false,
      eventSubscribed: false,
    };
  }

  private getOrCreateRemoteProjectionWatcher(address: ActorAddress): RemoteProjectionWatcher {
    const existingWatcher = this.remoteProjectionWatchers.get(address);
    if (existingWatcher) {
      return existingWatcher;
    }

    const watcher = this.createRemoteProjectionWatcher(address);
    this.remoteProjectionWatchers.set(address, watcher);
    return watcher;
  }

  private updateRemoteProjectionWatcherStatus(
    watcher: RemoteProjectionWatcher,
    nextStatus: ProjectionTransportStatus
  ): void {
    watcher.status = nextStatus;
    for (const listener of Array.from(watcher.statusListeners)) {
      listener(nextStatus);
    }
  }

  private createSnapshotProjection(
    address: ActorAddress,
    snapshot: ActorSnapshot<unknown>,
    previousSnapshot?: ActorSnapshot<unknown>,
    sequence = this.currentActorProjectionSequence(address)
  ): RuntimeSnapshotProjection {
    const projectionState = this.getActorProjectionState(address);
    const runtimeSnapshot = actorSnapshotToRuntimeSnapshot({
      snapshot,
      actorId: parse(address).id,
      createdAt: projectionState.createdAt,
      updatedAt: projectionState.updatedAt,
      correlationId: projectionState.correlationId,
      lastEventType: projectionState.lastEventType,
    });

    const transition =
      previousSnapshot &&
      (previousSnapshot.status !== snapshot.status || previousSnapshot.value !== snapshot.value)
        ? actorSnapshotsToTransitionRecord({
            fromSnapshot: previousSnapshot,
            toSnapshot: snapshot,
          })
        : undefined;

    return {
      address,
      snapshot: runtimeSnapshot,
      value: snapshot.value,
      context: snapshot.context,
      sequence,
      transition,
    };
  }

  private createEventProjection(
    address: ActorAddress,
    event: ActorMessage,
    sequence = this.currentActorProjectionSequence(address)
  ): RuntimeEventProjection {
    return {
      address,
      envelope: actorMessageToEventEnvelope(event as typeof event & Record<string, unknown>, {
        id: `${address}:event:${sequence}`,
        kind: 'fact',
        occurredAt: new Date(event._timestamp ?? Date.now()).toISOString(),
        sourceActor: address,
        correlationId: event._correlationId ?? this.getActorProjectionState(address).correlationId,
      }),
      sequence,
    };
  }

  private handleRemoteSnapshotProjection(payload: RuntimeSnapshotProjection): void {
    const watcher = this.getOrCreateRemoteProjectionWatcher(payload.address);
    const previousSequence = watcher.status.lastSequence;

    if (previousSequence !== undefined) {
      if (payload.sequence <= previousSequence) {
        return;
      }

      if (payload.sequence > previousSequence + 1) {
        this.updateRemoteProjectionWatcherStatus(
          watcher,
          createProjectionTransportStatus('degraded', {
            lastSequence: previousSequence,
            reason: `Projection sequence gap detected for ${payload.address}`,
          })
        );
      }
    }

    watcher.snapshot = actorRuntimeProjectionToActorSnapshot({
      snapshot: payload.snapshot,
      value: payload.value,
      context: payload.context,
    });

    for (const listener of Array.from(watcher.snapshotListeners)) {
      listener(watcher.snapshot);
    }

    const nextState = watcher.status.state === 'replaying' ? 'replaying' : watcher.status.state;
    this.updateRemoteProjectionWatcherStatus(
      watcher,
      createProjectionTransportStatus(nextState === 'disconnected' ? 'connected' : nextState, {
        lastSequence: payload.sequence,
        lagMs: this.calculateProjectionLagMs(payload.snapshot.updatedAt),
        reason: nextState === 'degraded' ? watcher.status.reason : undefined,
      })
    );
  }

  private handleRemoteEventProjection(payload: RuntimeEventProjection): void {
    const watcher = this.getOrCreateRemoteProjectionWatcher(payload.address);
    const previousSequence = watcher.status.lastSequence;

    if (previousSequence !== undefined) {
      if (payload.sequence <= previousSequence) {
        return;
      }

      if (payload.sequence > previousSequence + 1) {
        this.updateRemoteProjectionWatcherStatus(
          watcher,
          createProjectionTransportStatus('degraded', {
            lastSequence: previousSequence,
            reason: `Projection sequence gap detected for ${payload.address}`,
          })
        );
      }
    }

    const event = eventEnvelopeToActorMessage(payload.envelope);
    for (const subscriber of Array.from(watcher.eventSubscribers)) {
      if (
        subscriber.types &&
        subscriber.types.length > 0 &&
        !subscriber.types.includes(event.type)
      ) {
        continue;
      }

      subscriber.listener(event);
    }

    const nextState = watcher.status.state === 'replaying' ? 'replaying' : watcher.status.state;
    this.updateRemoteProjectionWatcherStatus(
      watcher,
      createProjectionTransportStatus(nextState === 'disconnected' ? 'connected' : nextState, {
        lastSequence: payload.sequence,
        lagMs: this.calculateProjectionLagMs(payload.envelope.occurredAt),
        reason: nextState === 'degraded' ? watcher.status.reason : undefined,
      })
    );
  }

  private calculateProjectionLagMs(updatedAt: string | undefined): number | undefined {
    if (!updatedAt) {
      return undefined;
    }

    const parsed = Date.parse(updatedAt);
    if (Number.isNaN(parsed)) {
      return undefined;
    }

    return Math.max(0, Date.now() - parsed);
  }

  private async handleTransportConnected(nodeAddress: string): Promise<void> {
    this.clusterState = {
      ...this.clusterState,
      nodes: Array.from(new Set([...this.clusterState.nodes, nodeAddress])),
      status: 'up',
    };

    try {
      await this.requestDirectorySync(nodeAddress);
    } catch (error) {
      log.warn('Failed to sync remote directory on transport connect', {
        nodeAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const watcherPromises = Array.from(this.remoteProjectionWatchers.values())
      .filter((watcher) => this.getAddressNode(watcher.address) === nodeAddress)
      .map((watcher) => this.replayRemoteProjectionWatcher(watcher));

    await Promise.allSettled(watcherPromises);

    // Re-establish cross-node topology subscription edges this node initiated to
    // the reconnected publisher node (publisher-restart recovery, Decision 5).
    await this.replayOutboundTopologySubscriptions(nodeAddress);
  }

  private async handleTransportDisconnected(nodeAddress: string): Promise<void> {
    this.clusterState = {
      ...this.clusterState,
      nodes: this.clusterState.nodes.filter(
        (node) => node === this.config.nodeAddress || node !== nodeAddress
      ),
      status: 'up',
    };

    const allEntries = await this.directory.getAll();
    for (const [path, location] of Array.from(allEntries.entries())) {
      if (location !== nodeAddress) {
        continue;
      }

      const address = parseActorPath(path);
      if (address) {
        this.directory.removeRemoteEntry(address);
      }
    }

    for (const watcher of Array.from(this.remoteProjectionWatchers.values())) {
      if (this.getAddressNode(watcher.address) !== nodeAddress) {
        continue;
      }

      this.updateRemoteProjectionWatcherStatus(
        watcher,
        createProjectionTransportStatus('disconnected', {
          lastSequence: watcher.status.lastSequence,
          reason: `Transport disconnected from ${nodeAddress}`,
        })
      );
    }

    this.removeOutboundRemoteProjectionSubscriptionsForNode(nodeAddress);
    this.removeTopologyRemoteSubscribersForNode(nodeAddress);
  }

  private async replayRemoteProjectionWatcher(watcher: RemoteProjectionWatcher): Promise<void> {
    this.updateRemoteProjectionWatcherStatus(
      watcher,
      createProjectionTransportStatus('replaying', {
        lastSequence: watcher.status.lastSequence,
      })
    );

    try {
      if (watcher.snapshotSubscribed) {
        await this.sendTransportMessage(this.getAddressNode(watcher.address), {
          type: '__runtime.remote.snapshot.subscribe',
          address: watcher.address,
          _timestamp: Date.now(),
          _version: '1.0.0',
        });
      }

      if (watcher.eventSubscribed) {
        await this.sendTransportMessage(this.getAddressNode(watcher.address), {
          type: '__runtime.remote.event.subscribe',
          address: watcher.address,
          _timestamp: Date.now(),
          _version: '1.0.0',
        });
      }

      const projection = await this.requestRemoteSnapshotProjection(watcher.address);
      this.handleRemoteSnapshotProjection(projection);
      this.updateRemoteProjectionWatcherStatus(
        watcher,
        createProjectionTransportStatus('connected', {
          lastSequence: projection.sequence,
          lagMs: this.calculateProjectionLagMs(projection.snapshot.updatedAt),
        })
      );
    } catch (error) {
      this.updateRemoteProjectionWatcherStatus(
        watcher,
        createProjectionTransportStatus('degraded', {
          lastSequence: watcher.status.lastSequence,
          reason: error instanceof Error ? error.message : 'Projection replay failed',
        })
      );
    }
  }

  private async primeRemoteProjectionWatcher(address: ActorAddress): Promise<void> {
    const watcher = this.getOrCreateRemoteProjectionWatcher(address);
    try {
      const projection = await this.requestRemoteSnapshotProjection(address);
      watcher.snapshot = actorRuntimeProjectionToActorSnapshot({
        snapshot: projection.snapshot,
        value: projection.value,
        context: projection.context,
      });
      this.updateRemoteProjectionWatcherStatus(
        watcher,
        createProjectionTransportStatus('connected', {
          lastSequence: projection.sequence,
          lagMs: this.calculateProjectionLagMs(projection.snapshot.updatedAt),
        })
      );
    } catch (error) {
      this.updateRemoteProjectionWatcherStatus(
        watcher,
        createProjectionTransportStatus('disconnected', {
          lastSequence: watcher.status.lastSequence,
          reason: error instanceof Error ? error.message : 'Remote snapshot priming failed',
        })
      );
    }
  }

  private subscribeToRemoteActorSnapshots(
    address: ActorAddress,
    listener: (snapshot: ActorSnapshot<unknown>) => void
  ): () => void {
    const watcher = this.getOrCreateRemoteProjectionWatcher(address);
    watcher.snapshotListeners.add(listener);

    if (!watcher.snapshotSubscribed) {
      watcher.snapshotSubscribed = true;
      void this.sendTransportMessage(this.getAddressNode(address), {
        type: '__runtime.remote.snapshot.subscribe',
        address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      });
    }

    return () => {
      watcher.snapshotListeners.delete(listener);
      if (watcher.snapshotListeners.size === 0 && watcher.snapshotSubscribed) {
        watcher.snapshotSubscribed = false;
        void this.sendTransportMessage(this.getAddressNode(address), {
          type: '__runtime.remote.snapshot.unsubscribe',
          address,
          _timestamp: Date.now(),
          _version: '1.0.0',
        }).catch(() => {});
      }
    };
  }

  private subscribeToRemoteActorEvents(
    address: ActorAddress,
    listener: (event: ActorMessage) => void,
    options: ActorEventSubscriptionOptions = {}
  ): () => void {
    const watcher = this.getOrCreateRemoteProjectionWatcher(address);
    const subscriber = {
      listener,
      types: options.types,
    };
    watcher.eventSubscribers.add(subscriber);

    if (!watcher.eventSubscribed) {
      watcher.eventSubscribed = true;
      void this.sendTransportMessage(this.getAddressNode(address), {
        type: '__runtime.remote.event.subscribe',
        address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      });
    }

    return () => {
      watcher.eventSubscribers.delete(subscriber);
      if (watcher.eventSubscribers.size === 0 && watcher.eventSubscribed) {
        watcher.eventSubscribed = false;
        void this.sendTransportMessage(this.getAddressNode(address), {
          type: '__runtime.remote.event.unsubscribe',
          address,
          _timestamp: Date.now(),
          _version: '1.0.0',
        }).catch(() => {});
      }
    };
  }

  private async sendTransportMessage(
    destination: string | undefined,
    message: RuntimeProtocolMessage
  ): Promise<void> {
    if (!destination) {
      throw new Error('Remote transport destination is required');
    }

    if (!this.config.transport) {
      throw new Error('Actor system transport is not configured');
    }

    await this.config.transport.send(destination, message);
  }

  private async sendRuntimeRequest<TResponse extends ActorMessage>(
    destination: string | undefined,
    requestId: string,
    message: RuntimeProtocolMessage,
    timeout = this.config.defaultAskTimeout ?? 5000
  ): Promise<TResponse> {
    const responsePromise = this.correlationManager.registerRequest<TResponse>(requestId, timeout);

    try {
      await this.sendTransportMessage(destination, message);
      return await responsePromise;
    } catch (error) {
      this.correlationManager.handleError(
        requestId,
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  private async sendRuntimeRequestError(
    destination: string,
    type:
      | '__runtime.remote.ask.error'
      | '__runtime.remote.snapshot.fetch.error'
      | '__runtime.remote.stop.error'
      | '__runtime.remote.stats.error',
    requestId: string,
    error: unknown
  ): Promise<void> {
    await this.sendTransportMessage(destination, {
      type,
      requestId,
      errorMessage: error instanceof Error ? error.message : String(error),
      _timestamp: Date.now(),
      _version: '1.0.0',
    });
  }

  private async broadcastDirectoryRegister(address: ActorAddress): Promise<void> {
    if (!this.config.transport) {
      return;
    }
    // Never advertise node-private (`local`-node) actors such as the guardian: the
    // `local` key is non-unique across nodes, so a peer applying it would clobber
    // its own same-keyed entry and mis-route the address back to us.
    if (isLocalAddress(address)) {
      return;
    }

    const entry: RuntimeDirectoryEntry = {
      address,
      location: this.config.nodeAddress,
      timestamp: Date.now(),
      ttl: Date.now() + (this.config.directory?.cacheTtl ?? 5 * 60 * 1000),
    };

    await Promise.allSettled(
      this.config.transport.getConnectedNodes().map((node) =>
        this.sendTransportMessage(node, {
          type: '__runtime.directory.register',
          entry,
          _timestamp: Date.now(),
          _version: '1.0.0',
        })
      )
    );
  }

  private async broadcastDirectoryUnregister(address: ActorAddress): Promise<void> {
    if (!this.config.transport) {
      return;
    }

    await Promise.allSettled(
      this.config.transport.getConnectedNodes().map((node) =>
        this.sendTransportMessage(node, {
          type: '__runtime.directory.unregister',
          address,
          _timestamp: Date.now(),
          _version: '1.0.0',
        })
      )
    );
  }

  private async requestDirectorySync(node: string): Promise<void> {
    const requestId = this.correlationManager.generateId();
    const response = await this.sendRuntimeRequest<ActorMessage>(
      node,
      requestId,
      {
        type: '__runtime.directory.sync.request',
        requestId,
        _timestamp: Date.now(),
        _version: '1.0.0',
      },
      this.config.defaultAskTimeout ?? 5000
    );

    if (response.type !== '__runtime.directory.sync.response') {
      throw new Error(`Unexpected directory sync response: ${response.type}`);
    }

    const syncResponse = response as ActorMessage & { entries: RuntimeDirectoryEntry[] };
    for (const entry of syncResponse.entries) {
      this.directory.applyRemoteEntry(entry);
    }
  }

  private async requestRemoteActorAsk<T>(
    address: ActorAddress,
    message: ActorMessage,
    timeout: number
  ): Promise<T> {
    const requestId = this.correlationManager.generateId();
    const response = await this.sendRuntimeRequest<ActorMessage>(
      this.getAddressNode(address),
      requestId,
      {
        type: '__runtime.remote.ask.request',
        requestId,
        address,
        message: {
          ...message,
          _correlationId: message._correlationId ?? requestId,
          _timestamp: message._timestamp ?? Date.now(),
          _version: message._version ?? '1.0.0',
        },
        timeout,
        _timestamp: Date.now(),
        _version: '1.0.0',
      },
      timeout
    );

    if (response.type !== '__runtime.remote.ask.response') {
      throw new Error(`Unexpected remote ask response: ${response.type}`);
    }

    return (response as ActorMessage & { payload: T }).payload;
  }

  private async requestRemoteSnapshotProjection(
    address: ActorAddress
  ): Promise<RuntimeSnapshotProjection> {
    const requestId = this.correlationManager.generateId();
    const response = await this.sendRuntimeRequest<ActorMessage>(
      this.getAddressNode(address),
      requestId,
      {
        type: '__runtime.remote.snapshot.fetch.request',
        requestId,
        address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      }
    );

    if (response.type !== '__runtime.remote.snapshot.fetch.response') {
      throw new Error(`Unexpected remote snapshot response: ${response.type}`);
    }

    return (response as ActorMessage & { payload: RuntimeSnapshotProjection }).payload;
  }

  private async requestRemoteActorStop(address: ActorAddress): Promise<void> {
    const requestId = this.correlationManager.generateId();
    const response = await this.sendRuntimeRequest<ActorMessage>(
      this.getAddressNode(address),
      requestId,
      {
        type: '__runtime.remote.stop.request',
        requestId,
        address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      }
    );

    if (response.type !== '__runtime.remote.stop.response') {
      throw new Error(`Unexpected remote stop response: ${response.type}`);
    }
  }

  private async requestRemoteActorStats(address: ActorAddress): Promise<ActorStats> {
    const requestId = this.correlationManager.generateId();
    const response = await this.sendRuntimeRequest<ActorMessage>(
      this.getAddressNode(address),
      requestId,
      {
        type: '__runtime.remote.stats.request',
        requestId,
        address,
        _timestamp: Date.now(),
        _version: '1.0.0',
      }
    );

    if (response.type !== '__runtime.remote.stats.response') {
      throw new Error(`Unexpected remote stats response: ${response.type}`);
    }

    return (response as ActorMessage & { payload: ActorStats }).payload;
  }

  private async addOutboundRemoteProjectionSubscriber(
    address: ActorAddress,
    sourceNode: string,
    kind: 'snapshot' | 'event'
  ): Promise<void> {
    const subscribers = this.outboundRemoteProjectionSubscribers.get(address) ?? {
      snapshotNodes: new Set<string>(),
      eventNodes: new Set<string>(),
    };
    this.outboundRemoteProjectionSubscribers.set(address, subscribers);

    if (kind === 'snapshot') {
      subscribers.snapshotNodes.add(sourceNode);
      await this.sendTransportMessage(sourceNode, {
        type: '__runtime.remote.snapshot.update',
        payload: this.createSnapshotProjection(address, this.getLocalActorSnapshot(address)),
        _timestamp: Date.now(),
        _version: '1.0.0',
      });
      return;
    }

    subscribers.eventNodes.add(sourceNode);
  }

  private removeOutboundRemoteProjectionSubscriber(
    address: ActorAddress,
    sourceNode: string,
    kind: 'snapshot' | 'event'
  ): void {
    const subscribers = this.outboundRemoteProjectionSubscribers.get(address);
    if (!subscribers) {
      return;
    }

    if (kind === 'snapshot') {
      subscribers.snapshotNodes.delete(sourceNode);
    } else {
      subscribers.eventNodes.delete(sourceNode);
    }

    if (subscribers.snapshotNodes.size === 0 && subscribers.eventNodes.size === 0) {
      this.outboundRemoteProjectionSubscribers.delete(address);
    }
  }

  private removeOutboundRemoteProjectionSubscriptionsForNode(nodeAddress: string): void {
    for (const [path, subscribers] of Array.from(
      this.outboundRemoteProjectionSubscribers.entries()
    )) {
      subscribers.snapshotNodes.delete(nodeAddress);
      subscribers.eventNodes.delete(nodeAddress);

      if (subscribers.snapshotNodes.size === 0 && subscribers.eventNodes.size === 0) {
        this.outboundRemoteProjectionSubscribers.delete(path);
      }
    }
  }

  private async publishRemoteSnapshotProjection(
    address: ActorAddress,
    snapshot: ActorSnapshot<unknown>,
    previousSnapshot?: ActorSnapshot<unknown>
  ): Promise<void> {
    const subscribers = this.outboundRemoteProjectionSubscribers.get(address);
    if (!subscribers || subscribers.snapshotNodes.size === 0) {
      return;
    }

    const sequence = this.nextActorProjectionSequence(address);
    const payload = this.createSnapshotProjection(address, snapshot, previousSnapshot, sequence);

    await Promise.allSettled(
      Array.from(subscribers.snapshotNodes).map((node) =>
        this.sendTransportMessage(node, {
          type: '__runtime.remote.snapshot.update',
          payload,
          _timestamp: Date.now(),
          _version: '1.0.0',
        })
      )
    );
  }

  private async publishRemoteActorEvent(address: ActorAddress, event: ActorMessage): Promise<void> {
    const subscribers = this.outboundRemoteProjectionSubscribers.get(address);
    if (!subscribers || subscribers.eventNodes.size === 0) {
      return;
    }

    const sequence = this.nextActorProjectionSequence(address);
    const payload = this.createEventProjection(address, event, sequence);

    await Promise.allSettled(
      Array.from(subscribers.eventNodes).map((node) =>
        this.sendTransportMessage(node, {
          type: '__runtime.remote.event.update',
          payload,
          _timestamp: Date.now(),
          _version: '1.0.0',
        })
      )
    );
  }

  isRemoteTransportConfigured(): boolean {
    return Boolean(this.config.transport);
  }

  registerTopologyRemoteSubscriber(options: {
    publisherPath: string;
    subscriberNode: string;
    subscriberPath: string;
    events?: readonly string[];
  }): void {
    let edges = this.topologyRemoteSubscribers.get(options.publisherPath);
    if (!edges) {
      edges = new Set();
      this.topologyRemoteSubscribers.set(options.publisherPath, edges);
    }
    // Replace any existing edge for the same (node, subscriberPath) pair so a
    // re-handshake updates the event filter rather than duplicating the edge.
    for (const existing of edges) {
      if (
        existing.node === options.subscriberNode &&
        existing.subscriberPath === options.subscriberPath
      ) {
        edges.delete(existing);
      }
    }
    edges.add({
      node: options.subscriberNode,
      subscriberPath: options.subscriberPath,
      ...(options.events ? { events: options.events } : {}),
    });
  }

  private removeTopologyRemoteSubscriber(
    publisherPath: string,
    subscriberNode: string,
    subscriberPath: string
  ): void {
    const edges = this.topologyRemoteSubscribers.get(publisherPath);
    if (!edges) {
      return;
    }
    for (const existing of edges) {
      if (existing.node === subscriberNode && existing.subscriberPath === subscriberPath) {
        edges.delete(existing);
      }
    }
    if (edges.size === 0) {
      this.topologyRemoteSubscribers.delete(publisherPath);
    }
  }

  private removeTopologyRemoteSubscribersForNode(node: string): void {
    for (const [publisherPath, edges] of Array.from(this.topologyRemoteSubscribers.entries())) {
      for (const existing of edges) {
        if (existing.node === node) {
          edges.delete(existing);
        }
      }
      if (edges.size === 0) {
        this.topologyRemoteSubscribers.delete(publisherPath);
      }
    }
  }

  /**
   * Pure: select the cross-node topology edges that should receive an event of
   * `eventType` from `publisherPath`. No clock, no I/O — the shell supplies the
   * registered edges and performs the sends.
   */
  private matchTopologyRemoteSubscribers(
    publisherPath: string,
    eventType: string
  ): Array<{ node: string; subscriberPath: string }> {
    const edges = this.topologyRemoteSubscribers.get(publisherPath);
    if (!edges) {
      return [];
    }
    const matched: Array<{ node: string; subscriberPath: string }> = [];
    for (const edge of edges) {
      if (edge.events && edge.events.length > 0 && !edge.events.includes(eventType)) {
        continue;
      }
      matched.push({ node: edge.node, subscriberPath: edge.subscriberPath });
    }
    return matched;
  }

  private async forwardTopologyEventToRemoteSubscribers(
    address: ActorAddress,
    event: ActorMessage
  ): Promise<void> {
    const matched = this.matchTopologyRemoteSubscribers(address, event.type);
    if (matched.length === 0) {
      return;
    }
    // Sequence 0: the topology channel must NOT consume the projection sequence
    // counter — doing so would advance it for actors that also have a
    // createActorSource projection watcher, falsely flipping that watcher to
    // `degraded` on a gap. Topology delivery is at-most-once direct enqueue and
    // carries no gap-detection contract, so it borrows a fixed sequence.
    const payload = this.createEventProjection(address, event, 0);

    await Promise.allSettled(
      matched.map((edge) =>
        this.sendTransportMessage(edge.node, {
          type: '__runtime.topology.event',
          subscriberPath: edge.subscriberPath,
          payload,
          _timestamp: Date.now(),
          _version: '1.0.0',
        }).catch((error) => {
          // A dead peer must never throw into the emit turn or escape as an
          // unhandled rejection (PR #27 incident). Drop + log.
          log.warn('Cross-node subscription event dropped', {
            publisherPath: address,
            subscriberPath: edge.subscriberPath,
            node: edge.node,
            eventType: event.type,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      )
    );
  }

  async sendTopologySubscribe(options: {
    publisherNode: string;
    publisherPath: string;
    subscriberPath: string;
    events?: readonly string[];
  }): Promise<() => Promise<void>> {
    let intents = this.outboundTopologySubscriptions.get(options.publisherNode);
    if (!intents) {
      intents = new Set();
      this.outboundTopologySubscriptions.set(options.publisherNode, intents);
    }
    const intent = {
      publisherPath: options.publisherPath,
      subscriberPath: options.subscriberPath,
      ...(options.events ? { events: options.events } : {}),
    };
    intents.add(intent);

    // A missing transport is the loud no-transport contract (cross-node needs a
    // transport). With a transport present, the initial handshake is best-effort:
    // the intent is recorded above and replayed on transport-connected, so a
    // not-yet-connected publisher node at start must not fail wiring (nodes can
    // start in any order).
    if (!this.config.transport) {
      throw new Error('Actor system transport is not configured');
    }
    await this.sendTransportMessage(options.publisherNode, {
      type: '__runtime.topology.subscribe',
      publisherPath: options.publisherPath,
      subscriberPath: options.subscriberPath,
      ...(options.events ? { events: [...options.events] } : {}),
      _timestamp: Date.now(),
      _version: '1.0.0',
    }).catch((error) => {
      log.warn('Cross-node subscription handshake deferred until peer connects', {
        publisherNode: options.publisherNode,
        publisherPath: options.publisherPath,
        subscriberPath: options.subscriberPath,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return async () => {
      intents?.delete(intent);
      if (intents && intents.size === 0) {
        this.outboundTopologySubscriptions.delete(options.publisherNode);
      }
      await this.sendTransportMessage(options.publisherNode, {
        type: '__runtime.topology.unsubscribe',
        publisherPath: options.publisherPath,
        subscriberPath: options.subscriberPath,
        _timestamp: Date.now(),
        _version: '1.0.0',
      }).catch((error) => {
        log.warn('Cross-node subscription unsubscribe failed', {
          publisherNode: options.publisherNode,
          publisherPath: options.publisherPath,
          subscriberPath: options.subscriberPath,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
  }

  private async replayOutboundTopologySubscriptions(publisherNode: string): Promise<void> {
    const intents = this.outboundTopologySubscriptions.get(publisherNode);
    if (!intents || intents.size === 0) {
      return;
    }
    await Promise.allSettled(
      Array.from(intents).map((intent) =>
        this.sendTransportMessage(publisherNode, {
          type: '__runtime.topology.subscribe',
          publisherPath: intent.publisherPath,
          subscriberPath: intent.subscriberPath,
          ...(intent.events ? { events: [...intent.events] } : {}),
          _timestamp: Date.now(),
          _version: '1.0.0',
        }).catch((error) => {
          log.warn('Cross-node subscription replay failed', {
            publisherNode,
            publisherPath: intent.publisherPath,
            subscriberPath: intent.subscriberPath,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      )
    );
  }

  private createFallbackSnapshot(
    status: ActorSnapshot<unknown>['status'] = 'running',
    previousSnapshot?: ActorSnapshot<unknown>
  ): ActorSnapshot<unknown> {
    const value = previousSnapshot?.value;
    const context = previousSnapshot?.context ?? {};
    const error = previousSnapshot?.error;
    const matches = previousSnapshot?.matches ?? (() => false);
    const hasTag = previousSnapshot?.hasTag ?? (() => false);

    return {
      value,
      context,
      status,
      error,
      matches,
      can: () => status === 'running',
      hasTag,
      toJSON: () => ({
        value,
        context,
        status,
      }),
    };
  }

  private snapshotsAreEquivalent(
    left: ActorSnapshot<unknown>,
    right: ActorSnapshot<unknown>
  ): boolean {
    return JSON.stringify(left.toJSON()) === JSON.stringify(right.toJSON());
  }

  private cloneSnapshot<TContext>(snapshot: ActorSnapshot<TContext>): ActorSnapshot<TContext> {
    const serialized = snapshot.toJSON() as {
      value?: ActorSnapshot<TContext>['value'];
      context?: TContext;
      status?: ActorSnapshot<TContext>['status'];
    };
    const value = serialized.value ?? snapshot.value;
    const context = (serialized.context ?? snapshot.context) as TContext;
    const status = serialized.status ?? snapshot.status;

    return {
      value,
      context,
      status,
      error: snapshot.error,
      matches: snapshot.matches,
      can: snapshot.can,
      hasTag: snapshot.hasTag,
      toJSON: () => ({
        value,
        context,
        status,
      }),
    };
  }

  /**
   * Execute error interceptors
   */
  private async executeErrorInterceptors(
    error: Error,
    message: ActorMessage,
    address: ActorAddress,
    context: MessageContext,
    actorChain?: InterceptorChain
  ): Promise<void> {
    // Execute global onError interceptors
    if (this.globalInterceptors.size > 0) {
      try {
        await this.globalInterceptors.executeOnError(error, message, address, context);
      } catch (interceptorError) {
        log.error('Global interceptor onError handler failed', {
          error:
            interceptorError instanceof Error ? interceptorError.message : String(interceptorError),
        });
      }
    }

    // Execute actor-specific onError interceptors
    if (actorChain && actorChain.size > 0) {
      try {
        await actorChain.executeOnError(error, message, address, context);
      } catch (interceptorError) {
        log.error('Actor interceptor onError handler failed', {
          error:
            interceptorError instanceof Error ? interceptorError.message : String(interceptorError),
        });
      }
    }
  }

  /**
   * Deliver message to remote actor (placeholder)
   */
  private async deliverMessageRemote(
    location: string,
    address: ActorAddress,
    message: ActorMessage
  ): Promise<void> {
    await this.sendTransportMessage(location, {
      type: '__runtime.remote.send',
      address,
      message,
      _timestamp: Date.now(),
      _version: '1.0.0',
    });
  }

  /**
   * Apply the supervision strategy to a failed actor.
   * Called when message processing throws. The pure decision core
   * (resolveSupervisionDecision) picks the directive from the actor's
   * per-actor policy (with system defaults as fallback); this method
   * executes it.
   */
  private async applySupervisionStrategy(address: ActorAddress, error: unknown): Promise<void> {
    const groupKey = this.actorSupervisorGroupKeys.get(address);
    if (groupKey && this.restartingGroups.has(groupKey)) {
      log.warn('Ignoring failure surfaced while its supervisor group action is in flight', {
        path: address,
        group: groupKey,
      });
      return;
    }

    const behavior = this.actors.get(address);
    if (!behavior) {
      log.error('Behavior not found for actor', { path: address });
      return;
    }

    const policy = this.actorSupervisionPolicies.get(address);
    const decision = resolveSupervisionDecision({
      policy,
      restartCount: this.actorRestartCounts.get(address) || 0,
      lastRestartTimeMs: this.actorLastRestartTime.get(address) || 0,
      nowMs: Date.now(),
    });
    const errorMessage = error instanceof Error ? error.message : String(error);

    log.warn('Actor failed, applying supervision decision', {
      path: address,
      strategy: policy?.strategy ?? 'restart',
      decision: decision.kind,
      error: errorMessage,
    });

    const group = groupKey ? this.supervisorGroups.get(groupKey) : undefined;
    // An escalating child inside a widening group hands its failure to the
    // group, but the group restart must stay bounded by the child's own
    // maxRestarts/withinMs — substitute a restart-strategy decision so
    // exhaustion still resolves to stop-permanent (= group give-up).
    let childDecision = decision;
    if (
      decision.kind === 'escalate' &&
      group &&
      (group.strategy === 'one-for-all' || group.strategy === 'rest-for-one') &&
      policy
    ) {
      childDecision = resolveSupervisionDecision({
        policy: { ...policy, strategy: 'restart' },
        restartCount: this.actorRestartCounts.get(address) || 0,
        lastRestartTimeMs: this.actorLastRestartTime.get(address) || 0,
        nowMs: Date.now(),
      });
    }
    const treeDecision = resolveTreeSupervisionDecision({
      childDecision,
      group,
      failedChildPath: address,
    });
    if (treeDecision.kind === 'restart-group' && group) {
      if (childDecision.kind === 'restart') {
        // Sync any window-expiry reset back into the tracked count before
        // the group restart path increments it.
        this.actorRestartCounts.set(address, childDecision.restartCount);
      }
      await this.restartSupervisorGroup(
        group,
        address,
        treeDecision.stopOrder,
        treeDecision.respawnOrder
      );
      return;
    }
    if (treeDecision.kind === 'give-up-group' && group) {
      await this.stopSupervisorGroup(
        group,
        address,
        treeDecision.stopOrder,
        treeDecision.reason,
        error
      );
      return;
    }

    switch (decision.kind) {
      case 'restart': {
        // Sync any window-expiry reset back into the tracked count before
        // the restart path increments it.
        this.actorRestartCounts.set(address, decision.restartCount);
        log.warn('Actor failed, applying restart directive', {
          path: address,
          restartAttempt: decision.restartCount + 1,
          maxRestarts: decision.maxRestarts,
        });
        await this.restartActorWithLimits(address, behavior);
        return;
      }
      case 'stop-permanent': {
        log.error('Actor exceeded restart limits, stopping permanently', {
          path: address,
          restartCount: decision.restartCount,
          maxAttempts: decision.maxRestarts,
          error: errorMessage,
        });
        // Stop the actor permanently to prevent restart loops and memory
        // leaks. stopActor emits the single terminal actorStopped event with
        // this reason.
        await this.stopActor(new ActorPIDImpl(address, this), 'max-restarts-exceeded');
        return;
      }
      case 'stop': {
        log.error('Actor failed, applying stop directive', { path: address });
        await this.stopActor(new ActorPIDImpl(address, this), 'supervision-stop');
        return;
      }
      case 'escalate': {
        // Per-actor escalate for ungrouped actors and one-for-one groups:
        // stop the failed actor and emit a distinct escalation event so
        // operators observe the unhandled failure. Widening groups
        // (one-for-all/rest-for-one) never reach here — their escalate is
        // substituted into a bounded group restart above.
        log.warn('Actor failed, escalating (stop + escalation event)', { path: address });
        await this.stopActor(new ActorPIDImpl(address, this));
        await this.emitSystemEvent({
          eventType: 'actorEscalated',
          timestamp: Date.now(),
          data: { address: address, reason: 'supervision-escalate', error: errorMessage },
        });
        return;
      }
      case 'resume': {
        // This failure path runs inside the actor's processing loop after
        // the failed message was already dequeued: returning without a stop
        // or restart resumes the actor in place — current state and the rest
        // of the mailbox are preserved, only the failed message is skipped.
        log.warn('Actor failed, resuming with current state (failed message skipped)', {
          path: address,
          error: errorMessage,
        });
        await this.emitSystemEvent({
          eventType: 'actorResumed',
          timestamp: Date.now(),
          data: { address: address, reason: 'supervision-resume', error: errorMessage },
        });
        return;
      }
    }
  }

  /**
   * Restart an actor with the same behavior and track restart attempts
   */
  private async restartActorWithLimits(
    address: ActorAddress,
    behavior: PureActorBehavior
  ): Promise<void> {
    const now = Date.now();
    const currentRestartCount = this.actorRestartCounts.get(address) || 0;
    // Capture the per-actor policy and the original behavior reference before
    // stopActor clears per-path bookkeeping. The respawn must use the
    // original (pre-normalization) behavior: machine registrations key on its
    // object identity, so respawning from the normalized copy would restart a
    // machine-backed actor as a context/stateless actor. Both captures are
    // re-stored by spawn itself, so they survive the stop-inside-restart.
    const supervisionPolicy = this.actorSupervisionPolicies.get(address);
    const respawnBehavior = this.actorOriginalBehaviors.get(address) ?? behavior;

    // Add exponential backoff delay to prevent rapid restart loops
    const backoffDelay = RESTART_BACKOFF_MS * 2 ** currentRestartCount;

    log.info('Restarting actor with backoff delay', {
      path: address,
      restartAttempt: currentRestartCount + 1,
      backoffDelayMs: backoffDelay,
    });

    // Wait before restarting to prevent rapid cycling
    await new Promise((resolve) => setTimeout(resolve, backoffDelay));

    try {
      // Stop the current actor
      await this.stopActor(new ActorPIDImpl(address, this));

      // Respawn with the same (original) behavior, ID, and supervision policy
      await this.spawn(respawnBehavior as unknown as ActorBehavior<ActorMessage, unknown>, {
        id: parse(address).id,
        supervision: supervisionPolicy,
      });

      // stopActor clears restart bookkeeping as part of normal teardown;
      // restore it after the respawn so maxRestarts/withinMs stay bounded
      // across the actor's restart history instead of resetting on every
      // restart.
      this.actorRestartCounts.set(address, currentRestartCount + 1);
      this.actorLastRestartTime.set(address, now);

      await this.emitSystemEvent({
        eventType: 'actorRestarted',
        timestamp: Date.now(),
        data: {
          address: address,
          restartAttempt: currentRestartCount + 1,
        },
      });

      log.info('Actor restarted successfully', {
        path: address,
        restartAttempt: currentRestartCount + 1,
      });
    } catch (restartError) {
      log.error('Failed to restart actor', {
        path: address,
        restartAttempt: currentRestartCount + 1,
        error: restartError instanceof Error ? restartError.message : 'Unknown',
      });
      // Escalate restart failure
      await this.notifyGuardianOfFailure(address, restartError);
    }
  }

  /**
   * Restart a whole supervisor group after a member failure: stop the
   * affected members in reverse declaration order, then respawn them in
   * declaration order from their original behaviors. One backoff wait per
   * group restart (derived from the failing child's restart history), and
   * only the failing child's restart counter is consumed — siblings restarted
   * as collateral keep their reset budgets. No rejection may escape this
   * driver; per-member failures are logged facts.
   */
  private async restartSupervisorGroup(
    group: SupervisorGroupConfig,
    failedAddress: ActorAddress,
    stopOrder: readonly string[],
    respawnOrder: readonly string[]
  ): Promise<void> {
    this.restartingGroups.add(group.key);
    try {
      // Capture every member's address, original behavior, and policy BEFORE
      // any stop — stopActor clears actorOriginalBehaviors and
      // actorSupervisionPolicies as part of teardown.
      const captured = new Map<
        string,
        {
          address: ActorAddress;
          behavior: ActorBehavior<unknown, unknown>;
          policy: ActorSupervisionPolicy | undefined;
        }
      >();
      for (const path of respawnOrder) {
        try {
          const memberAddress = parseActorPath(path);
          const memberBehavior = this.actorOriginalBehaviors.get(path);
          if (!memberBehavior) {
            log.warn('Skipping supervisor group member without an original behavior', {
              path,
              group: group.key,
            });
            continue;
          }
          captured.set(path, {
            address: memberAddress,
            behavior: memberBehavior,
            policy: this.actorSupervisionPolicies.get(path),
          });
        } catch (captureError) {
          log.warn('Skipping supervisor group member with unparseable path', {
            path,
            group: group.key,
            error: captureError instanceof Error ? captureError.message : String(captureError),
          });
        }
      }

      const now = Date.now();
      const currentRestartCount = this.actorRestartCounts.get(failedAddress) || 0;
      // Single backoff for the whole group, scaled by the failing child's
      // restart history (same formula as the single-actor restart path).
      const backoffDelay = RESTART_BACKOFF_MS * 2 ** currentRestartCount;

      // warn, not info: this is the one line carrying group/strategy/members
      // for a successful group restart, and info is silenced outside dev.
      log.warn('Restarting supervisor group with backoff delay', {
        group: group.key,
        strategy: group.strategy,
        failedChild: failedAddress,
        members: respawnOrder.length,
        restartAttempt: currentRestartCount + 1,
        backoffDelayMs: backoffDelay,
      });

      await new Promise((resolve) => setTimeout(resolve, backoffDelay));

      for (const path of stopOrder) {
        if (!captured.has(path)) {
          continue;
        }
        // A member stopped during the backoff window (manual stop, per-actor
        // policy, racing teardown) already got its single terminal
        // actorStopped — do not stop it again, and do not resurrect it.
        if (!this.actors.has(path)) {
          log.warn('Skipping member stopped during the group restart backoff', {
            path,
            group: group.key,
          });
          captured.delete(path);
          continue;
        }
        try {
          // Teardown emits the single terminal actorStopped with this reason.
          await this.stopActor(
            new ActorPIDImpl(parseActorPath(path), this),
            'supervisor-group-restart'
          );
        } catch (stopError) {
          log.error('Failed to stop supervisor group member', {
            path,
            group: group.key,
            error: stopError instanceof Error ? stopError.message : String(stopError),
          });
          // If the stop failed with the actor still registered, respawning
          // would stack a second live instance over it — leave the original
          // in place and keep it out of the respawn set.
          if (this.actors.has(path)) {
            captured.delete(path);
          }
        }
      }

      for (const path of respawnOrder) {
        const member = captured.get(path);
        if (!member) {
          continue;
        }
        try {
          await this.spawn(member.behavior as unknown as ActorBehavior<ActorMessage, unknown>, {
            id: parse(member.address).id,
            supervision: member.policy,
          });
          await this.emitSystemEvent({
            eventType: 'actorRestarted',
            timestamp: Date.now(),
            data: {
              address: path,
              restartAttempt: path === failedAddress ? currentRestartCount + 1 : 1,
              supervisor: group.key,
            },
          });
        } catch (respawnError) {
          log.error('Failed to respawn supervisor group member', {
            path,
            group: group.key,
            error: respawnError instanceof Error ? respawnError.message : String(respawnError),
          });
        }
      }

      // Restore the failing child's restart bookkeeping (stopActor cleared it
      // during teardown) so its maxRestarts/withinMs bound spans the group
      // restart. Siblings stay cleared — collateral restarts do not consume
      // their budgets.
      if (captured.has(failedAddress)) {
        this.actorRestartCounts.set(failedAddress, currentRestartCount + 1);
        this.actorLastRestartTime.set(failedAddress, now);
      }
    } catch (groupError) {
      log.error('Supervisor group restart failed', {
        group: group.key,
        failedChild: failedAddress,
        error: groupError instanceof Error ? groupError.message : String(groupError),
      });
    } finally {
      this.restartingGroups.delete(group.key);
    }
  }

  /**
   * Give up on a supervisor group: stop every child in reverse declaration
   * order with reason-coded terminal events and emit exactly one
   * actorEscalated for the group. The system itself never stops — hosts and
   * operators observe the escalation via subscribeToSystemEvents and decide.
   */
  private async stopSupervisorGroup(
    group: SupervisorGroupConfig,
    failedAddress: ActorAddress,
    stopOrder: readonly string[],
    reason: 'max-restarts-exceeded' | 'supervisor-escalated',
    error: unknown
  ): Promise<void> {
    this.restartingGroups.add(group.key);
    try {
      const errorMessage = error instanceof Error ? error.message : String(error);

      log.error('Supervisor group giving up: stopping all children', {
        group: group.key,
        strategy: group.strategy,
        failedChild: failedAddress,
        reason,
        error: errorMessage,
      });

      for (const path of stopOrder) {
        // Skip members that are no longer registered (already stopped by a
        // per-actor policy, a manual stop, or a racing teardown): stopActor
        // would emit a second terminal actorStopped for them, and teardown
        // owns exactly one terminal event per stop.
        if (!this.actors.has(path)) {
          log.warn('Skipping already-stopped supervisor group member during give-up', {
            path,
            group: group.key,
          });
          continue;
        }
        const memberReason =
          reason === 'supervisor-escalated'
            ? 'supervisor-escalated'
            : path === failedAddress
              ? 'max-restarts-exceeded'
              : 'supervisor-max-restarts-exceeded';
        try {
          await this.stopActor(new ActorPIDImpl(parseActorPath(path), this), memberReason);
        } catch (stopError) {
          log.error('Failed to stop supervisor group member during give-up', {
            path,
            group: group.key,
            error: stopError instanceof Error ? stopError.message : String(stopError),
          });
        }
      }

      await this.emitSystemEvent({
        eventType: 'actorEscalated',
        timestamp: Date.now(),
        data: {
          address: failedAddress,
          supervisor: group.key,
          failedChild: failedAddress,
          reason,
          error: errorMessage,
        },
      });
    } catch (groupError) {
      log.error('Supervisor group give-up failed', {
        group: group.key,
        failedChild: failedAddress,
        error: groupError instanceof Error ? groupError.message : String(groupError),
      });
    } finally {
      this.restartingGroups.delete(group.key);
    }
  }

  /**
   * Notify the Guardian actor of a failure that needs escalation
   */
  private async notifyGuardianOfFailure(address: ActorAddress, error: unknown): Promise<void> {
    if (!this.guardianActorAddress) {
      log.error('Cannot escalate failure, Guardian not available', { path: address });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);

    try {
      const actorFailedMessage: ActorFailedMessage = {
        type: 'ACTOR_FAILED',
        actorId: parse(address).id,
        actorPath: address,
        error: errorMessage,
        directive: 'escalate',
        _timestamp: Date.now(),
        _version: '1.0.0',
      };
      await this.enqueueMessage(this.guardianActorAddress, actorFailedMessage);

      log.info('Failure escalated to Guardian', { path: address });
    } catch (escalationError) {
      log.error('Failed to escalate to Guardian', {
        path: address,
        escalationError: escalationError instanceof Error ? escalationError.message : 'Unknown',
      });
    }
  }

  /**
   * Create dependencies for pure actor model
   */
  private createActorDependencies(
    actorId: string,
    actorInstance: ActorInstance
  ): ActorDependencies {
    // Create ActorRef for self reference
    const address = parseActorPath(actorId);
    const selfRef = address
      ? (new ActorPIDImpl(address, this) as unknown as ActorRef<unknown>)
      : undefined;

    return {
      actorId,
      actor: actorInstance,
      self: selfRef || ({} as ActorRef<unknown>), // Provide empty object as fallback
      emit: (event: unknown) => {
        log.debug('🔍 EMIT FUNCTION DEBUG: emit() called', {
          actorId,
          event,
          eventType:
            event && typeof event === 'object' && 'type' in event
              ? (event as { type: unknown }).type
              : undefined,
        });

        const address = parseActorPath(actorId);
        if (address) {
          this.publishActorEvent(address, event);
        } else {
          log.debug('🔍 EMIT FUNCTION DEBUG: Failed to parse actor path', {
            actorId,
          });
        }
      },
      send: async (to: unknown, message: ActorMessage) => {
        if (typeof to === 'object' && to !== null && 'send' in to) {
          await (to as { send: (msg: ActorMessage) => Promise<void> }).send(message);
          return;
        }

        if (typeof to === 'string') {
          const actorRef = await this.lookup(to);
          if (!actorRef) {
            throw new Error(`Unable to resolve actor "${to}" for dependency send.`);
          }

          await actorRef.send(message);
        }
      },
      ask: async <T>(_to: unknown, _message: ActorMessage, _timeout?: number) => {
        return Promise.resolve({} as T);
      },
      tools: createActorToolbox(
        this.config.tools,
        {
          actorId,
          nodeAddress: this.config.nodeAddress,
        },
        this.config.toolAccess?.[actorId]
      ),
      logger: Logger.namespace(`ACTOR_${actorId}`),
      correlationManager: this.correlationManager,
    };
  }

  /**
   * Get the Discovery Service Actor address
   */
  getDiscoveryServiceAddress(): ActorAddress | undefined {
    return this.discoveryServiceActorAddress;
  }

  /**
   * Subscribe to events from a specific actor
   * This is the primary subscription API that matches the interface
   */
  async subscribe<TEventType extends string = string>(
    publisher: ActorRef,
    options: {
      subscriber: ActorRef;
      events?: TEventType[];
    }
  ): Promise<() => Promise<void>> {
    const publisherId = publisher.address;
    const subscriberId = options.subscriber.address;
    const eventTypes = options.events || [];

    log.debug('🔍 SUBSCRIBE DEBUG: subscribe() called', {
      publisherId,
      subscriberId,
      eventTypes,
      hasPublisher: !!publisher,
      hasSubscriber: !!options.subscriber,
    });

    // Register publisher with auto-publishing registry if not already registered
    const behavior = this.actors.get(publisherId);
    log.debug('🔍 SUBSCRIBE DEBUG: Checking publisher behavior', {
      publisherId,
      hasBehavior: !!behavior,
      behaviorType: behavior ? typeof behavior : 'none',
    });

    if (behavior) {
      this.autoPublishingRegistry.analyzeActorBehavior(
        publisherId,
        behavior as unknown as ActorBehavior<ActorMessage, unknown>
      );
    }

    // Add subscriber to the registry
    log.debug('🔍 SUBSCRIBE DEBUG: Adding subscriber to registry', {
      publisherId,
      subscriberId,
      eventTypes,
    });

    this.autoPublishingRegistry.addSubscriber(
      publisherId,
      subscriberId,
      options.subscriber,
      eventTypes
    );

    log.debug('🔍 SUBSCRIBE DEBUG: Subscription completed', {
      publisherId,
      subscriberId,
      eventTypes: eventTypes.length > 0 ? eventTypes : 'all',
    });

    log.info('Actor subscription created', {
      publisher: publisherId,
      subscriber: subscriberId,
      events: eventTypes.length > 0 ? eventTypes : 'all',
    });

    // Return unsubscribe function
    return async () => {
      this.autoPublishingRegistry.removeSubscriber(publisherId, subscriberId);
      log.debug('Actor subscription removed', { publisherId, subscriberId });
    };
  }

  /**
   * Spawn an event collector actor for testing purposes
   */
  async spawnEventCollector(options: { id: string; autoStart?: boolean }): Promise<ActorRef> {
    // Import EventCollectorActor behavior
    const { createEventCollectorBehavior } = await import('./testing/event-collector.js');

    const behavior = createEventCollectorBehavior();

    return this.spawn(behavior, { id: options.id });
  }

  // ============================================================================
  // TEST SYNCHRONIZATION UTILITIES
  // ============================================================================

  /**
   * Enable synchronous test mode
   */
  enableTestMode(): void {
    this.testMode = true;
    log.info('Test mode enabled - messages will be processed synchronously');
  }

  /**
   * Disable synchronous test mode
   */
  disableTestMode(): void {
    this.testMode = false;
    log.info('Test mode disabled - messages will be processed asynchronously');
  }

  /**
   * Check if test mode is enabled
   */
  isTestMode(): boolean {
    return this.testMode;
  }

  /**
   * Flush all pending messages until system is idle
   */
  async flush(options?: { timeout?: number; maxRounds?: number }): Promise<void> {
    const timeout = options?.timeout ?? 5000;
    const maxRounds = options?.maxRounds ?? 1000;
    const startTime = Date.now();
    let rounds = 0;

    log.debug('Starting flush operation', { timeout, maxRounds });

    while (this.hasQueuedMessages()) {
      // Check timeout
      if (Date.now() - startTime > timeout) {
        const busyActors = this.getBusyActors();
        throw new Error(
          `Flush timeout after ${rounds} rounds. Busy actors: ${busyActors.join(', ')}`
        );
      }

      // Check max rounds
      if (rounds++ > maxRounds) {
        const busyActors = this.getBusyActors();
        throw new Error(
          `Flush exceeded max rounds (${maxRounds}). Possible infinite loop. Busy actors: ${busyActors.join(', ')}`
        );
      }

      // Process one round of messages (one per actor for fairness)
      await this.processOneRoundOfMessages();
    }

    log.debug('Flush completed', { rounds, duration: Date.now() - startTime });
  }

  /**
   * Check if any actor has queued messages
   */
  private hasQueuedMessages(): boolean {
    for (const mailbox of this.actorMailboxes.values()) {
      if (mailbox.size() > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get list of actors with pending messages
   */
  private getBusyActors(): string[] {
    const busyActors: string[] = [];
    for (const [path, mailbox] of this.actorMailboxes.entries()) {
      if (mailbox.size() > 0) {
        busyActors.push(path);
      }
    }
    return busyActors;
  }

  /**
   * Process one message from each actor's mailbox (round-robin)
   */
  private async processOneRoundOfMessages(): Promise<void> {
    const promises: Promise<void>[] = [];

    // Process one message from each actor
    for (const [path, mailbox] of this.actorMailboxes.entries()) {
      if (mailbox.size() > 0) {
        // Get the actor address
        const address = parseActorPath(path);
        if (address) {
          // Process one message for this actor
          const promise = this.processNextMessage(address);
          promises.push(promise);
        }
      }
    }

    // Wait for all messages in this round to be processed
    await Promise.all(promises);
  }

  /**
   * Process the next message for a specific actor
   */
  private async processNextMessage(address: ActorAddress): Promise<void> {
    const mailbox = this.actorMailboxes.get(address);
    if (!mailbox) return;

    const message = await mailbox.dequeue();
    if (!message) return;

    // Process the message
    await this.deliverMessageLocal(address, message);
  }
}

/**
 * Internal implementation of ActorPID
 */
class ActorPIDImpl implements ActorRef {
  constructor(
    public readonly address: ActorAddress,
    private readonly system: ActorSystemImpl
  ) {}

  async send<T extends { type: string }>(message: T): Promise<void> {
    log.debug('🔍 ACTOR PID SEND DEBUG: send() called', {
      actorAddress: this.address,
      messageType: message.type,
      message,
    });

    try {
      // Fire and forget - enqueue to mailbox
      await this.system.enqueueMessage(this.address, message);
      log.debug('🔍 ACTOR PID SEND DEBUG: enqueueMessage completed', {
        actorAddress: this.address,
        messageType: message.type,
      });
    } catch (error) {
      log.debug('🔍 ACTOR PID SEND DEBUG: enqueueMessage failed', {
        actorAddress: this.address,
        messageType: message.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async ask<TResponse = JsonValue>(
    message: { type: string; [key: string]: unknown },
    timeout?: number
  ): Promise<TResponse> {
    const askTimeout = timeout ?? this.system.getDefaultAskTimeout();
    return this.system.askActor<TResponse>(this.address, message, askTimeout);
  }

  async stop(): Promise<void> {
    await this.system.stopActorInternal(this.address);
  }

  async isAlive(): Promise<boolean> {
    return this.system.isActorAliveInternal(this.address);
  }

  async getStats(): Promise<ActorStats> {
    const stats = await this.system.getActorStatsInternal(this.address);
    return {
      messagesReceived: stats.messagesReceived,
      messagesProcessed: stats.messagesProcessed,
      errors: stats.errors,
      uptime: stats.uptime,
    };
  }

  subscribe(eventType: string, listener: (event: ActorMessage) => void): () => void {
    // Subscribe to specific event types emitted by this actor
    return this.system.subscribeToActor(this.address, eventType, listener);
  }

  subscribeEvent(
    listener: (event: ActorMessage) => void,
    options: ActorEventSubscriptionOptions = {}
  ): () => void {
    return this.system.subscribeToActorEvents(this.address, listener, options);
  }

  subscribeSnapshot(listener: (snapshot: ActorSnapshot<unknown>) => void): () => void {
    return this.system.subscribeToActorSnapshots(this.address, listener);
  }

  // ActorRef additional methods
  getSnapshot(): ActorSnapshot<unknown> {
    return this.system.getActorSnapshotInternal(this.address);
  }

  getTransportStatus(): ProjectionTransportStatus {
    return this.system.getActorTransportStatusInternal(this.address);
  }

  subscribeTransportStatus(listener: (status: ProjectionTransportStatus) => void): () => void {
    return this.system.subscribeToActorTransportStatus(this.address, listener);
  }
}

/**
 * Create an actor system with the given configuration
 */
export function createActorSystem(config: ActorSystemConfig): ActorSystem {
  return new ActorSystemImpl(config);
}
