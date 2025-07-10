import { type TestEnvironment, createTestEnvironment, setupGlobalMocks } from '@/framework/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  type KeyboardNavigationActor,
  KeyboardNavigationHelper,
  createKeyboardEventHandler,
  createKeyboardNavigationConfig,
  createKeyboardNavigationHelper,
  createKeyboardNavigationTemplateHelpers,
  keyboardNavigationMachine,
} from './keyboard-navigation.js';

// Mock focus management actor for testing
const createMockFocusActor = () => ({
  send: vi.fn(),
  getSnapshot: vi.fn().mockReturnValue({
    context: {
      currentElement: null,
      elements: [],
    },
  }),
});

describe('Keyboard Navigation', () => {
  let testEnv: TestEnvironment;
  let keyboardActor: KeyboardNavigationActor;
  let container: HTMLElement;
  let mockFocusActor: ReturnType<typeof createMockFocusActor>;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    // Create actor
    keyboardActor = createActor(keyboardNavigationMachine);
    keyboardActor.start();

    // Create container with focusable elements
    container = document.createElement('div');
    container.innerHTML = `
      <div role="menu">
        <button role="menuitem" data-testid="item-1">Item 1</button>
        <button role="menuitem" data-testid="item-2">Item 2</button>
        <button role="menuitem" data-testid="item-3">Item 3</button>
      </div>
    `;
    testEnv.container.appendChild(container);

    mockFocusActor = createMockFocusActor();
  });

  afterEach(() => {
    testEnv.cleanup();
    keyboardActor.stop();
  });

  describe('State Machine Behavior', () => {
    describe('Initial State', () => {
      it('starts in disabled state', () => {
        expect(keyboardActor.getSnapshot().value).toBe('disabled');
        expect(keyboardActor.getSnapshot().context.isEnabled).toBe(false);
      });

      it('has default configuration values', () => {
        const context = keyboardActor.getSnapshot().context;

        expect(context.orientation).toBe('vertical');
        expect(context.wrap).toBe(true);
        expect(context.activateOnFocus).toBe(false);
        expect(context.rovingTabIndex).toBe(false);
        expect(context.homeEndEnabled).toBe(true);
        expect(context.typeaheadEnabled).toBe(false);
        expect(context.preventDefaultKeys).toEqual([
          'ArrowUp',
          'ArrowDown',
          'ArrowLeft',
          'ArrowRight',
          'Home',
          'End',
        ]);
      });
    });

    describe('Enabling Navigation', () => {
      it('transitions to enabled state when ENABLE_NAVIGATION is sent', () => {
        keyboardActor.send({
          type: 'ENABLE_NAVIGATION',
          container,
          focusActor: mockFocusActor as never,
        });

        const snapshot = keyboardActor.getSnapshot();
        expect(snapshot.value).toBe('enabled');
        expect(snapshot.context.isEnabled).toBe(true);
        expect(snapshot.context.container).toBe(container);
        expect(snapshot.context.focusManagementActor).toBe(mockFocusActor);
      });

      it('can enable navigation without focus actor', () => {
        keyboardActor.send({
          type: 'ENABLE_NAVIGATION',
          container,
        });

        const snapshot = keyboardActor.getSnapshot();
        expect(snapshot.value).toBe('enabled');
        expect(snapshot.context.focusManagementActor).toBe(null);
      });
    });

    describe('Disabling Navigation', () => {
      beforeEach(() => {
        keyboardActor.send({
          type: 'ENABLE_NAVIGATION',
          container,
          focusActor: mockFocusActor as never,
        });
      });

      it('transitions to disabled state when DISABLE_NAVIGATION is sent', () => {
        keyboardActor.send({ type: 'DISABLE_NAVIGATION' });

        const snapshot = keyboardActor.getSnapshot();
        expect(snapshot.value).toBe('disabled');
        expect(snapshot.context.isEnabled).toBe(false);
        expect(snapshot.context.container).toBe(null);
        expect(snapshot.context.focusManagementActor).toBe(null);
      });
    });

    describe('Configuration Updates', () => {
      beforeEach(() => {
        keyboardActor.send({
          type: 'ENABLE_NAVIGATION',
          container,
          focusActor: mockFocusActor as never,
        });
      });

      it('updates orientation setting', () => {
        keyboardActor.send({
          type: 'SET_ORIENTATION',
          orientation: 'horizontal',
        });

        expect(keyboardActor.getSnapshot().context.orientation).toBe('horizontal');
      });

      it('updates wrap setting', () => {
        keyboardActor.send({
          type: 'SET_WRAP',
          wrap: false,
        });

        expect(keyboardActor.getSnapshot().context.wrap).toBe(false);
      });

      it('updates activate on focus setting', () => {
        keyboardActor.send({
          type: 'SET_ACTIVATE_ON_FOCUS',
          activateOnFocus: true,
        });

        expect(keyboardActor.getSnapshot().context.activateOnFocus).toBe(true);
      });

      it('updates roving tab index setting', () => {
        keyboardActor.send({
          type: 'SET_ROVING_TAB_INDEX',
          enabled: true,
        });

        expect(keyboardActor.getSnapshot().context.rovingTabIndex).toBe(true);
      });

      it('updates home/end enabled setting', () => {
        keyboardActor.send({
          type: 'SET_HOME_END_ENABLED',
          enabled: false,
        });

        expect(keyboardActor.getSnapshot().context.homeEndEnabled).toBe(false);
      });

      it('updates typeahead enabled setting', () => {
        keyboardActor.send({
          type: 'SET_TYPEAHEAD_ENABLED',
          enabled: true,
        });

        expect(keyboardActor.getSnapshot().context.typeaheadEnabled).toBe(true);
      });
    });
  });

  describe('Arrow Key Navigation', () => {
    beforeEach(() => {
      keyboardActor.send({
        type: 'ENABLE_NAVIGATION',
        container,
        focusActor: mockFocusActor as never,
      });
    });

    describe('Vertical Navigation', () => {
      it('handles up arrow key in vertical mode', () => {
        const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });

        keyboardActor.send({
          type: 'HANDLE_ARROW_KEY',
          direction: 'up',
          event: keyEvent,
        });

        expect(mockFocusActor.send).toHaveBeenCalledWith({
          type: 'MOVE_TO_PREVIOUS',
        });
      });

      it('handles down arrow key in vertical mode', () => {
        const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });

        keyboardActor.send({
          type: 'HANDLE_ARROW_KEY',
          direction: 'down',
          event: keyEvent,
        });

        expect(mockFocusActor.send).toHaveBeenCalledWith({
          type: 'MOVE_TO_NEXT',
        });
      });
    });

    describe('Horizontal Navigation', () => {
      beforeEach(() => {
        keyboardActor.send({
          type: 'SET_ORIENTATION',
          orientation: 'horizontal',
        });
      });

      it('handles left arrow key in horizontal mode', () => {
        const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft' });

        keyboardActor.send({
          type: 'HANDLE_ARROW_KEY',
          direction: 'left',
          event: keyEvent,
        });

        expect(mockFocusActor.send).toHaveBeenCalledWith({
          type: 'MOVE_TO_PREVIOUS',
        });
      });

      it('handles right arrow key in horizontal mode', () => {
        const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });

        keyboardActor.send({
          type: 'HANDLE_ARROW_KEY',
          direction: 'right',
          event: keyEvent,
        });

        expect(mockFocusActor.send).toHaveBeenCalledWith({
          type: 'MOVE_TO_NEXT',
        });
      });
    });

    describe('Both Orientations', () => {
      beforeEach(() => {
        keyboardActor.send({
          type: 'SET_ORIENTATION',
          orientation: 'both',
        });
      });

      it('handles all arrow keys when orientation is both', () => {
        const directions = ['up', 'down', 'left', 'right'] as const;

        directions.forEach((direction) => {
          mockFocusActor.send.mockClear();

          keyboardActor.send({
            type: 'HANDLE_ARROW_KEY',
            direction,
            event: new KeyboardEvent('keydown'),
          });

          const expectedAction =
            direction === 'up' || direction === 'left' ? 'MOVE_TO_PREVIOUS' : 'MOVE_TO_NEXT';

          expect(mockFocusActor.send).toHaveBeenCalledWith({
            type: expectedAction,
          });
        });
      });
    });

    describe('Without Focus Actor', () => {
      beforeEach(() => {
        keyboardActor.send({ type: 'DISABLE_NAVIGATION' });
        keyboardActor.send({
          type: 'ENABLE_NAVIGATION',
          container,
          // No focus actor
        });
      });

      it('does not crash when no focus actor is available', () => {
        expect(() => {
          keyboardActor.send({
            type: 'HANDLE_ARROW_KEY',
            direction: 'down',
            event: new KeyboardEvent('keydown'),
          });
        }).not.toThrow();
      });
    });
  });

  describe('Home and End Navigation', () => {
    beforeEach(() => {
      keyboardActor.send({
        type: 'ENABLE_NAVIGATION',
        container,
        focusActor: mockFocusActor as never,
      });
    });

    it('handles Home key to move to first element', () => {
      const keyEvent = new KeyboardEvent('keydown', { key: 'Home' });

      keyboardActor.send({
        type: 'HANDLE_HOME_END',
        key: 'Home',
        event: keyEvent,
      });

      expect(mockFocusActor.send).toHaveBeenCalledWith({
        type: 'MOVE_TO_FIRST',
      });
    });

    it('handles End key to move to last element', () => {
      const keyEvent = new KeyboardEvent('keydown', { key: 'End' });

      keyboardActor.send({
        type: 'HANDLE_HOME_END',
        key: 'End',
        event: keyEvent,
      });

      expect(mockFocusActor.send).toHaveBeenCalledWith({
        type: 'MOVE_TO_LAST',
      });
    });

    it('does not handle Home/End when disabled', () => {
      keyboardActor.send({
        type: 'SET_HOME_END_ENABLED',
        enabled: false,
      });

      const keyEvent = new KeyboardEvent('keydown', { key: 'Home' });

      keyboardActor.send({
        type: 'HANDLE_HOME_END',
        key: 'Home',
        event: keyEvent,
      });

      expect(mockFocusActor.send).not.toHaveBeenCalled();
    });
  });

  describe('Typeahead Functionality', () => {
    beforeEach(() => {
      keyboardActor.send({
        type: 'ENABLE_NAVIGATION',
        container,
        focusActor: mockFocusActor as never,
      });
      keyboardActor.send({
        type: 'SET_TYPEAHEAD_ENABLED',
        enabled: true,
      });
    });

    it('builds typeahead buffer from character input', () => {
      keyboardActor.send({
        type: 'HANDLE_TYPEAHEAD',
        character: 'i',
        event: new KeyboardEvent('keydown'),
      });

      expect(keyboardActor.getSnapshot().context.typeaheadBuffer).toBe('i');

      keyboardActor.send({
        type: 'HANDLE_TYPEAHEAD',
        character: 't',
        event: new KeyboardEvent('keydown'),
      });

      expect(keyboardActor.getSnapshot().context.typeaheadBuffer).toBe('it');
    });

    it('converts characters to lowercase', () => {
      keyboardActor.send({
        type: 'HANDLE_TYPEAHEAD',
        character: 'A',
        event: new KeyboardEvent('keydown'),
      });

      expect(keyboardActor.getSnapshot().context.typeaheadBuffer).toBe('a');
    });

    it('clears typeahead buffer on command', () => {
      keyboardActor.send({
        type: 'HANDLE_TYPEAHEAD',
        character: 'test',
        event: new KeyboardEvent('keydown'),
      });

      keyboardActor.send({ type: 'CLEAR_TYPEAHEAD' });

      expect(keyboardActor.getSnapshot().context.typeaheadBuffer).toBe('');
      expect(keyboardActor.getSnapshot().context.typeaheadTimeout).toBe(null);
    });

    it('sets up timeout to clear buffer automatically', () => {
      vi.spyOn(global, 'setTimeout').mockReturnValue(123 as never);

      keyboardActor.send({
        type: 'HANDLE_TYPEAHEAD',
        character: 'a',
        event: new KeyboardEvent('keydown'),
      });

      expect(global.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000);
      expect(keyboardActor.getSnapshot().context.typeaheadTimeout).toBe(123);
    });
  });

  describe('Custom Key Handlers', () => {
    beforeEach(() => {
      keyboardActor.send({
        type: 'ENABLE_NAVIGATION',
        container,
      });
    });

    it('adds custom key handlers', () => {
      const customHandler = vi.fn();

      keyboardActor.send({
        type: 'ADD_KEY_HANDLER',
        key: 'Escape',
        handler: customHandler,
      });

      const handlers = keyboardActor.getSnapshot().context.keyHandlers;
      expect(handlers.get('Escape')).toBe(customHandler);
    });

    it('removes custom key handlers', () => {
      const customHandler = vi.fn();

      keyboardActor.send({
        type: 'ADD_KEY_HANDLER',
        key: 'Escape',
        handler: customHandler,
      });

      keyboardActor.send({
        type: 'REMOVE_KEY_HANDLER',
        key: 'Escape',
      });

      const handlers = keyboardActor.getSnapshot().context.keyHandlers;
      expect(handlers.has('Escape')).toBe(false);
    });
  });

  describe('Element Activation', () => {
    let mockButton: HTMLButtonElement;

    beforeEach(() => {
      keyboardActor.send({
        type: 'ENABLE_NAVIGATION',
        container,
      });

      mockButton = document.createElement('button');
      mockButton.textContent = 'Test Button';
      mockButton.click = vi.fn();
      testEnv.container.appendChild(mockButton);

      keyboardActor.send({
        type: 'UPDATE_ACTIVE_ELEMENT',
        element: mockButton,
      });
    });

    it('updates active element', () => {
      expect(keyboardActor.getSnapshot().context.currentActiveElement).toBe(mockButton);
    });

    it('activates current element when activate on focus is enabled', () => {
      keyboardActor.send({
        type: 'SET_ACTIVATE_ON_FOCUS',
        activateOnFocus: true,
      });

      keyboardActor.send({ type: 'ACTIVATE_CURRENT_ELEMENT' });

      expect(mockButton.click).toHaveBeenCalled();
    });

    it('does not activate element when activate on focus is disabled', () => {
      keyboardActor.send({
        type: 'SET_ACTIVATE_ON_FOCUS',
        activateOnFocus: false,
      });

      keyboardActor.send({ type: 'ACTIVATE_CURRENT_ELEMENT' });

      expect(mockButton.click).not.toHaveBeenCalled();
    });
  });
});

