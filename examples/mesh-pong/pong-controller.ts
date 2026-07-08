import {
  ACTOR_WEB_LLM_TOOL_NAME,
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  type ActorAgentToolRegistry,
  createActorAgentTools,
} from '@actor-web/agent';
import type { ActorToolRegistry } from '@actor-web/runtime/browser';
import { defineBehavior } from '@actor-web/runtime/browser';
import {
  type ControllerCommand,
  PONG_FIELD,
  type PongControllerActorState,
  type PongControllerResult,
  type PongSide,
  type PongSnapshot,
} from './pong-contract';

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
    task: 'Return one paddle move as JSON.',
    side,
    bounds: {
      minAmount: 1,
      maxAmount: PONG_FIELD.paddleStep,
      directions: ['up', 'down'],
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
      direction: 'up | down',
      amount: 'number',
    },
  });
}

function mapFailure(
  side: PongSide,
  result: Extract<ActorAgentLlmResult, { ok: false }>
): PongControllerResult {
  return {
    ok: false,
    side,
    reason: result.error.code === 'LLM_TOOL_UNAVAILABLE' ? 'llm-unavailable' : 'provider-failed',
    error: {
      code: result.error.code,
      message: result.error.message,
    },
  };
}

export function normalizePongControllerAmount(rawAmount: number): number {
  return Math.max(1, Math.min(PONG_FIELD.paddleStep, Math.trunc(rawAmount)));
}

function parseControllerResponse(side: PongSide, content: string): PongControllerResult {
  try {
    const parsed = JSON.parse(content) as { direction?: unknown; amount?: unknown };
    const direction =
      parsed.direction === 'up' || parsed.direction === 'down' ? parsed.direction : null;
    const rawAmount =
      typeof parsed.amount === 'number'
        ? parsed.amount
        : typeof parsed.amount === 'string' && parsed.amount.trim().length > 0
          ? Number(parsed.amount)
          : Number.NaN;
    if (!direction || !Number.isFinite(rawAmount)) {
      return {
        ok: false,
        side,
        reason: 'invalid-response',
        error: {
          code: 'LLM_INVALID_RESPONSE',
          message: 'LLM controller must return JSON with direction and amount.',
        },
      };
    }

    return {
      ok: true,
      provider: 'llm',
      side,
      direction,
      amount: normalizePongControllerAmount(rawAmount),
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

export function createPongControllerBehavior(side: PongSide) {
  return defineBehavior<ControllerCommand>()
    .withTools<ActorAgentToolRegistry>()
    .withContext(createInitialControllerState(side))
    .onMessage(async ({ message, context, tools }) => {
      if (message.type === 'GET_CONTROLLER') {
        return { reply: context };
      }

      const request: ActorAgentLlmRequest = {
        system: 'You are a Pong paddle controller. Reply with JSON only. Do not include markdown.',
        messages: [
          {
            role: 'user',
            content: createControllerPrompt(side, message.snapshot),
          },
        ],
        tools: [],
      };
      const llmResult = await tools.execute<ActorAgentLlmResult, ActorAgentLlmRequest>(
        ACTOR_WEB_LLM_TOOL_NAME,
        request
      );
      const result = llmResult.ok
        ? parseControllerResponse(side, llmResult.value.message.content)
        : mapFailure(side, llmResult);

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
