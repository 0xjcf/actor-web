/**
 * Reactive Screen Reader Announcement System
 * XState-based screen reader announcements that follow reactive patterns
 */

import { type Actor, type SnapshotFrom, assign, setup } from 'xstate';

/**
 * Screen Reader Announcement Types
 */

export interface AnnouncementContext {
  liveRegion: HTMLElement | null;
  messageQueue: AnnouncementMessage[];
  currentMessage: AnnouncementMessage | null;
  isProcessing: boolean;
  debounceTimeout: number | null;
  lastAnnouncement: string;
  announcementHistory: AnnouncementMessage[];
  maxHistorySize: number;
  politenessLevel: 'polite' | 'assertive';
  isEnabled: boolean;
  suppressDuplicates: boolean;
  announcementDelay: number;
}

export interface AnnouncementMessage {
  id: string;
  message: string;
  priority: 'polite' | 'assertive';
  timestamp: number;
  source?: string;
  category?: 'status' | 'error' | 'success' | 'loading' | 'navigation' | 'action';
  interrupt?: boolean;
  delay?: number;
}

export type AnnouncementEvent =
  | { type: 'INITIALIZE' }
  | { type: 'CLEANUP' }
  | {
      type: 'ANNOUNCE';
      message: string;
      priority?: 'polite' | 'assertive';
      options?: Partial<AnnouncementMessage>;
    }
  | { type: 'ANNOUNCE_STATUS'; message: string; options?: Partial<AnnouncementMessage> }
  | { type: 'ANNOUNCE_ERROR'; message: string; options?: Partial<AnnouncementMessage> }
  | { type: 'ANNOUNCE_SUCCESS'; message: string; options?: Partial<AnnouncementMessage> }
  | { type: 'ANNOUNCE_LOADING'; resource: string; options?: Partial<AnnouncementMessage> }
  | { type: 'ANNOUNCE_NAVIGATION'; location: string; options?: Partial<AnnouncementMessage> }
  | {
      type: 'ANNOUNCE_ACTION';
      action: string;
      result: string;
      options?: Partial<AnnouncementMessage>;
    }
  | { type: 'PROCESS_QUEUE' }
  | { type: 'CLEAR_QUEUE' }
  | { type: 'SET_POLITENESS'; level: 'polite' | 'assertive' }
  | { type: 'ENABLE_ANNOUNCEMENTS' }
  | { type: 'DISABLE_ANNOUNCEMENTS' }
  | { type: 'SET_SUPPRESS_DUPLICATES'; suppress: boolean }
  | { type: 'SET_ANNOUNCEMENT_DELAY'; delay: number }
  | { type: 'DEBOUNCE_ANNOUNCEMENT'; message: AnnouncementMessage };

/**
 * Screen Reader Announcement State Machine
 */

