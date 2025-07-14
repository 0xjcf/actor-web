import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor, sendTo, setup } from 'xstate';
import { createTestEnvironment, type TestEnvironment } from '../testing/actor-test-utils.js';
import {
  type AnimationKeyframe,
  AnimationPresets,
  AnimationServices,
  createAnimationService,
  createParallelService,
  createSequenceService,
  createSpringService,
  createTransitionService,
  type ParallelAnimationGroup,
  type SequenceStep,
  type TransitionConfig,
} from './animation-services.js';
import { Logger } from './dev-mode.js';

const log = Logger.namespace('ANIMATION_SERVICES_TEST');

// Mock Web Animations API
interface MockAnimation {
  playState: 'idle' | 'running' | 'paused' | 'finished';
  playbackRate: number;
  finished: Promise<Animation>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  reverse: ReturnType<typeof vi.fn>;
  finish: ReturnType<typeof vi.fn>;
}

// Type for frame callback function
type FrameCallback = (timestamp: number) => void;

const createMockAnimation = (): MockAnimation => ({
  playState: 'running',
  playbackRate: 1,
  finished: Promise.resolve({} as Animation),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  pause: vi.fn(),
  play: vi.fn(),
  cancel: vi.fn(),
  reverse: vi.fn(),
  finish: vi.fn(),
});

// Helper to create a test machine that captures service events
const createTestMachine = (serviceType: string, input: unknown) => {
  const events: Array<{ type: string }> = [];

  const machine = setup({
    actors: {
      animation: createAnimationService(),
      sequence: createSequenceService(),
      parallel: createParallelService(),
      transition: createTransitionService(),
      spring: createSpringService(),
    },
  }).createMachine({
    initial: 'invoking',
    context: { events },
    states: {
      invoking: {
        invoke: {
          src: serviceType as 'animation' | 'sequence' | 'parallel' | 'transition' | 'spring',
          input: input as never,
          id: 'service',
        },
        on: {
          // Control events - forward to the service
          PAUSE: { actions: sendTo('service', ({ event }) => event) },
          RESUME: { actions: sendTo('service', ({ event }) => event) },
          CANCEL: { actions: sendTo('service', ({ event }) => event) },
          REVERSE: { actions: sendTo('service', ({ event }) => event) },
          SET_PLAYBACK_RATE: { actions: sendTo('service', ({ event }) => event) },
          PAUSE_SEQUENCE: { actions: sendTo('service', ({ event }) => event) },
          RESUME_SEQUENCE: { actions: sendTo('service', ({ event }) => event) },
          CANCEL_SEQUENCE: { actions: sendTo('service', ({ event }) => event) },
          SKIP_STEP: { actions: sendTo('service', ({ event }) => event) },
          PAUSE_PARALLEL: { actions: sendTo('service', ({ event }) => event) },
          RESUME_PARALLEL: { actions: sendTo('service', ({ event }) => event) },
          CANCEL_PARALLEL: { actions: sendTo('service', ({ event }) => event) },
          CANCEL_SPRING: { actions: sendTo('service', ({ event }) => event) },
          // All other events - capture them
          '*': {
            actions: ({ context, event }) => {
              context.events.push(event);
            },
          },
        },
      },
    },
  });

  return { machine, events };
};

