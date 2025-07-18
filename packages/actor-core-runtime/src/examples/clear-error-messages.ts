/**
 * Clear Error Messages Example - Demonstrates the improved type error experience
 *
 * This file shows how the enhanced type system provides clear, actionable error messages
 * for common mistakes when using createActor.
 */

import type { ActorMessage } from '../actor-system.js';
import { type TypedEvent, createActor } from '../index.js';

// Define events with clear type discrimination
type TodoEvent =
  | { type: 'ADD_TODO'; data: { id: string; text: string; completed: boolean } }
  | { type: 'TOGGLE_TODO'; data: { id: string } }
  | { type: 'DELETE_TODO'; data: { id: string } }
  | { type: 'CLEAR_COMPLETED'; data: { count: number } };

type TodoContext = {
  todos: Array<{ id: string; text: string; completed: boolean }>;
};

// Example with a typo - uncomment to see the clear error message
/*
const todoActorWithTypo = createActor<ActorMessage, TodoContext, TodoEvent>({
  context: { todos: [] },
  onMessage: ({ message, context }) => {
    if (message.type === 'ADD_TODO') {
      const newTodo = { id: '1', text: 'Test', completed: false };
      return {
        context: { todos: [...context.todos, newTodo] },
        // The error message will clearly show:
        // Error: Invalid event type "ADD_TODOO". Valid types are: "ADD_TODO" | "TOGGLE_TODO" | "DELETE_TODO" | "CLEAR_COMPLETED"
        emit: { type: 'ADD_TODOO', data: newTodo }
      };
    }
    return { context };
  },
});
*/

// Example with wrong data structure - uncomment to see the error
/*
const todoActorWrongData = createActor<ActorMessage, TodoContext, TodoEvent>({
  context: { todos: [] },
  onMessage: ({ message, context }) => {
    if (message.type === 'TOGGLE_TODO') {
      return {
        context,
        // The error will indicate that 'id' is expected to be string, not number
        emit: { type: 'TOGGLE_TODO', data: { id: 123 } }
      };
    }
    return { context };
  },
});
*/

// Example with missing required field - uncomment to see the error
/*
const todoActorMissingField = createActor<ActorMessage, TodoContext, TodoEvent>({
  context: { todos: [] },
  onMessage: ({ message, context }) => {
    if (message.type === 'ADD_TODO') {
      return {
        context,
        // The error will show that 'completed' field is missing
        emit: { type: 'ADD_TODO', data: { id: '1', text: 'Test' } }
      };
    }
    return { context };
  },
});
*/

// Helper function that demonstrates type-safe event creation
function createTodoEvent<T extends TodoEvent>(event: TypedEvent<T>): T {
  return event as T;
}

// Usage with helper - provides immediate feedback on typos
const validEvent = createTodoEvent({
  type: 'ADD_TODO',
  data: { id: '1', text: 'Learn Actor Model', completed: false },
});

// Uncomment to see error - the typo is caught immediately
/*
const invalidEvent = createTodoEvent({
  type: 'ADD_TODOO', // Error: Invalid event type
  data: { id: '1', text: 'Test', completed: false }
});
*/

// Correct implementation with proper types
const todoActor = createActor<ActorMessage, TodoContext, TodoEvent>({
  context: { todos: [] },
  onMessage: ({ message, context }) => {
    switch (message.type) {
      case 'ADD_TODO': {
        const { id, text } = message.payload as { id: string; text: string };
        const newTodo = { id, text, completed: false };
        return {
          context: { todos: [...context.todos, newTodo] },
          emit: {
            type: 'ADD_TODO',
            data: newTodo,
          },
        };
      }

      case 'TOGGLE_TODO': {
        const { id } = message.payload as { id: string };
        const todos = context.todos.map((todo) =>
          todo.id === id ? { ...todo, completed: !todo.completed } : todo
        );
        const toggled = todos.find((t) => t.id === id);
        if (toggled) {
          return {
            context: { todos },
            emit: {
              type: 'TOGGLE_TODO',
              data: { id },
            },
          };
        }
        return { context };
      }

      case 'DELETE_TODO': {
        const { id } = message.payload as { id: string };
        return {
          context: { todos: context.todos.filter((todo) => todo.id !== id) },
          emit: {
            type: 'DELETE_TODO',
            data: { id },
          },
        };
      }

      case 'CLEAR_COMPLETED': {
        const completedCount = context.todos.filter((t) => t.completed).length;
        return {
          context: { todos: context.todos.filter((todo) => !todo.completed) },
          emit: {
            type: 'CLEAR_COMPLETED',
            data: { count: completedCount },
          },
        };
      }

      default:
        return { context };
    }
  },
});

console.log('Clear error messages example compiled successfully!');
console.log('\nBenefits of the improved type system:');
console.log('1. Typos in event types show all valid options');
console.log('2. Wrong property types show expected vs actual');
console.log('3. Missing fields are clearly indicated');
console.log('4. Extra properties are flagged with suggestions');
console.log('\nUncomment the error examples to see the improved messages!');

export { todoActor, createTodoEvent, validEvent };
