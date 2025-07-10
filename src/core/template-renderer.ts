/**
 * Template Rendering System
 *
 * Replaces innerHTML/textContent with reactive, safe template rendering.
 * Part of Phase 0.7 Reactive Infrastructure.
 */

import { safeSerialize } from './json-utilities.js';

export type TemplateFunction<T = unknown> = (state: T) => RawHTML;

export interface RenderOptions {
  sanitize?: boolean;
  differential?: boolean; // For future morphdom integration
}

interface TemplateBinding<T> {
  element: HTMLElement;
  template: TemplateFunction<T>;
  lastState?: T;
  lastHtml?: string;
}

/**
 * Core Template Renderer
 * Provides safe, reactive template rendering without external dependencies
 */

// Module-level state
const templates = new Map<string, TemplateFunction>();
const bindings = new Map<string, TemplateBinding<unknown>>();

/**
 * Register a reusable template
 */
export function registerTemplate(name: string, template: TemplateFunction): void {
  templates.set(name, template);
}

/**
 * Get a registered template
 */
export function getTemplate(name: string): TemplateFunction | undefined {
  return templates.get(name);
}

/**
 * Basic HTML sanitization (simple version - can be enhanced)
 */
function sanitizeHtml(html: string): string {
  // Create a temporary element to leverage browser's parsing
  const temp = document.createElement('div');
  temp.innerHTML = html;

  // Remove potentially dangerous elements and attributes
  const dangerousElements = Array.from(temp.querySelectorAll('script, object, embed, iframe'));
  for (const element of dangerousElements) {
    element.remove();
  }

  // Remove dangerous attributes
  const allElements = Array.from(temp.querySelectorAll('*'));
  for (const element of allElements) {
    const attributes = Array.from(element.attributes);
    for (const attr of attributes) {
      if (attr.name.startsWith('on') || attr.name === 'javascript:') {
        element.removeAttribute(attr.name);
      }
    }
  }

  return temp.innerHTML;
}

/**
 * Render template with state
 */
export function render<T>(
  element: HTMLElement,
  template: TemplateFunction<T> | string,
  state: T,
  options: RenderOptions = { sanitize: true }
): void {
  // Get template function
  const templateFn = typeof template === 'string' ? templates.get(template) : template;

  if (!templateFn) {
    throw new Error(`Template not found: ${template}`);
  }

  // Generate HTML - now returns RawHTML
  const htmlResult = templateFn(state);
  let html = htmlResult.html;

  // Sanitize if needed
  if (options.sanitize) {
    html = sanitizeHtml(html);
  }

  // Update DOM only if content changed
  if (element.innerHTML !== html) {
    element.innerHTML = html;
  }
}

/**
 * Create a reactive template binding
 */
export function createBinding<T>(
  element: HTMLElement,
  template: TemplateFunction<T> | string,
  stateGetter: () => T,
  options?: RenderOptions
): () => void {
  const bindingId = generateBindingId();

  // Get template function
  const templateFn = typeof template === 'string' ? templates.get(template) : template;

  if (!templateFn) {
    throw new Error(`Template not found: ${template}`);
  }

  // Create binding
  const binding: TemplateBinding<T> = {
    element,
    template: templateFn,
  };

  bindings.set(bindingId, binding as TemplateBinding<unknown>);

  // Initial render
  const updateFn = () => {
    const currentState = stateGetter();

    // Check if state changed (shallow comparison)
    if (binding.lastState !== currentState) {
      render(element, templateFn, currentState, options);
      binding.lastState = currentState;
    }
  };

  updateFn(); // Initial render

  // Return update function and cleanup
  return () => {
    updateFn();
  };
}

/**
 * Remove a template binding
 */
export function removeBinding(bindingId: string): void {
  bindings.delete(bindingId);
}

/**
 * Update all active bindings
 */
export function updateAllBindings(): void {
  for (const [, binding] of Array.from(bindings.entries())) {
    // Force update by clearing last state
    binding.lastState = undefined;
  }
}

/**
 * Generate unique binding ID
 */
