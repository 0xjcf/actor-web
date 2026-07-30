/**
 * In-process runtime host for the actor-web CLI (design doc:
 * docs/actor-web-cli-runtime-host-design.md, phase v0).
 *
 * Boots a topology with `startRuntime` (in-memory transport — no network, no
 * LLM) and exposes the operator-console operations over it: list actors,
 * dynamic spawn, send/ask, and event watching. Operations return facts
 * (`ok`/`error`) instead of throwing so the console can report expected
 * failures verbatim.
 *
 * `executeCommand` implements the console grammar (`ls`, `spawn`, `send`,
 * `ask`, `watch`, ...) over a host instance so the REPL, `--exec` scripting,
 * and tests all share one code path.
 */

import { type ActorAgentLlmProvider, createActorAgentTools } from '@actor-web/agent';
import type {
  ActorMessage,
  ActorRef,
  ActorToolRegistry,
  ActorWebTopology,
  ActorWebTopologyInput,
  AgentExecutionAdmissionDecision,
  AgentExecutionAdmissionPolicy,
  AgentExecutionCommandMetadata,
  AgentExecutionCommandPrincipal,
  AgentExecutionIdempotencyClaimPort,
  AgentSessionCheckpointStore,
  ClusterState,
  ClosableActorWebSource,
  ClosableActorWebTraceSource,
  Message,
  ProjectionTransportStatus,
  RuntimeGatewayAuthProvider,
  RuntimeTransportStatus,
} from '@actor-web/runtime';
import {
  createActorWebSource,
  createActorWebTraceSource,
} from '@actor-web/runtime';
import { admitAgentExecutionCommand, Logger, parse, startRuntime } from '@actor-web/runtime';
import type {
  ActorWebNodeGatewayOptions,
  ActorWebNodeTransportOptions,
  ServeActorWebNodeOptions,
  ServedActorWebNode,
} from '../../../actor-core-runtime/src/serve-actor-web-node.js';
import type { RuntimeGatewayTraceProjection } from '../../../actor-core-runtime/src/runtime-gateway-shared.js';
import { serveNode } from '../../../actor-core-runtime/src/serve-actor-web-node.js';
import { loadModuleExport } from './load-module.js';

const log = Logger.namespace('ACTOR_WEB_CLI_HOST');
const DECISION_SINK_FAILURE_DETAIL = 'Decision sink threw before recording the admission decision.';
const DISPATCH_OUTCOME_RECORD_FAILURE_DETAIL =
  'Dispatch outcome could not be recorded after execution.';

function classifyOperationalError(error: unknown): 'error_instance' | 'non_error_throwable' {
  return error instanceof Error ? 'error_instance' : 'non_error_throwable';
}

function reportDecisionSinkFailure(label: 'Send' | 'Ask', error: unknown): void {
  log.error('Decision sink failure', {
    operation: label.toLowerCase(),
    failure: 'decision_sink_failure',
    errorClass: classifyOperationalError(error),
  });
}

export type HostResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface HostActorEntry {
  readonly key: string;
  readonly path: string;
  readonly origin: 'topology' | 'spawned';
  readonly status: string;
}

export interface RuntimeHost {
  /** Topology node keys started by this host. */
  readonly nodeKeys: readonly string[];
  getStatus(): RuntimeHostStatus;
  listActors(): Promise<HostActorEntry[]>;
  spawnFromFile(behaviorPath: string, id: string): Promise<HostResult<HostActorEntry>>;
  send(
    target: string,
    messageJson: string,
    metadata?: AgentExecutionCommandMetadata
  ): Promise<HostResult<string>>;
  ask(
    target: string,
    messageJson: string,
    timeoutMs?: number,
    metadata?: AgentExecutionCommandMetadata
  ): Promise<HostResult<unknown>>;
  watch(target: string, onEvent: (event: ActorMessage) => void): HostResult<() => void>;
  watchTrace(
    target: string,
    onTrace: (projection: RuntimeGatewayTraceProjection) => void
  ): HostResult<() => void>;
  /** Resolve a registry key or actor:// path to an ActorRef. */
  resolve(target: string): ActorRef | undefined;
  /** Drain in-flight messages on every started node. */
  flush(): Promise<void>;
  stop(): Promise<void>;
}

export interface RuntimeHostAgentOptions {
  readonly llm?: ActorAgentLlmProvider;
}

export interface RuntimeHostOptions {
  readonly node?: string;
  readonly tools?: ActorToolRegistry;
  readonly agent?: RuntimeHostAgentOptions;
  readonly commandAdmission?: RuntimeHostCommandAdmissionOptions;
  readonly distributed?: RuntimeHostDistributedOptions;
  readonly remote?: RuntimeHostRemoteOptions;
  readonly checkpoint?: RuntimeHostCheckpointOptions;
}

