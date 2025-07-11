/**
 * Behavior Tests for Template Renderer - Actor-SPA Framework
 *
 * Focus: What users see in the rendered output
 * Updated to use framework testing utilities following TESTING-GUIDE.md
 */

import {
  type TestEnvironment,
  createTestEnvironment,
  templateTestUtils,
} from '@/testing/actor-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { css, html } from './template-renderer.js';

describe('html template tag', () => {
  let testEnv: TestEnvironment;

  beforeEach(() => {
    testEnv = createTestEnvironment();
  });

  afterEach(() => {
    testEnv.cleanup();
  });
  it('renders text content', () => {
    const result = html`Hello World`;
    expect(result.html).toBe('Hello World');
  });

  it('renders HTML elements', () => {
    const result = html`<button>Click me</button>`;
    expect(result.html).toBe('<button>Click me</button>');
  });

  it('includes dynamic values in output', () => {
    const name = 'Alice';
    const result = html`Hello ${name}`;
    expect(result.html).toBe('Hello Alice');
  });

  it('combines multiple values', () => {
    const first = 'Hello';
    const second = 'World';
    const result = html`${first} ${second}`;
    expect(result.html).toBe('Hello World');
  });

  it('handles numbers', () => {
    const count = 42;
    const result = html`Count: ${count}`;
    expect(result.html).toBe('Count: 42');
  });

  it('handles empty strings', () => {
    const empty = '';
    const result = html`[${empty}]`;
    expect(result.html).toBe('[]');
  });

  it('renders lists', () => {
    const items = ['A', 'B', 'C'];
    const result = html`${items.map((item) => html`<li>${item}</li>`)}`;
    expect(result.html).toBe('<li>A</li><li>B</li><li>C</li>');
  });

  it('renders conditional content', () => {
    const show = true;
    const result = html`${show ? html`<div>Visible</div>` : ''}`;
    expect(result.html).toBe('<div>Visible</div>');
  });

  it('skips falsy conditional content', () => {
    const show = false;
    const result = html`${show ? html`<div>Hidden</div>` : ''}`;
    expect(result.html).toBe('');
  });

  it('escapes user input by default', () => {
    const userInput = '<script>alert("xss")</script>';
    const result = html`${userInput}`;

    // Use framework utilities for XSS protection testing
    templateTestUtils.expectEscaped(result, userInput);
  });

  it('preserves HTML from nested templates', () => {
    const bold = html`<strong>Important</strong>`;
    const result = html`<p>${bold}</p>`;
    expect(result.html).toBe('<p><strong>Important</strong></p>');
  });

  it('handles attributes', () => {
    const className = 'primary';
    const result = html`<button class="${className}">Click</button>`;
    expect(result.html).toBe('<button class="primary">Click</button>');
  });

  it('handles boolean attributes', () => {
    const disabled = true;
    const result = html`<button disabled="${disabled}">Click</button>`;
    expect(result.html).toBe('<button disabled="true">Click</button>');
  });

  it('handles event attributes', () => {
    const result = html`<button send="CLICK">Click</button>`;
    expect(result.html).toBe('<button send="CLICK">Click</button>');
  });

  it('returns an object with html property', () => {
    const result = html`<div>Test</div>`;
    expect(result).toHaveProperty('html');
    expect(typeof result.html).toBe('string');
  });
});

describe('css template tag', () => {
  it('renders CSS rules', () => {
    const result = css`.button { color: blue; }`;
    expect(result.css).toBe('.button { color: blue; }');
  });

  it('includes dynamic values', () => {
    const color = 'red';
    const result = css`.text { color: ${color}; }`;
    expect(result.css).toBe('.text { color: red; }');
  });

  it('handles multiple properties', () => {
    const size = '16px';
    const weight = 'bold';
    const result = css`
      .text {
        font-size: ${size};
        font-weight: ${weight};
      }
    `;
    expect(result.css).toContain('font-size: 16px');
    expect(result.css).toContain('font-weight: bold');
  });

  it('returns an object with css property', () => {
    const result = css`.test { color: blue; }`;
    expect(result).toHaveProperty('css');
    expect(typeof result.css).toBe('string');
  });
});

describe('Real-world usage patterns', () => {
  it('renders a complete component template', () => {
    const state = { count: 5 };
    const template = html`
      <div class="counter">
        <span>Count: ${state.count}</span>
        <button send="INCREMENT">+</button>
      </div>
    `;

    // Use framework utilities for template content validation
    templateTestUtils.expectTemplateContains(template, [
      'Count: 5',
      'send="INCREMENT"',
      '<div class="counter">',
      '<button',
    ]);
  });

  it('renders a list with proper HTML structure', () => {
    const todos = [
      { text: 'Learn', done: true },
      { text: 'Build', done: false },
    ];

    const template = html`
      <ul>
        ${todos.map(
          (todo) => html`
          <li class="${todo.done ? 'done' : ''}">
            ${todo.text}
          </li>
        `
        )}
      </ul>
    `;

    // Use framework utilities for comprehensive template validation
    templateTestUtils.expectTemplateContains(template, [
      '<ul>',
      '</ul>',
      '<li class="done">',
      '<li class="">',
      'Learn',
      'Build',
    ]);
  });

  it('renders form inputs with values', () => {
    const value = 'user@example.com';
    const template = html`
      <input type="email" value="${value}" send:input="UPDATE_EMAIL" />
    `;

    templateTestUtils.expectTemplateContains(template, [
      'value="user@example.com"',
      'send:input="UPDATE_EMAIL"',
      'type="email"',
    ]);
  });

  it('renders accessible button states', () => {
    const loading = true;
    const template = html`
      <button 
        aria-busy="${loading}"
        disabled="${loading}"
        send="SUBMIT"
      >
        ${loading ? 'Loading...' : 'Submit'}
      </button>
    `;

    templateTestUtils.expectTemplateContains(template, [
      'aria-busy="true"',
      'disabled="true"',
      'Loading...',
      'send="SUBMIT"',
    ]);
  });
});

describe('Security and Safety', () => {
  it('prevents XSS with malicious script tags', () => {
    const maliciousScript = '<script>alert("hack")</script>';
    const template = html`<div>${maliciousScript}</div>`;

    templateTestUtils.expectEscaped(template, maliciousScript);
    templateTestUtils.expectTemplateNotContains(template, '<script>');
  });

  it('prevents XSS with malicious image tags', () => {
    const maliciousImg = '<img src="x" onerror="alert(1)">';
    const template = html`<div>${maliciousImg}</div>`;

    templateTestUtils.expectEscaped(template, maliciousImg);
    // Verify that the onerror attribute is escaped, not executable
    templateTestUtils.expectTemplateContains(template, [
      '&lt;img',
      'onerror=',
      '&quot;alert(1)&quot;',
    ]);
    templateTestUtils.expectTemplateNotContains(template, '<img');
  });

  it('prevents XSS with malicious link tags', () => {
    const maliciousLink = '<a href="javascript:alert(1)">click</a>';
    const template = html`<div>${maliciousLink}</div>`;

    templateTestUtils.expectEscaped(template, maliciousLink);
    // Verify that the javascript: protocol is escaped, not executable
    templateTestUtils.expectTemplateContains(template, ['&lt;a', 'href=', 'javascript:']);
    templateTestUtils.expectTemplateNotContains(template, '<a href="javascript');
  });
});
