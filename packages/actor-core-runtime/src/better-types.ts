/**
 * Experimental: Better type error messages for event types
 */

// Brand type for event types
export type EventType<T extends string> = T & { readonly __brand: 'EventType' };

// Helper to create typed events
export function event<T extends string>(type: T): EventType<T> {
  return type as EventType<T>;
}

// Example usage showing cleaner errors
type MyEvents =
  | { type: EventType<'RESPONSE'>; data: number }
  | { type: EventType<'OTHER'>; data: string };

// This would show: Type '"RESPONE"' is not assignable to type 'EventType<"RESPONSE">'
// const badEvent: MyEvents = { type: event('RESPONE'), data: 42 };
