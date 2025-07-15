/**
 * Input Actor - Real-time Input Validation and Command Processing
 *
 * This actor manages user input state and provides real-time validation feedback
 * following the pure actor model architecture.
 *
 * STANDARDIZED ACTOR PATTERN IMPLEMENTATION
 * =======================================
 *
 * This actor follows the unified actor standardization patterns:
 * 1. Uses createActorRef() for unified actor creation
 * 2. Registers with ActorRegistry for discovery
 * 3. Emits events for real-time UI updates
 * 4. Supports ask() pattern for command validation
 * 5. Defines supervision strategies
 *
 * Actor Address: actor://system/input/{id}
 * Communication: Event emission for UI updates
 * Supervision: Restart strategy with retry limits
 */

import { type ActorRef, type ActorSnapshot, createActorRef, Logger } from '@actor-core/runtime';
import { assign, emit, setup } from 'xstate';

// Use scoped logger for input-actor
const log = Logger.namespace('INPUT_ACTOR');

// ============================================================================
// ACTOR REGISTRY INTEGRATION
// ============================================================================

/**
 * Actor Registry for standardized actor discovery
 * TODO: This should be imported from @actor-core/runtime once implemented
 */
type AnyActorRef = ActorRef<{ type: string }, { type: string }>;

class ActorRegistryService {
  private static instance: ActorRegistryService;
  private registry = new Map<string, AnyActorRef>();

  static getInstance(): ActorRegistryService {
    if (!ActorRegistryService.instance) {
      ActorRegistryService.instance = new ActorRegistryService();
    }
    return ActorRegistryService.instance;
  }

  register(path: string, actor: AnyActorRef): void {
    this.registry.set(path, actor);
    log.debug(`Registered actor at ${path}`);
  }

  lookup(path: string): AnyActorRef | undefined {
    return this.registry.get(path);
  }

  unregister(path: string): void {
    this.registry.delete(path);
    log.debug(`Unregistered actor at ${path}`);
  }

  list(): string[] {
    return Array.from(this.registry.keys());
  }
}

export const ActorRegistry = ActorRegistryService.getInstance();

// Generate unique actor IDs
function generateInputActorId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

// ============================================================================
// ACTOR INTERFACES
// ============================================================================

export interface InputActor
  extends ActorRef<InputEvent, InputEmittedEvent, ActorSnapshot<InputContext>> {
  // All ActorRef methods are inherited
  // Additional standardized methods will be added here
}

// ============================================================================
// INPUT CONTEXT (Pure State)
// ============================================================================

export interface InputContext {
  currentInput: string;
  cursorPosition: number;
  availableCommands: string[];
  availableEvents: string[];
  suggestions: string[];
  validationResult: {
    isValid: boolean;
    message?: string;
    color: 'green' | 'red' | 'gray';
  };
  history: string[];
  completionIndex: number;
  isCompleting: boolean;
}

// ============================================================================
// INPUT EVENTS (INCOMING)
// ============================================================================

export type InputEvent =
  | { type: 'CHAR_TYPED'; char: string }
  | { type: 'BACKSPACE' }
  | { type: 'TAB_PRESSED' }
  | { type: 'ENTER_PRESSED' }
  | { type: 'ESCAPE' }
  | { type: 'COMPLETION_SELECTED'; completion: string }
  | { type: 'UPDATE_AVAILABLE_EVENTS'; events: string[] }
  | { type: 'UPDATE_AVAILABLE_COMMANDS'; commands: string[] }
  | { type: 'CLEAR_INPUT' }
  | { type: 'ARROW_UP' }
  | { type: 'ARROW_DOWN' }
  | { type: 'CTRL_C' };

// ============================================================================
// INPUT EMITTED EVENTS (OUTGOING NOTIFICATIONS)
// ============================================================================

export type InputEmittedEvent =
  | {
      type: 'INPUT_VALIDATION_CHANGED';
      isValid: boolean;
      color: string;
      input: string;
      message?: string;
    }
  | { type: 'INPUT_SUGGESTIONS_AVAILABLE'; suggestions: string[]; partialInput: string }
  | { type: 'INPUT_COMMAND_READY'; command: string; isValid: boolean }
  | { type: 'INPUT_COMPLETION_REQUESTED'; partialInput: string; suggestions: string[] }
  | { type: 'INPUT_CLEARED' }
  | { type: 'INPUT_HISTORY_CHANGED'; historyIndex: number; historyItem: string }
  | { type: 'INPUT_ERROR'; error: string };