function generateBindingId(): string {
  return `binding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Clear all templates and bindings
 */
export function clear(): void {
  templates.clear();
  bindings.clear();
}

/**
 * CSS template literal tag for styles (most editors highlight this automatically)
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): { css: string } {
  const cssString = strings.reduce((result, str, i) => {
    const value = values[i];
    return result + str + (value ?? '');
  }, '');

  return { css: cssString };
}

/**
 * Template literal tag with automatic HTML escaping for security
 * Enhanced to automatically handle arrays - no more .join('') needed!
 * Enhanced to automatically serialize objects to JSON for attributes!
 * Returns RawHTML so nested html`` calls preserve HTML
 *
 * @example
 * ```typescript
 * const template = html`<div class="example">${content}</div>`;
 * // Objects automatically serialized:
 * const template = html`<button payload=${{ id: 123, name: "John" }}>Click</button>`;
 * ```
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): RawHTML {
  const htmlString = strings.reduce((result, str, i) => {
    const value = values[i];
    if (value === undefined || value === null) {
      return result + str;
    }

    // Check if this is already a RawHTML object (from nested html`` calls)
    if (typeof value === 'object' && value !== null && 'isRawHTML' in value) {
      return result + str + (value as RawHTML).html;
    }

    // ✨ SMART ATTRIBUTE DETECTION: Check if we're in an unquoted attribute context
    const isUnquotedAttribute = detectUnquotedAttributeContext(result, str);

    if (isUnquotedAttribute && (typeof value === 'object' || Array.isArray(value))) {
      // ✅ AUTO-QUOTE: Automatically add quotes and serialize objects/arrays
      try {
        const serialized = safeSerialize(value);
        return `${result}"${serialized}"${str}`;
      } catch (_error) {
        return `${result}"${escapeHtml(String(value))}"${str}`;
      }
    }

    // ✨ ENHANCED: Arrays in content vs quoted attributes - detect context
    if (Array.isArray(value)) {
      // Check if this appears to be in a quoted attribute context
      const beforeContext = result.slice(-20);
      const isInQuotedAttribute = beforeContext.includes('="') || beforeContext.includes("='");

      if (isInQuotedAttribute) {
        // ✅ CONSISTENT: Auto-serialize arrays in quoted attributes like objects
        try {
          const serialized = safeSerialize(value);
          return result + str + serialized;
        } catch (_error) {
          return result + str + escapeHtml(String(value));
        }
      } else {
        // ✅ CONTENT: Arrays in content are joined as HTML (existing behavior)
        const joinedValue = value
          .map((item) => {
            if (typeof item === 'object' && item !== null && 'isRawHTML' in item) {
              return (item as RawHTML).html;
            }
            // Check if the string looks like HTML (starts with <)
            const itemStr = String(item);
            if (itemStr.trim().startsWith('<') && itemStr.trim().endsWith('>')) {
              return itemStr; // Already HTML, don't escape
            }
            return escapeHtml(itemStr);
          })
          .join('');
        return result + str + joinedValue;
      }
    }

    // ✨ CONSISTENT: Automatically serialize objects to JSON for attributes
    if (typeof value === 'object' && value !== null) {
      try {
        const serialized = safeSerialize(value);
        return result + str + serialized;
      } catch (_error) {
        return result + str + escapeHtml(String(value));
      }
    }

    // Auto-escape all other values for security
    const stringValue = String(value);
    const escapedValue = escapeHtml(stringValue);
    return result + str + escapedValue;
  }, '');

  return { html: htmlString, isRawHTML: true };
}

/**
 * Detect if we're in an unquoted attribute context
 * Examples:
 * - "attr=" + value + " next" → true (unquoted attribute)
 * - "attr=\"" + value + "\" next" → false (quoted attribute)
 * - "text " + value + " more" → false (content context)
 */
function detectUnquotedAttributeContext(beforeString: string, afterString: string): boolean {
  // Check if the before string ends with an attribute assignment
  const beforeTrimmed = beforeString.trim();
  const endsWithAttributeAssignment = /[\w-]+=\s*$/.test(beforeTrimmed);

  if (!endsWithAttributeAssignment) {
    return false;
  }

  // Check if the after string starts with something that would complete an unquoted attribute
  const afterTrimmed = afterString.trim();
  const startsWithAttributeEnd =
    /^[\s>]/.test(afterString) || afterTrimmed.startsWith(' ') || afterTrimmed === '';

  return startsWithAttributeEnd;
}

/**
 * HTML marker interface for template system output
 */
export interface RawHTML {
  html: string;
  isRawHTML: true;
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Example templates for common patterns
export const CommonTemplates = {
  button: (state: { text: string; disabled?: boolean; variant?: string }) => html`
    <button 
      class="btn ${state.variant || 'primary'}"
      ${state.disabled ? 'disabled' : ''}
      data-ref="button"
    >
      ${state.text}
    </button>
  `,

  loading: (state: { message?: string }) => html`
    <div class="loading" data-ref="loading">
      <div class="spinner"></div>
      ${state.message ? html`<p>${state.message}</p>` : ''}
    </div>
  `,

  error: (state: { message: string; retry?: boolean }) => html`
    <div class="error" data-ref="error">
      <p class="error-message">${state.message}</p>
      ${state.retry === true ? html`<button data-action="retry">Try Again</button>` : ''}
    </div>
  `,

  list: <T>(state: {
    items: T[];
    itemTemplate: (item: T, index: number) => string;
    emptyMessage?: string;
  }) => html`
    <div class="list" data-ref="list">
      ${
        state.items.length > 0
          ? state.items.map(state.itemTemplate)
          : html`<p class="empty">${state.emptyMessage || 'No items'}</p>`
      }
    </div>
  `,
};

// Register common templates with proper type casting
registerTemplate('button', CommonTemplates.button as TemplateFunction);
registerTemplate('loading', CommonTemplates.loading as TemplateFunction);
registerTemplate('error', CommonTemplates.error as TemplateFunction);
registerTemplate('list', CommonTemplates.list as TemplateFunction);
