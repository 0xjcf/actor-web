/**
 * Namespace constants for consistent and type-safe logging
 *
 * Benefits:
 * - Type safety: No typos in namespace strings
 * - Consistency: Standard naming conventions
 * - Discoverability: Easy to see all available namespaces
 * - IDE support: Autocomplete for namespace names
 * - Refactoring safety: Can rename namespaces without breaking code
 *
 * Usage:
 * ```typescript
 * import { NAMESPACES } from './namespace-constants';
 * const log = Logger.namespace(NAMESPACES.TIMER.THROTTLE);
 * ```
 */

// ===== CORE SERVICES =====

export const TIMER_NAMESPACES = {
  DELAY: 'DELAY',
  INTERVAL: 'INTERVAL',
  ANIMATION_FRAME: 'ANIMATION_FRAME',
  DEBOUNCE: 'DEBOUNCE',
  THROTTLE: 'THROTTLE',
} as const;

export const EVENT_NAMESPACES = {
  BUS: 'EVENT_BUS',
  DELEGATION: 'EVENT_DELEGATION',
  OBSERVER: 'EVENT_OBSERVER',
  EMITTER: 'EVENT_EMITTER',
} as const;

export const COMPONENT_NAMESPACES = {
  BRIDGE: 'COMPONENT_BRIDGE',
  REGISTRY: 'COMPONENT_REGISTRY',
  LIFECYCLE: 'COMPONENT_LIFECYCLE',
  RENDERER: 'COMPONENT_RENDERER',
  TEMPLATE: 'COMPONENT_TEMPLATE',
} as const;

export const STATE_NAMESPACES = {
  MACHINE: 'STATE_MACHINE',
  ACTOR: 'STATE_ACTOR',
  SUPERVISOR: 'STATE_SUPERVISOR',
  CONTEXT: 'STATE_CONTEXT',
} as const;

// ===== UTILITIES =====

export const UTILITY_NAMESPACES = {
  JSON: 'JSON_UTILITIES',
  ACCESSIBILITY: 'ACCESSIBILITY',
  KEYBOARD: 'KEYBOARD_NAV',
  FOCUS: 'FOCUS_MGMT',
  VALIDATION: 'VALIDATION',
  PERSISTENCE: 'PERSISTENCE',
  ANIMATION: 'ANIMATION',
} as const;

export const API_NAMESPACES = {
  HTTP: 'HTTP_SERVICE',
  MINIMAL: 'MINIMAL_API',
  REQUEST: 'HTTP_REQUEST',
  RESPONSE: 'HTTP_RESPONSE',
  AUTH: 'AUTH_SERVICE',
} as const;

// ===== TESTING & DEVELOPMENT =====

export const TEST_NAMESPACES = {
  SETUP: 'TEST_SETUP',
  FIXTURE: 'TEST_FIXTURE',
  MOCK: 'TEST_MOCK',
  INTEGRATION: 'TEST_INTEGRATION',
  E2E: 'TEST_E2E',
} as const;

export const DEV_NAMESPACES = {
  HOT_RELOAD: 'DEV_HOT_RELOAD',
  BUNDLER: 'DEV_BUNDLER',
  WATCHER: 'DEV_WATCHER',
  PERFORMANCE: 'DEV_PERFORMANCE',
} as const;

// ===== USER-FACING FEATURES =====

export const USER_NAMESPACES = {
  AUTH: 'USER_AUTH',
  PROFILE: 'USER_PROFILE',
  PREFERENCES: 'USER_PREFERENCES',
  SESSION: 'USER_SESSION',
} as const;

export const UI_NAMESPACES = {
  FORM: 'UI_FORM',
  MODAL: 'UI_MODAL',
  NAVIGATION: 'UI_NAVIGATION',
  LAYOUT: 'UI_LAYOUT',
  THEME: 'UI_THEME',
} as const;

// ===== CONSOLIDATED NAMESPACES =====

/**
 * All available namespace constants organized by category
 *
 * @example
 * ```typescript
 * import { NAMESPACES } from './namespace-constants';
 *
 * // Timer services
 * const throttleLog = Logger.namespace(NAMESPACES.TIMER.THROTTLE);
 *
 * // Event system
 * const eventLog = Logger.namespace(NAMESPACES.EVENT.BUS);
 *
 * // Components
 * const componentLog = Logger.namespace(NAMESPACES.COMPONENT.BRIDGE);
 *
 * // User features
 * const authLog = Logger.namespace(NAMESPACES.USER.AUTH);
 * ```
 */
