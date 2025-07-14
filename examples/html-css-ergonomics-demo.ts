/**
 * Demonstration of the New Ergonomic html`` and css`` Template Tags
 *
 * ✅ BEFORE: Required .html and .css property access
 * ❌ template: () => html`<div>Hello</div>`.html
 * ❌ styles: css`body { color: red; }`.css
 *
 * ✅ AFTER: Direct usage - no property access needed!
 * ✅ template: () => html`<div>Hello</div>`
 * ✅ styles: css`body { color: red; }`
 */

import { createMachine } from 'xstate';
import { createEnhancedComponent } from '../src/core/enhanced-component.js';
import { createComponent, css, html } from '../src/core/index.js';

// ✨ Example 1: Regular Component with New Ergonomics
const regularMachine = createMachine({
  id: 'regular-demo',
  initial: 'greeting',
  context: { name: 'World' },
  states: {
    greeting: {
      on: {
        CHANGE_NAME: {
          actions: ({ context, event }) => {
            context.name = event.name;
          },
        },
      },
    },
  },
});

// ✅ NEW: No .html needed for templates!
const RegularDemoComponent = createComponent({
  machine: regularMachine,
  template: (state) => html`
    <div class="demo-container">
      <h1>Hello, ${state.context.name}!</h1>
      <input type="text" send:input="CHANGE_NAME" placeholder="Enter your name" />
      <p>Current state: ${state.value}</p>
    </div>
  `,
  // ✅ NEW: css`` can be used directly - no String() needed!
  styles: css`
    .demo-container {
      padding: 2rem;
      border: 1px solid #ccc;
      border-radius: 8px;
      font-family: system-ui, sans-serif;
    }
    
    h1 {
      color: #2563eb;
      margin-top: 0;
    }
    
    input {
      padding: 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      width: 100%;
      margin: 1rem 0;
    }
    
    p {
      color: #6b7280;
      font-size: 0.875rem;
    }
  `,
});

// ✨ Example 2: Enhanced Component with Accessibility
const enhancedMachine = createMachine({
  id: 'enhanced-demo',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: {
          actions: ({ context }) => {
            context.count++;
          },
        },
        DECREMENT: {
          actions: ({ context }) => {
            context.count--;
          },
        },
      },
    },
  },
});

// ✅ NEW: Enhanced components work with direct html`` usage!
const EnhancedDemoComponent = createEnhancedComponent({
  machine: enhancedMachine,
  template: (state, accessibility) => html`
    <div ${accessibility.getRootAttributes()}>
      <h2>Accessible Counter</h2>
      <div role="status" aria-live="polite">
        Count: ${state.context.count}
      </div>
      <button ${accessibility.getButtonAttributes()} send="DECREMENT">
        Decrease
      </button>
      <button ${accessibility.getButtonAttributes()} send="INCREMENT">
        Increase  
      </button>
    </div>
  `,
  accessibility: {
    presets: 'button',
  },
});

// ✨ Example 3: Nested Templates Still Work!
const createNestedExample = () => {
  const headerTemplate = (title: string) => html`
    <header class="app-header">
      <h1>${title}</h1>
    </header>
  `;

  const footerTemplate = () => html`
    <footer class="app-footer">
      <p>&copy; 2025 Actor-Web Framework</p>
    </footer>
  `;

  // ✅ Nested html`` calls are automatically detected and don't get double-escaped
  const pageTemplate = (content: string) => html`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Demo Page</title>
        <style>
          ${css`
            body { 
              margin: 0; 
              font-family: system-ui; 
            }
            .app-header { 
              background: #1f2937; 
              color: white; 
              padding: 1rem; 
            }
            .app-footer { 
              background: #f3f4f6; 
              padding: 1rem; 
              text-align: center; 
            }
          `}
        </style>
      </head>
      <body>
        ${headerTemplate('My App')}
        <main>${content}</main>
        ${footerTemplate()}
      </body>
    </html>
  `;

  return pageTemplate;
};

// Register components
customElements.define('regular-demo', RegularDemoComponent);
customElements.define('enhanced-demo', EnhancedDemoComponent);

// ✨ Usage demonstration
console.log('🎉 New Ergonomic Template API Loaded!');
console.log('✅ No more .html or .css property access needed!');
console.log('✅ Use html`` and css`` directly in component configs');
console.log('✅ Nested templates work seamlessly');
console.log('✅ Both regular and enhanced components supported');
console.log('✅ Backward compatibility maintained');
console.log('✅ Enhanced components accept html`` directly!');

// Export for use in other files
export { RegularDemoComponent, EnhancedDemoComponent, createNestedExample };