describe('Keyboard Navigation Helper', () => {
  let testEnv: TestEnvironment;
  let keyboardActor: KeyboardNavigationActor;
  let helper: KeyboardNavigationHelper;
  let container: HTMLElement;
  let mockFocusActor: ReturnType<typeof createMockFocusActor>;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    keyboardActor = createActor(keyboardNavigationMachine);
    keyboardActor.start();

    container = document.createElement('div');
    testEnv.container.appendChild(container);

    mockFocusActor = createMockFocusActor();

    keyboardActor.send({
      type: 'ENABLE_NAVIGATION',
      container,
      focusActor: mockFocusActor as never,
    });

    helper = new KeyboardNavigationHelper(
      keyboardActor,
      keyboardActor.getSnapshot(),
      mockFocusActor.getSnapshot()
    );
  });

  afterEach(() => {
    testEnv.cleanup();
    keyboardActor.stop();
  });

  describe('State Queries', () => {
    it('reports enabled state correctly', () => {
      expect(helper.isEnabled()).toBe(true);

      keyboardActor.send({ type: 'DISABLE_NAVIGATION' });

      // Update helper with new snapshot
      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      expect(helper.isEnabled()).toBe(false);
    });

    it('returns current orientation', () => {
      expect(helper.getOrientation()).toBe('vertical');

      keyboardActor.send({
        type: 'SET_ORIENTATION',
        orientation: 'horizontal',
      });

      // Update helper with new snapshot
      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      expect(helper.getOrientation()).toBe('horizontal');
    });
  });

  describe('Template Attributes', () => {
    it('generates container attributes when enabled', () => {
      const attributes = helper.getKeyboardAttributes();

      expect(attributes).toContain('data-keyboard-navigation="enabled"');
      expect(attributes).toContain('data-orientation="vertical"');
      expect(attributes).toContain('data-wrap="true"');
      expect(attributes).toContain('data-activate-on-focus="false"');
    });

    it('includes roving tab index attribute when enabled', () => {
      keyboardActor.send({
        type: 'SET_ROVING_TAB_INDEX',
        enabled: true,
      });

      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      const attributes = helper.getKeyboardAttributes();
      expect(attributes).toContain('data-roving-tabindex="true"');
    });

    it('includes home/end attribute when enabled', () => {
      const attributes = helper.getKeyboardAttributes();
      expect(attributes).toContain('data-home-end="true"');
    });

    it('includes typeahead attribute when enabled', () => {
      keyboardActor.send({
        type: 'SET_TYPEAHEAD_ENABLED',
        enabled: true,
      });

      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      const attributes = helper.getKeyboardAttributes();
      expect(attributes).toContain('data-typeahead="true"');
    });

    it('returns empty string when navigation is disabled', () => {
      keyboardActor.send({ type: 'DISABLE_NAVIGATION' });

      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      const attributes = helper.getKeyboardAttributes();
      expect(attributes).toBe('');
    });
  });

  describe('Item Attributes', () => {
    beforeEach(() => {
      keyboardActor.send({
        type: 'SET_ROVING_TAB_INDEX',
        enabled: true,
      });

      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());
    });

    it('generates item attributes with keyboard index', () => {
      const attributes = helper.getItemAttributes(2);

      expect(attributes).toContain('data-keyboard-index="2"');
      expect(attributes).toContain('tabindex="-1"');
    });

    it('marks active item with correct attributes', () => {
      const attributes = helper.getItemAttributes(0, true);

      expect(attributes).toContain('data-keyboard-index="0"');
      expect(attributes).toContain('tabindex="0"');
      expect(attributes).toContain('data-keyboard-active="true"');
    });

    it('returns empty string when navigation is disabled', () => {
      keyboardActor.send({ type: 'DISABLE_NAVIGATION' });

      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      const attributes = helper.getItemAttributes(0);
      expect(attributes).toBe('');
    });
  });

  describe('Event Handling', () => {
    it('handles arrow key events', () => {
      const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      vi.spyOn(keyboardActor, 'send');

      helper.handleKeyboardEvent(downEvent);

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'HANDLE_KEYDOWN',
        event: downEvent,
      });

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'HANDLE_ARROW_KEY',
        direction: 'down',
        event: downEvent,
      });
    });

    it('handles home and end keys', () => {
      const homeEvent = new KeyboardEvent('keydown', { key: 'Home' });
      vi.spyOn(keyboardActor, 'send');

      helper.handleKeyboardEvent(homeEvent);

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'HANDLE_HOME_END',
        key: 'Home',
        event: homeEvent,
      });
    });

    it('handles activation keys (Enter and Space)', () => {
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
      vi.spyOn(keyboardActor, 'send');

      helper.handleKeyboardEvent(enterEvent);

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'ACTIVATE_CURRENT_ELEMENT',
      });

      keyboardActor.send.mockClear();

      const spaceEvent = new KeyboardEvent('keydown', { key: ' ' });
      helper.handleKeyboardEvent(spaceEvent);

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'ACTIVATE_CURRENT_ELEMENT',
      });
    });

    it('handles typeahead characters', () => {
      const characterEvent = new KeyboardEvent('keydown', { key: 'a' });
      vi.spyOn(keyboardActor, 'send');

      helper.handleKeyboardEvent(characterEvent);

      expect(keyboardActor.send).toHaveBeenCalledWith({
        type: 'HANDLE_TYPEAHEAD',
        character: 'a',
        event: characterEvent,
      });
    });

    it('ignores modifier key combinations for typeahead', () => {
      const ctrlAEvent = new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
      });
      vi.spyOn(keyboardActor, 'send');

      helper.handleKeyboardEvent(ctrlAEvent);

      expect(keyboardActor.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'HANDLE_TYPEAHEAD' })
      );
    });

    it('calls custom key handlers when defined', () => {
      const customHandler = vi.fn();

      // Add custom handler to the context
      keyboardActor.send({
        type: 'ADD_KEY_HANDLER',
        key: 'Escape',
        handler: customHandler,
      });

      // Update helper with new snapshot
      helper = new KeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape' });
      helper.handleKeyboardEvent(escapeEvent);

      expect(customHandler).toHaveBeenCalledWith(escapeEvent);
    });
  });

  describe('Configuration Methods', () => {
    it('enables and disables navigation', () => {
      helper.disableNavigation();
      expect(keyboardActor.getSnapshot().context.isEnabled).toBe(false);

      helper.enableNavigation(container, mockFocusActor as never);
      expect(keyboardActor.getSnapshot().context.isEnabled).toBe(true);
    });

    it('updates navigation settings', () => {
      helper.setOrientation('horizontal');
      expect(keyboardActor.getSnapshot().context.orientation).toBe('horizontal');

      helper.setWrap(false);
      expect(keyboardActor.getSnapshot().context.wrap).toBe(false);

      helper.setActivateOnFocus(true);
      expect(keyboardActor.getSnapshot().context.activateOnFocus).toBe(true);

      helper.setRovingTabIndex(true);
      expect(keyboardActor.getSnapshot().context.rovingTabIndex).toBe(true);

      helper.setHomeEndEnabled(false);
      expect(keyboardActor.getSnapshot().context.homeEndEnabled).toBe(false);

      helper.setTypeaheadEnabled(true);
      expect(keyboardActor.getSnapshot().context.typeaheadEnabled).toBe(true);
    });

    it('manages custom key handlers', () => {
      const handler = vi.fn();

      helper.addKeyHandler('F1', handler);
      expect(keyboardActor.getSnapshot().context.keyHandlers.get('F1')).toBe(handler);

      helper.removeKeyHandler('F1');
      expect(keyboardActor.getSnapshot().context.keyHandlers.has('F1')).toBe(false);
    });

    it('updates active element', () => {
      const button = document.createElement('button');

      helper.updateActiveElement(button);
      expect(keyboardActor.getSnapshot().context.currentActiveElement).toBe(button);
    });
  });
});

