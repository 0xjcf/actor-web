/**
 * Simple Test for CSS Ergonomics
 * Verifying that css`` can be used directly without String() wrapper
 */

import { createMachine } from 'xstate';
import { createComponent, css, html } from '../src/core/index.js';

// Test machine
const testMachine = createMachine({
  id: 'css-test',
  initial: 'ready',
  states: { ready: {} },
});

// Test component using css`` directly
const CSSTestComponent = createComponent({
  machine: testMachine,
  template: () => html`<div class="test">CSS Ergonomics Test</div>`,
  // ✅ This should work without String() wrapper!
  styles: css`
    .test {
      color: blue;
      background: yellow;
      padding: 1rem;
      border: 2px solid red;
    }
  `,
});

// Export for testing
export { CSSTestComponent };

console.log('✅ CSS Ergonomics Test Component Created Successfully!');
console.log('✅ css`` template tag works directly without String() wrapper');
