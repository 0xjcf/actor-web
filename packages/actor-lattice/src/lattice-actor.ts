import { defineBehavior } from '@actor-web/runtime';
import {
  type BaseEvent,
  createEventStore,
  type EventStore,
} from '@actor-web/runtime/event-sourcing';
import {
  createArtifactStore,
  publishArtifact,
  queryArtifacts,
  stableStringify,
} from './artifact.js';
import {
  createRegisteredDependency,
  dependencyKey,
  evaluateDependencySatisfaction,
} from './dependency.js';
import type {
  ArtifactRecord,
  LatticeEvent,
  LatticeJournalEvent,
  LatticeMessage,
  RegisteredDependency,
} from './protocol.js';

export interface LatticeActivationRecord {
  readonly activationId: string;
  readonly dependencyId: string;
  readonly actorKey: string;
  readonly lattice: string;
  readonly satisfactionKey: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly status: 'pending' | 'delivered' | 'acknowledged';
  readonly attempts: number;
  readonly createdAt: number;
  readonly deliveredAt?: number;
  readonly nextTimeoutAt?: number;
  readonly acknowledgedAt?: number;
}

export interface LatticeState {
  readonly latticeId: string;
  readonly timeoutMs: number;
  readonly artifacts: ReturnType<typeof createArtifactStore>;
  readonly dependencies: readonly RegisteredDependency[];
  readonly activations: readonly LatticeActivationRecord[];
  readonly journalVersion: number;
  readonly deliveredSatisfactionKeys: Readonly<Record<string, readonly string[]>>;
}

export interface LatticeJournal {
  append(
    streamId: string,
    events: readonly LatticeJournalEvent[],
    expectedVersion: number
  ): Promise<number>;
  replay(streamId: string, fromVersion?: number): Promise<readonly LatticeJournalEvent[]>;
}

export interface LatticeReductionResult {
  readonly state: LatticeState;
  readonly emit: readonly LatticeEvent[];
  readonly journalEvents: readonly LatticeJournalEvent[];
  readonly reply: unknown;
}

export function createLatticeState(
  latticeId: string,
  options: { readonly timeoutMs?: number } = {}
): LatticeState {
  return {
    latticeId,
    timeoutMs: options.timeoutMs ?? 30_000,
    artifacts: createArtifactStore(),
    dependencies: [],
    activations: [],
    journalVersion: 0,
    deliveredSatisfactionKeys: {},
  };
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `a${(hash >>> 0).toString(16)}`;
}

function activationIdFor(dependencyId: string, satisfactionKey: string): string {
  return `activation:${dependencyId}:${hashText(satisfactionKey)}`;
}

function appendDeliveredKey(
  deliveredKeys: LatticeState['deliveredSatisfactionKeys'],
  dependencyId: string,
  satisfactionKey: string
): LatticeState['deliveredSatisfactionKeys'] {
  const existing = deliveredKeys[dependencyId] ?? [];
  if (existing.includes(satisfactionKey)) {
    return deliveredKeys;
  }
  return {
    ...deliveredKeys,
    [dependencyId]: [...existing, satisfactionKey],
  };
}

function shouldEmitSatisfaction(
  state: LatticeState,
  dependency: RegisteredDependency,
  satisfactionKey: string
): boolean {
  const deliveredKeys = state.deliveredSatisfactionKeys[dependency.dependencyId] ?? [];
  if (dependency.mode === 'once') {
    return deliveredKeys.length === 0;
  }
  return !deliveredKeys.includes(satisfactionKey);
}

function queueSatisfactionActivations(
  state: LatticeState,
  dependencies: readonly RegisteredDependency[],
  now: number
): LatticeState {
  let nextState = state;

  for (const dependency of dependencies) {
    const satisfaction = evaluateDependencySatisfaction(state.artifacts.artifacts, dependency);
    if (
      !satisfaction ||
      !shouldEmitSatisfaction(nextState, dependency, satisfaction.satisfactionKey)
    ) {
      continue;
    }

    const activationId = activationIdFor(dependency.dependencyId, satisfaction.satisfactionKey);
    const existing = nextState.activations.find(
      (activation) => activation.activationId === activationId
    );
    if (existing && existing.status !== 'acknowledged') {
      continue;
    }

    nextState = {
      ...nextState,
      activations: [
        ...nextState.activations,
        {
          activationId,
          dependencyId: dependency.dependencyId,
          actorKey: dependency.actorKey,
          lattice: dependency.lattice,
          satisfactionKey: satisfaction.satisfactionKey,
          artifacts: satisfaction.artifacts,
          status: 'pending',
          attempts: 0,
          createdAt: now,
        },
      ],
    };
  }

  return nextState;
}