describe('Factory Functions', () => {
  let testEnv: TestEnvironment;
  let keyboardActor: KeyboardNavigationActor;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    keyboardActor = createActor(keyboardNavigationMachine);
    keyboardActor.start();
  });

  afterEach(() => {
    testEnv.cleanup();
    keyboardActor.stop();
  });

  describe('createKeyboardNavigationHelper', () => {
    it('creates helper instance with correct parameters', () => {
      const snapshot = keyboardActor.getSnapshot();
      const helper = createKeyboardNavigationHelper(keyboardActor, snapshot);

      expect(helper).toBeInstanceOf(KeyboardNavigationHelper);
      expect(helper.isEnabled()).toBe(snapshot.context.isEnabled);
    });
  });

  describe('createKeyboardNavigationConfig', () => {
    it('returns default configuration for known types', () => {
      const menuConfig = createKeyboardNavigationConfig('menu');

      expect(menuConfig).toEqual({
        orientation: 'vertical',
        wrap: true,
        activateOnFocus: false,
        rovingTabIndex: true,
        homeEndEnabled: true,
        typeaheadEnabled: true,
      });
    });

    it('applies overrides to default configuration', () => {
      const config = createKeyboardNavigationConfig('menu', {
        orientation: 'horizontal',
        wrap: false,
      });

      expect(config.orientation).toBe('horizontal');
      expect(config.wrap).toBe(false);
      expect(config.rovingTabIndex).toBe(true); // Default preserved
    });

    it('provides all default configuration types', () => {
      const types = ['menu', 'tablist', 'toolbar', 'grid', 'listbox'] as const;

      types.forEach((type) => {
        const config = createKeyboardNavigationConfig(type);
        expect(config).toBeDefined();
        expect(typeof config.orientation).toBe('string');
        expect(typeof config.wrap).toBe('boolean');
      });
    });
  });

  describe('createKeyboardEventHandler', () => {
    it('creates event handler function', () => {
      const snapshot = keyboardActor.getSnapshot();
      const helper = createKeyboardNavigationHelper(keyboardActor, snapshot);
      const eventHandler = createKeyboardEventHandler(helper);

      expect(typeof eventHandler).toBe('function');

      const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      vi.spyOn(helper, 'handleKeyboardEvent');

      eventHandler(keyEvent);

      expect(helper.handleKeyboardEvent).toHaveBeenCalledWith(keyEvent);
    });
  });

  describe('createKeyboardNavigationTemplateHelpers', () => {
    it('creates template helpers with correct interface', () => {
      const snapshot = keyboardActor.getSnapshot();
      const helper = createKeyboardNavigationHelper(keyboardActor, snapshot);
      const templateHelpers = createKeyboardNavigationTemplateHelpers(helper);

      expect(templateHelpers).toMatchObject({
        getContainerAttributes: expect.any(Function),
        getItemAttributes: expect.any(Function),
        handleKeydown: expect.any(Function),
        isEnabled: expect.any(Function),
        getOrientation: expect.any(Function),
      });
    });

    it('template helpers call underlying helper methods', () => {
      const snapshot = keyboardActor.getSnapshot();
      const helper = createKeyboardNavigationHelper(keyboardActor, snapshot);
      const templateHelpers = createKeyboardNavigationTemplateHelpers(helper);

      vi.spyOn(helper, 'getKeyboardAttributes').mockReturnValue('test-attributes');
      vi.spyOn(helper, 'getItemAttributes').mockReturnValue('item-attributes');
      vi.spyOn(helper, 'handleKeyboardEvent');
      vi.spyOn(helper, 'isEnabled').mockReturnValue(true);
      vi.spyOn(helper, 'getOrientation').mockReturnValue('vertical');

      expect(templateHelpers.getContainerAttributes()).toBe('test-attributes');
      expect(templateHelpers.getItemAttributes(0, true)).toBe('item-attributes');
      expect(templateHelpers.isEnabled()).toBe(true);
      expect(templateHelpers.getOrientation()).toBe('vertical');

      const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
      templateHelpers.handleKeydown(keyEvent);
      expect(helper.handleKeyboardEvent).toHaveBeenCalledWith(keyEvent);
    });
  });
});

