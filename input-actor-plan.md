# Input Actor Implementation Plan

## Overview
Transform the current imperative readline-based input handling into a pure actor model architecture that provides real-time validation feedback and follows the standardized actor patterns.

## Current State Analysis

### Problems with Current Implementation:
1. **Mixed Paradigms**: `EnhancedReadline` class uses imperative approach while `GitActor` uses actor model
2. **No Real-time Validation**: Validation only happens on Enter press
3. **Hard to Test**: Imperative code with side effects
4. **Inconsistent Architecture**: Different patterns for different concerns
5. **Poor Separation**: UI rendering mixed with business logic

### Current Flow:
```
User Types → EnhancedReadline → Validation on Enter → Command Execution
```

## Target Architecture

### Actor-Based Flow:
```
User Types → InputActor → Real-time Validation → UI Updates via Events
           ↓
      StateActor → Command Execution → GitActor
```

### Core Actors:
1. **InputActor** - Manages input state and validation
2. **StateActor** - Orchestrates command execution
3. **GitActor** - Executes git operations (existing)

## InputActor Design

### State Machine:
```typescript
states: {
  idle: {
    on: { CHAR_TYPED: 'typing' }
  },
  typing: {
    on: { 
      CHAR_TYPED: 'typing',
      BACKSPACE: 'typing',
      TAB_PRESSED: 'completing',
      ENTER_PRESSED: 'validating'
    }
  },
  completing: {
    on: { 
      COMPLETION_SELECTED: 'typing',
      ESCAPE: 'typing' 
    }
  },
  validating: {
    on: { 
      VALIDATION_COMPLETE: [
        { target: 'valid', guard: 'isValid' },
        { target: 'invalid' }
      ]
    }
  },
  valid: {
    on: { 
      COMMAND_EXECUTED: 'idle',
      CHAR_TYPED: 'typing' 
    }
  },
  invalid: {
    on: { 
      CHAR_TYPED: 'typing',
      SUGGESTIONS_SHOWN: 'typing'
    }
  }
}
```

### Context:
```typescript
interface InputContext {
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
}
```

### Events:
```typescript
type InputEvent = 
  | { type: 'CHAR_TYPED'; char: string }
  | { type: 'BACKSPACE' }
  | { type: 'TAB_PRESSED' }
  | { type: 'ENTER_PRESSED' }
  | { type: 'ESCAPE' }
  | { type: 'COMPLETION_SELECTED'; completion: string }
  | { type: 'UPDATE_AVAILABLE_EVENTS'; events: string[] }
  | { type: 'CLEAR_INPUT' };
```

### Emitted Events:
```typescript
type InputEmittedEvent = 
  | { type: 'INPUT_VALIDATION_CHANGED'; isValid: boolean; color: string; input: string }
  | { type: 'INPUT_SUGGESTIONS_AVAILABLE'; suggestions: string[] }
  | { type: 'INPUT_COMMAND_READY'; command: string }
  | { type: 'INPUT_COMPLETION_REQUESTED'; partialInput: string }
  | { type: 'INPUT_CLEARED' };
```

## Implementation Steps

### Phase 1: Core InputActor (2-3 hours)
1. **Create InputActor Structure**
   - Define state machine with XState
   - Implement context interface
   - Add basic event handling

2. **Implement Real-time Validation**
   - Add validation logic for special commands
   - Add validation for available events
   - Implement suggestion generation

3. **Add Event Emission**
   - Emit validation state changes
   - Emit suggestion updates
   - Follow standardized event patterns

### Phase 2: UI Integration (1-2 hours)
1. **Create Input Renderer**
   - Subscribe to InputActor events
   - Update prompt colors in real-time
   - Display suggestions dynamically

2. **Integrate with Readline**
   - Use readline only for raw input capture
   - Forward keystrokes to InputActor
   - Handle special keys (Tab, Enter, Escape)

### Phase 3: Command Orchestration (1-2 hours)
1. **Create StateActor**
   - Orchestrate InputActor → GitActor flow
   - Handle command execution
   - Manage application state

2. **Refactor Command Handling**
   - Move command logic to StateActor
   - Implement proper actor communication
   - Add error handling

