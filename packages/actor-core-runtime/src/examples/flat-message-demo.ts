/**
 * @module examples/flat-message-demo
 * @description Demonstrates the new flat message structure for improved developer experience
 */

import { createActorSystem } from '../actor-system-impl.js';
import { Logger } from '../logger.js';
import { defineActor } from '../unified-actor-builder.js';

const log = Logger.namespace('FLAT_MESSAGE_DEMO');

// ============================================================================
// DEFINE MESSAGE TYPES WITH DISCRIMINATED UNIONS
// ============================================================================

/**
 * User service messages using TypeScript discriminated unions
 * Natural, Redux-style message patterns without nested payloads
 */
type UserMessage =
  | { type: 'GET_USER'; userId: string }
  | { type: 'UPDATE_USER'; userId: string; name: string; email: string }
  | { type: 'DELETE_USER'; userId: string }
  | { type: 'USER_FOUND'; user: { id: string; name: string; email: string } }
  | { type: 'USER_UPDATED'; user: { id: string; name: string; email: string } }
  | { type: 'USER_DELETED'; userId: string }
  | { type: 'USER_ERROR'; error: string; details?: string };

/**
 * Type-safe context for user actor
 */
interface UserContext {
  users: Map<string, { id: string; name: string; email: string }>;
  lastError?: string;
}

// ============================================================================
// CREATE ACTOR WITH FLAT MESSAGE HANDLING
// ============================================================================

const userBehavior = defineActor<UserMessage>()
  .withContext<UserContext>({
    users: new Map([
      ['user-1', { id: 'user-1', name: 'Alice', email: 'alice@example.com' }],
      ['user-2', { id: 'user-2', name: 'Bob', email: 'bob@example.com' }],
    ]),
  })
  .onMessage(({ message, actor }) => {
    // Get context from actor snapshot
    const context = actor.getSnapshot().context as UserContext;

    // Direct field access - no message.userId nonsense!
    switch (message.type) {
      case 'GET_USER': {
        const user = context.users.get(message.userId);
        if (user) {
          return {
            context,
            emit: [{ type: 'USER_FOUND', user }],
          };
        }
        return {
          context,
          emit: [
            {
              type: 'USER_ERROR',
              error: 'User not found',
              details: `No user with ID: ${message.userId}`,
            },
          ],
        };
      }

      case 'UPDATE_USER': {
        const updatedUser = {
          id: message.userId,
          name: message.name,
          email: message.email,
        };

        const newUsers = new Map(context.users);
        newUsers.set(message.userId, updatedUser);

        return {
          context: {
            ...context,
            users: newUsers,
          },
          emit: [{ type: 'USER_UPDATED', user: updatedUser }],
        };
      }

      case 'DELETE_USER': {
        const newUsers = new Map(context.users);
        const existed = newUsers.delete(message.userId);

        if (existed) {
          return {
            context: {
              ...context,
              users: newUsers,
            },
            emit: [{ type: 'USER_DELETED', userId: message.userId }],
          };
        }
        return {
          context,
          emit: [
            {
              type: 'USER_ERROR',
              error: 'User not found for deletion',
              details: `No user with ID: ${message.userId}`,
            },
          ],
        };
      }

      default:
        return { context };
    }
  });
// .build();

// ============================================================================
// DEMONSTRATE FLAT MESSAGE CREATION
// ============================================================================

async function demonstrateFlatMessages() {
  const system = createActorSystem({ nodeAddress: 'flat-message-demo' });
  const userActor = await system.spawn(userBehavior);

  log.debug('=== Flat Message Structure Demo ===\n');

  // 1. Create flat messages with natural syntax
  const getUser = {
    type: 'GET_USER' as const,
    userId: 'user-1',
    _correlationId: 'req-123',
  };

  log.debug('1. Flat GET_USER message:');
  log.debug(JSON.stringify(getUser, null, 2));
  log.debug('');

  // 2. Update user with multiple fields - all at top level
  const updateUser = {
    type: 'UPDATE_USER' as const,
    userId: 'user-1',
    name: 'Alice Smith',
    email: 'alice.smith@example.com',
  };

  log.debug('2. Flat UPDATE_USER message:');
  log.debug(JSON.stringify(updateUser, null, 2));
  log.debug('');

  // 3. TypeScript provides excellent intellisense
  // Try uncommenting to see TypeScript errors:
  // const badMessage = {
  //   type: 'GET_USER' as const
  //   // Error: Property 'userId' is missing
  // };

  // 3. Send messages and observe responses
  log.debug('3. Sending messages to actor:\n');

  // Note: Direct subscriptions removed in pure actor model
  // Use message-based patterns for event handling instead
  // For example, create a separate actor to collect events

  // Send flat messages
  userActor.send(getUser);
  userActor.send(updateUser);

  // Wait for processing
  await new Promise((resolve) => setTimeout(resolve, 100));

  await system.stop();
}

// ============================================================================
// BENEFITS OF FLAT MESSAGE STRUCTURE
// ============================================================================

log.debug(`
Benefits of Flat Message Structure:

1. Natural TypeScript Discriminated Unions
   - Direct field access: message.userId instead of message.userId
   - Better IntelliSense and type checking
   - Redux-style action patterns

2. Cleaner Code
   - Less nesting and boilerplate
   - More readable message handling
   - Easier to test

3. Framework Compatibility
   - Envelope fields prefixed with underscore (_timestamp, _correlationId)
   - No conflicts with user-defined fields
   - Clean separation between framework and user fields

4. Better Developer Experience
   - Familiar patterns from Redux/Flux
   - Natural JavaScript object syntax
   - Excellent TypeScript support
`);

// Run the demo
demonstrateFlatMessages().catch(console.error);