function deliverPendingActivations(state: LatticeState, now: number) {
  let deliveredKeys = state.deliveredSatisfactionKeys;
  const emit: LatticeEvent[] = [];

  const activations = state.activations.map((activation) => {
    if (activation.status !== 'pending') {
      return activation;
    }

    deliveredKeys = appendDeliveredKey(
      deliveredKeys,
      activation.dependencyId,
      activation.satisfactionKey
    );
    emit.push({
      type: 'DEPENDENCY_SATISFIED',
      activationId: activation.activationId,
      dependencyId: activation.dependencyId,
      actorKey: activation.actorKey,
      lattice: activation.lattice,
      satisfactionKey: activation.satisfactionKey,
      artifacts: activation.artifacts,
    });

    return {
      ...activation,
      status: 'delivered' as const,
      attempts: activation.attempts + 1,
      deliveredAt: now,
      nextTimeoutAt: now + state.timeoutMs,
    };
  });

  return {
    state: {
      ...state,
      activations,
      deliveredSatisfactionKeys: deliveredKeys,
    },
    emit,
  };
}

function applyJournalEvent(state: LatticeState, event: LatticeJournalEvent): LatticeState {
  if (event.kind === 'ARTIFACT_PUBLISHED') {
    const withArtifact = {
      ...state,
      artifacts: {
        artifacts: [...state.artifacts.artifacts, event.artifact],
      },
      journalVersion: state.journalVersion + 1,
    };
    const impactedDependencies = withArtifact.dependencies.filter((dependency) =>
      dependency.requires.some((matcher) => matcher.type === event.artifact.type)
    );
    const queued = queueSatisfactionActivations(
      withArtifact,
      impactedDependencies,
      event.artifact.publishedAt
    );
    return deliverPendingActivations(queued, event.artifact.publishedAt).state;
  }

  if (event.kind === 'DEPENDENCY_REGISTERED') {
    const registeredAt = event.registeredAt ?? 0;
    const withDependency = {
      ...state,
      dependencies: [
        ...state.dependencies.filter(
          (dependency) => dependency.dependencyId !== event.dependency.dependencyId
        ),
        event.dependency,
      ].sort((left, right) => dependencyKey(left).localeCompare(dependencyKey(right))),
      journalVersion: state.journalVersion + 1,
    };
    const queued = queueSatisfactionActivations(withDependency, [event.dependency], registeredAt);
    return deliverPendingActivations(queued, registeredAt).state;
  }

  if (event.kind === 'DEPENDENCY_WITHDRAWN') {
    return {
      ...state,
      dependencies: state.dependencies.filter(
        (dependency) => dependency.dependencyId !== event.dependencyId
      ),
      activations: state.activations.filter(
        (activation) => activation.dependencyId !== event.dependencyId
      ),
      journalVersion: state.journalVersion + 1,
    };
  }

  return {
    ...state,
    activations: state.activations.map((activation) =>
      activation.activationId === event.activationId
        ? {
            ...activation,
            status: 'acknowledged' as const,
            acknowledgedAt: event.acknowledgedAt,
            nextTimeoutAt: undefined,
          }
        : activation
    ),
    journalVersion: state.journalVersion + 1,
  };
}

