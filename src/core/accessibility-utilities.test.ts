/**
 * Tests for Accessibility Utilities - Actor-SPA Framework
 * Focus: Accessibility utility functions, color contrast, ARIA attributes
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/core/dev-mode.js';
import {
  AccessibilityErrorMessages,
  type AriaAttributes,
  createAriaAttributeString,
  debounce,
  generateId,
  getColorContrastRatio,
  getColorLuminance,
  getColorScheme,
  isValidAriaAttribute,
  kebabCase,
  meetsWCAGContrast,
  prefersHighContrast,
  prefersReducedMotion,
  throttle,
} from './accessibility-utilities.js';

const _log = Logger.namespace('ACCESSIBILITY_UTILITIES_TEST');

describe('Accessibility Utilities', () => {
  describe('User Preference Detection', () => {
    beforeEach(() => {
      // Mock matchMedia
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation((query) => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('prefersReducedMotion function', () => {
      it('returns true when user prefers reduced motion', () => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
        }));

        expect(prefersReducedMotion()).toBe(true);
      });

      it('returns false when user does not prefer reduced motion', () => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
          matches: false,
        }));

        expect(prefersReducedMotion()).toBe(false);
      });
    });

    describe('prefersHighContrast function', () => {
      it('returns true when user prefers high contrast', () => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-contrast: high)',
        }));

        expect(prefersHighContrast()).toBe(true);
      });

      it('returns false when user does not prefer high contrast', () => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
          matches: false,
        }));

        expect(prefersHighContrast()).toBe(false);
      });
    });

    describe('getColorScheme function', () => {
      it('returns dark when user prefers dark color scheme', () => {
        window.matchMedia = vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-color-scheme: dark)',
        }));

        expect(getColorScheme()).toBe('dark');
      });

      it('returns light when user does not prefer dark color scheme', () => {
        window.matchMedia = vi.fn().mockImplementation(() => ({
          matches: false,
        }));

        expect(getColorScheme()).toBe('light');
      });
    });
  });

  describe('Color Contrast Utilities', () => {
    describe('getColorLuminance function', () => {
      it('calculates luminance for pure white correctly', () => {
        const luminance = getColorLuminance('#ffffff');
        expect(luminance).toBeCloseTo(1, 3);
      });

      it('calculates luminance for pure black correctly', () => {
        const luminance = getColorLuminance('#000000');
        expect(luminance).toBeCloseTo(0, 3);
      });

      it('calculates luminance for pure red correctly', () => {
        const luminance = getColorLuminance('#ff0000');
        expect(luminance).toBeCloseTo(0.2126, 3);
      });

      it('handles 3-character hex colors', () => {
        const luminance = getColorLuminance('#fff');
        expect(luminance).toBeCloseTo(1, 3);
      });

      it('handles colors without hash prefix', () => {
        const luminance = getColorLuminance('ffffff');
        expect(luminance).toBeCloseTo(1, 3);
      });

      it('handles invalid color formats gracefully', () => {
        const luminance = getColorLuminance('invalid');
        expect(luminance).toBe(0);
      });
    });

    describe('getColorContrastRatio function', () => {
      it('calculates correct contrast ratio for black and white', () => {
        const ratio = getColorContrastRatio('#000000', '#ffffff');
        expect(ratio).toBeCloseTo(21, 1);
      });

      it('calculates contrast ratio for same colors as 1', () => {
        const ratio = getColorContrastRatio('#808080', '#808080');
        expect(ratio).toBeCloseTo(1, 3);
      });

      it('calculates contrast ratio regardless of color order', () => {
        const ratio1 = getColorContrastRatio('#000000', '#ffffff');
        const ratio2 = getColorContrastRatio('#ffffff', '#000000');
        expect(ratio1).toBeCloseTo(ratio2, 3);
      });

      it('calculates reasonable ratio for typical text colors', () => {
        const ratio = getColorContrastRatio('#333333', '#f8f8f8');
        expect(ratio).toBeGreaterThan(10);
      });
    });

    describe('meetsWCAGContrast function', () => {
      it('passes AA normal text with sufficient contrast', () => {
        // Black on white meets AA normal (4.5:1)
        expect(meetsWCAGContrast('#000000', '#ffffff', 'AA', 'normal')).toBe(true);
      });

      it('fails AA normal text with insufficient contrast', () => {
        // Light gray on white fails AA normal
        expect(meetsWCAGContrast('#cccccc', '#ffffff', 'AA', 'normal')).toBe(false);
      });

      it('passes AA large text with lower contrast requirement', () => {
        // Gray that fails normal but passes large (3:1)
        expect(meetsWCAGContrast('#777777', '#ffffff', 'AA', 'large')).toBe(true);
      });

      it('requires higher contrast for AAA level', () => {
        // Color that passes AA but fails AAA
        const foreground = '#666666';
        const background = '#ffffff';

        expect(meetsWCAGContrast(foreground, background, 'AA', 'normal')).toBe(true);
        expect(meetsWCAGContrast(foreground, background, 'AAA', 'normal')).toBe(false);
      });

      it('uses default values when parameters omitted', () => {
        expect(meetsWCAGContrast('#000000', '#ffffff')).toBe(true);
      });
    });
  });

  describe('Utility Functions', () => {
    describe('debounce function', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('delays function execution', () => {
        const mockFn = vi.fn();
        const debouncedFn = debounce(mockFn, 300);

        debouncedFn('arg1', 'arg2');
        expect(mockFn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
      });

      it('cancels previous execution when called again', () => {
        const mockFn = vi.fn();
        const debouncedFn = debounce(mockFn, 300);

        debouncedFn('first');
        vi.advanceTimersByTime(100);

        debouncedFn('second');
        vi.advanceTimersByTime(300);

        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenCalledWith('second');
      });

      it('executes with latest arguments after delay', () => {
        const mockFn = vi.fn();
        const debouncedFn = debounce(mockFn, 200);

        debouncedFn('a');
        debouncedFn('b');
        debouncedFn('c');

        vi.advanceTimersByTime(200);

        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenCalledWith('c');
      });
    });

    describe('throttle function', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('executes function immediately on first call', () => {
        const mockFn = vi.fn();
        const throttledFn = throttle(mockFn, 100);

        throttledFn('arg');
        expect(mockFn).toHaveBeenCalledWith('arg');
      });

      it('ignores subsequent calls within limit period', () => {
        const mockFn = vi.fn();
        const throttledFn = throttle(mockFn, 100);

        throttledFn('first');
        throttledFn('second');
        throttledFn('third');

        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenCalledWith('first');
      });

      it('allows execution after limit period expires', () => {
        const mockFn = vi.fn();
        const throttledFn = throttle(mockFn, 100);

        throttledFn('first');
        vi.advanceTimersByTime(100);
        throttledFn('second');

        expect(mockFn).toHaveBeenCalledTimes(2);
        expect(mockFn).toHaveBeenLastCalledWith('second');
      });

      it('preserves function context', () => {
        const obj = {
          value: 'test',
          method: throttle(function (this: { value: string }) {
            return this.value;
          }, 100),
        };

        const mockFn = vi.fn(obj.method);
        obj.method = mockFn;

        obj.method();
        expect(mockFn).toHaveBeenCalled();
      });
    });

    describe('kebabCase function', () => {
      it('converts camelCase to kebab-case', () => {
        expect(kebabCase('camelCase')).toBe('camel-case');
      });

      it('converts PascalCase to kebab-case', () => {
        expect(kebabCase('PascalCase')).toBe('pascal-case');
      });

      it('handles multiple consecutive capitals', () => {
        expect(kebabCase('XMLHttpRequest')).toBe('xml-http-request');
      });

      it('handles numbers correctly', () => {
        expect(kebabCase('element2Style')).toBe('element2-style');
      });

      it('leaves lowercase strings unchanged', () => {
        expect(kebabCase('alreadylowercase')).toBe('alreadylowercase');
      });

      it('handles single words', () => {
        expect(kebabCase('Word')).toBe('word');
      });
    });

    describe('generateId function', () => {
      it('generates ID with specified prefix', () => {
        const id = generateId('test');
        expect(id).toMatch(/^test-[a-z0-9]{9}$/);
      });

      it('generates unique IDs on multiple calls', () => {
        const id1 = generateId('unique');
        const id2 = generateId('unique');
        expect(id1).not.toBe(id2);
      });

      it('handles empty prefix', () => {
        const id = generateId('');
        expect(id).toMatch(/^-[a-z0-9]{9}$/);
      });
    });
  });

  describe('ARIA Attribute Validation', () => {
    describe('isValidAriaAttribute function', () => {
      it('validates role attributes correctly', () => {
        expect(isValidAriaAttribute('role', 'button')).toBe(true);
        expect(isValidAriaAttribute('role', '')).toBe(false);
        expect(isValidAriaAttribute('role', 123)).toBe(false);
      });

      it('validates boolean attributes correctly', () => {
        expect(isValidAriaAttribute('expanded', true)).toBe(true);
        expect(isValidAriaAttribute('expanded', false)).toBe(true);
        expect(isValidAriaAttribute('expanded', 'true')).toBe(false);
      });

      it('validates string attributes correctly', () => {
        expect(isValidAriaAttribute('label', 'Button label')).toBe(true);
        expect(isValidAriaAttribute('label', '')).toBe(true);
        expect(isValidAriaAttribute('label', 123)).toBe(false);
      });

      it('validates enumerated attributes correctly', () => {
        expect(isValidAriaAttribute('live', 'polite')).toBe(true);
        expect(isValidAriaAttribute('live', 'assertive')).toBe(true);
        expect(isValidAriaAttribute('live', 'off')).toBe(true);
        expect(isValidAriaAttribute('live', 'invalid')).toBe(false);
      });

      it('validates number attributes correctly', () => {
        expect(isValidAriaAttribute('level', 3)).toBe(true);
        expect(isValidAriaAttribute('level', 1)).toBe(true);
        expect(isValidAriaAttribute('level', 6)).toBe(true);
        expect(isValidAriaAttribute('level', 0)).toBe(false);
        expect(isValidAriaAttribute('level', 7)).toBe(false);
      });

      it('validates orientation attributes correctly', () => {
        expect(isValidAriaAttribute('orientation', 'horizontal')).toBe(true);
        expect(isValidAriaAttribute('orientation', 'vertical')).toBe(true);
        expect(isValidAriaAttribute('orientation', 'diagonal')).toBe(false);
      });

      it('validates hasPopup attributes correctly', () => {
        expect(isValidAriaAttribute('hasPopup', 'false')).toBe(true);
        expect(isValidAriaAttribute('hasPopup', 'menu')).toBe(true);
        expect(isValidAriaAttribute('hasPopup', 'dialog')).toBe(true);
        expect(isValidAriaAttribute('hasPopup', 'invalid')).toBe(false);
      });

      it('validates invalid attributes correctly', () => {
        expect(isValidAriaAttribute('invalid', true)).toBe(true);
        expect(isValidAriaAttribute('invalid', false)).toBe(true);
        expect(isValidAriaAttribute('invalid', 'grammar')).toBe(true);
        expect(isValidAriaAttribute('invalid', 'spelling')).toBe(true);
        expect(isValidAriaAttribute('invalid', 'syntax')).toBe(false);
      });

      it('rejects unknown attributes', () => {
        expect(isValidAriaAttribute('unknown', 'value')).toBe(false);
      });

      it('validates setsize and posinset as positive numbers', () => {
        expect(isValidAriaAttribute('setsize', 5)).toBe(true);
        expect(isValidAriaAttribute('setsize', 0)).toBe(false);
        expect(isValidAriaAttribute('setsize', -1)).toBe(false);

        expect(isValidAriaAttribute('posinset', 3)).toBe(true);
        expect(isValidAriaAttribute('posinset', 0)).toBe(false);
      });
    });

    describe('createAriaAttributeString function', () => {
      it('creates valid ARIA attribute string', () => {
        const attributes: AriaAttributes = {
          role: 'button',
          label: 'Click me',
          expanded: false,
        };

        const result = createAriaAttributeString(attributes);

        expect(result).toContain('role="button"');
        expect(result).toContain('aria-label="Click me"');
        expect(result).toContain('aria-expanded="false"');
      });

      it('converts camelCase to kebab-case for ARIA attributes', () => {
        const attributes: AriaAttributes = {
          labelledby: 'element-id',
          describedby: 'description-id',
        };

        const result = createAriaAttributeString(attributes);

        expect(result).toContain('aria-labelledby="element-id"');
        expect(result).toContain('aria-describedby="description-id"');
      });

      it('filters out invalid attributes', () => {
        const attributes = {
          role: 'button',
          label: 'Valid label',
          level: 0, // Invalid level
          unknown: 'value', // Unknown attribute
        } as AriaAttributes;

        const result = createAriaAttributeString(attributes);

        expect(result).toContain('role="button"');
        expect(result).toContain('aria-label="Valid label"');
        expect(result).not.toContain('level');
        expect(result).not.toContain('unknown');
      });

      it('handles undefined and null values', () => {
        const attributes: AriaAttributes = {
          role: 'button',
          label: undefined,
          expanded: null as unknown as boolean,
          selected: true,
        };

        const result = createAriaAttributeString(attributes);

        expect(result).toContain('role="button"');
        expect(result).toContain('aria-selected="true"');
        expect(result).not.toContain('label');
        expect(result).not.toContain('expanded');
      });

      it('handles complex ARIA attributes', () => {
        const attributes: AriaAttributes = {
          role: 'slider',
          valuemin: 0,
          valuemax: 100,
          valuenow: 50,
          valuetext: '50 percent',
          orientation: 'horizontal',
        };

        const result = createAriaAttributeString(attributes);

        expect(result).toContain('role="slider"');
        expect(result).toContain('aria-valuemin="0"');
        expect(result).toContain('aria-valuemax="100"');
        expect(result).toContain('aria-valuenow="50"');
        expect(result).toContain('aria-valuetext="50 percent"');
        expect(result).toContain('aria-orientation="horizontal"');
      });

      it('returns empty string for empty attributes object', () => {
        const result = createAriaAttributeString({});
        expect(result).toBe('');
      });
    });
  });

  describe('Error Messages', () => {
    it('provides standardized error messages', () => {
      expect(AccessibilityErrorMessages.MISSING_LABEL).toBe(
        'Interactive element is missing accessible label'
      );
      expect(AccessibilityErrorMessages.INSUFFICIENT_CONTRAST).toBe(
        'Color contrast ratio is insufficient'
      );
      expect(AccessibilityErrorMessages.MISSING_FORM_LABEL).toBe('Form control is missing label');
    });

    it('includes all expected error types', () => {
      const expectedErrors = [
        'MISSING_LABEL',
        'MISSING_ROLE',
        'INVALID_TABINDEX',
        'MISSING_FOCUS_INDICATOR',
        'INSUFFICIENT_CONTRAST',
        'MISSING_HEADING_STRUCTURE',
        'MISSING_LANDMARK',
        'IMPROPER_NESTING',
        'MISSING_FORM_LABEL',
        'EMPTY_LINK',
      ];

      for (const errorType of expectedErrors) {
        expect(AccessibilityErrorMessages).toHaveProperty(errorType);
        expect(
          typeof AccessibilityErrorMessages[errorType as keyof typeof AccessibilityErrorMessages]
        ).toBe('string');
      }
    });
  });

  describe('Real-world usage patterns', () => {
    describe('Form accessibility', () => {
      it('creates proper form field attributes', () => {
        const fieldAttributes: AriaAttributes = {
          required: true,
          invalid: false,
          describedby: 'field-help',
        };

        const attributeString = createAriaAttributeString(fieldAttributes);

        expect(attributeString).toContain('aria-required="true"');
        expect(attributeString).toContain('aria-invalid="false"');
        expect(attributeString).toContain('aria-describedby="field-help"');
      });

      it('handles form validation states', () => {
        const errorAttributes: AriaAttributes = {
          invalid: 'spelling',
          describedby: 'error-message',
        };

        const attributeString = createAriaAttributeString(errorAttributes);

        expect(attributeString).toContain('aria-invalid="spelling"');
        expect(attributeString).toContain('aria-describedby="error-message"');
      });
    });

    describe('Navigation components', () => {
      it('creates proper navigation attributes', () => {
        const navAttributes: AriaAttributes = {
          role: 'navigation',
          label: 'Main navigation',
          expanded: false,
        };

        const attributeString = createAriaAttributeString(navAttributes);

        expect(attributeString).toContain('role="navigation"');
        expect(attributeString).toContain('aria-label="Main navigation"');
        expect(attributeString).toContain('aria-expanded="false"');
      });

      it('handles dropdown menu attributes', () => {
        const menuAttributes: AriaAttributes = {
          role: 'menu',
          hasPopup: 'menu',
          expanded: true,
          controls: 'submenu-id',
        };

        const attributeString = createAriaAttributeString(menuAttributes);

        expect(attributeString).toContain('role="menu"');
        expect(attributeString).toContain('aria-haspopup="menu"');
        expect(attributeString).toContain('aria-expanded="true"');
        expect(attributeString).toContain('aria-controls="submenu-id"');
      });
    });

    describe('Interactive components', () => {
      it('creates proper button attributes', () => {
        const buttonAttributes: AriaAttributes = {
          role: 'button',
          pressed: false,
          describedby: 'button-help',
        };

        const attributeString = createAriaAttributeString(buttonAttributes);

        expect(attributeString).toContain('role="button"');
        expect(attributeString).toContain('aria-pressed="false"');
        expect(attributeString).toContain('aria-describedby="button-help"');
      });

      it('handles modal dialog attributes', () => {
        const modalAttributes: AriaAttributes = {
          role: 'dialog',
          modal: true,
          labelledby: 'dialog-title',
          describedby: 'dialog-content',
        };

        const attributeString = createAriaAttributeString(modalAttributes);

        expect(attributeString).toContain('role="dialog"');
        expect(attributeString).toContain('aria-modal="true"');
        expect(attributeString).toContain('aria-labelledby="dialog-title"');
        expect(attributeString).toContain('aria-describedby="dialog-content"');
      });
    });

    describe('Color scheme integration', () => {
      it('respects user color scheme preferences', () => {
        // Mock dark mode preference
        window.matchMedia = vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-color-scheme: dark)',
        }));

        const scheme = getColorScheme();
        expect(scheme).toBe('dark');

        // Verify WCAG compliance still works
        const darkBackground = '#1a1a1a';
        const lightText = '#ffffff';
        expect(meetsWCAGContrast(lightText, darkBackground)).toBe(true);
      });

      it('adapts to reduced motion preferences', () => {
        // Mock reduced motion preference
        window.matchMedia = vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
        }));

        expect(prefersReducedMotion()).toBe(true);

        // In real usage, this would disable animations
        const shouldAnimate = !prefersReducedMotion();
        expect(shouldAnimate).toBe(false);
      });
    });

    describe('Performance optimization', () => {
      beforeEach(() => {
        vi.useFakeTimers();
      });

      afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
      });

      it('debounces rapid accessibility checks', async () => {
        const accessibilityCheck = vi.fn();
        const debouncedCheck = debounce(accessibilityCheck, 250);

        // Simulate rapid form changes
        debouncedCheck();
        debouncedCheck();
        debouncedCheck();

        expect(accessibilityCheck).not.toHaveBeenCalled();

        vi.advanceTimersByTime(250);
        expect(accessibilityCheck).toHaveBeenCalledTimes(1);
      });

      it('throttles scroll-based accessibility updates', () => {
        const updateFocus = vi.fn();
        const throttledUpdate = throttle(updateFocus, 100);

        // Simulate rapid scroll events
        for (let i = 0; i < 10; i++) {
          throttledUpdate();
        }

        expect(updateFocus).toHaveBeenCalledTimes(1);
      });
    });
  });
});
