// ============================================================================
// 🔐 Actor System Symbols - Collision-Resistant Runtime Patterns
// ============================================================================

/**
 * Actor Runtime Symbols
 * Used for attaching runtime metadata to ActorBehavior objects
 */
export const ActorSymbols = {
  /** Symbol for attaching XState machines to actor behaviors */
  MACHINE: Symbol('actor.runtime.machine'),

  /** Symbol for attaching universal templates to actor behaviors */
  TEMPLATE: Symbol('actor.runtime.template'),

  /**
   * Symbol for attaching behavior context metadata
   * Reserved for future context isolation enhancements
   */
  CONTEXT: Symbol('actor.runtime.context'),

  /**
   * Symbol for attaching lifecycle hook metadata
   * Reserved for future lifecycle management enhancements
   */
  LIFECYCLE: Symbol('actor.runtime.lifecycle'),
} as const;

/**
 * Component Runtime Symbols
 * Used for attaching runtime metadata to DOM elements and component actors
 */
export const ComponentSymbols = {
  /** Symbol for attaching DOM event listeners to HTML elements */
  EVENT_LISTENER: Symbol('component.dom.eventListener'),

  /**
   * Symbol for attaching render root references
   * Reserved for future DOM render boundary management
   */
  RENDER_ROOT: Symbol('component.dom.renderRoot'),
} as const;
