import { describe, expect, it } from 'vitest';
import type {
  NodeSessionActor,
  NodeSessionActorCommand,
  NodeSessionActorProjection,
  SessionActorObservedProviderFact,
} from '../node-session-actor-contract.js';

type DeltaFact = Extract<SessionActorObservedProviderFact, { type: 'PROVIDER_DELTA' }>;
type CompletedFact = Extract<SessionActorObservedProviderFact, { type: 'TURN_COMPLETED' }>;
type FailedFact = Extract<SessionActorObservedProviderFact, { type: 'TURN_FAILED' }>;

export interface SessionActorConformanceScenario {
  readonly actor: NodeSessionActor;
  readonly sessionId: string;
  readonly providerId: string;
  readonly firstTurnId: string;
  readonly secondTurnId: string;
  readonly openedAt: string;
  readonly attachedAt: string;
  readonly submittedAt: string;
  readonly deltaObservedAt: string;
  readonly completedAt: string;
  readonly cancelledAt: string;
  readonly failedAt: string;
  readonly closedAt: string;
}

export interface SessionActorConformanceHarness {
  readonly name: string;
  createScenario(): SessionActorConformanceScenario;
}

function projectCore(snapshot: NodeSessionActorProjection) {
  return {
    session: snapshot.session,
    provider: snapshot.provider,
    turn: snapshot.turn,
    checkpoint: snapshot.checkpoint,
  };
}

function expectCoreProjectionUnchanged(
  previous: NodeSessionActorProjection,
  current: NodeSessionActorProjection
): void {
  expect(projectCore(current)).toEqual(projectCore(previous));
}

function createSession(
  scenario: SessionActorConformanceScenario
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'CREATE_SESSION',
    sessionId: scenario.sessionId,
    openedAt: scenario.openedAt,
  });
}

function attachProvider(
  scenario: SessionActorConformanceScenario
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'ATTACH_PROVIDER',
    providerId: scenario.providerId,
    attachedAt: scenario.attachedAt,
    metadata: {
      label: 'fake-provider',
    },
  });
}

function submitTurn(
  scenario: SessionActorConformanceScenario,
  turnId = scenario.firstTurnId
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'SUBMIT_TURN',
    turnId,
    submittedAt: scenario.submittedAt,
    input: {
      prompt: `prompt:${turnId}`,
    },
  });
}

function observeProviderFact(
  scenario: SessionActorConformanceScenario,
  fact: SessionActorObservedProviderFact
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'OBSERVE_PROVIDER_FACT',
    fact,
  });
}

function cancelTurn(
  scenario: SessionActorConformanceScenario
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'CANCEL_TURN',
    cancelledAt: scenario.cancelledAt,
    reason: 'operator_requested',
  });
}

function closeSession(
  scenario: SessionActorConformanceScenario
): Promise<NodeSessionActorProjection> {
  return scenario.actor.dispatch({
    type: 'CLOSE_SESSION',
    closedAt: scenario.closedAt,
  });
}

function createDeltaFact(
  scenario: SessionActorConformanceScenario,
  overrides: Partial<DeltaFact> = {}
): DeltaFact {
  return {
    type: 'PROVIDER_DELTA',
    turnId: scenario.firstTurnId,
    sequence: 1,
    delta: 'Hello',
    checkpoint: 'checkpoint:delta:1',
    observedAt: scenario.deltaObservedAt,
    ...overrides,
  };
}

function createCompletedFact(
  scenario: SessionActorConformanceScenario,
  overrides: Partial<CompletedFact> = {}
): CompletedFact {
  return {
    type: 'TURN_COMPLETED',
    turnId: scenario.firstTurnId,
    sequence: 2,
    checkpoint: 'checkpoint:terminal:completed',
    completedAt: scenario.completedAt,
    output: 'Hello world',
    ...overrides,
  };
}

function createFailedFact(
  scenario: SessionActorConformanceScenario,
  overrides: Partial<FailedFact> = {}
): FailedFact {
  return {
    type: 'TURN_FAILED',
    turnId: scenario.firstTurnId,
    sequence: 2,
    checkpoint: 'checkpoint:terminal:failed',
    failedAt: scenario.failedAt,
    failure: {
      code: 'provider_error',
      message: 'Provider crashed',
      retryable: true,
      details: {
        exitCode: 137,
      },
    },
    ...overrides,
  };
}