### Phase 4: Testing & Polish (1-2 hours)
1. **Add Comprehensive Tests**
   - Test InputActor state transitions
   - Test validation logic
   - Test actor communication

2. **Performance Optimization**
   - Debounce validation updates
   - Optimize suggestion generation
   - Add input history

## File Structure

```
packages/agent-workflow-cli/src/
├── actors/
│   ├── input-actor.ts       # NEW: InputActor implementation
│   ├── state-actor.ts       # NEW: StateActor orchestration
│   └── git-actor.ts         # EXISTING: Updated for integration
├── ui/
│   ├── input-renderer.ts    # NEW: UI rendering logic
│   └── terminal-utils.ts    # NEW: Terminal utilities
├── commands/
│   └── state-machine-analysis.ts # UPDATED: Simplified to use actors
└── testing/
    └── input-actor.test.ts  # NEW: InputActor tests
```

## Detailed Implementation

### InputActor Example:
```typescript
export const inputActorMachine = setup({
  types: {
    context: {} as InputContext,
    events: {} as InputEvent,
    emitted: {} as InputEmittedEvent,
  },
  actions: {
    updateInput: assign({
      currentInput: ({ context, event }) => {
        if (event.type === 'CHAR_TYPED') {
          return context.currentInput + event.char;
        }
        if (event.type === 'BACKSPACE') {
          return context.currentInput.slice(0, -1);
        }
        return context.currentInput;
      }
    }),
    
    emitValidationChange: emit(({ context }) => ({
      type: 'INPUT_VALIDATION_CHANGED' as const,
      isValid: context.validationResult.isValid,
      color: context.validationResult.color,
      input: context.currentInput
    })),
    
    validateInput: assign({
      validationResult: ({ context }) => {
        const input = context.currentInput.trim();
        
        // Check special commands
        if (context.availableCommands.includes(input)) {
          return { isValid: true, color: 'green' as const };
        }
        
        // Check available events
        if (context.availableEvents.includes(input.toUpperCase())) {
          return { isValid: true, color: 'green' as const };
        }
        
        // Invalid input
        return { 
          isValid: false, 
          color: 'red' as const,
          message: `Unknown command: ${input}`
        };
      }
    }),
    
    generateSuggestions: assign({
      suggestions: ({ context }) => {
        const input = context.currentInput.trim().toLowerCase();
        if (input.length === 0) return [];
        
        const allOptions = [
          ...context.availableCommands,
          ...context.availableEvents.map(e => e.toLowerCase())
        ];
        
        return allOptions.filter(option => 
          option.toLowerCase().includes(input)
        ).slice(0, 5);
      }
    })
  }
}).createMachine({
  id: 'input-actor',
  initial: 'idle',
  context: {
    currentInput: '',
    cursorPosition: 0,
    availableCommands: [],
    availableEvents: [],
    suggestions: [],
    validationResult: { isValid: true, color: 'gray' },
    history: []
  },
  states: {
    idle: {
      on: {
        CHAR_TYPED: {
          target: 'typing',
          actions: ['updateInput', 'generateSuggestions']
        }
      }
    },
    typing: {
      on: {
        CHAR_TYPED: {
          actions: ['updateInput', 'validateInput', 'generateSuggestions', 'emitValidationChange']
        },
        BACKSPACE: {
          actions: ['updateInput', 'validateInput', 'generateSuggestions', 'emitValidationChange']
        },
        TAB_PRESSED: 'completing',
        ENTER_PRESSED: 'validating'
      }
    },
    completing: {
      on: {
        COMPLETION_SELECTED: {
          target: 'typing',
          actions: ['updateInput', 'validateInput', 'emitValidationChange']
        },
        ESCAPE: 'typing'
      }
    },
    validating: {
      invoke: {
        src: 'validateCommand',
        onDone: {
          target: 'valid',
          actions: 'emitValidationChange'
        },
        onError: {
          target: 'invalid',
          actions: 'emitValidationChange'
        }
      }
    },
    valid: {
      on: {
        COMMAND_EXECUTED: 'idle',
        CHAR_TYPED: 'typing'
      }
    },
    invalid: {
      on: {
        CHAR_TYPED: 'typing',
        SUGGESTIONS_SHOWN: 'typing'
      }
    }
  }
});
```