describe('Integration with Focus Management', () => {
  let testEnv: TestEnvironment;
  let keyboardActor: KeyboardNavigationActor;
  let helper: KeyboardNavigationHelper;
  let mockFocusActor: ReturnType<typeof createMockFocusActor>;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    keyboardActor = createActor(keyboardNavigationMachine);
    keyboardActor.start();

    mockFocusActor = createMockFocusActor();

    const container = document.createElement('div');
    testEnv.container.appendChild(container);

    keyboardActor.send({
      type: 'ENABLE_NAVIGATION',
      container,
      focusActor: mockFocusActor as never,
    });

    helper = createKeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());
  });

  afterEach(() => {
    testEnv.cleanup();
    keyboardActor.stop();
  });

  it('integrates with focus management for complete navigation', () => {
    // Simulate user pressing arrow down
    const downEvent = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    helper.handleKeyboardEvent(downEvent);

    // Should send move to next to focus management
    expect(mockFocusActor.send).toHaveBeenCalledWith({
      type: 'MOVE_TO_NEXT',
    });
  });

  it('respects orientation when working with focus management', () => {
    helper.setOrientation('horizontal');

    // Vertical keys should not trigger navigation
    const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp' });
    helper.handleKeyboardEvent(upEvent);

    expect(mockFocusActor.send).not.toHaveBeenCalled();

    // Horizontal keys should trigger navigation
    const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    helper.handleKeyboardEvent(rightEvent);

    expect(mockFocusActor.send).toHaveBeenCalledWith({
      type: 'MOVE_TO_NEXT',
    });
  });
});

