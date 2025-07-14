/**
 * Development Mode Enhancements
 * Provides better DX with runtime validation and enhanced error messages
 */

import type { AnyStateMachine } from 'xstate';
import type { NamespaceParam } from './namespace-constants.js';

let isDevModeEnabled = false;
const registeredMachines = new Map<string, AnyStateMachine>();

// Export for testing
export function resetDevMode(): void {
  isDevModeEnabled = false;
  registeredMachines.clear();
  if (typeof window !== 'undefined' && (window as unknown as { __actorSPA?: unknown }).__actorSPA) {
    (window as unknown as { __actorSPA?: unknown }).__actorSPA = undefined;
  }
}

/**
 * Enable development mode with enhanced template validation
 */
export function enableDevMode(): void {
  if (isDevModeEnabled) {
    return;
  }

  isDevModeEnabled = true;

  // Browser-specific enhancements (only when window exists)
  if (typeof window !== 'undefined') {
    // Add global helper for inspecting templates
    (window as unknown as { __actorSPA?: unknown }).__actorSPA = {
      inspectTemplate,
      validateTemplate,
      listMachines: () => Array.from(registeredMachines.keys()),
      getMachine: (id: string) => registeredMachines.get(id),
    };
  }
}

/**
 * Force enable development mode for CLI/Node.js environments
 * This bypasses browser checks and enables logging
 */
export function enableDevModeForCLI(): void {
  isDevModeEnabled = true;
}

/**
 * Register a machine for development-time validation
 */
export function registerMachine(machine: AnyStateMachine): void {
  if (!isDevModeEnabled) {
    return;
  }

  registeredMachines.set(machine.id, machine);
}

/**
 * Enhanced template validation with actor model awareness
 */
export function validateTemplate(html: string, machineId?: string): ValidationResult {
  const issues: ValidationIssue[] = [];

  // Extract actor model patterns
  const patterns = extractActorPatterns(html);

  // Validate against registered machine if available
  if (machineId && registeredMachines.has(machineId)) {
    const machine = registeredMachines.get(machineId);
    if (machine) {
      issues.push(...validateAgainstMachine(patterns, machine));
    }
  }

  // General pattern validation
  issues.push(...validateGeneralPatterns(patterns, html));

  return {
    isValid: issues.length === 0,
    issues,
    patterns,
    html,
  };
}

/**
 * Template inspection helper for debugging
 */
export function inspectTemplate(template: { html: string }, machineId?: string): void {
  if (!isDevModeEnabled) {
    return;
  }

  const validation = validateTemplate(template.html, machineId);

  console.group('🔍 Template Inspection');
  console.log('HTML:', template.html);
  console.log('Patterns:', validation.patterns);

  if (validation.issues.length > 0) {
    console.warn(`Found ${validation.issues.length} issues:`);
    for (const issue of validation.issues) {
      console.warn(`[${issue.severity}] ${issue.message}`);
      if (issue.suggestion) {
        console.log(`  💡 ${issue.suggestion}`);
      }
    }
  } else {
    console.log('✅ Template is valid');
  }

  console.groupEnd();
}

/**
 * Extract actor model patterns from HTML
 */
function extractActorPatterns(html: string): ActorPatterns {
  // Event attributes
  const sendEvents = Array.from(html.matchAll(/send(?::[\w-]+)?="([^"]*)"/g)).map((m) => m[1]);
  const dataEvents = Array.from(html.matchAll(/data-(?:send|action)="([^"]*)"/g)).map((m) => m[1]);

  // State references
  const stateMatches = Array.from(html.matchAll(/state\.matches\(['"]([^'"]+)['"]\)/g)).map(
    (m) => m[1]
  );
  const stateValues = Array.from(html.matchAll(/state\.value[^a-zA-Z]/g));

  // Context access
  const contextAccess = Array.from(
    html.matchAll(/state\.context\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g)
  ).map((m) => m[1]);

  // ARIA attributes
  const ariaAttributes = Array.from(html.matchAll(/(?:data-)?aria-([a-z-]+)=/g)).map((m) => m[1]);

  // Payload attributes - handle both single and double quotes
  const payloads = Array.from(html.matchAll(/payload=["']([^"']+)["']/g)).map((m) => m[1]);

  return {
    events: [...sendEvents, ...dataEvents],
    stateReferences: stateMatches,
    hasStateValue: stateValues.length > 0,
    contextProperties: contextAccess,
    ariaAttributes,
    payloads,
  };
}