### UI Integration Example:
```typescript
export class InputRenderer {
  private inputActor: InputActor;
  private rl: readline.Interface;
  
  constructor(inputActor: InputActor) {
    this.inputActor = inputActor;
    this.setupSubscriptions();
    this.setupReadline();
  }
  
  private setupSubscriptions() {
    // Subscribe to validation changes
    this.inputActor.subscribe(event => {
      if (event.type === 'INPUT_VALIDATION_CHANGED') {
        this.updatePrompt(event.color, event.input);
      }
      
      if (event.type === 'INPUT_SUGGESTIONS_AVAILABLE') {
        this.showSuggestions(event.suggestions);
      }
    });
  }
  
  private updatePrompt(color: string, input: string) {
    const status = input.length > 0 ? (color === 'green' ? '✓' : '✗') : '';
    const colorFn = color === 'green' ? chalk.green : 
                   color === 'red' ? chalk.red : chalk.gray;
    
    this.rl.setPrompt(colorFn(`${status} > `));
  }
  
  private setupReadline() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.gray('> ')
    });
    
    this.rl.on('line', (input) => {
      this.inputActor.send({ type: 'ENTER_PRESSED' });
    });
    
    // Handle raw keystrokes
    process.stdin.on('keypress', (char, key) => {
      if (key.name === 'tab') {
        this.inputActor.send({ type: 'TAB_PRESSED' });
      } else if (key.name === 'backspace') {
        this.inputActor.send({ type: 'BACKSPACE' });
      } else if (char && char.length === 1) {
        this.inputActor.send({ type: 'CHAR_TYPED', char });
      }
    });
  }
}
```

## Testing Strategy

### Unit Tests:
1. **InputActor State Transitions**
2. **Validation Logic**
3. **Suggestion Generation**
4. **Event Emission**

### Integration Tests:
1. **InputActor ↔ StateActor Communication**
2. **StateActor ↔ GitActor Communication**
3. **End-to-end Command Flow**

### Example Test:
```typescript
describe('InputActor', () => {
  it('should validate input in real-time', () => {
    const actor = createInputActor();
    const validationSpy = jest.fn();
    
    actor.subscribe(event => {
      if (event.type === 'INPUT_VALIDATION_CHANGED') {
        validationSpy(event);
      }
    });
    
    actor.send({ type: 'CHAR_TYPED', char: 'h' });
    actor.send({ type: 'CHAR_TYPED', char: 'e' });
    actor.send({ type: 'CHAR_TYPED', char: 'l' });
    actor.send({ type: 'CHAR_TYPED', char: 'p' });
    
    expect(validationSpy).toHaveBeenCalledWith({
      type: 'INPUT_VALIDATION_CHANGED',
      isValid: true,
      color: 'green',
      input: 'help'
    });
  });
});
```

## Migration Strategy

### Phase 1: Parallel Implementation
- Create InputActor alongside existing EnhancedReadline
- Test in isolation
- Verify actor patterns work

### Phase 2: Progressive Integration
- Replace EnhancedReadline with InputActor
- Keep existing command handling
- Test integration

### Phase 3: Full Actor Model
- Add StateActor orchestration
- Complete actor communication
- Remove imperative code

## Success Criteria

1. **Real-time Validation**: Input color changes as you type
2. **Consistent Architecture**: All components use actor model
3. **Testable**: 100% test coverage for actors
4. **Maintainable**: Clear separation of concerns
5. **Performance**: No noticeable lag in input handling

## Timeline

- **Phase 1**: 2-3 hours
- **Phase 2**: 1-2 hours  
- **Phase 3**: 1-2 hours
- **Phase 4**: 1-2 hours
- **Total**: 5-9 hours

## Next Steps

1. Review and approve this plan
2. Create InputActor implementation
3. Test in isolation
4. Begin UI integration
5. Refactor existing code

This plan ensures we maintain architectural consistency while delivering the real-time validation feedback you requested. 