export function evaluateActivationTimeouts(state: LatticeState, now: number) {
  let activations = state.activations;
  const emit: LatticeEvent[] = [];

  for (const activation of state.activations) {
    if (
      activation.status !== 'delivered' ||
      activation.nextTimeoutAt === undefined ||
      activation.nextTimeoutAt > now
    ) {
      continue;
    }

    emit.push({
      type: 'ACTIVATION_TIMED_OUT',
      activationId: activation.activationId,
      dependencyId: activation.dependencyId,
      actorKey: activation.actorKey,
      lattice: activation.lattice,
      timedOutAt: now,
    });

    activations = activations.map((candidate) =>
      candidate.activationId === activation.activationId
        ? {
            ...candidate,
            status: 'pending' as const,
          }
        : candidate
    );
  }

  const redelivered = deliverPendingActivations(
    {
      ...state,
      activations,
    },
    now
  );

  return {
    state: redelivered.state,
    emit: [...emit, ...redelivered.emit],
  };
}

export function reduceLatticeMessage(
  state: LatticeState,
  message: LatticeMessage
): LatticeReductionResult {
  if (message.type === 'QUERY_ARTIFACTS') {
    return {
      state,
      emit: [] as LatticeEvent[],
      journalEvents: [] as LatticeJournalEvent[],
      reply: queryArtifacts(state.artifacts, message.query),
    };
  }

  if (message.type === 'CHECK_ACTIVATION_TIMEOUTS') {
    const timeoutResult = evaluateActivationTimeouts(state, message.now);
    return {
      ...timeoutResult,
      journalEvents: [] as LatticeJournalEvent[],
      reply: undefined,
    };
  }

  if (message.type === 'REGISTER_DEPENDENCY') {
    const dependency = createRegisteredDependency(message.dependency);
    const registeredAt = message.registeredAt ?? 0;
    const dedupedDependencies = state.dependencies.filter(
      (candidate) => candidate.dependencyId !== dependency.dependencyId
    );
    const withDependency = {
      ...state,
      dependencies: [...dedupedDependencies, dependency].sort((left, right) =>
        dependencyKey(left).localeCompare(dependencyKey(right))
      ),
    };
    const queued = queueSatisfactionActivations(withDependency, [dependency], registeredAt);
    const delivered = deliverPendingActivations(queued, registeredAt);
    return {
      ...delivered,
      journalEvents: [
        {
          kind: 'DEPENDENCY_REGISTERED',
          dependency,
          registeredAt,
        },
      ] as LatticeJournalEvent[],
      reply: undefined,
    };
  }

  if (message.type === 'WITHDRAW_DEPENDENCY') {
    return {
      state: {
        ...state,
        dependencies: state.dependencies.filter(
          (dependency) => dependency.dependencyId !== message.dependencyId
        ),
        activations: state.activations.filter(
          (activation) => activation.dependencyId !== message.dependencyId
        ),
      },
      emit: [] as LatticeEvent[],
      journalEvents: [
        {
          kind: 'DEPENDENCY_WITHDRAWN',
          dependencyId: message.dependencyId,
        },
      ] as LatticeJournalEvent[],
      reply: undefined,
    };
  }

  if (message.type === 'ACK_ACTIVATION') {
    const current = state.activations.find(
      (activation) => activation.activationId === message.activationId
    );
    if (!current || current.status === 'acknowledged') {
      return {
        state,
        emit: [] as LatticeEvent[],
        journalEvents: [] as LatticeJournalEvent[],
        reply: undefined,
      };
    }

    const acknowledgedAt = message.acknowledgedAt ?? current.deliveredAt ?? current.createdAt;
    return {
      state: {
        ...state,
        activations: state.activations.map((activation) =>
          activation.activationId === message.activationId
            ? {
                ...activation,
                status: 'acknowledged' as const,
                acknowledgedAt,
                nextTimeoutAt: undefined,
              }
            : activation
        ),
      },
      emit: [] as LatticeEvent[],
      journalEvents: [
        {
          kind: 'ACTIVATION_ACKNOWLEDGED',
          activationId: message.activationId,
          acknowledgedAt,
        },
      ] as LatticeJournalEvent[],
      reply: undefined,
    };
  }

  const published = publishArtifact(state.artifacts, message.artifact);
  if (!published.published) {
    return {
      state,
      emit: [] as LatticeEvent[],
      journalEvents: [] as LatticeJournalEvent[],
      reply: undefined,
    };
  }

  const withArtifact = {
    ...state,
    artifacts: published.store,
  };
  const impactedDependencies = withArtifact.dependencies.filter((dependency) =>
    dependency.requires.some((matcher) => matcher.type === published.artifact.type)
  );
  const queued = queueSatisfactionActivations(
    withArtifact,
    impactedDependencies,
    published.artifact.publishedAt
  );
  const delivered = deliverPendingActivations(queued, published.artifact.publishedAt);

  return {
    state: delivered.state,
    emit: [{ type: 'ARTIFACT_PUBLISHED', artifact: published.artifact }, ...delivered.emit],
    journalEvents: [
      {
        kind: 'ARTIFACT_PUBLISHED',
        artifact: published.artifact,
      },
    ] as LatticeJournalEvent[],
    reply: undefined,
  };
}