function expectRejected(
  snapshot: NodeSessionActorProjection,
  command: NodeSessionActorCommand['type']
): void {
  expect(snapshot.failure).toMatchObject({
    code: 'invalid_transition',
    retryable: false,
  });
  expect(snapshot.lastFact).toMatchObject({
    type: 'COMMAND_REJECTED',
    command,
    failure: {
      code: 'invalid_transition',
    },
  });
}

export function describeSessionActorConformance(harness: SessionActorConformanceHarness): void {
  describe(`SessionActor conformance: ${harness.name}`, () => {
    it('creates an open session and emits SESSION_CREATED', async () => {
      const scenario = harness.createScenario();

      const created = await createSession(scenario);
      expect(created.session).toEqual({
        id: scenario.sessionId,
        status: 'open',
        openedAt: scenario.openedAt,
        closedAt: null,
      });
      expect(created.lastFact).toEqual({
        type: 'SESSION_CREATED',
        sessionId: scenario.sessionId,
        openedAt: scenario.openedAt,
      });
      expect(created.failure).toBeNull();
    });

    it('attaches a provider and emits PROVIDER_ATTACHED', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      const attached = await attachProvider(scenario);
      expect(attached.provider).toEqual({
        id: scenario.providerId,
        attachedAt: scenario.attachedAt,
        metadata: {
          label: 'fake-provider',
        },
      });
      expect(attached.lastFact).toEqual({
        type: 'PROVIDER_ATTACHED',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        attachedAt: scenario.attachedAt,
        metadata: {
          label: 'fake-provider',
        },
      });
    });

    it('submits a turn only when the session is open and a provider is attached', async () => {
      const scenario = harness.createScenario();

      const missingSession = await submitTurn(scenario);
      expectRejected(missingSession, 'SUBMIT_TURN');

      await createSession(scenario);
      const missingProvider = await submitTurn(scenario);
      expectRejected(missingProvider, 'SUBMIT_TURN');

      await attachProvider(scenario);
      const submitted = await submitTurn(scenario);
      expect(submitted.turn).toMatchObject({
        id: scenario.firstTurnId,
        status: 'active',
        submittedAt: scenario.submittedAt,
        output: '',
        sequence: 0,
        checkpoint: null,
        failure: null,
      });
      expect(submitted.lastFact).toEqual({
        type: 'TURN_SUBMITTED',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        turnId: scenario.firstTurnId,
        submittedAt: scenario.submittedAt,
        input: {
          prompt: `prompt:${scenario.firstTurnId}`,
        },
      });
    });

    it('applies provider deltas by appending output and advancing sequence/checkpoint', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      const delta = await observeProviderFact(scenario, createDeltaFact(scenario));
      expect(delta.turn).toMatchObject({
        id: scenario.firstTurnId,
        status: 'active',
        output: 'Hello',
        sequence: 1,
        checkpoint: 'checkpoint:delta:1',
      });
      expect(delta.checkpoint).toBe('checkpoint:delta:1');
      expect(delta.lastFact).toEqual({
        type: 'PROVIDER_DELTA',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        turnId: scenario.firstTurnId,
        sequence: 1,
        delta: 'Hello',
        checkpoint: 'checkpoint:delta:1',
        observedAt: scenario.deltaObservedAt,
      });
    });

    it('completes a turn from provider facts and keeps the session open', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      await observeProviderFact(scenario, createDeltaFact(scenario));
      const completed = await observeProviderFact(scenario, createCompletedFact(scenario));
      expect(completed.turn).toMatchObject({
        id: scenario.firstTurnId,
        status: 'completed',
        output: 'Hello world',
        sequence: 2,
        checkpoint: 'checkpoint:terminal:completed',
        completedAt: scenario.completedAt,
      });
      expect(completed.session?.status).toBe('open');
      expect(completed.checkpoint).toBe('checkpoint:terminal:completed');
      expect(completed.lastFact).toEqual({
        type: 'TURN_COMPLETED',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        turnId: scenario.firstTurnId,
        sequence: 2,
        checkpoint: 'checkpoint:terminal:completed',
        completedAt: scenario.completedAt,
        output: 'Hello world',
      });
    });

    it('cancels the active turn and leaves the session open', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      await observeProviderFact(scenario, createDeltaFact(scenario));
      const cancelled = await cancelTurn(scenario);
      expect(cancelled.turn).toMatchObject({
        id: scenario.firstTurnId,
        status: 'cancelled',
        output: 'Hello',
        sequence: 1,
        checkpoint: 'checkpoint:delta:1',
        cancelledAt: scenario.cancelledAt,
        cancelReason: 'operator_requested',
      });
      expect(cancelled.session?.status).toBe('open');
      expect(cancelled.lastFact).toEqual({
        type: 'TURN_CANCELLED',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        turnId: scenario.firstTurnId,
        sequence: 1,
        checkpoint: 'checkpoint:delta:1',
        cancelledAt: scenario.cancelledAt,
        reason: 'operator_requested',
      });
    });

    it('projects provider failures as TURN_FAILED data and keeps the session open', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      await observeProviderFact(scenario, createDeltaFact(scenario));
      const failed = await observeProviderFact(scenario, createFailedFact(scenario));
      expect(failed.turn).toMatchObject({
        id: scenario.firstTurnId,
        status: 'failed',
        output: 'Hello',
        sequence: 2,
        checkpoint: 'checkpoint:terminal:failed',
        failedAt: scenario.failedAt,
        failure: {
          code: 'provider_error',
          message: 'Provider crashed',
          retryable: true,
        },
      });
      expect(failed.session?.status).toBe('open');
      expect(failed.lastFact).toEqual({
        type: 'TURN_FAILED',
        sessionId: scenario.sessionId,
        providerId: scenario.providerId,
        turnId: scenario.firstTurnId,
        sequence: 2,
        checkpoint: 'checkpoint:terminal:failed',
        failedAt: scenario.failedAt,
        failure: {
          code: 'provider_error',
          message: 'Provider crashed',
          retryable: true,
          details: {
            exitCode: 137,
          },
        },
      });
    });

    it('closes an idle session and rejects repeat submit/cancel/close commands as data', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      await observeProviderFact(scenario, createCompletedFact(scenario));
      const closed = await closeSession(scenario);
      expect(closed.session).toEqual({
        id: scenario.sessionId,
        status: 'closed',
        openedAt: scenario.openedAt,
        closedAt: scenario.closedAt,
      });
      expect(closed.lastFact).toEqual({
        type: 'SESSION_CLOSED',
        sessionId: scenario.sessionId,
        closedAt: scenario.closedAt,
      });

      const closedAgain = await closeSession(scenario);
      expectRejected(closedAgain, 'CLOSE_SESSION');
      const submitAfterClose = await submitTurn(scenario, scenario.secondTurnId);
      expectRejected(submitAfterClose, 'SUBMIT_TURN');
      const cancelAfterClose = await cancelTurn(scenario);
      expectRejected(cancelAfterClose, 'CANCEL_TURN');
    });

    it('rejects close while a turn is active and preserves the valid projection', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      const active = await submitTurn(scenario);
      const rejected = await closeSession(scenario);
      expectRejected(rejected, 'CLOSE_SESSION');
      expectCoreProjectionUnchanged(active, rejected);
      expect(rejected.session?.status).toBe('open');
    });

    it('keeps the last valid projection intact on invalid provider facts and duplicate active submits', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      const active = await submitTurn(scenario);

      const duplicateSubmit = await submitTurn(scenario, scenario.secondTurnId);
      expectRejected(duplicateSubmit, 'SUBMIT_TURN');
      expectCoreProjectionUnchanged(active, duplicateSubmit);

      const mismatchedTurn = await observeProviderFact(
        scenario,
        createDeltaFact(scenario, {
          turnId: 'turn:other',
        })
      );
      expectRejected(mismatchedTurn, 'OBSERVE_PROVIDER_FACT');
      expectCoreProjectionUnchanged(active, mismatchedTurn);
    });

    it('rejects duplicate deltas and stale terminal provider facts without mutating the turn', async () => {
      const scenario = harness.createScenario();

      await createSession(scenario);
      await attachProvider(scenario);
      await submitTurn(scenario);
      const delta = await observeProviderFact(scenario, createDeltaFact(scenario));

      const duplicateDelta = await observeProviderFact(scenario, createDeltaFact(scenario));
      expectRejected(duplicateDelta, 'OBSERVE_PROVIDER_FACT');
      expectCoreProjectionUnchanged(delta, duplicateDelta);

      const staleCompleted = await observeProviderFact(
        scenario,
        createCompletedFact(scenario, {
          sequence: 1,
          checkpoint: 'checkpoint:terminal:stale',
        })
      );
      expectRejected(staleCompleted, 'OBSERVE_PROVIDER_FACT');
      expectCoreProjectionUnchanged(delta, staleCompleted);
    });
  });
}
