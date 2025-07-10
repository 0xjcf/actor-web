import { assign, setup } from 'xstate';

interface AriaAttributes {
  role?: string;
  label?: string;
  labelledby?: string;
  describedby?: string;
  expanded?: boolean;
  selected?: boolean;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  live?: 'off' | 'polite' | 'assertive';
  atomic?: boolean;
  busy?: boolean;
  current?: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false';
  controls?: string;
  owns?: string;
  flowto?: string;
  hasPopup?: 'false' | 'true' | 'menu' | 'listbox' | 'tree' | 'grid' | 'dialog';
  invalid?: boolean | 'grammar' | 'spelling';
  level?: number;
  modal?: boolean;
  multiline?: boolean;
  multiselectable?: boolean;
  orientation?: 'horizontal' | 'vertical';
  pressed?: boolean;
  readonly?: boolean;
  required?: boolean;
  sort?: 'none' | 'ascending' | 'descending' | 'other';
  valuemax?: number;
  valuemin?: number;
  valuenow?: number;
  valuetext?: string;
}

interface AccessibilityContext {
  announcements: Array<{
    id: string;
    message: string;
    priority: 'polite' | 'assertive';
    timestamp: number;
  }>;
  focusHistory: string[];
  currentFocus?: string;
  screenReaderEnabled: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  colorScheme: 'light' | 'dark';
}

type AccessibilityEvent =
  | { type: 'ANNOUNCE'; message: string; priority?: 'polite' | 'assertive' }
  | { type: 'FOCUS_ELEMENT'; elementId: string }
  | { type: 'RESTORE_FOCUS' }
  | { type: 'PUSH_FOCUS_HISTORY'; elementId: string }
  | { type: 'CLEAR_ANNOUNCEMENTS' }
  | { type: 'UPDATE_PREFERENCES' }
  | { type: 'LOADING_START'; resource?: string }
  | { type: 'LOADING_END' }
  | { type: 'ERROR_OCCURRED'; error: string }
  | { type: 'SUCCESS_ACTION'; action: string };