function toBaseEvent(streamId: string, event: LatticeJournalEvent, version: number): BaseEvent {
  return {
    type: event.kind,
    timestamp:
      event.kind === 'ARTIFACT_PUBLISHED'
        ? event.artifact.publishedAt
        : event.kind === 'DEPENDENCY_REGISTERED'
          ? (event.registeredAt ?? 0)
          : event.kind === 'ACTIVATION_ACKNOWLEDGED'
            ? event.acknowledgedAt
            : 0,
    eventId: `${streamId}:${version}:${hashText(stableStringify(event))}`,
    actorId: streamId,
    version,
    metadata: {
      data: event,
    },
  };
}

export function createEventStoreLatticeJournal(
  eventStore: EventStore = createEventStore()
): LatticeJournal {
  return {
    async append(streamId, events, expectedVersion) {
      const baseEvents = events.map((event, index) =>
        toBaseEvent(streamId, event, expectedVersion + index + 1)
      );
      await eventStore.append(streamId, baseEvents, expectedVersion);
      return expectedVersion + events.length;
    },
    async replay(streamId, fromVersion = 0) {
      const events = await eventStore.getEvents(streamId, fromVersion);
      return events
        .map((event) => event.metadata?.data as LatticeJournalEvent | undefined)
        .filter((event): event is LatticeJournalEvent => event !== undefined);
    },
  };
}

export async function replayLatticeState(
  latticeId: string,
  journal: LatticeJournal,
  options: { readonly timeoutMs?: number } = {}
): Promise<LatticeState> {
  const state = createLatticeState(latticeId, options);
  const events = await journal.replay(latticeId);
  return events.reduce((nextState, event) => applyJournalEvent(nextState, event), state);
}

export function createLatticeActor(
  input:
    | string
    | { readonly latticeId: string; readonly timeoutMs?: number; readonly journal?: LatticeJournal }
) {
  const options = typeof input === 'string' ? { latticeId: input } : input;
  const journal = options.journal;
  let replayed = false;
  let replayPromise: Promise<LatticeState> | null = null;

  const hydrate = async (context: LatticeState): Promise<LatticeState> => {
    if (!journal || replayed) {
      return context;
    }

    replayPromise ??= replayLatticeState(options.latticeId, journal, {
      timeoutMs: options.timeoutMs,
    });
    const replayedState = await replayPromise;
    replayed = true;
    return replayedState;
  };

  return defineBehavior<LatticeMessage, LatticeEvent>()
    .withContext(createLatticeState(options.latticeId, { timeoutMs: options.timeoutMs }))
    .onMessage(async ({ context, message }) => {
      const hydratedContext = await hydrate(context);
      const shellMessage =
        message.type === 'REGISTER_DEPENDENCY' && message.registeredAt === undefined
          ? { ...message, registeredAt: Date.now() }
          : message;
      const result = reduceLatticeMessage(hydratedContext, shellMessage);
      let nextState = result.state;

      if (journal && result.journalEvents.length > 0) {
        const nextVersion = await journal.append(
          hydratedContext.latticeId,
          result.journalEvents,
          hydratedContext.journalVersion
        );
        nextState = {
          ...result.state,
          journalVersion: nextVersion,
        };
      }

      return {
        context: nextState,
        ...(result.emit.length > 0 ? { emit: [...result.emit] } : {}),
        ...(result.reply !== undefined ? { reply: result.reply } : {}),
      };
    });
}