export const screenReaderAnnouncementMachine = setup({
  types: {
    context: {} as AnnouncementContext,
    events: {} as AnnouncementEvent,
  },
  guards: {
    isEnabled: ({ context }) => context.isEnabled,
    hasLiveRegion: ({ context }) => context.liveRegion !== null,
    hasQueuedMessages: ({ context }) => context.messageQueue.length > 0,
    shouldSuppressDuplicate: ({ context, event }) => {
      if (!context.suppressDuplicates) return false;
      if (event.type !== 'ANNOUNCE') return false;
      return context.lastAnnouncement === event.message;
    },
    shouldInterrupt: ({ context, event }) => {
      if (!context.currentMessage) return false;
      if (event.type !== 'ANNOUNCE') return false;
      const priority = event.priority || 'polite';
      return priority === 'assertive' && context.currentMessage.priority === 'polite';
    },
    isProcessing: ({ context }) => context.isProcessing,
  },
  actions: {
    initializeAction: assign({
      liveRegion: () => createLiveRegion(),
      isEnabled: true,
      messageQueue: [],
      currentMessage: null,
      isProcessing: false,
      debounceTimeout: null,
      lastAnnouncement: '',
      announcementHistory: [],
      maxHistorySize: 50,
      politenessLevel: 'polite',
      suppressDuplicates: true,
      announcementDelay: 100,
    }),

    cleanupAction: assign({
      liveRegion: ({ context }) => {
        if (context.liveRegion) {
          context.liveRegion.remove();
        }
        return null;
      },
      messageQueue: [],
      currentMessage: null,
      isProcessing: false,
      debounceTimeout: ({ context }) => {
        if (context.debounceTimeout) {
          clearTimeout(context.debounceTimeout);
        }
        return null;
      },
      isEnabled: false,
    }),

    queueAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: event.message,
          priority: event.priority || 'polite',
          timestamp: Date.now(),
          source: event.options?.source,
          category: event.options?.category,
          interrupt: event.options?.interrupt || false,
          delay: event.options?.delay || context.announcementDelay,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueStatusAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_STATUS') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: event.message,
          priority: 'polite',
          timestamp: Date.now(),
          category: 'status',
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueErrorAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_ERROR') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: event.message,
          priority: 'assertive',
          timestamp: Date.now(),
          category: 'error',
          interrupt: true,
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueSuccessAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_SUCCESS') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: event.message,
          priority: 'polite',
          timestamp: Date.now(),
          category: 'success',
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueLoadingAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_LOADING') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: `Loading ${event.resource}...`,
          priority: 'polite',
          timestamp: Date.now(),
          category: 'loading',
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueNavigationAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_NAVIGATION') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: `Navigated to ${event.location}`,
          priority: 'polite',
          timestamp: Date.now(),
          category: 'navigation',
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    queueActionAnnouncementAction: assign({
      messageQueue: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE_ACTION') return context.messageQueue;

        const announcement: AnnouncementMessage = {
          id: generateAnnouncementId(),
          message: `${event.action}: ${event.result}`,
          priority: 'polite',
          timestamp: Date.now(),
          category: 'action',
          ...event.options,
        };

        return [...context.messageQueue, announcement];
      },
    }),

    processQueueAction: assign({
      currentMessage: ({ context }) => {
        if (context.messageQueue.length === 0) return context.currentMessage;
        return context.messageQueue[0];
      },
      messageQueue: ({ context }) => {
        if (context.messageQueue.length === 0) return context.messageQueue;
        return context.messageQueue.slice(1);
      },
      isProcessing: true,
      lastAnnouncement: ({ context }) => {
        if (context.messageQueue.length === 0) return context.lastAnnouncement;
        return context.messageQueue[0].message;
      },
      announcementHistory: ({ context }) => {
        if (context.messageQueue.length === 0) return context.announcementHistory;

        const newHistory = [...context.announcementHistory, context.messageQueue[0]];
        return newHistory.slice(-context.maxHistorySize);
      },
    }),

    announceMessageAction: ({ context }) => {
      if (context.liveRegion && context.currentMessage) {
        const { message, priority } = context.currentMessage;

        // Set the politeness level
        context.liveRegion.setAttribute('aria-live', priority);

        // Clear and then set the message to ensure it's announced
        context.liveRegion.textContent = '';

        // Use setTimeout to ensure the clearing is processed before setting new content
        setTimeout(() => {
          if (context.liveRegion) {
            context.liveRegion.textContent = message;
          }
        }, 50);
      }
    },

    clearQueueAction: assign({
      messageQueue: [],
      currentMessage: null,
      isProcessing: false,
    }),

    setPolitenessAction: assign({
      politenessLevel: ({ event }) => {
        if (event.type !== 'SET_POLITENESS') return 'polite';
        return event.level;
      },
    }),

    enableAnnouncementsAction: assign({
      isEnabled: true,
    }),

    disableAnnouncementsAction: assign({
      isEnabled: false,
    }),

    setSuppressDuplicatesAction: assign({
      suppressDuplicates: ({ event }) => {
        if (event.type !== 'SET_SUPPRESS_DUPLICATES') return true;
        return event.suppress;
      },
    }),

    setAnnouncementDelayAction: assign({
      announcementDelay: ({ event }) => {
        if (event.type !== 'SET_ANNOUNCEMENT_DELAY') return 100;
        return event.delay;
      },
    }),

    finishAnnouncementAction: assign({
      currentMessage: null,
      isProcessing: false,
    }),
  },
}).createMachine({
  id: 'screenReaderAnnouncement',
  initial: 'uninitialized',
  context: {
    liveRegion: null,
    messageQueue: [],
    currentMessage: null,
    isProcessing: false,
    debounceTimeout: null,
    lastAnnouncement: '',
    announcementHistory: [],
    maxHistorySize: 50,
    politenessLevel: 'polite',
    isEnabled: false,
    suppressDuplicates: true,
    announcementDelay: 100,
  },
  states: {
    uninitialized: {
      on: {
        INITIALIZE: {
          target: 'idle',
          actions: 'initializeAction',
        },
      },
    },
    idle: {
      on: {
        CLEANUP: {
          target: 'uninitialized',
          actions: 'cleanupAction',
        },
        ANNOUNCE: [
          {
            guard: 'shouldSuppressDuplicate',
            actions: [],
          },
          {
            guard: 'isEnabled',
            actions: 'queueAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_STATUS: [
          {
            guard: 'isEnabled',
            actions: 'queueStatusAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_ERROR: [
          {
            guard: 'isEnabled',
            actions: 'queueErrorAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_SUCCESS: [
          {
            guard: 'isEnabled',
            actions: 'queueSuccessAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_LOADING: [
          {
            guard: 'isEnabled',
            actions: 'queueLoadingAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_NAVIGATION: [
          {
            guard: 'isEnabled',
            actions: 'queueNavigationAnnouncementAction',
            target: 'processing',
          },
        ],
        ANNOUNCE_ACTION: [
          {
            guard: 'isEnabled',
            actions: 'queueActionAnnouncementAction',
            target: 'processing',
          },
        ],
        CLEAR_QUEUE: {
          actions: 'clearQueueAction',
        },
        SET_POLITENESS: {
          actions: 'setPolitenessAction',
        },
        ENABLE_ANNOUNCEMENTS: {
          actions: 'enableAnnouncementsAction',
        },
        DISABLE_ANNOUNCEMENTS: {
          actions: 'disableAnnouncementsAction',
        },
        SET_SUPPRESS_DUPLICATES: {
          actions: 'setSuppressDuplicatesAction',
        },
        SET_ANNOUNCEMENT_DELAY: {
          actions: 'setAnnouncementDelayAction',
        },
      },
    },
    processing: {
      entry: ['processQueueAction', 'announceMessageAction'],
      after: {
        500: {
          target: 'idle',
          actions: 'finishAnnouncementAction',
        },
      },
      on: {
        ANNOUNCE: [
          {
            guard: 'shouldInterrupt',
            actions: 'queueAnnouncementAction',
          },
          {
            guard: 'isEnabled',
            actions: 'queueAnnouncementAction',
          },
        ],
        ANNOUNCE_ERROR: [
          {
            guard: 'isEnabled',
            actions: 'queueErrorAnnouncementAction',
          },
        ],
        CLEAR_QUEUE: {
          target: 'idle',
          actions: 'clearQueueAction',
        },
        CLEANUP: {
          target: 'uninitialized',
          actions: 'cleanupAction',
        },
      },
    },
  },
});

/**
 * Screen Reader Announcement State Machine Types
 */

export type ScreenReaderAnnouncementActor = Actor<typeof screenReaderAnnouncementMachine>;
export type ScreenReaderAnnouncementSnapshot = SnapshotFrom<typeof screenReaderAnnouncementMachine>;

/**
 * Screen Reader Announcement Helper
 * Provides reactive screen reader announcements for templates
 */

export class ScreenReaderAnnouncementHelper {
  private actor: ScreenReaderAnnouncementActor;
  private snapshot: ScreenReaderAnnouncementSnapshot;

  constructor(actor: ScreenReaderAnnouncementActor, snapshot: ScreenReaderAnnouncementSnapshot) {
    this.actor = actor;
    this.snapshot = snapshot;
  }

  /**
   * Check if announcements are enabled
   */
  isEnabled(): boolean {
    return this.actor.getSnapshot().context.isEnabled;
  }

  /**
   * Get current message being announced
   */
  getCurrentMessage(): AnnouncementMessage | null {
    return this.actor.getSnapshot().context.currentMessage;
  }

  /**
   * Get announcement queue length
   */
  getQueueLength(): number {
    return this.actor.getSnapshot().context.messageQueue.length;
  }

  /**
   * Get announcement history
   */
  getHistory(): AnnouncementMessage[] {
    return this.actor.getSnapshot().context.announcementHistory;
  }

  /**
   * Check if currently processing announcements
   */
  isProcessing(): boolean {
    return this.actor.getSnapshot().context.isProcessing;
  }

  /**
   * Basic announcement
   */
  announce(
    message: string,
    priority: 'polite' | 'assertive' = 'polite',
    options?: Partial<AnnouncementMessage>
  ): void {
    this.actor.send({ type: 'ANNOUNCE', message, priority, options });
  }

  /**
   * Status announcement
   */
  announceStatus(message: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_STATUS', message, options });
  }

  /**
   * Error announcement
   */
  announceError(message: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_ERROR', message, options });
  }

  /**
   * Success announcement
   */
  announceSuccess(message: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_SUCCESS', message, options });
  }

  /**
   * Loading announcement
   */
  announceLoading(resource: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_LOADING', resource, options });
  }

  /**
   * Navigation announcement
   */
  announceNavigation(location: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_NAVIGATION', location, options });
  }

  /**
   * Action result announcement
   */
  announceAction(action: string, result: string, options?: Partial<AnnouncementMessage>): void {
    this.actor.send({ type: 'ANNOUNCE_ACTION', action, result, options });
  }

  /**
   * Configuration methods
   */
  enableAnnouncements(): void {
    this.actor.send({ type: 'ENABLE_ANNOUNCEMENTS' });
  }

  disableAnnouncements(): void {
    this.actor.send({ type: 'DISABLE_ANNOUNCEMENTS' });
  }

  clearQueue(): void {
    this.actor.send({ type: 'CLEAR_QUEUE' });
  }

  setPoliteness(level: 'polite' | 'assertive'): void {
    this.actor.send({ type: 'SET_POLITENESS', level });
  }

  setSuppressDuplicates(suppress: boolean): void {
    this.actor.send({ type: 'SET_SUPPRESS_DUPLICATES', suppress });
  }

  setAnnouncementDelay(delay: number): void {
    this.actor.send({ type: 'SET_ANNOUNCEMENT_DELAY', delay });
  }

  /**
   * Template helpers
   */
  getLiveRegionAttributes(): string {
    const attributes: string[] = [];
    const snapshot = this.actor.getSnapshot();

    if (snapshot.context.liveRegion) {
      attributes.push('role="status"');
      attributes.push(`aria-live="${snapshot.context.politenessLevel}"`);
      attributes.push('aria-atomic="true"');
    }

    return attributes.join(' ');
  }

  getAnnouncementStatusAttributes(): string {
    const attributes: string[] = [];
    const snapshot = this.actor.getSnapshot();

    if (snapshot.context.isProcessing) {
      attributes.push('data-announcing="true"');
    }

    if (snapshot.context.messageQueue.length > 0) {
      attributes.push(`data-announcement-queue="${snapshot.context.messageQueue.length}"`);
    }

    return attributes.join(' ');
  }
}

/**
 * Utility Functions
 */

function createLiveRegion(): HTMLElement {
  const liveRegion = document.createElement('div');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.setAttribute('role', 'status');
  liveRegion.className = 'sr-only';

  // Screen reader only styles
  liveRegion.style.cssText = `
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  `;

  document.body.appendChild(liveRegion);
  return liveRegion;
}

function generateAnnouncementId(): string {
  return `announcement-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Screen Reader Announcement Configuration
 */

export interface ScreenReaderConfig {
  enabled?: boolean;
  politenessLevel?: 'polite' | 'assertive';
  suppressDuplicates?: boolean;
  announcementDelay?: number;
  maxHistorySize?: number;
  categories?: {
    status?: boolean;
    error?: boolean;
    success?: boolean;
    loading?: boolean;
    navigation?: boolean;
    action?: boolean;
  };
}

/**
 * Default Screen Reader Configurations
 */

export const DefaultScreenReaderConfigs = {
  standard: {
    enabled: true,
    politenessLevel: 'polite' as const,
    suppressDuplicates: true,
    announcementDelay: 100,
    maxHistorySize: 50,
    categories: {
      status: true,
      error: true,
      success: true,
      loading: true,
      navigation: true,
      action: true,
    },
  },

  minimal: {
    enabled: true,
    politenessLevel: 'polite' as const,
    suppressDuplicates: true,
    announcementDelay: 200,
    maxHistorySize: 20,
    categories: {
      status: false,
      error: true,
      success: false,
      loading: false,
      navigation: false,
      action: false,
    },
  },

  verbose: {
    enabled: true,
    politenessLevel: 'polite' as const,
    suppressDuplicates: false,
    announcementDelay: 50,
    maxHistorySize: 100,
    categories: {
      status: true,
      error: true,
      success: true,
      loading: true,
      navigation: true,
      action: true,
    },
  },
} as const;

export type DefaultScreenReaderConfigType = keyof typeof DefaultScreenReaderConfigs;

/**
 * Factory Functions
 */

export function createScreenReaderAnnouncementHelper(
  actor: ScreenReaderAnnouncementActor,
  snapshot: ScreenReaderAnnouncementSnapshot
): ScreenReaderAnnouncementHelper {
  return new ScreenReaderAnnouncementHelper(actor, snapshot);
}

export function createScreenReaderConfig(
  type: DefaultScreenReaderConfigType,
  overrides?: Partial<ScreenReaderConfig>
): ScreenReaderConfig {
  return {
    ...DefaultScreenReaderConfigs[type],
    ...overrides,
  };
}

/**
 * Template Integration Helpers
 */

export interface ScreenReaderTemplateHelpers {
  announce(message: string, priority?: 'polite' | 'assertive'): void;
  announceStatus(message: string): void;
  announceError(message: string): void;
  announceSuccess(message: string): void;
  announceLoading(resource: string): void;
  announceNavigation(location: string): void;
  announceAction(action: string, result: string): void;
  isProcessing(): boolean;
  getQueueLength(): number;
}

export function createScreenReaderTemplateHelpers(
  helper: ScreenReaderAnnouncementHelper
): ScreenReaderTemplateHelpers {
  return {
    announce: (message: string, priority?: 'polite' | 'assertive') =>
      helper.announce(message, priority),
    announceStatus: (message: string) => helper.announceStatus(message),
    announceError: (message: string) => helper.announceError(message),
    announceSuccess: (message: string) => helper.announceSuccess(message),
    announceLoading: (resource: string) => helper.announceLoading(resource),
    announceNavigation: (location: string) => helper.announceNavigation(location),
    announceAction: (action: string, result: string) => helper.announceAction(action, result),
    isProcessing: () => helper.isProcessing(),
    getQueueLength: () => helper.getQueueLength(),
  };
}
