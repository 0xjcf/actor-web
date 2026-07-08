import {
  type ActorAgentLlmProvider,
  type ActorAgentLlmRequest,
  type ActorAgentLlmResult,
  createActorAgentTools,
} from '@actor-web/agent';
import type { ActorToolRegistry } from '@actor-web/runtime/browser';

export interface StorageLike {
  getItem(key: string): string | null;
}

export interface MeshPongMlxProviderConfig {
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey?: string;
}

export interface OpenAiChatCompletionResponse {
  readonly choices?: Array<{
    readonly message?: {
      readonly content?: string | null;
    };
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly total_tokens?: number;
  };
}

export const MESH_PONG_MLX_ENABLED_KEY = 'actor-web.mesh-pong.mlx.enabled';
export const MESH_PONG_MLX_ENDPOINT_KEY = 'actor-web.mesh-pong.mlx.endpoint';
export const MESH_PONG_MLX_MODEL_KEY = 'actor-web.mesh-pong.mlx.model';
export const MESH_PONG_MLX_API_KEY = 'actor-web.mesh-pong.mlx.api-key';
export const DEFAULT_MESH_PONG_MLX_ENDPOINT = 'http://127.0.0.1:8080/v1';
export const DEFAULT_MESH_PONG_MLX_MODEL = 'mlx-community/Llama-3.2-3B-Instruct-4bit';
export const DEFAULT_MESH_PONG_MLX_TIMEOUT_MS = 20_000;
export const DEFAULT_MESH_PONG_MLX_MAX_TOKENS = 24;

function readStorageValue(storage: StorageLike | undefined, key: string): string | undefined {
  try {
    const value = storage?.getItem(key);
    return value?.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function readEnvValue(key: string): string | undefined {
  const env = (
    import.meta as ImportMeta & {
      readonly env?: Record<string, string | undefined>;
    }
  ).env;
  const value = env?.[key];
  return value?.trim() ? value.trim() : undefined;
}

function parseEnabled(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}

export function resolveBrowserMlxProviderConfig(storage?: StorageLike): MeshPongMlxProviderConfig {
  return {
    enabled: parseEnabled(
      readStorageValue(storage, MESH_PONG_MLX_ENABLED_KEY) ??
        readEnvValue('VITE_MESH_PONG_MLX_ENABLED')
    ),
    endpoint: normalizeEndpoint(
      readStorageValue(storage, MESH_PONG_MLX_ENDPOINT_KEY) ??
        readEnvValue('VITE_MESH_PONG_MLX_ENDPOINT') ??
        DEFAULT_MESH_PONG_MLX_ENDPOINT
    ),
    model:
      readStorageValue(storage, MESH_PONG_MLX_MODEL_KEY) ??
      readEnvValue('VITE_MESH_PONG_MLX_MODEL') ??
      DEFAULT_MESH_PONG_MLX_MODEL,
    apiKey:
      readStorageValue(storage, MESH_PONG_MLX_API_KEY) ??
      readEnvValue('VITE_MESH_PONG_MLX_API_KEY'),
  };
}

function unavailableResult(message: string): Extract<ActorAgentLlmResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code: 'LLM_TOOL_UNAVAILABLE',
      message,
    },
  };
}

function providerFailure(
  message: string,
  cause?: unknown
): Extract<ActorAgentLlmResult, { ok: false }> {
  return {
    ok: false,
    error: {
      code: 'LLM_PROVIDER_FAILED',
      message,
      cause,
    },
  };
}

function requestMessages(request: ActorAgentLlmRequest) {
  return [
    ...(request.system ? [{ role: 'system' as const, content: request.system }] : []),
    ...request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function createBrowserMlxLlmProvider(
  input: {
    readonly config?: MeshPongMlxProviderConfig;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {}
): ActorAgentLlmProvider {
  const config = input.config ?? resolveBrowserMlxProviderConfig();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_MESH_PONG_MLX_TIMEOUT_MS;

  return async (request) => {
    if (!config.enabled) {
      return unavailableResult(
        `Enable local MLX with ${MESH_PONG_MLX_ENABLED_KEY}=true or VITE_MESH_PONG_MLX_ENABLED=true.`
      );
    }
    if (typeof fetchImpl !== 'function') {
      return unavailableResult('Fetch is unavailable in this runtime.');
    }

    const abortController = new AbortController();
    const timeoutId = globalThis.setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(`${config.endpoint}/chat/completions`, {
        method: 'POST',
        signal: abortController.signal,
        headers: {
          'content-type': 'application/json',
          ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          messages: requestMessages(request),
          temperature: 0,
          max_tokens: DEFAULT_MESH_PONG_MLX_MAX_TOKENS,
          chat_template_kwargs: { enable_thinking: false },
        }),
      });
      globalThis.clearTimeout(timeoutId);

      if (!response.ok) {
        return providerFailure(
          `Local MLX endpoint ${config.endpoint} responded ${response.status} ${response.statusText}.`
        );
      }

      const json = (await response.json()) as OpenAiChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        return providerFailure('Local MLX endpoint returned no assistant message content.', json);
      }

      return {
        ok: true,
        value: {
          message: {
            role: 'assistant',
            content,
          },
          ...(json.usage
            ? {
                usage: {
                  inputTokens: json.usage.prompt_tokens,
                  outputTokens: json.usage.completion_tokens,
                  totalTokens: json.usage.total_tokens,
                },
              }
            : {}),
        },
      };
    } catch (error) {
      globalThis.clearTimeout(timeoutId);
      if (isAbortError(error)) {
        return providerFailure(
          `Local MLX request timed out after ${timeoutMs}ms for ${config.endpoint}/chat/completions.`,
          error
        );
      }
      return providerFailure(
        `Local MLX request failed for ${config.endpoint}/chat/completions.`,
        error
      );
    }
  };
}

export function createBrowserMlxTools(
  input: { readonly storage?: StorageLike; readonly fetchImpl?: typeof fetch } = {}
): ActorToolRegistry {
  return createActorAgentTools({
    llm: createBrowserMlxLlmProvider({
      config: resolveBrowserMlxProviderConfig(input.storage),
      fetchImpl: input.fetchImpl,
    }),
  });
}