export interface RuntimeHostDistributedOptions {
  readonly host?: string;
  readonly gateway?:
    | boolean
    | Pick<
        ActorWebNodeGatewayOptions<string>,
        'host' | 'port' | 'expose' | 'inboundQueueLimit' | 'auth' | 'commandAdmission'
      >;
  readonly transport?:
    | boolean
    | Pick<
        ActorWebNodeTransportOptions,
        | 'listen'
        | 'connectTimeoutMs'
        | 'heartbeatIntervalMs'
        | 'heartbeatTimeoutMs'
        | 'outboundQueueLimit'
        | 'idempotencyWindowSize'
        | 'idempotencyProvider'
      >;
  readonly peers?: Record<string, string>;
  readonly connect?: readonly string[];
  readonly allowUnsafeExposure?: boolean;
}

export interface RuntimeHostRemoteOptions {
  readonly gateway: {
    readonly url: string;
    readonly auth?: RuntimeGatewayAuthProvider;
  };
}

export interface RuntimeHostCheckpointOptions {
  readonly store?: AgentSessionCheckpointStore;
  readonly required?: boolean;
}

export interface RuntimeHostReadinessStatus {
  readonly process: 'ready' | 'unavailable';
  readonly transport: 'connected' | 'degraded' | 'disconnected' | 'replaying' | 'local';
  readonly directory: 'local' | 'remote' | 'ready' | 'unavailable';
  readonly checkpointStore: 'ready' | 'missing';
  readonly policyAdmission: 'authenticated' | 'explicit' | 'unconfigured';
}

export interface RuntimeHostStatus {
  readonly mode: 'in-process' | 'distributed' | 'remote';
  readonly node: string;
  readonly nodeKeys: readonly string[];
  readonly gatewayUrl: string | null;
  readonly transportUrl: string | null;
  readonly transport: RuntimeTransportStatus | null;
  readonly cluster: ClusterState | null;
  readonly readiness?: RuntimeHostReadinessStatus;
  readonly transportReason?: string | null;
}

export interface RuntimeHostCommandAdmissionOptions {
  readonly principal: AgentExecutionCommandPrincipal;
  readonly policy: AgentExecutionAdmissionPolicy;
  readonly idempotency?: AgentExecutionIdempotencyClaimPort;
  readonly onDecision: (decision: AgentExecutionAdmissionDecision) => void | Promise<void>;
}

interface RegisteredActor {
  readonly key: string;
  readonly ref: ActorRef;
  readonly origin: 'topology' | 'spawned';
}

type AnyTopology = ActorWebTopology<ActorWebTopologyInput>;

function isTopologyValue(value: unknown): value is AnyTopology {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { actors?: unknown }).actors === 'object' &&
    typeof (value as { nodes?: unknown }).nodes === 'object'
  );
}

function parseMessage(messageJson: string): HostResult<ActorMessage & Message> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(messageJson);
  } catch (error) {
    return {
      ok: false,
      error: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Message must be a JSON object with a string "type" field' };
  }
  if (typeof (parsed as { type?: unknown }).type !== 'string') {
    return { ok: false, error: 'Message must have a string "type" field' };
  }
  return { ok: true, value: parsed as ActorMessage & Message };
}