const accessibilityService = setup({
  types: {
    context: {} as AccessibilityContext,
    events: {} as AccessibilityEvent,
  },
  actions: {
    announce: assign({
      announcements: ({ context, event }) => {
        if (event.type !== 'ANNOUNCE') return context.announcements;

        const announcement = {
          id: `announce-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          message: event.message,
          priority: event.priority || 'polite',
          timestamp: Date.now(),
        };

        return [...context.announcements, announcement];
      },
    }),
    clearOldAnnouncements: assign({
      announcements: ({ context }) => {
        const oneMinuteAgo = Date.now() - 60000;
        return context.announcements.filter((a) => a.timestamp > oneMinuteAgo);
      },
    }),
    pushFocusHistory: assign({
      focusHistory: ({ context, event }) => {
        if (event.type !== 'PUSH_FOCUS_HISTORY') return context.focusHistory;
        return [...context.focusHistory, event.elementId];
      },
    }),
    restoreFocus: assign({
      currentFocus: ({ context }) => {
        return context.focusHistory[context.focusHistory.length - 1];
      },
      focusHistory: ({ context }) => {
        return context.focusHistory.slice(0, -1);
      },
    }),
    setCurrentFocus: assign({
      currentFocus: ({ event }) => {
        if (event.type !== 'FOCUS_ELEMENT') return undefined;
        return event.elementId;
      },
    }),
    updatePreferences: assign({
      reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      highContrast: () => window.matchMedia('(prefers-contrast: high)').matches,
      colorScheme: () =>
        window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      screenReaderEnabled: () =>
        window.navigator.userAgent.includes('NVDA') ||
        window.navigator.userAgent.includes('JAWS') ||
        window.speechSynthesis !== undefined,
    }),
    announceLoading: assign({
      announcements: ({ context, event }) => {
        if (event.type !== 'LOADING_START') return context.announcements;

        const message = event.resource ? `Loading ${event.resource}...` : 'Loading...';
        const announcement = {
          id: `loading-${Date.now()}`,
          message,
          priority: 'polite' as const,
          timestamp: Date.now(),
        };

        return [...context.announcements, announcement];
      },
    }),
    announceError: assign({
      announcements: ({ context, event }) => {
        if (event.type !== 'ERROR_OCCURRED') return context.announcements;

        const announcement = {
          id: `error-${Date.now()}`,
          message: `Error: ${event.error}`,
          priority: 'assertive' as const,
          timestamp: Date.now(),
        };

        return [...context.announcements, announcement];
      },
    }),
    announceSuccess: assign({
      announcements: ({ context, event }) => {
        if (event.type !== 'SUCCESS_ACTION') return context.announcements;

        const announcement = {
          id: `success-${Date.now()}`,
          message: `Success: ${event.action}`,
          priority: 'polite' as const,
          timestamp: Date.now(),
        };

        return [...context.announcements, announcement];
      },
    }),
  },
}).createMachine({
  id: 'accessibility-service',
  initial: 'ready',
  context: {
    announcements: [],
    focusHistory: [],
    currentFocus: undefined,
    screenReaderEnabled: false,
    reducedMotion: false,
    highContrast: false,
    colorScheme: 'light',
  },
  states: {
    ready: {
      entry: 'updatePreferences',
      on: {
        ANNOUNCE: { actions: 'announce' },
        FOCUS_ELEMENT: { actions: ['pushFocusHistory', 'setCurrentFocus'] },
        RESTORE_FOCUS: { actions: 'restoreFocus' },
        PUSH_FOCUS_HISTORY: { actions: 'pushFocusHistory' },
        CLEAR_ANNOUNCEMENTS: { actions: 'clearOldAnnouncements' },
        UPDATE_PREFERENCES: { actions: 'updatePreferences' },
        LOADING_START: { actions: 'announceLoading' },
        ERROR_OCCURRED: { actions: 'announceError' },
        SUCCESS_ACTION: { actions: 'announceSuccess' },
      },
      after: {
        60000: { actions: 'clearOldAnnouncements' },
      },
    },
  },
});

export const createAriaAttributes = (attrs: AriaAttributes): Record<string, string> => {
  const result: Record<string, string> = {};

  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      const ariaKey = key === 'role' ? 'role' : `aria-${kebabCase(key)}`;
      result[ariaKey] = String(value);
    }
  });

  return result;
};

export const createFocusableSelector = (): string => {
  return [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"]):not([disabled])',
    '[contenteditable="true"]',
  ].join(', ');
};

export const createKeyboardNavigation = (
  orientation: 'horizontal' | 'vertical' | 'both' = 'vertical',
  _wrap = true
) => {
  const keyMappings: Record<string, string> = {};

  if (orientation === 'vertical' || orientation === 'both') {
    keyMappings.ArrowDown = 'NAVIGATE_NEXT';
    keyMappings.ArrowUp = 'NAVIGATE_PREVIOUS';
  }

  if (orientation === 'horizontal' || orientation === 'both') {
    keyMappings.ArrowRight = 'NAVIGATE_NEXT';
    keyMappings.ArrowLeft = 'NAVIGATE_PREVIOUS';
  }

  keyMappings.Home = 'NAVIGATE_FIRST';
  keyMappings.End = 'NAVIGATE_LAST';

  return keyMappings;
};

export const generateAccessibilityId = (prefix = 'a11y'): string => {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
};

export const createScreenReaderStyles = (): string => {
  return `
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
};

export const getUserPreferences = () => ({
  reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  highContrast: window.matchMedia('(prefers-contrast: high)').matches,
  colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
});

export const validateContrast = (
  foreground: string,
  background: string
): {
  ratio: number;
  meetsAA: boolean;
  meetsAAA: boolean;
} => {
  const ratio = calculateContrastRatio(foreground, background);
  return {
    ratio,
    meetsAA: ratio >= 4.5,
    meetsAAA: ratio >= 7,
  };
};

export const createLiveRegionTemplate = (
  announcements: Array<{ message: string; priority: 'polite' | 'assertive' }>
) => {
  const politeMessages = announcements
    .filter((a) => a.priority === 'polite')
    .map((a) => a.message)
    .join(' ');

  const assertiveMessages = announcements
    .filter((a) => a.priority === 'assertive')
    .map((a) => a.message)
    .join(' ');

  return {
    polite: politeMessages,
    assertive: assertiveMessages,
  };
};

const kebabCase = (str: string): string => {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
};

const calculateContrastRatio = (foreground: string, background: string): number => {
  const l1 = getLuminance(foreground);
  const l2 = getLuminance(background);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const getLuminance = (color: string): number => {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((c) => {
    const normalized = c / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        Number.parseInt(result[1], 16),
        Number.parseInt(result[2], 16),
        Number.parseInt(result[3], 16),
      ]
    : null;
};

export { accessibilityService };
export type { AccessibilityContext, AccessibilityEvent, AriaAttributes };
