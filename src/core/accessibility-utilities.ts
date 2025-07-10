/**
 * Pure Accessibility Utility Functions
 * These functions don't violate reactive patterns - they're pure, side-effect-free utilities
 */

/**
 * User Preference Detection
 * Pure functions that read system preferences without DOM manipulation
 */

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function prefersHighContrast(): boolean {
  return window.matchMedia('(prefers-contrast: high)').matches;
}

export function getColorScheme(): 'light' | 'dark' {
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/**
 * Color Contrast Utilities
 * Pure functions for color contrast calculations
 */

/**
 * Convert hex color to RGB values
 */
function hexToRgb(hex: string): [number, number, number] | null {
  // Remove the hash if it exists
  let cleanHex = hex.replace('#', '');

  // Parse 3 or 6 character hex
  if (cleanHex.length === 3) {
    cleanHex = cleanHex
      .split('')
      .map((char) => char + char)
      .join('');
  }

  if (cleanHex.length !== 6) return null;

  const r = Number.parseInt(cleanHex.substr(0, 2), 16);
  const g = Number.parseInt(cleanHex.substr(2, 2), 16);
  const b = Number.parseInt(cleanHex.substr(4, 2), 16);

  return [r, g, b];
}

/**
 * Calculate relative luminance of a color
 */
export function getColorLuminance(color: string): number {
  const rgb = hexToRgb(color);
  if (!rgb) return 0;

  const [r, g, b] = rgb.map((c) => {
    const sRGB = c / 255;
    return sRGB <= 0.03928 ? sRGB / 12.92 : ((sRGB + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Calculate contrast ratio between two colors
 */
export function getColorContrastRatio(color1: string, color2: string): number {
  const luminance1 = getColorLuminance(color1);
  const luminance2 = getColorLuminance(color2);

  const brightest = Math.max(luminance1, luminance2);
  const darkest = Math.min(luminance1, luminance2);

  return (brightest + 0.05) / (darkest + 0.05);
}

/**
 * Check if color combination meets WCAG contrast requirements
 */
export function meetsWCAGContrast(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA' = 'AA',
  size: 'normal' | 'large' = 'normal'
): boolean {
  const contrastRatio = getColorContrastRatio(foreground, background);
  const minRatio = level === 'AAA' ? (size === 'large' ? 4.5 : 7) : size === 'large' ? 3 : 4.5;
  return contrastRatio >= minRatio;
}

/**
 * Pure Utility Functions
 * Functions that don't perform DOM operations
 */

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const executeFunction = () => {
      timeout = null;
      func(...args);
    };

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(executeFunction, wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function executedFunction(this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}

/**
 * String Utilities
 * Pure functions for string manipulation
 */

export function kebabCase(str: string): string {
  return str.replace(/([a-z0-9]|(?=[A-Z]))([A-Z])/g, '$1-$2').toLowerCase();
}

export function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * ARIA Attribute Types
 * Type definitions for ARIA attributes
 */

export interface AriaAttributes {
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
  setsize?: number;
  posinset?: number;
}

/**
 * Accessibility Issue Types
 * Type definitions for accessibility validation
 */

export interface AccessibilityIssue {
  element: HTMLElement;
  type: 'error' | 'warning';
  rule: string;
  message: string;
  suggestion?: string;
}

/**
 * Keyboard Navigation Configuration
 * Type definitions for keyboard navigation
 */

export interface KeyboardConfig {
  keys: string[];
  handler: (event: KeyboardEvent) => void;
  preventDefault?: boolean;
  stopPropagation?: boolean;
}

/**
 * Focus Management Configuration
 * Type definitions for focus management
 */

export interface FocusOptions {
  preventScroll?: boolean;
  restoreFocus?: boolean;
  trapFocus?: boolean;
  skipHidden?: boolean;
}

/**
 * Accessibility Announcement Configuration
 * Type definitions for screen reader announcements
 */

export interface AnnouncementConfig {
  message: string;
  priority?: 'polite' | 'assertive';
  interrupt?: boolean;
}

/**
 * Pure Validation Functions
 * Functions that validate data without DOM manipulation
 */

export function isValidAriaAttribute(key: string, value: unknown): boolean {
  const ariaAttributes: Record<string, (value: unknown) => boolean> = {
    role: (v) => typeof v === 'string' && v.length > 0,
    label: (v) => typeof v === 'string',
    labelledby: (v) => typeof v === 'string',
    describedby: (v) => typeof v === 'string',
    expanded: (v) => typeof v === 'boolean',
    selected: (v) => typeof v === 'boolean',
    checked: (v) => typeof v === 'boolean',
    disabled: (v) => typeof v === 'boolean',
    hidden: (v) => typeof v === 'boolean',
    live: (v) => typeof v === 'string' && ['off', 'polite', 'assertive'].includes(v as string),
    atomic: (v) => typeof v === 'boolean',
    busy: (v) => typeof v === 'boolean',
    current: (v) =>
      typeof v === 'string' &&
      ['page', 'step', 'location', 'date', 'time', 'true', 'false'].includes(v as string),
    controls: (v) => typeof v === 'string',
    owns: (v) => typeof v === 'string',
    flowto: (v) => typeof v === 'string',
    hasPopup: (v) =>
      typeof v === 'string' &&
      ['false', 'true', 'menu', 'listbox', 'tree', 'grid', 'dialog'].includes(v as string),
    invalid: (v) =>
      typeof v === 'boolean' ||
      (typeof v === 'string' && ['grammar', 'spelling'].includes(v as string)),
    level: (v) => typeof v === 'number' && v >= 1 && v <= 6,
    modal: (v) => typeof v === 'boolean',
    multiline: (v) => typeof v === 'boolean',
    multiselectable: (v) => typeof v === 'boolean',
    orientation: (v) => typeof v === 'string' && ['horizontal', 'vertical'].includes(v as string),
    pressed: (v) => typeof v === 'boolean',
    readonly: (v) => typeof v === 'boolean',
    required: (v) => typeof v === 'boolean',
    sort: (v) =>
      typeof v === 'string' && ['none', 'ascending', 'descending', 'other'].includes(v as string),
    valuemax: (v) => typeof v === 'number',
    valuemin: (v) => typeof v === 'number',
    valuenow: (v) => typeof v === 'number',
    valuetext: (v) => typeof v === 'string',
    setsize: (v) => typeof v === 'number' && v > 0,
    posinset: (v) => typeof v === 'number' && v > 0,
  };

  const validator = ariaAttributes[key];
  return validator ? validator(value) : false;
}

export function createAriaAttributeString(attributes: AriaAttributes): string {
  const validAttributes: string[] = [];

  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== undefined && value !== null && isValidAriaAttribute(key, value)) {
      const ariaKey = key === 'role' ? 'role' : `aria-${kebabCase(key)}`;
      validAttributes.push(`${ariaKey}="${String(value)}"`);
    }
  });

  return validAttributes.join(' ');
}

/**
 * Error Messages
 * Standardized error messages for accessibility issues
 */

export const AccessibilityErrorMessages = {
  MISSING_LABEL: 'Interactive element is missing accessible label',
  MISSING_ROLE: 'Element is missing appropriate ARIA role',
  INVALID_TABINDEX: 'Element has invalid tabindex value',
  MISSING_FOCUS_INDICATOR: 'Element is missing focus indicator',
  INSUFFICIENT_CONTRAST: 'Color contrast ratio is insufficient',
  MISSING_HEADING_STRUCTURE: 'Page is missing proper heading structure',
  MISSING_LANDMARK: 'Page is missing landmark elements',
  IMPROPER_NESTING: 'Element is improperly nested',
  MISSING_FORM_LABEL: 'Form control is missing label',
  EMPTY_LINK: 'Link contains no accessible text',
} as const;

export type AccessibilityErrorMessage =
  (typeof AccessibilityErrorMessages)[keyof typeof AccessibilityErrorMessages];
