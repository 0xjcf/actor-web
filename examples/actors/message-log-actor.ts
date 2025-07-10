// TypeScript interfaces for Message Log Actor
import { assign, createMachine } from 'xstate';

interface LogMessage {
  timestamp: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

interface MessageLogContext {
  messages: LogMessage[];
}

type MessageLogEvents =
  | { type: 'LOG_MESSAGE'; message: string; messageType?: LogMessage['type'] }
  | { type: 'CLEAR_LOG' };

type MessageLogStates = 'active';

export const messageLogMachine = createMachine({
  id: 'messageLog',
  initial: 'active' as MessageLogStates,

  context: {
    messages: [],
  } as MessageLogContext,

  types: {} as {
    context: MessageLogContext;
    events: MessageLogEvents;
  },

  states: {
    active: {
      on: {
        LOG_MESSAGE: {
          actions: assign({
            messages: ({
              context,
              event,
            }: {
              context: MessageLogContext;
              event: Extract<MessageLogEvents, { type: 'LOG_MESSAGE' }>;
            }) => [
              ...context.messages,
              {
                timestamp: new Date().toLocaleTimeString(),
                message: event.message,
                type: event.messageType || 'info',
              },
            ],
          }),
        },

        CLEAR_LOG: {
          actions: assign({
            messages: [],
          }),
        },
      },
    },
  },
});

// Helper functions for type-safe message logging
export const createLogMessage = (
  message: string,
  type: LogMessage['type'] = 'info'
): Extract<MessageLogEvents, { type: 'LOG_MESSAGE' }> => ({
  type: 'LOG_MESSAGE',
  message,
  messageType: type,
});

export const createClearLogEvent = (): Extract<MessageLogEvents, { type: 'CLEAR_LOG' }> => ({
  type: 'CLEAR_LOG',
});

// Type exports for external usage
export type { LogMessage, MessageLogContext, MessageLogEvents, MessageLogStates };
