import type { ActorRef } from './actor-ref.js';
import type { ActorMessage } from './actor-system.js';

declare const replyType: unique symbol;

/** Associate a command (or union of commands) with its reply. Adds no wire fields. */
export type ActorRequest<Message extends ActorMessage, Reply> = Message & {
  readonly [replyType]?: () => Reply;
};

/** Extract the declared reply, e.g. `ReplyOf<typeof message>` in a narrowed handler. */
export type ReplyOf<Message> = Message extends { readonly [replyType]?: () => infer Reply }
  ? Reply
  : never;

type Requests<Protocol> = Protocol extends ActorMessage
  ? typeof replyType extends keyof Protocol
    ? Protocol
    : never
  : never;

/** Ask using the ref's command contract. Like ref.ask, this does not validate remote data. */
export function ask<Protocol extends ActorMessage, Kind extends Requests<Protocol>['type']>(
  ref: ActorRef<unknown, Protocol>,
  message: { type: Kind } & NoInfer<Extract<Requests<Protocol>, { type: Kind }>>,
  timeout?: number
): Promise<ReplyOf<Extract<Requests<Protocol>, { type: Kind }>>> {
  // The dynamic API needs only the discriminant. Forward the original object and timeout.
  const envelope: { type: string } = message;
  return ref.ask(envelope, timeout);
}
