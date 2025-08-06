/**
 * @module actor-core/runtime/ask-pattern-safeguards
 * @description Safeguards and developer experience improvements for ask pattern
 *
 * Provides correlation-based detection that works with any message type,
 * helpful timeout errors, and development warnings.
 */

import { Logger } from './logger.js';

const log = Logger.namespace('ASK_SAFEGUARDS');

/**
 * Custom error for ask pattern timeouts with helpful debugging info
 */
export class AskPatternTimeout extends Error {
  constructor(
    public readonly actorPath: string,
    public readonly messageType: string,
    public readonly timeout: number,
    public readonly correlationId: string
  ) {
    super(
      `Ask pattern timeout after ${timeout}ms.\n\n` +
        `The actor '${actorPath}' did not reply to your ask() request.\n` +
        `Message type: '${messageType}'\n` +
        `Correlation ID: ${correlationId}\n\n` +
        'Possible causes:\n' +
        `1. The handler for '${messageType}' doesn't return a 'reply' field\n` +
        '2. The actor is taking too long to process the message\n' +
        '3. The actor has crashed or is not processing messages\n\n' +
        'To fix missing reply:\n' +
        'onMessage(({ message }) => {\n' +
        `  if (message.type === '${messageType}') {\n` +
        '    // Process your message...\n' +
        '    return {\n' +
        '      context: updatedContext,\n' +
        '      reply: { /* response data */ }\n' +
        '    };\n' +
        '  }\n' +
        '})'
    );
    this.name = 'AskPatternTimeout';
  }
}

/**
 * Configuration for ask pattern safeguards
 */
export interface AskPatternConfig {
  /** Default timeout in milliseconds (default: 5000) */
  defaultTimeout: number;
  /** Enable development warnings (default: true in dev/test) */
  enableDevWarnings: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_ASK_CONFIG: AskPatternConfig = {
  defaultTimeout: 5000,
  enableDevWarnings: isDevelopmentMode(),
};

/**
 * Check if we're in development or test mode
 */
export function isDevelopmentMode(): boolean {
  const env = process.env.NODE_ENV;
  return env === 'development' || env === 'test' || !env;
}

/**
 * Validate ask pattern response in OTP processor
 * Called after processing message handler result
 */
export function validateAskResponse(
  result: { reply?: unknown; context?: unknown },
  actorPath: string,
  messageType: string,
  correlationId: string | undefined
): void {
  // Only validate if this is an ask request (has correlationId)
  if (!correlationId) {
    return;
  }

  // This is definitely an ask - check for reply
  if (!('reply' in result)) {
    const warning =
      `⚠️  ASK PATTERN WARNING: Missing 'reply' field\n` +
      `   Actor: '${actorPath}'\n` +
      `   Message type: '${messageType}'\n` +
      `   Correlation ID: ${correlationId}\n\n` +
      `   This message was sent using ask() but the handler didn't return a reply.\n` +
      '   To fix: return { context, reply: <your-response-data> }\n\n' +
      `   Example for '${messageType}':\n` +
      '   return {\n' +
      '     context: updatedContext,\n' +
      `     reply: { /* your ${messageType} response */ }\n` +
      '   };';

    // In development, show console warning
    if (DEFAULT_ASK_CONFIG.enableDevWarnings) {
      console.warn(warning);
    }

    // Always log for debugging
    log.warn('Ask pattern used but no reply field returned', {
      actorPath,
      messageType,
      correlationId,
      hasReply: false,
      hasContext: 'context' in result,
    });
  }
}

/**
 * Create a timeout promise for ask pattern
 */
export function createAskTimeout(
  actorPath: string,
  messageType: string,
  correlationId: string,
  timeout: number = DEFAULT_ASK_CONFIG.defaultTimeout
): { promise: Promise<never>; cancel: () => void } {
  let timeoutId: NodeJS.Timeout | undefined;

  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new AskPatternTimeout(actorPath, messageType, timeout, correlationId));
    }, timeout);
  });

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return { promise, cancel };
}

/**
 * Update ask pattern configuration
 */
export function updateAskConfig(config: Partial<AskPatternConfig>): void {
  Object.assign(DEFAULT_ASK_CONFIG, config);
  log.info('Ask pattern configuration updated', DEFAULT_ASK_CONFIG);
}
