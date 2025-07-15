/**
 * @module actor-core/runtime/logger
 * @description Simple logger utility for development debugging
 */

let isDevModeEnabled = false;

/**
 * Enable development mode for logging
 */
export function enableDevMode(): void {
  isDevModeEnabled = true;
}

/**
 * Force enable development mode for CLI/Node.js environments
 * This bypasses browser checks and enables logging
 */
export function enableDevModeForCLI(): void {
  isDevModeEnabled = true;
}

/**
 * Check if development mode is enabled
 */
export function isDevMode(): boolean {
  return isDevModeEnabled;
}

/**
 * Reset development mode (for testing)
 */
export function resetDevMode(): void {
  isDevModeEnabled = false;
}

/**
 * Scoped logger interface for a specific namespace
 */
export interface ScopedLogger {
  debug: (message: string, data?: unknown) => void;
  info: (message: string, data?: unknown) => void;
  warn: (message: string, data?: unknown) => void;
  error: (message: string, error?: unknown) => void;
  group: (title: string) => void;
  groupEnd: () => void;
}

/**
 * Simple logger utility for development debugging
 */
export const Logger = {
  debug: (namespace: string, message: string, data?: unknown) => {
    if (isDevModeEnabled && typeof console !== 'undefined') {
      console.log(`🐛 [${namespace}] ${message}`, data ? data : '');
    }
  },

  info: (namespace: string, message: string, data?: unknown) => {
    // Respect debug mode and check for test environment
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const debugEnabled = isDevModeEnabled || (isTestEnv && process.env.DEBUG_TESTS === 'true');

    if (debugEnabled && typeof console !== 'undefined') {
      console.log(`ℹ️  [${namespace}] ${message}`, data ? data : '');
    }
  },

  warn: (namespace: string, message: string, data?: unknown) => {
    // Keep warnings visible unless specifically silenced in tests
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const shouldLog = !isTestEnv || process.env.DEBUG_TESTS === 'true' || isDevModeEnabled;

    if (shouldLog && typeof console !== 'undefined') {
      console.warn(`⚠️  [${namespace}] ${message}`, data ? data : '');
    }
  },

  error: (namespace: string, message: string, error?: unknown) => {
    // Always show errors, but allow silencing in tests
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const shouldLog = !isTestEnv || process.env.DEBUG_TESTS === 'true' || isDevModeEnabled;

    if (shouldLog && typeof console !== 'undefined') {
      console.error(`❌ [${namespace}] ${message}`, error ? error : '');
    }
  },

  group: (namespace: string, title: string) => {
    if (isDevModeEnabled && typeof console !== 'undefined') {
      console.group(`🔍 [${namespace}] ${title}`);
    }
  },

  groupEnd: () => {
    if (isDevModeEnabled && typeof console !== 'undefined') {
      console.groupEnd();
    }
  },

  /**
   * Create a scoped logger for a specific namespace
   * @param namespace - The namespace to use for all log messages
   * @returns A scoped logger that doesn't require passing namespace each time
   */
  namespace: (namespace: string): ScopedLogger => ({
    debug: (message: string, data?: unknown) => Logger.debug(namespace, message, data),
    info: (message: string, data?: unknown) => Logger.info(namespace, message, data),
    warn: (message: string, data?: unknown) => Logger.warn(namespace, message, data),
    error: (message: string, error?: unknown) => Logger.error(namespace, message, error),
    group: (title: string) => Logger.group(namespace, title),
    groupEnd: () => Logger.groupEnd(),
  }),
};

// Development mode detection
if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
  enableDevMode();
}