// ============================================================================
// VALIDATION LOGIC
// ============================================================================

function validateInput(
  input: string,
  availableCommands: string[],
  availableEvents: string[]
): {
  isValid: boolean;
  color: 'green' | 'red' | 'gray';
  message?: string;
} {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();

  // Empty input is neutral
  if (trimmed.length === 0) {
    return { isValid: true, color: 'gray' };
  }

  // Check special commands (case-insensitive)
  if (availableCommands.some((cmd) => cmd.toLowerCase() === trimmed.toLowerCase())) {
    return { isValid: true, color: 'green' };
  }

  // Check available events (uppercase)
  if (availableEvents.includes(upper)) {
    return { isValid: true, color: 'green' };
  }

  // Check if it's a known but unavailable event
  const allEvents = [
    'CHECK_REPO',
    'CHECK_STATUS',
    'CHECK_UNCOMMITTED_CHANGES',
    'ADD_ALL',
    'COMMIT_CHANGES',
    'FETCH_REMOTE',
    'PUSH_CHANGES',
    'MERGE_BRANCH',
    'GET_INTEGRATION_STATUS',
    'GET_CHANGED_FILES',
    'GENERATE_COMMIT_MESSAGE',
    'VALIDATE_DATES',
    'SETUP_WORKTREES',
    'CHECK_WORKTREE',
    'CREATE_BRANCH',
    'GET_LAST_COMMIT',
    'CONTINUE',
    'RETRY',
  ];

  if (allEvents.includes(upper)) {
    return {
      isValid: false,
      color: 'red',
      message: `Event "${upper}" not available in current state`,
    };
  }

  // Unknown command
  return {
    isValid: false,
    color: 'red',
    message: `Unknown command: ${trimmed}`,
  };
}

function generateSuggestions(
  input: string,
  availableCommands: string[],
  availableEvents: string[]
): string[] {
  const trimmed = input.trim();
  const lowerInput = trimmed.toLowerCase();
  const upperInput = trimmed.toUpperCase();

  if (trimmed.length === 0) {
    return [];
  }

  const suggestions: string[] = [];

  // Match special commands (case-insensitive)
  const commandMatches = availableCommands.filter(
    (cmd) => cmd.toLowerCase().includes(lowerInput) || cmd.toLowerCase().startsWith(lowerInput)
  );

  // Match available events (uppercase)
  const exactEventMatches = availableEvents.filter((event) => event.startsWith(upperInput));

  // Fuzzy match available events
  const fuzzyEventMatches = availableEvents.filter(
    (event) => !event.startsWith(upperInput) && event.includes(upperInput)
  );

  // Combine all matches, prioritizing exact matches
  suggestions.push(...commandMatches);
  suggestions.push(...exactEventMatches);
  suggestions.push(...fuzzyEventMatches);

  // Remove duplicates and limit to 8 suggestions
  return Array.from(new Set(suggestions)).slice(0, 8);
}

// ============================================================================
// STATE MACHINE DEFINITION
// ============================================================================