describe('Animation Services', () => {
  let testEnv: TestEnvironment;
  let mockElement: HTMLElement;
  let mockAnimation: MockAnimation;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    log.debug('Animation services test environment initialized', { testEnvExists: !!testEnv });

    // Create mock element
    mockElement = document.createElement('div');
    mockElement.style.position = 'absolute';
    mockElement.style.top = '0px';
    mockElement.style.left = '0px';
    document.body.appendChild(mockElement);

    // Mock Web Animations API
    mockAnimation = createMockAnimation();
    mockElement.animate = vi.fn().mockReturnValue(mockAnimation);

    // Mock requestAnimationFrame for spring animations
    global.requestAnimationFrame = vi.fn((callback) => {
      setTimeout(callback, 16);
      return 1;
    });
    global.cancelAnimationFrame = vi.fn();

    // Mock performance.now for consistent timing
    vi.spyOn(performance, 'now').mockReturnValue(0);
    log.debug('Animation mocks and test element set up', {
      elementTag: mockElement.tagName,
      hasAnimateMock: !!mockElement.animate,
      hasRAFMock: !!global.requestAnimationFrame,
    });
  });

  afterEach(() => {
    testEnv.cleanup();
    vi.restoreAllMocks();
    log.debug('Animation services test environment cleaned up');
  });

  describe('Single Animation Service', () => {
    describe('Animation Creation', () => {
      it('creates animations with Web Animations API', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 0 }, { opacity: 1 }],
          options: { duration: 300, easing: 'ease-out' },
        });
        log.debug('Web Animations API test started', {
          keyframes: [{ opacity: 0 }, { opacity: 1 }],
          duration: 300,
          easing: 'ease-out',
        });

        const actor = createActor(machine);
        actor.start();
        log.debug('Animation actor started', { actorExists: !!actor });

        // Should create animation with correct parameters
        expect(mockElement.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
          easing: 'ease-out',
          delay: 0,
          iterations: 1,
          direction: 'normal',
          fill: 'none',
        });

        // Should send animation started event
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_STARTED',
            animation: mockAnimation,
            element: mockElement,
            data: null,
          })
        );

        actor.stop();
      });

      it('includes custom data in animation events', () => {
        const customData = { animationId: 'fadeIn', context: 'menu' };
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
          options: { data: customData },
        });

        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_STARTED',
            animation: mockAnimation,
            element: mockElement,
            data: customData,
          })
        );

        actor.stop();
      });
    });

    describe('Animation Lifecycle Events', () => {
      it('handles animation completion', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        // Simulate animation finish
        const finishHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'finish'
        )?.[1];

        finishHandler?.();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_COMPLETE',
            animation: mockAnimation,
            element: mockElement,
            data: null,
          })
        );

        actor.stop();
      });

      it('handles animation cancellation', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        // Simulate animation cancel
        const cancelHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'cancel'
        )?.[1];

        cancelHandler?.();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_CANCELLED',
            animation: mockAnimation,
            element: mockElement,
            data: null,
          })
        );

        actor.stop();
      });
    });

    describe('Animation Control', () => {
      it('pauses and resumes animations on external events', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        // Test pause
        actor.send({ type: 'PAUSE' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_PAUSED',
            animation: mockAnimation,
          })
        );

        // Test resume
        actor.send({ type: 'RESUME' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_RESUMED',
            animation: mockAnimation,
          })
        );

        actor.stop();
      });

      it('cancels animations on external events', () => {
        const { machine } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'CANCEL' });
        expect(mockAnimation.cancel).toHaveBeenCalled();

        actor.stop();
      });

      it('changes playback rate on external events', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'SET_PLAYBACK_RATE', rate: 2 });

        expect(mockAnimation.playbackRate).toBe(2);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PLAYBACK_RATE_CHANGED',
            rate: 2,
            animation: mockAnimation,
          })
        );

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles missing element gracefully', () => {
        const { machine, events } = createTestMachine('animation', {
          element: null as unknown as Element,
          keyframes: [{ opacity: 1 }],
        });

        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_ERROR',
            error: 'Element and keyframes are required',
          })
        );

        actor.stop();
      });

      it('handles missing keyframes gracefully', () => {
        const { machine, events } = createTestMachine('animation', {
          element: mockElement,
          keyframes: null as unknown as AnimationKeyframe[],
        });

        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'ANIMATION_ERROR',
            error: 'Element and keyframes are required',
          })
        );

        actor.stop();
      });
    });
  });

  describe('Sequence Animation Service', () => {
    let secondElement: HTMLElement;
    let secondMockAnimation: MockAnimation;

    beforeEach(() => {
      secondElement = document.createElement('div');
      document.body.appendChild(secondElement);

      secondMockAnimation = createMockAnimation();
      secondElement.animate = vi.fn().mockReturnValue(secondMockAnimation);
    });

    describe('Step Execution', () => {
      it('executes animation steps in sequence', () => {
        const steps: SequenceStep[] = [
          {
            element: mockElement,
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            options: { duration: 200 },
            id: 'step1',
          },
          {
            element: secondElement,
            keyframes: [{ transform: 'translateY(0)' }],
            options: { duration: 150 },
            id: 'step2',
          },
        ];

        const { machine, events } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        // First step should start immediately
        expect(mockElement.animate).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_STEP_STARTED',
            stepIndex: 0,
            stepId: 'step1',
            animation: mockAnimation,
            element: mockElement,
          })
        );

        // Second step should not start yet
        expect(secondElement.animate).not.toHaveBeenCalled();

        // Simulate first animation finishing
        const finishHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'finish'
        )?.[1];

        finishHandler?.();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_STEP_COMPLETE',
            stepIndex: 0,
            stepId: 'step1',
            animation: mockAnimation,
            element: mockElement,
          })
        );

        // Now second step should start
        expect(secondElement.animate).toHaveBeenCalled();

        actor.stop();
      });

      it('handles parallel steps when waitForCompletion is false', () => {
        const steps: SequenceStep[] = [
          {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
            waitForCompletion: false,
            id: 'parallel1',
          },
          {
            element: secondElement,
            keyframes: [{ opacity: 1 }],
            id: 'parallel2',
          },
        ];

        const { machine } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        // Both steps should start immediately
        expect(mockElement.animate).toHaveBeenCalled();
        expect(secondElement.animate).toHaveBeenCalled();

        actor.stop();
      });
    });

    describe('Sequence Control', () => {
      it('pauses and resumes entire sequence', () => {
        const steps: SequenceStep[] = [
          {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
        ];

        const { machine, events } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        // Test pause
        actor.send({ type: 'PAUSE_SEQUENCE' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_PAUSED',
            currentStep: 0,
          })
        );

        // Test resume
        actor.send({ type: 'RESUME_SEQUENCE' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_RESUMED',
            currentStep: 0,
          })
        );

        actor.stop();
      });

      it('cancels entire sequence', () => {
        const steps: SequenceStep[] = [{ element: mockElement, keyframes: [{ opacity: 1 }] }];

        const { machine, events } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'CANCEL_SEQUENCE' });

        expect(mockAnimation.cancel).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_CANCELLED',
            totalSteps: 1,
          })
        );

        actor.stop();
      });

      it('skips current step when requested', () => {
        const steps: SequenceStep[] = [{ element: mockElement, keyframes: [{ opacity: 1 }] }];

        const { machine } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'SKIP_STEP' });
        expect(mockAnimation.finish).toHaveBeenCalled();

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles empty steps gracefully', () => {
        const { machine, events } = createTestMachine('sequence', { steps: [] });
        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_ERROR',
            error: 'No steps provided',
          })
        );

        actor.stop();
      });

      it('handles invalid step elements', () => {
        const steps: SequenceStep[] = [
          {
            element: null as unknown as Element,
            keyframes: [{ opacity: 1 }],
            id: 'invalid-step',
          },
        ];

        const { machine, events } = createTestMachine('sequence', { steps });
        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SEQUENCE_STEP_ERROR',
            stepIndex: 0,
            stepId: 'invalid-step',
            error: 'Element and keyframes are required',
          })
        );

        actor.stop();
      });
    });
  });

  describe('Parallel Animation Service', () => {
    let thirdElement: HTMLElement;
    let thirdMockAnimation: MockAnimation;

    beforeEach(() => {
      thirdElement = document.createElement('div');
      document.body.appendChild(thirdElement);

      thirdMockAnimation = createMockAnimation();
      thirdElement.animate = vi.fn().mockReturnValue(thirdMockAnimation);
    });

    describe('Group Execution', () => {
      it('starts all animations in parallel groups simultaneously', () => {
        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            options: { duration: 300 },
            id: 'fade-group',
          },
        ];

        const { machine, events } = createTestMachine('parallel', { groups });
        const actor = createActor(machine);
        actor.start();

        // All elements should start animating
        expect(mockElement.animate).toHaveBeenCalled();
        expect(thirdElement.animate).toHaveBeenCalled();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_GROUP_STARTED',
            groupId: 'fade-group',
            groupIndex: 0,
            animationCount: 2,
          })
        );

        actor.stop();
      });

      it('staggers animations within groups', () => {
        // Store mock animate functions
        const mockAnimateFn = vi.fn().mockReturnValue(mockAnimation);
        const thirdMockAnimateFn = vi.fn().mockReturnValue(thirdMockAnimation);

        mockElement.animate = mockAnimateFn;
        thirdElement.animate = thirdMockAnimateFn;

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
            options: { delay: 100 },
          },
        ];

        const { machine } = createTestMachine('parallel', { groups });
        const actor = createActor(machine);
        actor.start();

        // Check that animations have staggered delays
        const firstCall = mockAnimateFn.mock.calls[0][1];
        const secondCall = thirdMockAnimateFn.mock.calls[0][1];

        expect(firstCall.delay).toBe(100); // Base delay
        expect(secondCall.delay).toBe(150); // Base delay + 50ms stagger

        actor.stop();
      });
    });

    describe('Group Control', () => {
      it('pauses and resumes all parallel animations', () => {
        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
          },
        ];

        const { machine, events } = createTestMachine('parallel', { groups });
        const actor = createActor(machine);
        actor.start();

        // Test pause
        actor.send({ type: 'PAUSE_PARALLEL' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(thirdMockAnimation.pause).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_PAUSED',
          })
        );

        // Test resume
        actor.send({ type: 'RESUME_PARALLEL' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(thirdMockAnimation.play).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_RESUMED',
          })
        );

        actor.stop();
      });

      it('cancels all parallel animations', () => {
        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
          },
        ];

        const { machine, events } = createTestMachine('parallel', { groups });
        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'CANCEL_PARALLEL' });

        expect(mockAnimation.cancel).toHaveBeenCalled();
        expect(thirdMockAnimation.cancel).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_CANCELLED',
          })
        );

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles empty groups gracefully', () => {
        const { machine, events } = createTestMachine('parallel', { groups: [] });
        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_ERROR',
            error: 'No groups provided',
          })
        );

        actor.stop();
      });

      it('handles groups with invalid elements', () => {
        const groups: ParallelAnimationGroup[] = [
          {
            elements: [],
            keyframes: [{ opacity: 1 }],
            id: 'empty-group',
          },
        ];

        const { machine, events } = createTestMachine('parallel', { groups });
        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'PARALLEL_GROUP_ERROR',
            groupId: 'empty-group',
            error: 'Elements and keyframes are required',
          })
        );

        actor.stop();
      });
    });
  });

  describe('CSS Transition Service', () => {
    beforeEach(() => {
      // Mock CSS transition events
      global.TransitionEvent = class extends Event {
        propertyName: string;

        constructor(type: string, init: { propertyName: string; target?: Element }) {
          super(type);
          this.propertyName = init.propertyName;
          // Note: Don't set target here as it's read-only in Event
          // The target will be set by the DOM when the event is dispatched
        }
      } as never;
    });

    describe('Transition Creation', () => {
      it('applies CSS transitions to elements', () => {
        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
          from: '0',
          duration: 200,
        };

        const { machine } = createTestMachine('transition', transitionConfig);
        const actor = createActor(machine);
        actor.start();

        // Verify initial value was set
        expect(mockElement.style.opacity).toBe('0');

        // Verify transition property was applied
        expect(mockElement.style.transition).toContain('opacity 200ms ease 0ms');

        // Note: Final value is not immediately set - CSS transitions handle this asynchronously

        actor.stop();
      });

      it('uses current value when from is not provided', () => {
        mockElement.style.opacity = '0.5';

        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
          duration: 100,
        };

        const { machine } = createTestMachine('transition', transitionConfig);
        const actor = createActor(machine);
        actor.start();

        // Should not override existing value initially
        expect(mockElement.style.opacity).toBe('0.5');

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles transition cancellation via DOM event', () => {
        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
        };

        const { machine } = createTestMachine('transition', transitionConfig);
        const actor = createActor(machine);
        actor.start();

        // Simulate transition cancel - this should not crash
        const event = new TransitionEvent('transitioncancel', {
          propertyName: 'opacity',
        });

        expect(() => {
          mockElement.dispatchEvent(event);
        }).not.toThrow();

        actor.stop();
      });

      it('validates required parameters', () => {
        const invalidConfig = {
          element: null,
          property: 'opacity',
          to: '1',
        } as never;

        const { machine } = createTestMachine('transition', invalidConfig);
        const actor = createActor(machine);

        // This should not crash when starting with invalid config
        expect(() => {
          actor.start();
        }).not.toThrow();

        actor.stop();
      });
    });
  });

  describe('Spring Animation Service', () => {
    describe('Spring Physics', () => {
      it('creates physics-based animations', () => {
        const { machine, events } = createTestMachine('spring', {
          element: mockElement,
          property: 'transform',
          from: 0.8,
          to: 1,
          config: { stiffness: 200, damping: 20 },
        });
        log.debug('Spring animation test started', {
          property: 'transform',
          from: 0.8,
          to: 1,
          stiffness: 200,
          damping: 20,
        });

        const actor = createActor(machine);
        actor.start();
        log.debug('Spring animation actor started', {
          actorExists: !!actor,
          expectedEventType: 'SPRING_STARTED',
        });

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SPRING_STARTED',
            from: 0.8,
            to: 1,
          })
        );
        log.debug('Spring animation event verification completed', {
          eventsReceived: events.length,
          hasSpringStartedEvent: events.some((e) => e.type === 'SPRING_STARTED'),
        });

        // Should start animation loop
        expect(global.requestAnimationFrame).toHaveBeenCalled();

        actor.stop();
      });

      it('applies spring values to element properties', () => {
        // Mock requestAnimationFrame to execute immediately
        global.requestAnimationFrame = vi.fn((callback) => {
          callback(0);
          return 1;
        });

        const { machine } = createTestMachine('spring', {
          element: mockElement,
          property: 'transform',
          from: 0.8,
          to: 1,
        });

        const actor = createActor(machine);
        actor.start();

        // Should update transform property
        expect(mockElement.style.transform).toContain('scale(');

        actor.stop();
      });

      it('sends spring update events during animation', () => {
        let frameCallback: FrameCallback | undefined;
        global.requestAnimationFrame = vi.fn((callback) => {
          frameCallback = callback;
          return 1;
        });

        const { machine, events } = createTestMachine('spring', {
          element: mockElement,
          property: 'opacity',
          from: 0,
          to: 1,
        });

        const actor = createActor(machine);
        actor.start();

        // Execute a frame
        frameCallback?.(0);

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SPRING_UPDATE',
            currentValue: expect.any(Number),
            velocity: expect.any(Number),
            progress: expect.any(Number),
          })
        );

        actor.stop();
      });
    });

    describe('Spring Control', () => {
      it('cancels spring animation on external events', () => {
        const { machine, events } = createTestMachine('spring', {
          element: mockElement,
          property: 'opacity',
          from: 0,
          to: 1,
        });

        const actor = createActor(machine);
        actor.start();

        actor.send({ type: 'CANCEL_SPRING' });

        expect(global.cancelAnimationFrame).toHaveBeenCalled();
        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SPRING_CANCELLED',
            currentValue: expect.any(Number),
          })
        );

        actor.stop();
      });
    });

    describe('Error Handling', () => {
      it('handles missing required parameters', () => {
        const { machine, events } = createTestMachine('spring', {
          element: null as unknown as Element,
          property: 'opacity',
          from: 0,
          to: 1,
        });

        const actor = createActor(machine);
        actor.start();

        expect(events).toContainEqual(
          expect.objectContaining({
            type: 'SPRING_ERROR',
            error: 'Element, property, from, and to values are required',
          })
        );

        actor.stop();
      });
    });
  });

  describe('Animation Presets', () => {
    describe('Common Animation Patterns', () => {
      it('provides fade in preset with correct configuration', () => {
        const fadeIn = AnimationPresets.fadeIn(500);

        expect(fadeIn.keyframes).toEqual([{ opacity: '0' }, { opacity: '1' }]);
        expect(fadeIn.options).toEqual({
          duration: 500,
          fill: 'forwards',
        });
      });

      it('provides fade out preset with correct configuration', () => {
        const fadeOut = AnimationPresets.fadeOut(300);

        expect(fadeOut.keyframes).toEqual([{ opacity: '1' }, { opacity: '0' }]);
        expect(fadeOut.options).toEqual({
          duration: 300,
          fill: 'forwards',
        });
      });

      it('provides slide animations with distance parameters', () => {
        const slideUp = AnimationPresets.slideInUp(30, 400);

        expect(slideUp.keyframes).toEqual([
          { transform: 'translateY(30px)', opacity: '0' },
          { transform: 'translateY(0)', opacity: '1' },
        ]);
        expect(slideUp.options).toEqual({
          duration: 400,
          fill: 'forwards',
          easing: 'ease-out',
        });
      });

      it('provides scale animation preset', () => {
        const scaleIn = AnimationPresets.scaleIn(250);

        expect(scaleIn.keyframes).toEqual([
          { transform: 'scale(0.8)', opacity: '0' },
          { transform: 'scale(1)', opacity: '1' },
        ]);
        expect(scaleIn.options).toEqual({
          duration: 250,
          fill: 'forwards',
          easing: 'ease-out',
        });
      });

      it('provides infinite animations', () => {
        const pulse = AnimationPresets.pulse(1.1, 800);

        expect(pulse.options?.iterations).toBe(Number.POSITIVE_INFINITY);
        expect(pulse.options?.duration).toBe(800);
      });
    });

    describe('Preset Integration', () => {
      it('presets work with animation services', () => {
        const fadeIn = AnimationPresets.fadeIn(200);

        const { machine } = createTestMachine('animation', {
          element: mockElement,
          keyframes: fadeIn.keyframes,
          options: fadeIn.options,
        });

        const actor = createActor(machine);
        actor.start();

        expect(mockElement.animate).toHaveBeenCalledWith(
          fadeIn.keyframes,
          expect.objectContaining({
            duration: 200,
            fill: 'forwards',
          })
        );

        actor.stop();
      });
    });
  });

  describe('Pre-configured Services', () => {
    it('provides ready-to-use animation services', () => {
      expect(AnimationServices.single).toBeDefined();
      expect(AnimationServices.sequence).toBeDefined();
      expect(AnimationServices.parallel).toBeDefined();
      expect(AnimationServices.transition).toBeDefined();
      expect(AnimationServices.spring).toBeDefined();
    });
  });

  describe('Performance Characteristics', () => {
    it('creates animation services efficiently', async () => {
      const start = performance.now();

      // Create multiple services
      const services = [
        createAnimationService(),
        createSequenceService(),
        createParallelService(),
        createTransitionService(),
        createSpringService(),
      ];

      const setupTime = performance.now() - start;

      expect(services).toHaveLength(5);
      expect(setupTime).toBeLessThan(10);
    });

    it('handles multiple simultaneous animations efficiently', async () => {
      const elements = Array.from({ length: 20 }, () => {
        const el = document.createElement('div');
        el.animate = vi.fn().mockReturnValue(createMockAnimation());
        return el;
      });

      const start = performance.now();

      const { machine } = createTestMachine('parallel', {
        groups: [
          {
            elements,
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            options: { duration: 300 },
          },
        ],
      });

      const actor = createActor(machine);
      actor.start();

      const animationTime = performance.now() - start;

      expect(animationTime).toBeLessThan(50);

      actor.stop();
    });

    it('generates animation presets efficiently', async () => {
      // Test performance of preset generation
      const start = performance.now();
      const presets = [
        AnimationPresets.fadeIn(),
        AnimationPresets.fadeOut(),
        AnimationPresets.slideInUp(),
        AnimationPresets.slideInDown(),
        AnimationPresets.scaleIn(),
        AnimationPresets.bounce(),
        AnimationPresets.pulse(),
      ];
      const end = performance.now();

      expect(presets).toHaveLength(7);

      // Should be fast (< 5ms)
      expect(end - start).toBeLessThan(5);
    });
  });
});
