import type { JsonValue } from './types.js';

export type SessionActorFailureCode =
  | 'invalid_transition'
  | 'provider_error'
  | 'provider_required'
  | 'session_closed'
  | 'session_missing'
  | 'turn_active'
  | 'turn_missing';

export interface SessionActorFailure {
  readonly code: SessionActorFailureCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: JsonValue;
}

export interface SessionActorSessionProjection {
  readonly id: string;
  readonly status: 'open' | 'closed';
  readonly openedAt: string;
  readonly closedAt: string | null;
}

export interface SessionActorProviderProjection {
  readonly id: string;
  readonly attachedAt: string;
  readonly metadata?: JsonValue;
}

export interface SessionActorTurnProjection {
  readonly id: string;
  readonly status: 'active' | 'completed' | 'cancelled' | 'failed';
  readonly submittedAt: string;
  readonly output: string;
  readonly sequence: number;
  readonly checkpoint: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly failedAt: string | null;
  readonly cancelReason: string | null;
  readonly failure: SessionActorFailure | null;
  readonly input: JsonValue;
}

export interface SessionCreatedFact {
  readonly type: 'SESSION_CREATED';
  readonly sessionId: string;
  readonly openedAt: string;
}

export interface ProviderAttachedFact {
  readonly type: 'PROVIDER_ATTACHED';
  readonly sessionId: string;
  readonly providerId: string;
  readonly attachedAt: string;
  readonly metadata?: JsonValue;
}

export interface TurnSubmittedFact {
  readonly type: 'TURN_SUBMITTED';
  readonly sessionId: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly submittedAt: string;
  readonly input: JsonValue;
}

export interface ProviderDeltaFact {
  readonly type: 'PROVIDER_DELTA';
  readonly sessionId: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly delta: string;
  readonly checkpoint: string | null;
  readonly observedAt: string;
}

export interface TurnCompletedFact {
  readonly type: 'TURN_COMPLETED';
  readonly sessionId: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly checkpoint: string | null;
  readonly completedAt: string;
  readonly output: string;
}

export interface TurnCancelledFact {
  readonly type: 'TURN_CANCELLED';
  readonly sessionId: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly checkpoint: string | null;
  readonly cancelledAt: string;
  readonly reason?: string;
}

export interface TurnFailedFact {
  readonly type: 'TURN_FAILED';
  readonly sessionId: string;
  readonly providerId: string;
  readonly turnId: string;
  readonly sequence: number;
  readonly checkpoint: string | null;
  readonly failedAt: string;
  readonly failure: SessionActorFailure;
}

export interface SessionClosedFact {
  readonly type: 'SESSION_CLOSED';
  readonly sessionId: string;
  readonly closedAt: string;
}

export interface CommandRejectedFact {
  readonly type: 'COMMAND_REJECTED';
  readonly sessionId: string | null;
  readonly command: NodeSessionActorCommand['type'];
  readonly observedAt: string;
  readonly failure: SessionActorFailure;
}

export type SessionActorFact =
  | SessionCreatedFact
  | ProviderAttachedFact
  | TurnSubmittedFact
  | ProviderDeltaFact
  | TurnCompletedFact
  | TurnCancelledFact
  | TurnFailedFact
  | SessionClosedFact
  | CommandRejectedFact;

export type SessionActorObservedProviderFact =
  | {
      readonly type: 'PROVIDER_DELTA';
      readonly turnId: string;
      readonly sequence: number;
      readonly delta: string;
      readonly checkpoint: string | null;
      readonly observedAt: string;
    }
  | {
      readonly type: 'TURN_COMPLETED';
      readonly turnId: string;
      readonly sequence: number;
      readonly checkpoint: string | null;
      readonly completedAt: string;
      readonly output: string;
    }
  | {
      readonly type: 'TURN_CANCELLED';
      readonly turnId: string;
      readonly sequence: number;
      readonly checkpoint: string | null;
      readonly cancelledAt: string;
      readonly reason?: string;
    }
  | {
      readonly type: 'TURN_FAILED';
      readonly turnId: string;
      readonly sequence: number;
      readonly checkpoint: string | null;
      readonly failedAt: string;
      readonly failure: SessionActorFailure;
    };

export type NodeSessionActorCommand =
  | {
      readonly type: 'CREATE_SESSION';
      readonly sessionId: string;
      readonly openedAt: string;
    }
  | {
      readonly type: 'ATTACH_PROVIDER';
      readonly providerId: string;
      readonly attachedAt: string;
      readonly metadata?: JsonValue;
    }
  | {
      readonly type: 'SUBMIT_TURN';
      readonly turnId: string;
      readonly submittedAt: string;
      readonly input: JsonValue;
    }
  | {
      readonly type: 'CANCEL_TURN';
      readonly cancelledAt: string;
      readonly reason?: string;
    }
  | {
      readonly type: 'CLOSE_SESSION';
      readonly closedAt: string;
    }
  | {
      readonly type: 'OBSERVE_PROVIDER_FACT';
      readonly fact: SessionActorObservedProviderFact;
    };

export interface NodeSessionActorProjection {
  readonly session: SessionActorSessionProjection | null;
  readonly provider: SessionActorProviderProjection | null;
  readonly turn: SessionActorTurnProjection | null;
  readonly checkpoint: string | null;
  readonly lastFact: SessionActorFact | null;
  readonly failure: SessionActorFailure | null;
}

export interface NodeSessionActor {
  dispatch(command: NodeSessionActorCommand): Promise<NodeSessionActorProjection>;
  getSnapshot(): NodeSessionActorProjection;
}

export function createSessionActorFailure(input: SessionActorFailure): SessionActorFailure {
  return input.details === undefined ? { ...input } : { ...input, details: input.details };
}