describe('Accessibility Compliance', () => {
  let testEnv: TestEnvironment;
  let keyboardActor: KeyboardNavigationActor;
  let helper: KeyboardNavigationHelper;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    keyboardActor = createActor(keyboardNavigationMachine);
    keyboardActor.start();

    const container = document.createElement('div');
    testEnv.container.appendChild(container);

    keyboardActor.send({
      type: 'ENABLE_NAVIGATION',
      container,
    });

    helper = createKeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());
  });

  afterEach(() => {
    testEnv.cleanup();
    keyboardActor.stop();
  });

  it('implements roving tab index correctly', () => {
    helper.setRovingTabIndex(true);

    // Update helper with new snapshot
    helper = createKeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

    // First item should be focusable
    const firstItemAttrs = helper.getItemAttributes(0, true);
    expect(firstItemAttrs).toContain('tabindex="0"');

    // Other items should not be focusable
    const secondItemAttrs = helper.getItemAttributes(1, false);
    expect(secondItemAttrs).toContain('tabindex="-1"');
  });

  it('provides proper ARIA-compatible attributes', () => {
    helper.setRovingTabIndex(true);
    helper.setHomeEndEnabled(true);
    helper.setTypeaheadEnabled(true);

    // Update helper with new snapshot
    helper = createKeyboardNavigationHelper(keyboardActor, keyboardActor.getSnapshot());

    const containerAttrs = helper.getKeyboardAttributes();

    // Should include accessibility-related data attributes
    expect(containerAttrs).toContain('data-roving-tabindex="true"');
    expect(containerAttrs).toContain('data-home-end="true"');
    expect(containerAttrs).toContain('data-typeahead="true"');
  });

  it('supports standard keyboard interaction patterns', () => {
    const keyEventsToTest = [
      { key: 'ArrowDown', description: 'Arrow Down' },
      { key: 'ArrowUp', description: 'Arrow Up' },
      { key: 'ArrowLeft', description: 'Arrow Left' },
      { key: 'ArrowRight', description: 'Arrow Right' },
      { key: 'Home', description: 'Home' },
      { key: 'End', description: 'End' },
      { key: 'Enter', description: 'Enter' },
      { key: ' ', description: 'Space' },
    ];

    keyEventsToTest.forEach(({ key, description }) => {
      const keyEvent = new KeyboardEvent('keydown', { key });

      expect(() => {
        helper.handleKeyboardEvent(keyEvent);
      }).not.toThrow();
    });
  });
});