/**
 * Validate patterns against a specific machine
 */
function validateAgainstMachine(
  patterns: ActorPatterns,
  machine: AnyStateMachine
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Get valid events from machine
  const validEvents = extractEventsFromMachine(machine);
  const validStates = extractStatesFromMachine(machine);

  // Validate events
  for (const event of patterns.events) {
    if (!validEvents.includes(event)) {
      const suggestion = suggestClosestMatch(event, validEvents);
      issues.push({
        type: 'invalid-event',
        severity: 'error',
        message: `Event "${event}" not found in machine "${machine.id}"`,
        suggestion: suggestion ? `Did you mean "${suggestion}"?` : undefined,
        pattern: event,
      });
    }
  }

  // Validate state references
  for (const state of patterns.stateReferences) {
    if (!validStates.includes(state)) {
      const suggestion = suggestClosestMatch(state, validStates);
      issues.push({
        type: 'invalid-state',
        severity: 'error',
        message: `State "${state}" not found in machine "${machine.id}"`,
        suggestion: suggestion ? `Did you mean "${suggestion}"?` : undefined,
        pattern: state,
      });
    }
  }

  return issues;
}

/**
 * Validate general patterns and best practices
 */
function validateGeneralPatterns(patterns: ActorPatterns, html: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Note: raw() function has been removed from framework
  // Use html`` templates or direct HTML for trusted content

  // Check for non-conventional context property names
  for (const prop of patterns.contextProperties) {
    if (isAccessibilityRelated(prop) && !isConventionalARIAName(prop)) {
      issues.push({
        type: 'unconventional-context',
        severity: 'info',
        message: `Context property "${prop}" doesn't follow ARIA conventions`,
        suggestion: `Consider renaming to conventional name like "is${capitalize(prop)}"`,
        pattern: prop,
      });
    }
  }

  // Check for mix of send vs data-action
  const hasSend = html.includes('send="');
  const hasDataAction = html.includes('data-action="');
  if (hasSend && hasDataAction) {
    issues.push({
      type: 'inconsistent-event-syntax',
      severity: 'info',
      message: 'Mixing send and data-action attributes',
      suggestion: 'Consider using consistent syntax throughout template',
      pattern: 'mixed-syntax',
    });
  }

  return issues;
}

/**
 * Extract events from machine definition
 */
function extractEventsFromMachine(machine: AnyStateMachine): string[] {
  // This is a simplified extraction - in a real implementation,
  // we'd need to parse the machine config more thoroughly
  const events = new Set<string>();

  function walkStates(states: Record<string, unknown>) {
    for (const [, stateConfig] of Object.entries(states)) {
      if (stateConfig && typeof stateConfig === 'object') {
        const config = stateConfig as Record<string, unknown>;
        if (config.on && typeof config.on === 'object') {
          for (const event of Object.keys(config.on)) {
            events.add(event);
          }
        }
        if (config.states && typeof config.states === 'object') {
          walkStates(config.states as Record<string, unknown>);
        }
      }
    }
  }

  if (machine.config.on) {
    for (const event of Object.keys(machine.config.on)) {
      events.add(event);
    }
  }

  if (machine.config.states) {
    walkStates(machine.config.states as Record<string, unknown>);
  }

  return Array.from(events);
}

/**
 * Extract states from machine definition
 */
function extractStatesFromMachine(machine: AnyStateMachine): string[] {
  const states = new Set<string>();

  function walkStates(statesConfig: Record<string, unknown>, prefix = '') {
    for (const [stateName, stateConfig] of Object.entries(statesConfig)) {
      const fullStateName = prefix ? `${prefix}.${stateName}` : stateName;
      states.add(fullStateName);

      if (stateConfig && typeof stateConfig === 'object') {
        const config = stateConfig as Record<string, unknown>;
        if (config.states && typeof config.states === 'object') {
          walkStates(config.states as Record<string, unknown>, fullStateName);
        }
      }
    }
  }

  if (machine.config.states) {
    walkStates(machine.config.states as Record<string, unknown>);
  }

  return Array.from(states);
}

/**
 * Suggest closest match using simple string distance
 */