function describeStatus(ref: ActorRef): string {
  try {
    const status = (ref.getSnapshot() as { status?: unknown }).status;
    return typeof status === 'string' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

function toEntry(actor: RegisteredActor): HostActorEntry {
  return {
    key: actor.key,
    path: actor.ref.address,
    origin: actor.origin,
    status: describeStatus(actor.ref),
  };
}

function resolveRuntimeHostTools(options: RuntimeHostOptions): ActorToolRegistry | undefined {
  if (!options.agent?.llm) {
    return options.tools;
  }

  return {
    ...(options.tools ?? {}),
    ...createActorAgentTools({ llm: options.agent.llm }),
  };
}

function isLoopbackHost(host: string | undefined): boolean {
  if (!host) {
    return true;
  }
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

function createUnsafeExposureError(
  surface: 'gateway' | 'transport',
  host: string
): HostResult<RuntimeHost> {
  return {
    ok: false,
    error:
      'Distributed host rejected: unsafe_exposure_requires_override ' +
      `(${surface} host "${host}" is not loopback-safe. Pass allowUnsafeExposure to bind outside localhost.)`,
  };
}

function validateDistributedExposure(
  options: RuntimeHostDistributedOptions | undefined
): HostResult<RuntimeHost> | null {
  if (!options || options.allowUnsafeExposure) {
    return null;
  }
  const distributedHost = options.host;
  const gatewayHost =
    typeof options.gateway === 'object'
      ? (options.gateway.host ?? distributedHost)
      : distributedHost;
  if (options.gateway && !isLoopbackHost(gatewayHost)) {
    return createUnsafeExposureError('gateway', gatewayHost ?? '0.0.0.0');
  }
  const transportListen =
    typeof options.transport === 'object' ? options.transport.listen : options.transport;
  const transportHost =
    typeof transportListen === 'object'
      ? (transportListen.host ?? distributedHost)
      : distributedHost;
  if (transportListen && !isLoopbackHost(transportHost)) {
    return createUnsafeExposureError('transport', transportHost ?? '0.0.0.0');
  }
  return null;
}

function requiresNonLocalhostGatewayHardening(
  options: RuntimeHostOptions
): Pick<ActorWebNodeGatewayOptions<string>, 'auth' | 'commandAdmission'> | null {
  if (!options.distributed?.allowUnsafeExposure || !options.distributed.gateway) {
    return null;
  }
  const distributedHost = options.distributed.host;
  const gatewayOptions =
    options.distributed.gateway === true ? {} : (options.distributed.gateway ?? {});
  const gatewayHost = gatewayOptions.host ?? distributedHost ?? '127.0.0.1';
  if (isLoopbackHost(gatewayHost)) {
    return null;
  }
  return gatewayOptions;
}

function validateDistributedSecurityRequirements(
  options: RuntimeHostOptions
): HostResult<RuntimeHost> | null {
  const gatewayOptions = requiresNonLocalhostGatewayHardening(options);
  if (!gatewayOptions) {
    return null;
  }
  if (!gatewayOptions.auth) {
    return {
      ok: false,
      error:
        'Distributed host rejected: missing_gateway_auth (non-localhost gateway exposure requires explicit gateway authentication.)',
    };
  }
  if (!gatewayOptions.commandAdmission) {
    return {
      ok: false,
      error:
        'Distributed host rejected: missing_gateway_admission (non-localhost gateway exposure requires explicit command admission.)',
    };
  }
  if (options.checkpoint?.required && !options.checkpoint.store) {
    return {
      ok: false,
      error:
        'Distributed host rejected: missing_checkpoint_store (non-localhost gateway exposure requires an explicit checkpoint store.)',
    };
  }
  return null;
}

function validateCheckpointRequirements(
  options: RuntimeHostOptions
): HostResult<RuntimeHost> | null {
  if (options.checkpoint?.required && !options.checkpoint.store) {
    return {
      ok: false,
      error:
        'Runtime host rejected: missing_checkpoint_store (checkpoint readiness was required but no checkpoint store is configured.)',
    };
  }
  return null;
}

async function settleRuntimeHostClaim(
  decision: AgentExecutionAdmissionDecision,
  outcome: 'not_dispatched' | 'dispatch_succeeded' | 'dispatch_indeterminate'
): Promise<void> {
  await Promise.resolve(decision.idempotencyClaim?.settle(outcome));
}

async function trySettleRuntimeHostClaim(
  decision: AgentExecutionAdmissionDecision,
  outcome: 'not_dispatched' | 'dispatch_succeeded' | 'dispatch_indeterminate'
): Promise<boolean> {
  try {
    await settleRuntimeHostClaim(decision, outcome);
    return true;
  } catch {
    return false;
  }
}

function toRuntimeHostDispatchFailure<T>(label: 'Send' | 'Ask', detail: string): HostResult<T> {
  return {
    ok: false,
    error: `${label} failed: ${detail}`,
  };
}

function validateRuntimeHostCommandAdmissionConfig<T>(
  commandAdmission: RuntimeHostOptions['commandAdmission'] | undefined,
  label: 'Send' | 'Ask'
): HostResult<T> | null {
  if (!commandAdmission) {
    return null;
  }
  if (!commandAdmission.principal) {
    return {
      ok: false,
      error: `${label} rejected: missing_principal (commandAdmission requires an explicit principal.)`,
    };
  }
  if (!commandAdmission.policy) {
    return {
      ok: false,
      error: `${label} rejected: missing_policy_adapter (commandAdmission requires an explicit policy adapter.)`,
    };
  }
  if (!commandAdmission.onDecision) {
    return {
      ok: false,
      error: `${label} rejected: missing_decision_sink (commandAdmission requires an explicit durable decision sink.)`,
    };
  }
  return null;
}

async function executeRuntimeHostDispatch<T>(input: {
  readonly label: 'Send' | 'Ask';
  readonly decision: AgentExecutionAdmissionDecision;
  readonly dispatch: () => Promise<T>;
}): Promise<HostResult<T>> {
  let dispatchCompleted = false;

  try {
    const value = await input.dispatch();
    dispatchCompleted = true;
    const settled = await trySettleRuntimeHostClaim(input.decision, 'dispatch_succeeded');
    if (!settled) {
      return toRuntimeHostDispatchFailure(input.label, DISPATCH_OUTCOME_RECORD_FAILURE_DETAIL);
    }
    return { ok: true, value };
  } catch (error) {
    if (!dispatchCompleted) {
      await trySettleRuntimeHostClaim(input.decision, 'dispatch_indeterminate');
      return toRuntimeHostDispatchFailure(
        input.label,
        error instanceof Error ? error.message : String(error)
      );
    }

    return toRuntimeHostDispatchFailure(input.label, DISPATCH_OUTCOME_RECORD_FAILURE_DETAIL);
  }
}

/**
 * Start an in-process host from a topology value (programmatic entry point).
 */
export async function createRuntimeHost(
  topology: AnyTopology,
  options: RuntimeHostOptions = {}
): Promise<HostResult<RuntimeHost>> {
  const unsafeExposure = validateDistributedExposure(options.distributed);
  if (unsafeExposure) {
    return unsafeExposure;
  }
  const securityRequirementFailure = validateDistributedSecurityRequirements(options);
  if (securityRequirementFailure) {
    return securityRequirementFailure;
  }
  const checkpointRequirementFailure = validateCheckpointRequirements(options);
  if (checkpointRequirementFailure) {
    return checkpointRequirementFailure;
  }

  const topologyNodeKeys = Object.keys(topology.nodes);
  const spawnNodeKey = options.node ?? topologyNodeKeys[0];
  if (spawnNodeKey && !topology.nodes[spawnNodeKey]) {
    return {
      ok: false,
      error: `Node "${spawnNodeKey}" not found in topology. Available nodes: ${topologyNodeKeys.join(', ')}`,
    };
  }

  const tools = resolveRuntimeHostTools(options);
  let runtime: Awaited<ReturnType<typeof startRuntime>> | null = null;
  let servedNode: ServedActorWebNode<AnyTopology> | null = null;
  const remoteSourceCache = new Map<
    string,
    ClosableActorWebSource<unknown, ActorMessage, ActorMessage>
  >();
  const remoteTraceSourceCache = new Map<string, ClosableActorWebTraceSource>();
  let remoteTransportStatus: ProjectionTransportStatus | null = null;
  let remoteTransportReason: string | null = null;

  const toRemoteReadiness = (): RuntimeHostReadinessStatus => ({
    process: 'ready',
    transport: remoteTransportStatus?.state ?? 'replaying',
    directory: 'remote',
    checkpointStore: options.checkpoint?.store ? 'ready' : 'missing',
    policyAdmission: options.remote?.gateway.auth ? 'authenticated' : 'unconfigured',
  });

  try {
    if (options.remote) {
      // Remote mode is gateway-backed; actor sources are opened lazily.
    } else if (options.distributed) {
      const serveOptions: ServeActorWebNodeOptions<AnyTopology> = {
        node: spawnNodeKey,
        ...(options.distributed.host ? { host: options.distributed.host } : {}),
        ...(options.distributed.gateway ? { gateway: options.distributed.gateway } : {}),
        ...(options.distributed.transport ? { transport: options.distributed.transport } : {}),
        ...(options.distributed.peers ? { peers: options.distributed.peers } : {}),
        ...(options.distributed.connect ? { connect: options.distributed.connect } : {}),
        ...(tools ? { tools } : {}),
      };
      servedNode = await serveNode(topology, serveOptions);
    } else {
      runtime = await startRuntime(topology, tools ? { tools } : undefined);
    }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to start runtime: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const nodeKeys = options.remote
    ? [spawnNodeKey]
    : servedNode
      ? [spawnNodeKey]
      : Object.keys(runtime?.nodes ?? {});

  const registry = new Map<string, RegisteredActor>();
  for (const [key, descriptor] of Object.entries(topology.actors)) {
    const ref = options.remote
      ? undefined
      : servedNode
        ? descriptor.node === spawnNodeKey
          ? servedNode.getActor(key)
          : undefined
        : runtime?.getActor(key);
    if (ref) {
      registry.set(key, { key, ref, origin: 'topology' });
    }
  }
  log.debug('Runtime host started', { nodeKeys, actors: Array.from(registry.keys()) });

  const getStatus = (): RuntimeHostStatus => ({
    mode: options.remote ? 'remote' : servedNode ? 'distributed' : 'in-process',
    node: spawnNodeKey,
    nodeKeys,
    gatewayUrl: options.remote?.gateway.url ?? servedNode?.getGatewayUrl() ?? null,
    transportUrl: servedNode?.getTransportUrl() ?? null,
    transport: servedNode?.getTransportStatus() ?? null,
    cluster: servedNode?.system.getClusterState() ?? null,
    ...(options.remote
      ? {
          readiness: toRemoteReadiness(),
          transportReason: remoteTransportReason,
        }
      : {}),
  });

  const resolve = (target: string): ActorRef | undefined => {
    if (options.remote) {
      return undefined;
    }
    const byKey = registry.get(target);
    if (byKey) {
      return byKey.ref;
    }
    for (const entry of registry.values()) {
      if (entry.ref.address === target || parse(entry.ref.address).id === target) {
        return entry.ref;
      }
    }
    return undefined;
  };

  const lookupDistributedActor = async (target: string): Promise<ActorRef | undefined> => {
    if (!servedNode || !target.startsWith('actor://')) {
      return undefined;
    }
    return servedNode.system.lookup(target);
  };

  const getRemoteSource = (
    target: string
  ): ClosableActorWebSource<unknown, ActorMessage, ActorMessage> | undefined => {
    if (!options.remote) {
      return undefined;
    }
    const actorEntry = Object.entries(topology.actors).find(
      ([key, descriptor]) =>
        key === target || descriptor.address === target || parse(descriptor.address).id === target
    );
    if (!actorEntry) {
      return undefined;
    }
    const [actorKey, actorDescriptor] = actorEntry;
    const cached = remoteSourceCache.get(actorKey);
    if (cached) {
      return cached;
    }
    const source = createActorWebSource({
      actor: actorDescriptor,
      gateway: options.remote.gateway,
      streamId: `actor-web-cli-remote-${actorKey}`,
    });
    source.subscribeTransportStatus((status) => {
      remoteTransportStatus = status;
      remoteTransportReason = status.reason ?? null;
    });
    remoteSourceCache.set(actorKey, source);
    return source;
  };

  const getRemoteTraceSource = (target: string): ClosableActorWebTraceSource | undefined => {
    if (!options.remote) {
      return undefined;
    }
    const actorEntry = Object.entries(topology.actors).find(
      ([key, descriptor]) =>
        key === target || descriptor.address === target || parse(descriptor.address).id === target
    );
    if (!actorEntry) {
      return undefined;
    }
    const [actorKey, actorDescriptor] = actorEntry;
    const cached = remoteTraceSourceCache.get(actorKey);
    if (cached) {
      return cached;
    }
    const source = createActorWebTraceSource({
      actor: actorDescriptor,
      gateway: {
        ...options.remote.gateway,
        scope: {
          ...(actorDescriptor.gateway?.scope ?? {}),
          params: {
            ...(actorDescriptor.gateway?.scope.params ?? {}),
            stream: 'trace',
          },
        },
      },
      streamId: `actor-web-cli-remote-trace-${actorKey}`,
    });
    source.subscribeTransportStatus((status) => {
      remoteTransportStatus = status;
      remoteTransportReason = status.reason ?? null;
    });
    remoteTraceSourceCache.set(actorKey, source);
    return source;
  };

  const resolveForDispatch = async (target: string): Promise<ActorRef | undefined> => {
    if (options.remote) {
      return undefined;
    }
    const local = resolve(target);
    if (local) {
      return local;
    }
    return lookupDistributedActor(target);
  };

  const unknownTargetError = (target: string): string =>
    `Unknown actor "${target}". Known: ${Array.from(registry.keys()).join(', ') || '(none)'}`;

  const flush = async (): Promise<void> => {
    if (options.remote) {
      return;
    }
    if (servedNode) {
      await servedNode.system.flush();
      return;
    }
    for (const key of nodeKeys) {
      await runtime?.nodes[key]?.system.flush();
    }
  };

  const host: RuntimeHost = {
    nodeKeys,
    getStatus,

    async listActors() {
      if (options.remote) {
        return Object.entries(topology.actors).map(([key, descriptor]) => {
          const source = getRemoteSource(key);
          const status = source?.snapshot().status ?? 'unknown';
          return {
            key,
            path: descriptor.address,
            origin: 'topology' as const,
            status,
          };
        });
      }
      if (!servedNode) {
        return Array.from(registry.values()).map(toEntry);
      }
      const actors = await Promise.all(
        Object.entries(topology.actors).map(async ([key, descriptor]) => {
          const ref =
            registry.get(key)?.ref ?? (await servedNode?.system.lookup(descriptor.address));
          if (!ref) {
            return null;
          }
          return toEntry({
            key,
            ref,
            origin: descriptor.node === spawnNodeKey ? 'topology' : 'spawned',
          });
        })
      );
      return actors.filter((entry): entry is HostActorEntry => entry !== null);
    },

    async spawnFromFile(behaviorPath, id) {
      if (options.remote) {
        return {
          ok: false,
          error:
            'Spawn failed: remote runtime hosts do not support dynamic spawn through the CLI shell.',
        };
      }
      if (registry.has(id)) {
        return { ok: false, error: `Actor id "${id}" is already registered` };
      }
      if (servedNode) {
        return {
          ok: false,
          error:
            'Spawn failed: distributed runtime hosts do not support dynamic spawn through the CLI shell yet.',
        };
      }
      const loaded = await loadModuleExport(behaviorPath);
      if (!loaded.ok) {
        return loaded;
      }
      const system = runtime.nodes[spawnNodeKey]?.system;
      if (!system) {
        return { ok: false, error: `No started system for node "${spawnNodeKey}"` };
      }
      let ref: ActorRef;
      try {
        // The runtime materializes built behaviors and builders alike; shape
        // errors surface here as facts rather than crashing the console.
        ref = await system.spawn(loaded.value as Parameters<typeof system.spawn>[0], { id });
      } catch (error) {
        return {
          ok: false,
          error: `Spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const entry: RegisteredActor = { key: id, ref, origin: 'spawned' };
      registry.set(id, entry);
      return { ok: true, value: toEntry(entry) };
    },

    async send(target, messageJson, metadata) {
      if (options.remote) {
        const source = getRemoteSource(target);
        if (!source) {
          return { ok: false, error: unknownTargetError(target) };
        }
        const message = parseMessage(messageJson);
        if (!message.ok) {
          return message;
        }
        try {
          await source.send(message.value, metadata);
          return { ok: true, value: `Sent ${message.value.type} to ${source.address}` };
        } catch (error) {
          return {
            ok: false,
            error: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      const ref = await resolveForDispatch(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      const message = parseMessage(messageJson);
      if (!message.ok) {
        return message;
      }
      try {
        if (options.commandAdmission) {
          const configError = validateRuntimeHostCommandAdmissionConfig<string>(
            options.commandAdmission,
            'Send'
          );
          if (configError) {
            return configError;
          }
          const decision = await admitAgentExecutionCommand({
            actorId: ref.address,
            sessionId: `runtime-host:${spawnNodeKey}`,
            kind: 'send',
            message: message.value,
            principal: options.commandAdmission.principal,
            policy: options.commandAdmission.policy,
            requireExplicitPolicy: true,
            idempotency: options.commandAdmission.idempotency,
            metadata,
          });
          try {
            await Promise.resolve(options.commandAdmission.onDecision(decision));
          } catch (error) {
            reportDecisionSinkFailure('Send', error);
            if (decision.ok) {
              await trySettleRuntimeHostClaim(decision, 'not_dispatched');
            }
            return {
              ok: false,
              error: `Send rejected: decision_sink_failure (${DECISION_SINK_FAILURE_DETAIL})`,
            };
          }
          if (!decision.ok) {
            const reason = decision.rejectionReceipt?.reason;
            return {
              ok: false,
              error: `Send rejected: ${reason?.code ?? 'authorization_denied'}${reason?.detail ? ` (${reason.detail})` : ''}`,
            };
          }
          return executeRuntimeHostDispatch({
            label: 'Send',
            decision,
            dispatch: async () => {
              await ref.send(message.value);
              await flush();
              return `Sent ${message.value.type} to ${ref.address}`;
            },
          });
        }
        await ref.send(message.value);
        await flush();
      } catch (error) {
        return {
          ok: false,
          error: `Send failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return { ok: true, value: `Sent ${message.value.type} to ${ref.address}` };
    },

    async ask(target, messageJson, timeoutMs, metadata) {
      if (options.remote) {
        const source = getRemoteSource(target);
        if (!source) {
          return { ok: false, error: unknownTargetError(target) };
        }
        const message = parseMessage(messageJson);
        if (!message.ok) {
          return message;
        }
        try {
          const reply = await source.ask(
            message.value,
            timeoutMs === undefined ? { metadata } : { timeout: timeoutMs, metadata }
          );
          return { ok: true, value: reply };
        } catch (error) {
          return {
            ok: false,
            error: `Ask failed: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
      const ref = await resolveForDispatch(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      const message = parseMessage(messageJson);
      if (!message.ok) {
        return message;
      }
      try {
        if (options.commandAdmission) {
          const configError = validateRuntimeHostCommandAdmissionConfig<unknown>(
            options.commandAdmission,
            'Ask'
          );
          if (configError) {
            return configError;
          }
          const decision = await admitAgentExecutionCommand({
            actorId: ref.address,
            sessionId: `runtime-host:${spawnNodeKey}`,
            kind: 'ask',
            message: message.value,
            principal: options.commandAdmission.principal,
            policy: options.commandAdmission.policy,
            requireExplicitPolicy: true,
            idempotency: options.commandAdmission.idempotency,
            metadata,
          });
          try {
            await Promise.resolve(options.commandAdmission.onDecision(decision));
          } catch (error) {
            reportDecisionSinkFailure('Ask', error);
            if (decision.ok) {
              await trySettleRuntimeHostClaim(decision, 'not_dispatched');
            }
            return {
              ok: false,
              error: `Ask rejected: decision_sink_failure (${DECISION_SINK_FAILURE_DETAIL})`,
            };
          }
          if (!decision.ok) {
            const reason = decision.rejectionReceipt?.reason;
            return {
              ok: false,
              error: `Ask rejected: ${reason?.code ?? 'authorization_denied'}${reason?.detail ? ` (${reason.detail})` : ''}`,
            };
          }
          return executeRuntimeHostDispatch({
            label: 'Ask',
            decision,
            dispatch: async () => ref.ask(message.value, timeoutMs),
          });
        }
        const reply = await ref.ask(message.value, timeoutMs);
        return { ok: true, value: reply };
      } catch (error) {
        return {
          ok: false,
          error: `Ask failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },

    watch(target, onEvent) {
      if (options.remote) {
        const source = getRemoteSource(target);
        if (!source) {
          return { ok: false, error: unknownTargetError(target) };
        }
        const unsubscribe = source.subscribeEvent(onEvent);
        return { ok: true, value: unsubscribe };
      }
      const ref = resolve(target);
      if (!ref) {
        return { ok: false, error: unknownTargetError(target) };
      }
      if (typeof ref.subscribeEvent !== 'function') {
        return { ok: false, error: `Actor "${target}" does not expose an event stream` };
      }
      const unsubscribe = ref.subscribeEvent(onEvent);
      return { ok: true, value: unsubscribe };
    },

    watchTrace(target, onTrace) {
      if (!options.remote) {
        return {
          ok: false,
          error: 'Trace watch requires a remote gateway-backed host.',
        };
      }
      const source = getRemoteTraceSource(target);
      if (!source) {
        return { ok: false, error: unknownTargetError(target) };
      }
      const unsubscribe = source.subscribeTrace(onTrace);
      return { ok: true, value: unsubscribe };
    },

    resolve,
    flush,

    async stop() {
      if (options.remote) {
        for (const source of remoteSourceCache.values()) {
          source.close();
        }
        for (const source of remoteTraceSourceCache.values()) {
          source.close();
        }
        remoteSourceCache.clear();
        remoteTraceSourceCache.clear();
        return;
      }
      if (servedNode) {
        await servedNode.stop();
        return;
      }
      await runtime?.stop();
    },
  };

  return { ok: true, value: host };
}

/**
 * Start an in-process host from a topology module file (CLI entry point).
 */
export async function createRuntimeHostFromFile(
  topologyPath: string,
  options: RuntimeHostOptions = {}
): Promise<HostResult<RuntimeHost>> {
  const loaded = await loadModuleExport(topologyPath);
  if (!loaded.ok) {
    return loaded;
  }
  if (!isTopologyValue(loaded.value)) {
    return {
      ok: false,
      error: `${topologyPath} does not export a topology (expected a defineActorWebTopology(...) value with "actors" and "nodes")`,
    };
  }
  return createRuntimeHost(loaded.value, options);
}

// ============================================================================
// CONSOLE GRAMMAR
// ============================================================================

export interface CommandOutcome {
  readonly ok: boolean;
  readonly lines: readonly string[];
  /** True when the console should stop (exit/quit). */
  readonly exit?: boolean;
}

export interface CommandContext {
  /** Receives watch events; the REPL prints them, tests collect them. */
  readonly onEvent?: (target: string, event: ActorMessage) => void;
  /** Receives trace projections; the REPL prints them, tests collect them. */
  readonly onTrace?: (target: string, projection: RuntimeGatewayTraceProjection) => void;
}

const HELP_LINES = [
  'Commands:',
  '  ls                              list actors (key, origin, status, path)',
  '  status                          show host, transport, and directory readiness status',
  '  spawn <file> <id>               spawn a behavior module as a new actor',
  '  send <target> <json>            fire-and-forget message',
  '  ask <target> <json> [timeout]   request/response (timeout in ms)',
  '  watch <target>                  stream emitted events to the console',
  '  watch-trace <target>            stream gateway trace and receipt projections',
  '  unwatch <target>                stop streaming',
  '  unwatch-trace <target>          stop streaming gateway trace projections',
  '  help                            show this help',
  '  exit                            stop the host and leave',
];

/**
 * Split an `--exec` script into console commands on semicolons, ignoring
 * semicolons inside single/double-quoted regions (and backslash escapes) so
 * JSON payloads like `send a {"text":"a;b"}` survive intact.
 */
export function splitExecScript(script: string): string[] {
  const commands: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of script) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ';') {
      commands.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  commands.push(current);

  return commands.map((command) => command.trim()).filter((command) => command.length > 0);
}

/**
 * Execute one console line against a host. Shared by the REPL, `--exec`, and
 * tests. Watch subscriptions are tracked per-`watches` map so `unwatch` and
 * shutdown can release them.
 */
export async function executeCommand(
  host: RuntimeHost,
  line: string,
  watches: Map<string, () => void>,
  context: CommandContext = {}
): Promise<CommandOutcome> {
  const trimmed = line.trim();
  if (trimmed === '') {
    return { ok: true, lines: [] };
  }

  const [command, ...rest] = trimmed.split(/\s+/);

  switch (command) {
    case 'help':
      return { ok: true, lines: HELP_LINES };

    case 'exit':
    case 'quit':
      return { ok: true, lines: ['Stopping host...'], exit: true };

    case 'ls': {
      const actors = await host.listActors();
      if (actors.length === 0) {
        return { ok: true, lines: ['(no actors)'] };
      }
      return {
        ok: true,
        lines: actors.map(
          (entry) => `${entry.key}  [${entry.origin}/${entry.status}]  ${entry.path}`
        ),
      };
    }

    case 'status': {
      const status = host.getStatus();
      const lines = [
        `mode=${status.mode} node=${status.node}`,
        `gateway=${status.gatewayUrl ?? '(disabled)'}`,
        `transport=${status.transportUrl ?? '(disabled)'}`,
      ];
      if (status.readiness) {
        lines.push(`readiness.process=${status.readiness.process}`);
        lines.push(`readiness.transport=${status.readiness.transport}`);
        lines.push(`readiness.directory=${status.readiness.directory}`);
        lines.push(`readiness.checkpointStore=${status.readiness.checkpointStore}`);
        lines.push(`readiness.policyAdmission=${status.readiness.policyAdmission}`);
      }
      if (status.transport) {
        lines.push(
          `transport.connected=${status.transport.connectedNodes.length} peers=${status.transport.peers.length}`
        );
      }
      if (status.transportReason) {
        lines.push(`transport.reason=${status.transportReason}`);
      }
      if (status.cluster?.directoryReadiness) {
        if (status.cluster.directoryReadiness.length === 0) {
          lines.push('directoryReadiness=(none)');
        } else {
          for (const readiness of status.cluster.directoryReadiness) {
            lines.push(`directoryReadiness.${readiness.nodeAddress}=${readiness.status}`);
          }
        }
      }
      return { ok: true, lines };
    }

    case 'spawn': {
      const [file, id] = rest;
      if (!file || !id) {
        return { ok: false, lines: ['Usage: spawn <file> <id>'] };
      }
      const result = await host.spawnFromFile(file, id);
      return result.ok
        ? { ok: true, lines: [`Spawned ${result.value.key} at ${result.value.path}`] }
        : { ok: false, lines: [result.error] };
    }

    case 'send': {
      const target = rest[0];
      if (!target) {
        return { ok: false, lines: ['Usage: send <target> <json>'] };
      }
      const targetStart = trimmed.indexOf(target, command.length);
      const json = trimmed.slice(targetStart + target.length).trim();
      if (!json) {
        return { ok: false, lines: ['Usage: send <target> <json>'] };
      }
      const result = await host.send(target, json);
      return result.ok ? { ok: true, lines: [result.value] } : { ok: false, lines: [result.error] };
    }

    case 'ask': {
      const target = rest[0];
      if (!target) {
        return { ok: false, lines: ['Usage: ask <target> <json> [timeoutMs]'] };
      }
      let remainder = trimmed.slice(trimmed.indexOf(target, command.length) + target.length).trim();
      let timeoutMs: number | undefined;
      const trailingTimeout = remainder.match(/\s(\d+)$/);
      if (trailingTimeout && !remainder.endsWith('}')) {
        timeoutMs = Number.parseInt(trailingTimeout[1], 10);
        remainder = remainder.slice(0, trailingTimeout.index).trim();
      }
      if (!remainder) {
        return { ok: false, lines: ['Usage: ask <target> <json> [timeoutMs]'] };
      }
      const result = await host.ask(target, remainder, timeoutMs);
      return result.ok
        ? { ok: true, lines: [JSON.stringify(result.value)] }
        : { ok: false, lines: [result.error] };
    }

    case 'watch': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: watch <target>'] };
      }
      if (watches.has(target)) {
        return { ok: true, lines: [`Already watching ${target}`] };
      }
      const result = host.watch(target, (event) => {
        context.onEvent?.(target, event);
      });
      if (!result.ok) {
        return { ok: false, lines: [result.error] };
      }
      watches.set(target, result.value);
      return { ok: true, lines: [`Watching ${target} (unwatch ${target} to stop)`] };
    }

    case 'watch-trace': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: watch-trace <target>'] };
      }
      const watchKey = `trace:${target}`;
      if (watches.has(watchKey)) {
        return { ok: true, lines: [`Already tracing ${target}`] };
      }
      const result = host.watchTrace(target, (projection) => {
        context.onTrace?.(target, projection);
      });
      if (!result.ok) {
        return { ok: false, lines: [result.error] };
      }
      watches.set(watchKey, result.value);
      return { ok: true, lines: [`Tracing ${target} (unwatch-trace ${target} to stop)`] };
    }

    case 'unwatch': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: unwatch <target>'] };
      }
      const unsubscribe = watches.get(target);
      if (!unsubscribe) {
        return { ok: false, lines: [`Not watching ${target}`] };
      }
      unsubscribe();
      watches.delete(target);
      return { ok: true, lines: [`Stopped watching ${target}`] };
    }

    case 'unwatch-trace': {
      const [target] = rest;
      if (!target) {
        return { ok: false, lines: ['Usage: unwatch-trace <target>'] };
      }
      const watchKey = `trace:${target}`;
      const unsubscribe = watches.get(watchKey);
      if (!unsubscribe) {
        return { ok: false, lines: [`Not tracing ${target}`] };
      }
      unsubscribe();
      watches.delete(watchKey);
      return { ok: true, lines: [`Stopped tracing ${target}`] };
    }

    default:
      return {
        ok: false,
        lines: [`Unknown command: ${command}. Type "help" for available commands.`],
      };
  }
}