export const NAMESPACES = {
  TIMER: TIMER_NAMESPACES,
  EVENT: EVENT_NAMESPACES,
  COMPONENT: COMPONENT_NAMESPACES,
  STATE: STATE_NAMESPACES,
  UTILITY: UTILITY_NAMESPACES,
  API: API_NAMESPACES,
  TEST: TEST_NAMESPACES,
  DEV: DEV_NAMESPACES,
  USER: USER_NAMESPACES,
  UI: UI_NAMESPACES,
} as const;

// ===== TYPE DEFINITIONS =====

/**
 * Type for all available namespace values
 */
export type NamespaceValue =
  | (typeof TIMER_NAMESPACES)[keyof typeof TIMER_NAMESPACES]
  | (typeof EVENT_NAMESPACES)[keyof typeof EVENT_NAMESPACES]
  | (typeof COMPONENT_NAMESPACES)[keyof typeof COMPONENT_NAMESPACES]
  | (typeof STATE_NAMESPACES)[keyof typeof STATE_NAMESPACES]
  | (typeof UTILITY_NAMESPACES)[keyof typeof UTILITY_NAMESPACES]
  | (typeof API_NAMESPACES)[keyof typeof API_NAMESPACES]
  | (typeof TEST_NAMESPACES)[keyof typeof TEST_NAMESPACES]
  | (typeof DEV_NAMESPACES)[keyof typeof DEV_NAMESPACES]
  | (typeof USER_NAMESPACES)[keyof typeof USER_NAMESPACES]
  | (typeof UI_NAMESPACES)[keyof typeof UI_NAMESPACES];

/**
 * Type for namespace parameters - supports both constants and custom strings
 */
export type NamespaceParam = NamespaceValue | string;

// ===== HELPER FUNCTIONS =====

/**
 * Get all available namespace values for validation
 */
export const getAllNamespaceValues = (): NamespaceValue[] => {
  return Object.values(NAMESPACES).flatMap((category) =>
    Object.values(category)
  ) as NamespaceValue[];
};

/**
 * Check if a string is a valid namespace constant
 */
export const isValidNamespace = (namespace: string): namespace is NamespaceValue => {
  return getAllNamespaceValues().includes(namespace as NamespaceValue);
};

/**
 * Create a custom namespace with validation
 * Ensures namespace follows naming conventions
 */
export const createCustomNamespace = (name: string): string => {
  // Validate naming convention: UPPER_CASE with underscores
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid namespace format: "${name}". Use UPPER_CASE with underscores (e.g., "MY_SERVICE")`
    );
  }
  return name;
};

// ===== NAMESPACE RECOMMENDATIONS =====

/**
 * Recommended namespace patterns for different types of code
 */
export const NAMESPACE_PATTERNS = {
  /**
   * Services: Use NOUN format
   * Examples: HTTP_SERVICE, AUTH_SERVICE, TIMER_SERVICE
   */
  SERVICE: (name: string) => `${name.toUpperCase()}_SERVICE`,

  /**
   * Components: Use COMPONENT prefix
   * Examples: BUTTON_COMPONENT, MODAL_COMPONENT, FORM_COMPONENT
   */
  COMPONENT: (name: string) => `${name.toUpperCase()}_COMPONENT`,

  /**
   * Utilities: Use UTILITY suffix or descriptive name
   * Examples: JSON_UTILITIES, VALIDATION_UTILS, ARRAY_HELPERS
   */
  UTILITY: (name: string) => `${name.toUpperCase()}_UTILITIES`,

  /**
   * Tests: Use TEST prefix
   * Examples: UNIT_TEST, INTEGRATION_TEST, E2E_TEST
   */
  TEST: (name: string) => `${name.toUpperCase()}_TEST`,

  /**
   * User features: Use USER prefix
   * Examples: USER_AUTH, USER_PROFILE, USER_SETTINGS
   */
  USER_FEATURE: (name: string) => `USER_${name.toUpperCase()}`,

  /**
   * UI components: Use UI prefix
   * Examples: UI_BUTTON, UI_MODAL, UI_FORM
   */
  UI_COMPONENT: (name: string) => `UI_${name.toUpperCase()}`,
} as const;
