import {
  ACTOR_WEB_LLM_TOOL_NAME,
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  type ActorAgentToolRegistry,
  createActorAgentTools,
} from '@actor-web/agent';
import type { ActorToolRegistry } from '@actor-web/runtime/browser';
import { ActorToolTimeoutError, defineBehavior } from '@actor-web/runtime/browser';
import {
  type ControllerCommand,
  createPlannerStrategy,
  PONG_FIELD,
  type PongControllerActorState,
  type PongControllerResult,
  type PongSide,
  type PongSnapshot,
} from './pong-contract';

export const CONTROLLER_LLM_TIMEOUT_MS = 1500;

function createInitialControllerState(side: PongSide): PongControllerActorState {
  return {
    side,
    lastResult: null,
  };
}

const unavailableLlmProvider: ActorAgentLlmProvider = () => ({
  ok: false,
  error: {
    code: 'LLM_TOOL_UNAVAILABLE',
    message: 'Actor tool "llm" is not registered.',
  },
});

function createControllerPrompt(side: PongSide, snapshot: PongSnapshot): string {
  return JSON.stringify({
    task: 'Return one low-frequency Pong planner strategy as JSON.',
    side,
    strategy: {
      targetY: `0..${PONG_FIELD.height - PONG_FIELD.paddleHeight}`,
      biasY: `-${PONG_FIELD.paddleHeight}..${PONG_FIELD.paddleHeight}`,
      maxStep: `1..${PONG_FIELD.paddleStep}`,
      label: 'short reason string',
      facts: ['short fact strings'],
    },
    snapshot: {
      ball: snapshot.ball,
      paddles: snapshot.paddles,
      score: {
        left: snapshot.score.left,
        right: snapshot.score.right,
      },
    },
    response: {
      targetY: 'number',
      biasY: 'number',
      maxStep: 'number',
      label: 'string',
      facts: 'string[]',
    },
  });
}

export function createPongControllerRequest(
  side: PongSide,
  snapshot: PongSnapshot
): ActorAgentLlmRequest {
  return {
    system: 'You are a Pong paddle controller. Reply with JSON only. Do not include markdown.',
    messages: [
      {
        role: 'user',
        content: createControllerPrompt(side, snapshot),
      },
    ],
    tools: [],
  };
}

function mapFailure(
  side: PongSide,
  result: Extract<ActorAgentLlmResult, { ok: false }>
): PongControllerResult {
  const timedOut = result.error.code === 'LLM_TOOL_TIMEOUT' || result.error.code === 'LLM_TIMEOUT';
  return {
    ok: false,
    side,
    reason:
      result.error.code === 'LLM_TOOL_UNAVAILABLE'
        ? 'llm-unavailable'
        : timedOut
          ? 'timeout'
          : 'provider-failed',
    error: {
      code: result.error.code,
      message: result.error.message,
    },
  };
}

function mapThrownProviderError(
  side: PongSide,
  error: unknown,
  timedOut: boolean
): PongControllerResult {
  const timeoutError = timedOut || error instanceof ActorToolTimeoutError;
  return {
    ok: false,
    side,
    reason: timeoutError ? 'timeout' : 'provider-failed',
    error: {
      code: timeoutError ? 'LLM_TIMEOUT' : 'LLM_PROVIDER_ERROR',
      message: timedOut
        ? `Pong controller timed out after ${CONTROLLER_LLM_TIMEOUT_MS}ms.`
        : error instanceof Error
          ? error.message
          : 'LLM provider threw unexpectedly.',
    },
  };
}

export function normalizePongControllerAmount(rawAmount: number): number {
  return Math.max(1, Math.min(PONG_FIELD.paddleStep, Math.trunc(rawAmount)));
}

