/**
 * Tests for Focus Management - Actor-SPA Framework
 * Focus: Focus behaviors, keyboard navigation, and accessibility
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  a11yTestUtils,
  createTestEnvironment,
  type MockGlobalEventBus,
  setupGlobalMocks,
  type TestEnvironment,
} from '@/testing/actor-test-utils';
import {
  type FocusManagementActor,
  FocusManagementHelper,
  focusManagementMachine,
  getFirstFocusableElement,
  getFocusableElements,
  getLastFocusableElement,
  isFocusable,
} from './focus-management.js';

describe('Focus Management', () => {
  let testEnv: TestEnvironment;
  let _mockEventBus: MockGlobalEventBus;
  let focusActor: FocusManagementActor;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    _mockEventBus = setupGlobalMocks();
    focusActor = createActor(focusManagementMachine);
    focusActor.start();
  });

  afterEach(() => {
    testEnv.cleanup();
    focusActor.stop();
  });

  describe('Focus Utility Functions', () => {
    describe('isFocusable function', () => {
      it('identifies focusable elements correctly', () => {
        const button = document.createElement('button');
        button.textContent = 'Click me';
        testEnv.container.appendChild(button);

        expect(isFocusable(button)).toBe(true);
      });

      it('identifies non-focusable elements correctly', () => {
        const disabledButton = document.createElement('button');
        disabledButton.disabled = true;
        testEnv.container.appendChild(disabledButton);

        expect(isFocusable(disabledButton)).toBe(false);
      });

      it('respects aria-hidden attribute', () => {
        const hiddenButton = document.createElement('button');
        hiddenButton.setAttribute('aria-hidden', 'true');
        testEnv.container.appendChild(hiddenButton);

        expect(isFocusable(hiddenButton)).toBe(false);
      });

      it('respects negative tabindex', () => {
        const button = document.createElement('button');
        button.tabIndex = -1;
        testEnv.container.appendChild(button);

        expect(isFocusable(button)).toBe(false);
      });

      it('handles elements with display none', () => {
        const button = document.createElement('button');
        button.style.display = 'none';
        testEnv.container.appendChild(button);

        expect(isFocusable(button)).toBe(false);
      });

      it('handles elements with visibility hidden', () => {
        const button = document.createElement('button');
        button.style.visibility = 'hidden';
        testEnv.container.appendChild(button);

        expect(isFocusable(button)).toBe(false);
      });
    });

    describe('getFocusableElements function', () => {
      it('finds all focusable elements in container', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <button>Button 1</button>
          <input type="text" placeholder="Input">
          <a href="#link">Link</a>
          <button disabled>Disabled Button</button>
          <div tabindex="0">Focusable Div</div>
        `;
        testEnv.container.appendChild(container);

        const focusableElements = getFocusableElements(container);

        expect(focusableElements).toHaveLength(4); // Excludes disabled button
        expect(focusableElements[0].tagName).toBe('BUTTON');
        expect(focusableElements[1].tagName).toBe('INPUT');
        expect(focusableElements[2].tagName).toBe('A');
        expect(focusableElements[3].tagName).toBe('DIV');
      });

      it('returns empty array for container with no focusable elements', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <div>Plain div</div>
          <span>Plain span</span>
          <button disabled>Disabled button</button>
        `;
        testEnv.container.appendChild(container);

        const focusableElements = getFocusableElements(container);

        expect(focusableElements).toHaveLength(0);
      });
    });

    describe('getFirstFocusableElement function', () => {
      it('returns first focusable element', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <span>Not focusable</span>
          <button>First Button</button>
          <button>Second Button</button>
        `;
        testEnv.container.appendChild(container);

        const firstElement = getFirstFocusableElement(container);

        expect(firstElement?.textContent).toBe('First Button');
      });

      it('returns null when no focusable elements exist', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>Not focusable</span>';
        testEnv.container.appendChild(container);

        const firstElement = getFirstFocusableElement(container);

        expect(firstElement).toBe(null);
      });
    });

    describe('getLastFocusableElement function', () => {
      it('returns last focusable element', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <button>First Button</button>
          <button>Last Button</button>
          <span>Not focusable</span>
        `;
        testEnv.container.appendChild(container);

        const lastElement = getLastFocusableElement(container);

        expect(lastElement?.textContent).toBe('Last Button');
      });

      it('returns null when no focusable elements exist', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>Not focusable</span>';
        testEnv.container.appendChild(container);

        const lastElement = getLastFocusableElement(container);

        expect(lastElement).toBe(null);
      });
    });
  });

  describe('Focus Management State Machine', () => {
    describe('Basic focus behaviors', () => {
      it('starts in idle state', () => {
        expect(focusActor.getSnapshot().value).toBe('idle');
        expect(focusActor.getSnapshot().context.currentFocusElement).toBe(null);
      });

      it('transitions to focused state when focusing an element', () => {
        const button = document.createElement('button');
        testEnv.container.appendChild(button);

        focusActor.send({ type: 'FOCUS_ELEMENT', element: button });

        expect(focusActor.getSnapshot().value).toBe('focused');
        expect(focusActor.getSnapshot().context.currentFocusElement).toBe(button);
      });

      it('ignores focus events for non-focusable elements', () => {
        const disabledButton = document.createElement('button');
        disabledButton.disabled = true;
        testEnv.container.appendChild(disabledButton);

        focusActor.send({ type: 'FOCUS_ELEMENT', element: disabledButton });

        expect(focusActor.getSnapshot().value).toBe('idle');
        expect(focusActor.getSnapshot().context.currentFocusElement).toBe(null);
      });
    });

    describe('Focus history and restoration', () => {
      it('maintains focus history when restoreFocus option is enabled', () => {
        const button1 = document.createElement('button');
        const button2 = document.createElement('button');
        testEnv.container.appendChild(button1);
        testEnv.container.appendChild(button2);

        // Focus first element
        focusActor.send({ type: 'FOCUS_ELEMENT', element: button1 });

        // Focus second element with restore option
        focusActor.send({
          type: 'FOCUS_ELEMENT',
          element: button2,
          options: { restoreFocus: true },
        });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.currentFocusElement).toBe(button2);
        expect(snapshot.context.focusHistory).toContain(button1);
        expect(snapshot.context.restoreTarget).toBe(button1);
      });

      it('restores focus to previous element', () => {
        const button1 = document.createElement('button');
        const button2 = document.createElement('button');
        testEnv.container.appendChild(button1);
        testEnv.container.appendChild(button2);

        // Setup focus history
        focusActor.send({ type: 'FOCUS_ELEMENT', element: button1 });
        focusActor.send({
          type: 'FOCUS_ELEMENT',
          element: button2,
          options: { restoreFocus: true },
        });

        // Restore focus
        focusActor.send({ type: 'RESTORE_FOCUS' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.currentFocusElement).toBe(button1);
        expect(snapshot.context.focusHistory).toHaveLength(0);
      });

      it('handles restore focus when no history exists', () => {
        focusActor.send({ type: 'RESTORE_FOCUS' });

        // Should remain in current state without error
        expect(focusActor.getSnapshot().value).toBe('idle');
      });
    });

    describe('Focus trapping', () => {
      it('transitions to trapped state when focus is trapped', () => {
        const container = document.createElement('div');
        container.innerHTML = `
          <button>Button 1</button>
          <button>Button 2</button>
          <input type="text">
        `;
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.value).toBe('trapped');
        expect(snapshot.context.isTrapped).toBe(true);
        expect(snapshot.context.trapContainer).toBe(container);
        expect(snapshot.context.focusableElements).toHaveLength(3);
      });

      it('releases focus trap and returns to focused state', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button</button>';
        testEnv.container.appendChild(container);

        // First trap focus
        focusActor.send({ type: 'TRAP_FOCUS', container });
        expect(focusActor.getSnapshot().value).toBe('trapped');

        // Then release trap
        focusActor.send({ type: 'RELEASE_TRAP' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.value).toBe('focused');
        expect(snapshot.context.isTrapped).toBe(false);
        expect(snapshot.context.trapContainer).toBe(null);
        expect(snapshot.context.focusableElements).toHaveLength(0);
      });
    });

    describe('Roving tab index navigation', () => {
      let container: HTMLElement;

      beforeEach(() => {
        container = document.createElement('div');
        container.innerHTML = `
          <button>Button 1</button>
          <button>Button 2</button>
          <button>Button 3</button>
        `;
        testEnv.container.appendChild(container);
        focusActor.send({ type: 'TRAP_FOCUS', container });
      });

      it('moves to next element in sequence', () => {
        focusActor.send({ type: 'MOVE_TO_NEXT' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(1);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 2');
      });

      it('wraps to first element when moving next from last', () => {
        // Move to last element first
        focusActor.send({ type: 'MOVE_TO_LAST' });
        expect(focusActor.getSnapshot().context.rovingTabIndex).toBe(2);

        // Move next should wrap to first
        focusActor.send({ type: 'MOVE_TO_NEXT' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(0);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 1');
      });

      it('moves to previous element in sequence', () => {
        // Start from second element
        focusActor.send({ type: 'MOVE_TO_NEXT' });
        expect(focusActor.getSnapshot().context.rovingTabIndex).toBe(1);

        // Move to previous
        focusActor.send({ type: 'MOVE_TO_PREVIOUS' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(0);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 1');
      });

      it('wraps to last element when moving previous from first', () => {
        // From initial position (0), move previous
        focusActor.send({ type: 'MOVE_TO_PREVIOUS' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(2);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 3');
      });

      it('moves to first element', () => {
        // Move away from first
        focusActor.send({ type: 'MOVE_TO_NEXT' });
        focusActor.send({ type: 'MOVE_TO_NEXT' });

        // Move to first
        focusActor.send({ type: 'MOVE_TO_FIRST' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(0);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 1');
      });

      it('moves to last element', () => {
        focusActor.send({ type: 'MOVE_TO_LAST' });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(2);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 3');
      });
    });

    describe('Keyboard navigation', () => {
      let container: HTMLElement;

      beforeEach(() => {
        container = document.createElement('div');
        container.innerHTML = `
          <button>Button 1</button>
          <button>Button 2</button>
          <button>Button 3</button>
        `;
        testEnv.container.appendChild(container);
        focusActor.send({ type: 'TRAP_FOCUS', container });
      });

      it('handles arrow down navigation', () => {
        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'ArrowDown', shiftKey: false });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(1);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 2');
      });

      it('handles arrow up navigation', () => {
        // Start from second element
        focusActor.send({ type: 'MOVE_TO_NEXT' });

        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'ArrowUp', shiftKey: false });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(0);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 1');
      });

      it('handles Home key navigation', () => {
        // Move away from first
        focusActor.send({ type: 'MOVE_TO_LAST' });

        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'Home', shiftKey: false });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(0);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 1');
      });

      it('handles End key navigation', () => {
        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'End', shiftKey: false });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(2);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 3');
      });

      it('handles Tab key navigation', () => {
        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'Tab', shiftKey: false });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(1);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 2');
      });

      it('handles Shift+Tab navigation', () => {
        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'Tab', shiftKey: true });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.context.rovingTabIndex).toBe(2);
        expect(snapshot.context.currentFocusElement?.textContent).toBe('Button 3');
      });

      it('ignores unknown keys', () => {
        const initialSnapshot = focusActor.getSnapshot();

        focusActor.send({ type: 'KEYBOARD_NAVIGATION', key: 'Space', shiftKey: false });

        const afterSnapshot = focusActor.getSnapshot();
        expect(afterSnapshot.context.rovingTabIndex).toBe(initialSnapshot.context.rovingTabIndex);
      });
    });

    describe('Dynamic focusable elements', () => {
      it('updates focusable elements when container changes', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button 1</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        expect(focusActor.getSnapshot().context.focusableElements).toHaveLength(1);

        // Add more elements
        container.innerHTML += '<button>Button 2</button><input type="text">';

        focusActor.send({ type: 'UPDATE_FOCUSABLE_ELEMENTS' });

        expect(focusActor.getSnapshot().context.focusableElements).toHaveLength(3);
      });
    });
  });

  describe('Focus Management Helper', () => {
    let helper: FocusManagementHelper;

    beforeEach(() => {
      const snapshot = focusActor.getSnapshot();
      helper = new FocusManagementHelper(focusActor, snapshot);
    });

    describe('State queries', () => {
      it('reports current focus target', () => {
        expect(helper.getCurrentFocusTarget()).toBe(null);

        const button = document.createElement('button');
        testEnv.container.appendChild(button);
        focusActor.send({ type: 'FOCUS_ELEMENT', element: button });

        // Update helper with new snapshot
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());
        expect(helper.getCurrentFocusTarget()).toBe(button);
      });

      it('reports focus trap status', () => {
        expect(helper.isFocusTrapped()).toBe(false);

        const container = document.createElement('div');
        focusActor.send({ type: 'TRAP_FOCUS', container });

        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());
        expect(helper.isFocusTrapped()).toBe(true);
      });

      it('provides focusable elements', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        expect(helper.getFocusableElements()).toHaveLength(1);
      });

      it('provides roving tab index', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        expect(helper.getRovingTabIndex()).toBe(0);
      });
    });

    describe('Template attribute generation', () => {
      it('generates basic focus attributes', () => {
        const attributes = helper.getFocusAttributes();

        expect(attributes).toBe(''); // No trap active
      });

      it('generates focus attributes when trapped', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        const attributes = helper.getFocusAttributes(0);

        expect(attributes).toContain('data-focus-trapped="true"');
        expect(attributes).toContain('tabindex="0"');
        expect(attributes).toContain('data-focus-index="0"');
        expect(attributes).toContain('data-focus-active="true"');
      });

      it('generates inactive focus attributes for non-current elements', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button 1</button><button>Button 2</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        const attributes = helper.getFocusAttributes(1); // Second element, not active

        expect(attributes).toContain('data-focus-trapped="true"');
        expect(attributes).toContain('tabindex="-1"');
        expect(attributes).toContain('data-focus-index="1"');
        expect(attributes).not.toContain('data-focus-active="true"');
      });

      it('generates keyboard navigation attributes', () => {
        const attributes = helper.getKeyboardNavigationAttributes('horizontal');

        expect(attributes).toContain('data-keyboard-orientation="horizontal"');
      });

      it('includes trap status in keyboard navigation attributes', () => {
        const container = document.createElement('div');
        focusActor.send({ type: 'TRAP_FOCUS', container });
        helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        const attributes = helper.getKeyboardNavigationAttributes();

        expect(attributes).toContain('data-keyboard-trapped="true"');
      });
    });

    describe('Event sending methods', () => {
      it('sends focus element event', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');
        const button = document.createElement('button');

        helper.focusElement(button);

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'FOCUS_ELEMENT',
          element: button,
          options: undefined,
        });
      });

      it('sends focus element event with options', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');
        const button = document.createElement('button');
        const options = { restoreFocus: true };

        helper.focusElement(button, options);

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'FOCUS_ELEMENT',
          element: button,
          options,
        });
      });

      it('sends trap focus event', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');
        const container = document.createElement('div');

        helper.trapFocus(container);

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'TRAP_FOCUS',
          container,
        });
      });

      it('sends release trap event', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');

        helper.releaseFocusTrap();

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'RELEASE_TRAP',
        });
      });

      it('sends navigation events', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');

        helper.moveToNext();
        helper.moveToPrevious();
        helper.moveToFirst();
        helper.moveToLast();

        expect(sendSpy).toHaveBeenCalledWith({ type: 'MOVE_TO_NEXT' });
        expect(sendSpy).toHaveBeenCalledWith({ type: 'MOVE_TO_PREVIOUS' });
        expect(sendSpy).toHaveBeenCalledWith({ type: 'MOVE_TO_FIRST' });
        expect(sendSpy).toHaveBeenCalledWith({ type: 'MOVE_TO_LAST' });
      });

      it('sends keyboard navigation event', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');

        helper.handleKeyboardNavigation('ArrowDown', true);

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'KEYBOARD_NAVIGATION',
          key: 'ArrowDown',
          shiftKey: true,
        });
      });

      it('sends update focusable elements event', () => {
        const sendSpy = vi.spyOn(focusActor, 'send');

        helper.updateFocusableElements();

        expect(sendSpy).toHaveBeenCalledWith({
          type: 'UPDATE_FOCUSABLE_ELEMENTS',
        });
      });
    });
  });

  describe('Real-world usage patterns', () => {
    describe('Modal dialog focus management', () => {
      it('traps focus within modal and restores on close', () => {
        // Setup modal structure
        const modal = document.createElement('div');
        modal.innerHTML = `
          <h2>Dialog Title</h2>
          <button>Action</button>
          <button>Cancel</button>
          <button>Close</button>
        `;
        testEnv.container.appendChild(modal);

        // Setup trigger button outside modal
        const triggerButton = document.createElement('button');
        triggerButton.textContent = 'Open Modal';
        testEnv.container.appendChild(triggerButton);

        // Focus trigger first
        focusActor.send({ type: 'FOCUS_ELEMENT', element: triggerButton });

        // Open modal and trap focus
        focusActor.send({
          type: 'TRAP_FOCUS',
          container: modal,
        });

        const snapshot = focusActor.getSnapshot();
        expect(snapshot.value).toBe('trapped');
        expect(snapshot.context.focusableElements).toHaveLength(3);

        // Navigate within modal
        focusActor.send({ type: 'MOVE_TO_NEXT' });
        expect(focusActor.getSnapshot().context.rovingTabIndex).toBe(1);

        // Close modal and release trap
        focusActor.send({ type: 'RELEASE_TRAP' });
        expect(focusActor.getSnapshot().value).toBe('focused');
      });
    });

    describe('Tab navigation with roving tabindex', () => {
      it('implements ARIA toolbar pattern', () => {
        const toolbar = document.createElement('div');
        toolbar.setAttribute('role', 'toolbar');
        toolbar.innerHTML = `
          <button>Bold</button>
          <button>Italic</button>
          <button>Underline</button>
          <button>Strike</button>
        `;
        testEnv.container.appendChild(toolbar);

        focusActor.send({ type: 'TRAP_FOCUS', container: toolbar });
        const helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        // First button should be focusable
        expect(helper.getFocusAttributes(0)).toContain('tabindex="0"');

        // Others should not be
        expect(helper.getFocusAttributes(1)).toContain('tabindex="-1"');
        expect(helper.getFocusAttributes(2)).toContain('tabindex="-1"');
        expect(helper.getFocusAttributes(3)).toContain('tabindex="-1"');

        // Navigate to next
        focusActor.send({ type: 'MOVE_TO_NEXT' });
        const updatedHelper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        // Second button should now be focusable
        expect(updatedHelper.getFocusAttributes(1)).toContain('tabindex="0"');
        expect(updatedHelper.getFocusAttributes(0)).toContain('tabindex="-1"');
      });
    });

    describe('Dynamic content focus management', () => {
      it('handles addition and removal of focusable elements', () => {
        const container = document.createElement('div');
        container.innerHTML = '<button>Button 1</button>';
        testEnv.container.appendChild(container);

        focusActor.send({ type: 'TRAP_FOCUS', container });
        expect(focusActor.getSnapshot().context.focusableElements).toHaveLength(1);

        // Add new button
        const newButton = document.createElement('button');
        newButton.textContent = 'Button 2';
        container.appendChild(newButton);

        // Update focusable elements
        focusActor.send({ type: 'UPDATE_FOCUSABLE_ELEMENTS' });
        expect(focusActor.getSnapshot().context.focusableElements).toHaveLength(2);

        // Should be able to navigate to new button
        focusActor.send({ type: 'MOVE_TO_LAST' });
        expect(focusActor.getSnapshot().context.currentFocusElement).toBe(newButton);
      });
    });

    describe('Accessibility compliance', () => {
      it('maintains proper ARIA attributes during navigation', () => {
        const menu = document.createElement('div');
        menu.setAttribute('role', 'menu');
        menu.innerHTML = `
          <div role="menuitem">Item 1</div>
          <div role="menuitem">Item 2</div>
          <div role="menuitem">Item 3</div>
        `;
        testEnv.container.appendChild(menu);

        focusActor.send({ type: 'TRAP_FOCUS', container: menu });
        const helper = new FocusManagementHelper(focusActor, focusActor.getSnapshot());

        // Verify ARIA-compliant attributes
        a11yTestUtils.expectAccessible(menu.firstElementChild as HTMLElement, {
          role: 'menuitem',
        });

        // Verify keyboard navigation attributes
        const navAttrs = helper.getKeyboardNavigationAttributes('vertical');
        expect(navAttrs).toContain('data-keyboard-orientation="vertical"');
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('handles empty containers gracefully', () => {
      const emptyContainer = document.createElement('div');
      testEnv.container.appendChild(emptyContainer);

      focusActor.send({ type: 'TRAP_FOCUS', container: emptyContainer });

      const snapshot = focusActor.getSnapshot();
      expect(snapshot.value).toBe('trapped');
      expect(snapshot.context.focusableElements).toHaveLength(0);

      // Navigation should not break
      focusActor.send({ type: 'MOVE_TO_NEXT' });
      expect(snapshot.context.rovingTabIndex).toBe(0);
    });

    it('handles removed elements during navigation', () => {
      const container = document.createElement('div');
      container.innerHTML = `
        <button>Button 1</button>
        <button>Button 2</button>
      `;
      testEnv.container.appendChild(container);

      focusActor.send({ type: 'TRAP_FOCUS', container });
      focusActor.send({ type: 'MOVE_TO_NEXT' }); // Focus second button

      // Remove second button
      container.children[1].remove();
      focusActor.send({ type: 'UPDATE_FOCUSABLE_ELEMENTS' });

      // Should handle gracefully
      expect(focusActor.getSnapshot().context.focusableElements).toHaveLength(1);
    });

    it('prevents focus on detached elements', () => {
      const button = document.createElement('button');
      // Don't append to DOM

      focusActor.send({ type: 'FOCUS_ELEMENT', element: button });

      // Should remain in idle state
      expect(focusActor.getSnapshot().value).toBe('idle');
    });
  });
});
