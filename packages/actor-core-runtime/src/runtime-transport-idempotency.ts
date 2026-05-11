import type { RuntimeNodeIdentity, RuntimeTransportFrame } from './runtime-transport-contract.js';

export interface RuntimeTransportIdempotencyClaimInput {
  readonly scope: string;
  readonly key: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly sequence: number;
  readonly localNode: RuntimeNodeIdentity;
  readonly peerNode: RuntimeNodeIdentity;
}

export type RuntimeTransportIdempotencyClaimResult =
  | { readonly outcome: 'claimed' }
  | { readonly outcome: 'duplicate' };

export interface RuntimeTransportIdempotencyProvider {
  claim(
    input: RuntimeTransportIdempotencyClaimInput
  ): RuntimeTransportIdempotencyClaimResult | Promise<RuntimeTransportIdempotencyClaimResult>;
}

export interface RuntimeTransportIdempotencyFrontCache {
  readonly limit: number;
  has(messageId: string): boolean;
  remember(messageId: string): readonly string[];
}

export type RuntimeTransportIdempotencyClaimOutcome =
  | {
      readonly outcome: 'accepted';
      readonly source: 'memory' | 'provider';
      readonly evictedMessageIds: readonly string[];
      readonly providerClaim?: RuntimeTransportIdempotencyClaimInput;
    }
  | {
      readonly outcome: 'duplicate';
      readonly source: 'memory' | 'provider';
      readonly evictedMessageIds: readonly string[];
      readonly providerClaim?: RuntimeTransportIdempotencyClaimInput;
    }
  | {
      readonly outcome: 'error';
      readonly source: 'provider';
      readonly error: Error;
      readonly providerClaim: RuntimeTransportIdempotencyClaimInput;
    };

export interface InMemoryRuntimeTransportIdempotencyProvider
  extends RuntimeTransportIdempotencyProvider {
  getSnapshot(): Readonly<Record<string, readonly string[]>>;
  clear(): void;
}

export function createRuntimeTransportIdempotencyScope(
  localNode: RuntimeNodeIdentity,
  peerNode: RuntimeNodeIdentity
): string {
  return [
    'runtime-transport',
    'local',
    localNode.nodeAddress,
    localNode.nodeId,
    'peer',
    peerNode.nodeAddress,
    peerNode.nodeId,
  ].join(':');
}

export function createRuntimeTransportIdempotencyClaimInput(
  localNode: RuntimeNodeIdentity,
  peerNode: RuntimeNodeIdentity,
  frame: Pick<RuntimeTransportFrame, 'messageId' | 'sequence' | 'message'>
): RuntimeTransportIdempotencyClaimInput {
  const scope = createRuntimeTransportIdempotencyScope(localNode, peerNode);

  return {
    scope,
    key: `${scope}:message:${frame.messageId}`,
    messageId: frame.messageId,
    messageType: frame.message.type,
    sequence: frame.sequence,
    localNode,
    peerNode,
  };
}

export function createRuntimeTransportIdempotencyFrontCache(
  limit: number
): RuntimeTransportIdempotencyFrontCache {
  const messageIds: string[] = [];
  const messageIdSet = new Set<string>();

  return {
    limit,
    has(messageId: string): boolean {
      return limit > 0 && messageIdSet.has(messageId);
    },
    remember(messageId: string): readonly string[] {
      if (limit <= 0) {
        return [];
      }

      messageIdSet.add(messageId);
      messageIds.push(messageId);
      const evictedMessageIds: string[] = [];

      while (messageIds.length > limit) {
        const evicted = messageIds.shift();
        if (!evicted) {
          continue;
        }

        messageIdSet.delete(evicted);
        evictedMessageIds.push(evicted);
      }

      return evictedMessageIds;
    },
  };
}

export async function claimRuntimeTransportFrameIdempotency(options: {
  readonly cache: RuntimeTransportIdempotencyFrontCache;
  readonly provider?: RuntimeTransportIdempotencyProvider;
  readonly localNode: RuntimeNodeIdentity;
  readonly peerNode: RuntimeNodeIdentity;
  readonly frame: Pick<RuntimeTransportFrame, 'messageId' | 'sequence' | 'message'>;
}): Promise<RuntimeTransportIdempotencyClaimOutcome> {
  if (options.cache.has(options.frame.messageId)) {
    return {
      outcome: 'duplicate',
      source: 'memory',
      evictedMessageIds: [],
    };
  }

  if (!options.provider) {
    return {
      outcome: 'accepted',
      source: 'memory',
      evictedMessageIds: options.cache.remember(options.frame.messageId),
    };
  }

  const providerClaim = createRuntimeTransportIdempotencyClaimInput(
    options.localNode,
    options.peerNode,
    options.frame
  );

  try {
    const result = await options.provider.claim(providerClaim);
    const evictedMessageIds = options.cache.remember(options.frame.messageId);
    return {
      outcome: result.outcome === 'duplicate' ? 'duplicate' : 'accepted',
      source: 'provider',
      evictedMessageIds,
      providerClaim,
    };
  } catch (error) {
    return {
      outcome: 'error',
      source: 'provider',
      error: error instanceof Error ? error : new Error(String(error)),
      providerClaim,
    };
  }
}

export function createInMemoryRuntimeTransportIdempotencyProvider(): InMemoryRuntimeTransportIdempotencyProvider {
  const scopes = new Map<string, Set<string>>();

  return {
    claim(input): RuntimeTransportIdempotencyClaimResult {
      const keys = scopes.get(input.scope) ?? new Set<string>();
      const duplicate = keys.has(input.key);
      keys.add(input.key);
      scopes.set(input.scope, keys);
      return duplicate ? { outcome: 'duplicate' } : { outcome: 'claimed' };
    },
    getSnapshot(): Readonly<Record<string, readonly string[]>> {
      return Object.fromEntries(
        Array.from(scopes.entries()).map(([scope, keys]) => [scope, Array.from(keys.values())])
      );
    },
    clear(): void {
      scopes.clear();
    },
  };
}