function parseControllerResponse(side: PongSide, content: string): PongControllerResult {
  try {
    const parsed = JSON.parse(content) as {
      targetY?: unknown;
      biasY?: unknown;
      maxStep?: unknown;
      label?: unknown;
      facts?: unknown;
    };
    const targetY =
      typeof parsed.targetY === 'number'
        ? parsed.targetY
        : typeof parsed.targetY === 'string' && parsed.targetY.trim().length > 0
          ? Number(parsed.targetY)
          : Number.NaN;
    const biasY =
      typeof parsed.biasY === 'number'
        ? parsed.biasY
        : typeof parsed.biasY === 'string' && parsed.biasY.trim().length > 0
          ? Number(parsed.biasY)
          : 0;
    const maxStep =
      typeof parsed.maxStep === 'number'
        ? parsed.maxStep
        : typeof parsed.maxStep === 'string' && parsed.maxStep.trim().length > 0
          ? Number(parsed.maxStep)
          : PONG_FIELD.paddleStep;
    if (!Number.isFinite(targetY) || !Number.isFinite(biasY) || !Number.isFinite(maxStep)) {
      return {
        ok: false,
        side,
        reason: 'invalid-response',
        error: {
          code: 'LLM_INVALID_RESPONSE',
          message: 'LLM controller must return JSON with targetY, biasY, and maxStep.',
        },
      };
    }

    return {
      ok: true,
      provider: 'llm',
      side,
      strategy: createPlannerStrategy(side, {
        targetY,
        biasY,
        maxStep,
        label:
          typeof parsed.label === 'string' && parsed.label.trim().length > 0
            ? parsed.label.trim()
            : 'planner-target',
        facts: Array.isArray(parsed.facts)
          ? parsed.facts.filter((fact): fact is string => typeof fact === 'string')
          : [],
      }),
    };
  } catch {
    return {
      ok: false,
      side,
      reason: 'invalid-response',
      error: {
        code: 'LLM_INVALID_RESPONSE',
        message: 'LLM controller must return valid JSON.',
      },
    };
  }
}

export async function runPongControllerWithLlmProvider(
  side: PongSide,
  snapshot: PongSnapshot,
  provider: ActorAgentLlmProvider,
  timeoutMs = CONTROLLER_LLM_TIMEOUT_MS
): Promise<PongControllerResult> {
  const abortController = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      abortController.abort();
      reject(new Error('Pong controller timeout.'));
    }, timeoutMs);
  });
  try {
    const controllerResult = Promise.resolve(
      provider(createPongControllerRequest(side, snapshot), {
        actorId: `mesh-pong-controller-${side}`,
        nodeAddress: 'browser',
        signal: abortController.signal,
      })
    ).then((llmResult) =>
      llmResult.ok
        ? parseControllerResponse(side, llmResult.value.message.content)
        : mapFailure(side, llmResult)
    );
    return await Promise.race([controllerResult, timeout]);
  } catch (error) {
    return mapThrownProviderError(side, error, timedOut);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

export function createPongControllerBehavior(side: PongSide) {
  return defineBehavior<ControllerCommand>()
    .withTools<ActorAgentToolRegistry>()
    .withContext(createInitialControllerState(side))
    .onMessage(async ({ message, context, tools }) => {
      if (message.type === 'GET_CONTROLLER') {
        return { reply: context };
      }

      const result = await runPongControllerWithLlmProvider(
        side,
        message.snapshot,
        (request, _context) =>
          tools.execute<ActorAgentLlmResult, ActorAgentLlmRequest>(
            ACTOR_WEB_LLM_TOOL_NAME,
            request,
            {
              timeoutMs: CONTROLLER_LLM_TIMEOUT_MS,
            }
          ),
        CONTROLLER_LLM_TIMEOUT_MS + 1
      );

      return {
        context: {
          side,
          lastResult: result,
        },
        reply: result,
      };
    })
    .build();
}

export function createPongControllerTools(tools?: ActorToolRegistry): ActorToolRegistry {
  return {
    ...createActorAgentTools({ llm: unavailableLlmProvider }),
    ...(tools ?? {}),
  };
}
