/**
 * Behavior Tests for Reactive Event Bus - Actor-Web Framework
 *
 * These tests focus on testing the actual ReactiveEventBus framework API
 * following TESTING-GUIDE.md principles: behavior over implementation
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@/core/dev-mode';
import { ReactiveEventBus } from '@/core/reactive-event-bus';

// Use scoped logger as recommended in Testing Guide
const log = Logger.namespace('REACTIVE_EVENT_BUS_TEST');

// Proper typing for components with controllers
interface ComponentWithController extends HTMLElement {
  controller?: {
    receiveEvent: (eventData: Record<string, unknown>) => void;
  };
}

describe('Reactive Event Bus - Framework API', () => {
  let eventBus: ReactiveEventBus;
  let container: HTMLElement;
  const mockController = {
    receiveEvent: vi.fn(),
  };

  beforeEach(() => {
    // ✅ CORRECT: Test the real framework API, not mocks
    eventBus = ReactiveEventBus.getInstance();

    // Create test container with proper DOM structure
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    log.debug('Test environment set up', { containerExists: !!container });
  });

  afterEach(() => {
    // Clean up DOM and event listeners
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }

    // Reset any component bindings
    const componentElements = document.querySelectorAll('[data-component-id]');
    for (const el of componentElements) {
      const componentId = el.getAttribute('data-component-id');
      if (componentId) {
        eventBus.unbindEvents(componentId);
      }
    }

    log.debug('Test environment cleaned up');
  });

  describe('Component Event Binding', () => {
    it('should bind click events to component elements', () => {
      // Arrange: Create a component with controller
      const componentId = ReactiveEventBus.generateComponentId('test');
      const button = document.createElement('button') as ComponentWithController;
      button.textContent = 'Click me';
      button.setAttribute('data-component-id', componentId);

      // ✅ CORRECT: Add controller to component (framework pattern)
      button.controller = mockController;
      container.appendChild(button);

      // Act: Bind events using framework API
      eventBus.bindEvents(componentId, {
        click: 'BUTTON_CLICKED',
      });

      // Trigger DOM event
      button.click();

      // Assert: Controller should receive the event
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'BUTTON_CLICKED',
      });

      log.debug('Click event binding test completed', {
        callCount: mockController.receiveEvent.mock.calls.length,
      });
    });

    it('should handle selector-based event binding', () => {
      // Arrange: Component with multiple buttons
      const componentId = ReactiveEventBus.generateComponentId('test');
      const componentDiv = document.createElement('div') as ComponentWithController;
      componentDiv.setAttribute('data-component-id', componentId);
      componentDiv.controller = mockController;

      const submitButton = document.createElement('button');
      submitButton.className = 'submit-btn';
      submitButton.textContent = 'Submit';

      const cancelButton = document.createElement('button');
      cancelButton.className = 'cancel-btn';
      cancelButton.textContent = 'Cancel';

      componentDiv.appendChild(submitButton);
      componentDiv.appendChild(cancelButton);
      container.appendChild(componentDiv);

      // Act: Bind events with CSS selectors
      eventBus.bindEvents(componentId, {
        'click .submit-btn': 'SUBMIT_CLICKED',
        'click .cancel-btn': 'CANCEL_CLICKED',
      });

      // Trigger different button clicks
      submitButton.click();
      cancelButton.click();

      // Assert: Correct events received
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'SUBMIT_CLICKED',
      });
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'CANCEL_CLICKED',
      });
      expect(mockController.receiveEvent).toHaveBeenCalledTimes(2);

      log.debug('Selector-based binding test completed');
    });

    it('should handle form submission events', () => {
      // Arrange: Form component
      const componentId = ReactiveEventBus.generateComponentId('form');
      const form = document.createElement('form') as ComponentWithController;
      form.setAttribute('data-component-id', componentId);
      form.controller = mockController;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'test data';

      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.textContent = 'Submit';

      form.appendChild(input);
      form.appendChild(submitBtn);
      container.appendChild(form);

      // Act: Bind form submission
      eventBus.bindEvents(componentId, {
        submit: 'FORM_SUBMITTED',
      });

      // Trigger form submission
      const submitEvent = new Event('submit', {
        bubbles: true,
        cancelable: true,
      });
      form.dispatchEvent(submitEvent);

      // Assert: Form submission handled
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'FORM_SUBMITTED',
      });

      log.debug('Form submission test completed');
    });
  });

  describe('Component Lifecycle', () => {
    it('should unbind events when component is removed', () => {
      // Arrange: Component with events
      const componentId = ReactiveEventBus.generateComponentId('test');
      const button = document.createElement('button') as ComponentWithController;
      button.setAttribute('data-component-id', componentId);
      button.controller = mockController;
      container.appendChild(button);

      eventBus.bindEvents(componentId, {
        click: 'BUTTON_CLICKED',
      });

      // Verify binding works
      button.click();
      expect(mockController.receiveEvent).toHaveBeenCalledTimes(1);

      // Act: Unbind events
      eventBus.unbindEvents(componentId);

      // Click again after unbinding
      button.click();

      // Assert: No additional events received
      expect(mockController.receiveEvent).toHaveBeenCalledTimes(1);

      log.debug('Unbind test completed');
    });

    it('should generate unique component IDs', () => {
      // Act: Generate multiple IDs
      const id1 = ReactiveEventBus.generateComponentId('test');
      const id2 = ReactiveEventBus.generateComponentId('test');
      const id3 = ReactiveEventBus.generateComponentId('other');

      // Assert: All IDs are unique
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);

      // All should start with prefix
      expect(id1).toMatch(/^test-/);
      expect(id2).toMatch(/^test-/);
      expect(id3).toMatch(/^other-/);

      log.debug('ID generation test completed', { id1, id2, id3 });
    });
  });

  describe('Event Propagation', () => {
    it('should handle bubbling events correctly', () => {
      // Arrange: Nested elements
      const componentId = ReactiveEventBus.generateComponentId('nested');
      const outerDiv = document.createElement('div') as ComponentWithController;
      outerDiv.setAttribute('data-component-id', componentId);
      outerDiv.controller = mockController;

      const innerButton = document.createElement('button');
      innerButton.className = 'inner-btn';
      innerButton.textContent = 'Inner';

      outerDiv.appendChild(innerButton);
      container.appendChild(outerDiv);

      // Act: Bind to outer div but target inner button
      eventBus.bindEvents(componentId, {
        'click .inner-btn': 'INNER_CLICKED',
      });

      // Click inner button (event bubbles to outer div)
      innerButton.click();

      // Assert: Event received via bubbling
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'INNER_CLICKED',
      });

      log.debug('Event bubbling test completed');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing controller gracefully', () => {
      // Arrange: Component without controller
      const componentId = ReactiveEventBus.generateComponentId('no-controller');
      const button = document.createElement('button');
      button.setAttribute('data-component-id', componentId);
      // No controller attached!
      container.appendChild(button);

      // Act & Assert: Should not throw
      expect(() => {
        eventBus.bindEvents(componentId, {
          click: 'BUTTON_CLICKED',
        });
        button.click();
      }).not.toThrow();

      log.debug('Missing controller test completed');
    });

    it('should handle missing component element gracefully', () => {
      // Act & Assert: Should not throw when binding to non-existent component
      expect(() => {
        eventBus.bindEvents('non-existent-component', {
          click: 'BUTTON_CLICKED',
        });
      }).not.toThrow();

      log.debug('Missing element test completed');
    });
  });

  describe('Advanced Features', () => {
    it('should support refreshing bindings', () => {
      // Arrange: Component with initial binding
      const componentId = ReactiveEventBus.generateComponentId('refresh');
      const button = document.createElement('button') as ComponentWithController;
      button.setAttribute('data-component-id', componentId);
      button.controller = mockController;
      container.appendChild(button);

      eventBus.bindEvents(componentId, {
        click: 'INITIAL_CLICK',
      });

      // Act: Refresh bindings (simulates DOM updates)
      eventBus.refreshBindings();

      // Click button
      button.click();

      // Assert: Still works after refresh
      expect(mockController.receiveEvent).toHaveBeenCalledWith({
        type: 'INITIAL_CLICK',
      });

      log.debug('Refresh bindings test completed');
    });

    it('should maintain singleton behavior', () => {
      // Act: Get multiple instances
      const instance1 = ReactiveEventBus.getInstance();
      const instance2 = ReactiveEventBus.getInstance();

      // Assert: Same instance returned
      expect(instance1).toBe(instance2);
      expect(instance1).toBe(eventBus);

      log.debug('Singleton test completed');
    });
  });
});