function suggestClosestMatch(input: string, options: string[]): string | undefined {
  if (options.length === 0) {
    return undefined;
  }

  let closest = options[0];
  let minDistance = levenshteinDistance(input.toLowerCase(), closest.toLowerCase());

  for (let i = 1; i < options.length; i++) {
    const distance = levenshteinDistance(input.toLowerCase(), options[i].toLowerCase());
    if (distance < minDistance) {
      minDistance = distance;
      closest = options[i];
    }
  }

  // Only suggest if reasonably close
  return minDistance <= Math.max(2, input.length * 0.4) ? closest : undefined;
}

/**
 * Simple Levenshtein distance calculation
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const matrix = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(null));

  for (let i = 0; i <= a.length; i++) {
    matrix[0][i] = i;
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if property name is accessibility-related
 */
function isAccessibilityRelated(prop: string): boolean {
  const ariaProps = ['busy', 'expanded', 'selected', 'disabled', 'checked', 'hidden', 'live'];
  return ariaProps.some((aria) => prop.toLowerCase().includes(aria));
}

/**
 * Check if property follows conventional ARIA naming
 */
function isConventionalARIAName(prop: string): boolean {
  const conventional = /^is[A-Z][a-zA-Z]*$|^has[A-Z][a-zA-Z]*$/;
  return conventional.test(prop);
}

/**
 * Capitalize first letter
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Type definitions
export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  patterns: ActorPatterns;
  html: string;
}

export interface ValidationIssue {
  type: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
  pattern: string;
}

export interface ActorPatterns {
  events: string[];
  stateReferences: string[];
  hasStateValue: boolean;
  contextProperties: string[];
  ariaAttributes: string[];
  payloads: string[];
}

// ===== LOGGER UTILITY =====

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
 *
 * Supports both namespace constants and custom strings:
 * ```typescript
 * import { NAMESPACES } from './namespace-constants';
 *
 * // Using constants (recommended)
 * Logger.debug(NAMESPACES.TIMER.THROTTLE, 'Processing', data);
 *
 * // Using custom strings (still supported)
 * Logger.debug('CUSTOM_SERVICE', 'Processing', data);
 * ```
 */
export const Logger = {
  debug: (namespace: NamespaceParam, message: string, data?: unknown) => {
    if (isDevModeEnabled && typeof console !== 'undefined') {
      console.log(`🐛 [${namespace}] ${message}`, data ? data : '');
    }
  },

  info: (namespace: NamespaceParam, message: string, data?: unknown) => {
    // Respect debug mode and check for test environment
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const debugEnabled = isDevModeEnabled || (isTestEnv && process.env.DEBUG_TESTS === 'true');

    if (debugEnabled && typeof console !== 'undefined') {
      console.log(`ℹ️  [${namespace}] ${message}`, data ? data : '');
    }
  },

  warn: (namespace: NamespaceParam, message: string, data?: unknown) => {
    // Keep warnings visible unless specifically silenced in tests
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const shouldLog = !isTestEnv || process.env.DEBUG_TESTS === 'true' || isDevModeEnabled;

    if (shouldLog && typeof console !== 'undefined') {
      console.warn(`⚠️  [${namespace}] ${message}`, data ? data : '');
    }
  },

  error: (namespace: NamespaceParam, message: string, error?: unknown) => {
    // Always show errors, but allow silencing in tests
    const isTestEnv =
      typeof process !== 'undefined' &&
      (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true');
    const shouldLog = !isTestEnv || process.env.DEBUG_TESTS === 'true' || isDevModeEnabled;

    if (shouldLog && typeof console !== 'undefined') {
      console.error(`❌ [${namespace}] ${message}`, error ? error : '');
    }
  },

  group: (namespace: NamespaceParam, title: string) => {
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
   * @param namespace - The namespace to use for all log messages (constant or custom string)
   * @returns A scoped logger that doesn't require passing namespace each time
   *
   * @example
   * ```typescript
   * import { NAMESPACES } from './namespace-constants';
   *
   * // Using constants (recommended)
   * const log = Logger.namespace(NAMESPACES.TIMER.THROTTLE);
   *
   * // Using custom strings (still supported)
   * const log = Logger.namespace('CUSTOM_SERVICE');
   *
   * // Usage is identical
   * log.debug('Service created', { interval: 100 });
   * log.warn('Unexpected state', { state: 'invalid' });
   * log.group('Complex Operation');
   * log.debug('Step 1 complete');
   * log.groupEnd();
   * ```
   */
  namespace: (namespace: NamespaceParam): ScopedLogger => ({
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