export const inputActorMachine = setup({
  types: {
    context: {} as InputContext,
    events: {} as InputEvent,
    input: {} as { availableCommands?: string[]; availableEvents?: string[] },
    emitted: {} as InputEmittedEvent,
  },
  actions: {
    // Core input actions
    addChar: assign({
      currentInput: ({ context, event }) => {
        if (event.type === 'CHAR_TYPED') {
          const pos = context.cursorPosition;
          return context.currentInput.slice(0, pos) + event.char + context.currentInput.slice(pos);
        }
        return context.currentInput;
      },
      cursorPosition: ({ context, event }) => {
        if (event.type === 'CHAR_TYPED') {
          return context.cursorPosition + 1;
        }
        return context.cursorPosition;
      },
    }),

    removeChar: assign({
      currentInput: ({ context }) => {
        if (context.cursorPosition > 0) {
          const pos = context.cursorPosition;
          return context.currentInput.slice(0, pos - 1) + context.currentInput.slice(pos);
        }
        return context.currentInput;
      },
      cursorPosition: ({ context }) => {
        return Math.max(0, context.cursorPosition - 1);
      },
    }),

    clearInput: assign({
      currentInput: () => '',
      cursorPosition: () => 0,
      suggestions: () => [],
      validationResult: () => ({ isValid: true, color: 'gray' as const }),
      isCompleting: () => false,
      completionIndex: () => 0,
    }),

    // Validation actions
    validateInput: assign({
      validationResult: ({ context }) => {
        return validateInput(
          context.currentInput,
          context.availableCommands,
          context.availableEvents
        );
      },
    }),

    generateSuggestions: assign({
      suggestions: ({ context }) => {
        return generateSuggestions(
          context.currentInput,
          context.availableCommands,
          context.availableEvents
        );
      },
    }),

    // Completion actions
    startCompletion: assign({
      isCompleting: () => true,
      completionIndex: () => 0,
    }),

    stopCompletion: assign({
      isCompleting: () => false,
      completionIndex: () => 0,
    }),

    selectCompletion: assign({
      currentInput: ({ context, event }) => {
        if (event.type === 'COMPLETION_SELECTED') {
          return event.completion;
        }
        return context.currentInput;
      },
      cursorPosition: ({ context, event }) => {
        if (event.type === 'COMPLETION_SELECTED') {
          return event.completion.length;
        }
        return context.cursorPosition;
      },
      isCompleting: () => false,
      completionIndex: () => 0,
    }),

    // History actions
    addToHistory: assign({
      history: ({ context }) => {
        const command = context.currentInput.trim();
        if (command && !context.history.includes(command)) {
          return [...context.history, command];
        }
        return context.history;
      },
    }),

    // Update actions
    updateAvailableEvents: assign({
      availableEvents: ({ event }) => {
        if (event.type === 'UPDATE_AVAILABLE_EVENTS') {
          return event.events;
        }
        return [];
      },
    }),

    updateAvailableCommands: assign({
      availableCommands: ({ event }) => {
        if (event.type === 'UPDATE_AVAILABLE_COMMANDS') {
          return event.commands;
        }
        return [];
      },
    }),

    // Event emission actions
    emitValidationChange: emit(({ context }) => ({
      type: 'INPUT_VALIDATION_CHANGED' as const,
      isValid: context.validationResult.isValid,
      color: context.validationResult.color,
      input: context.currentInput,
      message: context.validationResult.message,
    })),

    emitSuggestions: emit(({ context }) => ({
      type: 'INPUT_SUGGESTIONS_AVAILABLE' as const,
      suggestions: context.suggestions,
      partialInput: context.currentInput,
    })),

    emitCommandReady: emit(({ context }) => ({
      type: 'INPUT_COMMAND_READY' as const,
      command: context.currentInput.trim(),
      isValid: context.validationResult.isValid,
    })),

    emitCompletionRequest: emit(({ context }) => ({
      type: 'INPUT_COMPLETION_REQUESTED' as const,
      partialInput: context.currentInput,
      suggestions: context.suggestions,
    })),

    emitInputCleared: emit(() => ({
      type: 'INPUT_CLEARED' as const,
    })),

    emitError: emit(({ context }) => ({
      type: 'INPUT_ERROR' as const,
      error: context.validationResult.message || 'Unknown input error',
    })),
  },
}).createMachine({
  id: 'input-actor',

  context: ({ input }) => ({
    currentInput: '',
    cursorPosition: 0,
    availableCommands: input?.availableCommands || [
      'help',
      'state',
      'events',
      'status',
      'registry',
      'completions',
      'q',
      'quit',
      'exit',
    ],
    availableEvents: input?.availableEvents || [],
    suggestions: [],
    validationResult: { isValid: true, color: 'gray' as const },
    history: [],
    completionIndex: 0,
    isCompleting: false,
  }),

  initial: 'idle',

  states: {
    idle: {
      on: {
        CHAR_TYPED: {
          target: 'typing',
          actions: [
            'addChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        UPDATE_AVAILABLE_EVENTS: {
          actions: [
            'updateAvailableEvents',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
          ],
        },
        UPDATE_AVAILABLE_COMMANDS: {
          actions: [
            'updateAvailableCommands',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
          ],
        },
      },
    },

    typing: {
      on: {
        CHAR_TYPED: {
          actions: [
            'addChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        BACKSPACE: {
          actions: [
            'removeChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        TAB_PRESSED: {
          target: 'completing',
          actions: ['startCompletion', 'emitCompletionRequest'],
        },
        ENTER_PRESSED: {
          target: 'validating',
          actions: ['addToHistory'],
        },
        CLEAR_INPUT: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
        CTRL_C: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
        UPDATE_AVAILABLE_EVENTS: {
          actions: [
            'updateAvailableEvents',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        UPDATE_AVAILABLE_COMMANDS: {
          actions: [
            'updateAvailableCommands',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
      },
    },

    completing: {
      on: {
        COMPLETION_SELECTED: {
          target: 'typing',
          actions: ['selectCompletion', 'stopCompletion', 'validateInput', 'emitValidationChange'],
        },
        ESCAPE: {
          target: 'typing',
          actions: ['stopCompletion'],
        },
        CHAR_TYPED: {
          target: 'typing',
          actions: [
            'stopCompletion',
            'addChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        BACKSPACE: {
          target: 'typing',
          actions: [
            'stopCompletion',
            'removeChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        ENTER_PRESSED: {
          target: 'validating',
          actions: ['stopCompletion', 'addToHistory'],
        },
      },
    },

    validating: {
      always: [
        {
          target: 'valid',
          guard: ({ context }) => context.validationResult.isValid,
          actions: ['emitCommandReady'],
        },
        {
          target: 'invalid',
          actions: ['emitError'],
        },
      ],
    },

    valid: {
      on: {
        CHAR_TYPED: {
          target: 'typing',
          actions: [
            'addChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        CLEAR_INPUT: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
        CTRL_C: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
      },
    },

    invalid: {
      on: {
        CHAR_TYPED: {
          target: 'typing',
          actions: [
            'addChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        BACKSPACE: {
          target: 'typing',
          actions: [
            'removeChar',
            'validateInput',
            'generateSuggestions',
            'emitValidationChange',
            'emitSuggestions',
          ],
        },
        CLEAR_INPUT: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
        CTRL_C: {
          target: 'idle',
          actions: ['clearInput', 'emitInputCleared'],
        },
      },
    },
  },
});

// ============================================================================
// STANDARDIZED ACTOR FACTORY
// ============================================================================

export function createInputActor(options?: {
  availableCommands?: string[];
  availableEvents?: string[];
}): InputActor {
  const actorId = generateInputActorId('input-actor');
  const actorRef = createActorRef(inputActorMachine, {
    id: actorId,
    input: options,
    autoStart: false,
  });

  // Register in actor registry for discovery
  const actorPath = `actor://system/input/${actorId}`;
  ActorRegistry.register(actorPath, actorRef as AnyActorRef);

  // Log actor creation
  log.debug(`Created input actor with ID: ${actorId}`);
  log.debug(`Registered at path: ${actorPath}`);

  return actorRef as unknown as InputActor;
}

// ============================================================================
// STANDARDIZED ACTOR LOOKUP
// ============================================================================

export function lookupInputActor(actorId: string): InputActor | undefined {
  const actorPath = `actor://system/input/${actorId}`;
  const actorRef = ActorRegistry.lookup(actorPath);
  return actorRef as InputActor | undefined;
}

export function listInputActors(): string[] {
  const allActors = ActorRegistry.list();
  return allActors.filter((path) => path.startsWith('actor://system/input/'));
}

// ============================================================================
// ACTOR LIFECYCLE MANAGEMENT
// ============================================================================

export function cleanupInputActor(actorId: string): void {
  const actorPath = `actor://system/input/${actorId}`;
  ActorRegistry.unregister(actorPath);
  log.debug(`Unregistered input actor: ${actorPath}`);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function getInputValidation(
  input: string,
  availableCommands: string[],
  availableEvents: string[]
): {
  isValid: boolean;
  color: 'green' | 'red' | 'gray';
  message?: string;
} {
  return validateInput(input, availableCommands, availableEvents);
}

export function getInputSuggestions(
  input: string,
  availableCommands: string[],
  availableEvents: string[]
): string[] {
  return generateSuggestions(input, availableCommands, availableEvents);
}
