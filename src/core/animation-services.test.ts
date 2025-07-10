import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createActor } from 'xstate';
import {
  createTestEnvironment,
  performanceTestUtils,
  setupGlobalMocks,
  type TestEnvironment,
} from '@/framework/testing';
import {
  type AnimationKeyframe,
  type AnimationOptions,
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

describe('Animation Services', () => {
  let testEnv: TestEnvironment;
  let mockElement: HTMLElement;
  let mockAnimation: MockAnimation;

  beforeEach(() => {
    testEnv = createTestEnvironment();
    setupGlobalMocks();

    // Create mock element
    mockElement = document.createElement('div');
    mockElement.style.position = 'absolute';
    mockElement.style.top = '0px';
    mockElement.style.left = '0px';
    testEnv.container.appendChild(mockElement);

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
  });

  afterEach(() => {
    testEnv.cleanup();
    vi.restoreAllMocks();
  });

  describe('Single Animation Service', () => {
    describe('Animation Creation', () => {
      it('creates animations with Web Animations API', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const keyframes: AnimationKeyframe[] = [{ opacity: 0 }, { opacity: 1 }];

        const options: AnimationOptions = {
          duration: 300,
          easing: 'ease-out',
        };

        // Call the service logic directly by extracting it
        const serviceLogic = (service as any).config.src;
        const cleanup = serviceLogic({
          sendBack: mockSendBack,
          input: { element: mockElement, keyframes, options },
          receive: vi.fn(),
        });

        // Should create animation with correct parameters
        expect(mockElement.animate).toHaveBeenCalledWith(keyframes, {
          duration: 300,
          easing: 'ease-out',
          delay: 0,
          iterations: 1,
          direction: 'normal',
          fill: 'none',
        });

        // Should send animation started event
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_STARTED',
          animation: mockAnimation,
          element: mockElement,
          data: null,
        });

        cleanup();
      });

      it('applies default animation options when not provided', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const keyframes: AnimationKeyframe[] = [{ transform: 'scale(1.1)' }];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { element: mockElement, keyframes },
          receive: vi.fn(),
        });

        expect(mockElement.animate).toHaveBeenCalledWith(keyframes, {
          duration: 300,
          easing: 'ease',
          delay: 0,
          iterations: 1,
          direction: 'normal',
          fill: 'none',
        });

        cleanup();
      });

      it('includes custom data in animation events', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const customData = { animationId: 'fadeIn', context: 'menu' };

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
            options: { data: customData },
          },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_STARTED',
          animation: mockAnimation,
          element: mockElement,
          data: customData,
        });

        cleanup();
      });
    });

    describe('Animation Lifecycle Events', () => {
      it('handles animation completion', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
          receive: vi.fn(),
        });

        // Simulate animation finish
        const finishHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'finish'
        )?.[1];

        finishHandler?.();

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_COMPLETE',
          animation: mockAnimation,
          element: mockElement,
          data: null,
        });

        cleanup();
      });

      it('handles animation cancellation', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
          receive: vi.fn(),
        });

        // Simulate animation cancel
        const cancelHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'cancel'
        )?.[1];

        cancelHandler?.();

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_CANCELLED',
          animation: mockAnimation,
          element: mockElement,
          data: null,
        });

        cleanup();
      });
    });

    describe('Animation Control', () => {
      it('pauses and resumes animations on external events', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        // Test pause
        receiveHandler({ type: 'PAUSE' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_PAUSED',
          animation: mockAnimation,
        });

        // Test resume
        receiveHandler({ type: 'RESUME' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_RESUMED',
          animation: mockAnimation,
        });

        cleanup();
      });

      it('cancels animations on external events', () => {
        const service = createAnimationService();
        const mockReceive = vi.fn();

        const cleanup = service({
          sendBack: vi.fn(),
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'CANCEL' });
        expect(mockAnimation.cancel).toHaveBeenCalled();

        cleanup();
      });

      it('changes playback rate on external events', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'SET_PLAYBACK_RATE', rate: 2 });

        expect(mockAnimation.playbackRate).toBe(2);
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PLAYBACK_RATE_CHANGED',
          rate: 2,
          animation: mockAnimation,
        });

        cleanup();
      });
    });

    describe('Error Handling', () => {
      it('handles missing element gracefully', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: null as unknown as Element,
            keyframes: [{ opacity: 1 }],
          },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_ERROR',
          error: 'Element and keyframes are required',
        });

        cleanup();
      });

      it('handles missing keyframes gracefully', () => {
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: null as unknown as AnimationKeyframe[],
          },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'ANIMATION_ERROR',
          error: 'Element and keyframes are required',
        });

        cleanup();
      });
    });
  });

  describe('Sequence Animation Service', () => {
    let secondElement: HTMLElement;
    let secondMockAnimation: MockAnimation;

    beforeEach(() => {
      secondElement = document.createElement('div');
      testEnv.container.appendChild(secondElement);

      secondMockAnimation = createMockAnimation();
      secondElement.animate = vi.fn().mockReturnValue(secondMockAnimation);
    });

    describe('Step Execution', () => {
      it('executes animation steps in sequence', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();

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

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps },
          receive: vi.fn(),
        });

        // First step should start immediately
        expect(mockElement.animate).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_STEP_STARTED',
          stepIndex: 0,
          stepId: 'step1',
          animation: mockAnimation,
          element: mockElement,
        });

        // Second step should not start yet
        expect(secondElement.animate).not.toHaveBeenCalled();

        // Simulate first animation finishing
        const finishHandler = mockAnimation.addEventListener.mock.calls.find(
          (call) => call[0] === 'finish'
        )?.[1];

        finishHandler?.();

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_STEP_COMPLETE',
          stepIndex: 0,
          stepId: 'step1',
          animation: mockAnimation,
          element: mockElement,
        });

        // Now second step should start
        expect(secondElement.animate).toHaveBeenCalled();

        cleanup();
      });

      it('handles parallel steps when waitForCompletion is false', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();

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

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps },
          receive: vi.fn(),
        });

        // Both steps should start immediately
        expect(mockElement.animate).toHaveBeenCalled();
        expect(secondElement.animate).toHaveBeenCalled();

        cleanup();
      });
    });

    describe('Sequence Control', () => {
      it('pauses and resumes entire sequence', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const steps: SequenceStep[] = [
          {
            element: mockElement,
            keyframes: [{ opacity: 1 }],
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        // Test pause
        receiveHandler({ type: 'PAUSE_SEQUENCE' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_PAUSED',
          currentStep: 0,
        });

        // Test resume
        receiveHandler({ type: 'RESUME_SEQUENCE' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_RESUMED',
          currentStep: 0,
        });

        cleanup();
      });

      it('cancels entire sequence', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const steps: SequenceStep[] = [{ element: mockElement, keyframes: [{ opacity: 1 }] }];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'CANCEL_SEQUENCE' });

        expect(mockAnimation.cancel).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_CANCELLED',
          totalSteps: 1,
        });

        cleanup();
      });

      it('skips current step when requested', () => {
        const service = createSequenceService();
        const mockReceive = vi.fn();

        const steps: SequenceStep[] = [{ element: mockElement, keyframes: [{ opacity: 1 }] }];

        const cleanup = service({
          sendBack: vi.fn(),
          input: { steps },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'SKIP_STEP' });
        expect(mockAnimation.finish).toHaveBeenCalled();

        cleanup();
      });
    });

    describe('Error Handling', () => {
      it('handles empty steps gracefully', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps: [] },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_ERROR',
          error: 'No steps provided',
        });

        cleanup();
      });

      it('handles invalid step elements', () => {
        const service = createSequenceService();
        const mockSendBack = vi.fn();

        const steps: SequenceStep[] = [
          {
            element: null as unknown as Element,
            keyframes: [{ opacity: 1 }],
            id: 'invalid-step',
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { steps },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SEQUENCE_STEP_ERROR',
          stepIndex: 0,
          stepId: 'invalid-step',
          error: 'Element and keyframes are required',
        });

        cleanup();
      });
    });
  });

  describe('Parallel Animation Service', () => {
    let thirdElement: HTMLElement;
    let thirdMockAnimation: MockAnimation;

    beforeEach(() => {
      thirdElement = document.createElement('div');
      testEnv.container.appendChild(thirdElement);

      thirdMockAnimation = createMockAnimation();
      thirdElement.animate = vi.fn().mockReturnValue(thirdMockAnimation);
    });

    describe('Group Execution', () => {
      it('starts all animations in parallel groups simultaneously', () => {
        const service = createParallelService();
        const mockSendBack = vi.fn();

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 0 }, { opacity: 1 }],
            options: { duration: 300 },
            id: 'fade-group',
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { groups },
          receive: vi.fn(),
        });

        // All elements should start animating
        expect(mockElement.animate).toHaveBeenCalled();
        expect(thirdElement.animate).toHaveBeenCalled();

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_GROUP_STARTED',
          groupId: 'fade-group',
          groupIndex: 0,
          animationCount: 2,
        });

        cleanup();
      });

      it('staggers animations within groups', () => {
        const service = createParallelService();

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
            options: { delay: 100 },
          },
        ];

        const cleanup = service({
          sendBack: vi.fn(),
          input: { groups },
          receive: vi.fn(),
        });

        // Check that animations have staggered delays
        const firstCall = mockElement.animate.mock.calls[0][1];
        const secondCall = thirdElement.animate.mock.calls[0][1];

        expect(firstCall.delay).toBe(100); // Base delay
        expect(secondCall.delay).toBe(150); // Base delay + 50ms stagger

        cleanup();
      });
    });

    describe('Group Control', () => {
      it('pauses and resumes all parallel animations', () => {
        const service = createParallelService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { groups },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        // Test pause
        receiveHandler({ type: 'PAUSE_PARALLEL' });
        expect(mockAnimation.pause).toHaveBeenCalled();
        expect(thirdMockAnimation.pause).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_PAUSED',
        });

        // Test resume
        receiveHandler({ type: 'RESUME_PARALLEL' });
        expect(mockAnimation.play).toHaveBeenCalled();
        expect(thirdMockAnimation.play).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_RESUMED',
        });

        cleanup();
      });

      it('cancels all parallel animations', () => {
        const service = createParallelService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [mockElement, thirdElement],
            keyframes: [{ opacity: 1 }],
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { groups },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'CANCEL_PARALLEL' });

        expect(mockAnimation.cancel).toHaveBeenCalled();
        expect(thirdMockAnimation.cancel).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_CANCELLED',
        });

        cleanup();
      });
    });

    describe('Error Handling', () => {
      it('handles empty groups gracefully', () => {
        const service = createParallelService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: { groups: [] },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_ERROR',
          error: 'No groups provided',
        });

        cleanup();
      });

      it('handles groups with invalid elements', () => {
        const service = createParallelService();
        const mockSendBack = vi.fn();

        const groups: ParallelAnimationGroup[] = [
          {
            elements: [],
            keyframes: [{ opacity: 1 }],
            id: 'empty-group',
          },
        ];

        const cleanup = service({
          sendBack: mockSendBack,
          input: { groups },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'PARALLEL_GROUP_ERROR',
          groupId: 'empty-group',
          error: 'Elements and keyframes are required',
        });

        cleanup();
      });
    });
  });

  describe('CSS Transition Service', () => {
    beforeEach(() => {
      // Mock CSS transition events
      global.TransitionEvent = class extends Event {
        propertyName: string;
        target: Element;

        constructor(type: string, init: { propertyName: string; target: Element }) {
          super(type);
          this.propertyName = init.propertyName;
          this.target = init.target;
        }
      } as never;
    });

    describe('Transition Creation', () => {
      it('applies CSS transitions to elements', async () => {
        const service = createTransitionService();

        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
          from: '0',
          duration: 200,
        };

        // Start transition (returns a promise)
        const transitionPromise = service({ input: transitionConfig });

        // Verify initial value was set
        expect(mockElement.style.opacity).toBe('0');

        // Verify transition property was applied
        expect(mockElement.style.transition).toContain('opacity 200ms ease 0ms');

        // Simulate transition end
        setTimeout(() => {
          const event = new TransitionEvent('transitionend', {
            propertyName: 'opacity',
            target: mockElement,
          });
          mockElement.dispatchEvent(event);
        }, 10);

        await expect(transitionPromise).resolves.toBeUndefined();
      });

      it('uses current value when from is not provided', async () => {
        mockElement.style.opacity = '0.5';

        const service = createTransitionService();

        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
          duration: 100,
        };

        service({ input: transitionConfig });

        // Should not override existing value
        expect(mockElement.style.opacity).toBe('0.5');
      });
    });

    describe('Error Handling', () => {
      it('rejects when transition is cancelled', async () => {
        const service = createTransitionService();

        const transitionConfig: TransitionConfig = {
          element: mockElement,
          property: 'opacity',
          to: '1',
        };

        const transitionPromise = service({ input: transitionConfig });

        // Simulate transition cancel
        setTimeout(() => {
          const event = new TransitionEvent('transitioncancel', {
            propertyName: 'opacity',
            target: mockElement,
          });
          mockElement.dispatchEvent(event);
        }, 10);

        await expect(transitionPromise).rejects.toThrow('Transition was cancelled');
      });

      it('handles missing required parameters', async () => {
        const service = createTransitionService();

        const invalidConfig = {
          element: null,
          property: 'opacity',
          to: '1',
        } as never;

        await expect(service({ input: invalidConfig })).rejects.toThrow(
          'Element, property, and to value are required'
        );
      });
    });
  });

  describe('Spring Animation Service', () => {
    describe('Spring Physics', () => {
      it('creates physics-based animations', () => {
        const service = createSpringService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            property: 'transform',
            from: 0.8,
            to: 1,
            config: { stiffness: 200, damping: 20 },
          },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SPRING_STARTED',
          from: 0.8,
          to: 1,
        });

        // Should start animation loop
        expect(global.requestAnimationFrame).toHaveBeenCalled();

        cleanup();
      });

      it('applies spring values to element properties', () => {
        const service = createSpringService();
        const mockSendBack = vi.fn();

        // Mock requestAnimationFrame to execute immediately
        global.requestAnimationFrame = vi.fn((callback) => {
          callback(0);
          return 1;
        });

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            property: 'transform',
            from: 0.8,
            to: 1,
          },
          receive: vi.fn(),
        });

        // Should update transform property
        expect(mockElement.style.transform).toContain('scale(');

        cleanup();
      });

      it('sends spring update events during animation', () => {
        const service = createSpringService();
        const mockSendBack = vi.fn();

        let frameCallback: Function;
        global.requestAnimationFrame = vi.fn((callback) => {
          frameCallback = callback;
          return 1;
        });

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            property: 'opacity',
            from: 0,
            to: 1,
          },
          receive: vi.fn(),
        });

        // Execute a frame
        frameCallback!(0);

        expect(mockSendBack).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'SPRING_UPDATE',
            currentValue: expect.any(Number),
            velocity: expect.any(Number),
            progress: expect.any(Number),
          })
        );

        cleanup();
      });
    });

    describe('Spring Control', () => {
      it('cancels spring animation on external events', () => {
        const service = createSpringService();
        const mockSendBack = vi.fn();
        const mockReceive = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            property: 'opacity',
            from: 0,
            to: 1,
          },
          receive: mockReceive,
        });

        const receiveHandler = mockReceive.mock.calls[0][0];

        receiveHandler({ type: 'CANCEL_SPRING' });

        expect(global.cancelAnimationFrame).toHaveBeenCalled();
        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SPRING_CANCELLED',
          currentValue: expect.any(Number),
        });

        cleanup();
      });
    });

    describe('Error Handling', () => {
      it('handles missing required parameters', () => {
        const service = createSpringService();
        const mockSendBack = vi.fn();

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: null as unknown as Element,
            property: 'opacity',
            from: 0,
            to: 1,
          },
          receive: vi.fn(),
        });

        expect(mockSendBack).toHaveBeenCalledWith({
          type: 'SPRING_ERROR',
          error: 'Element, property, from, and to values are required',
        });

        cleanup();
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
        const service = createAnimationService();
        const mockSendBack = vi.fn();

        const fadeIn = AnimationPresets.fadeIn(200);

        const cleanup = service({
          sendBack: mockSendBack,
          input: {
            element: mockElement,
            keyframes: fadeIn.keyframes,
            options: fadeIn.options,
          },
          receive: vi.fn(),
        });

        expect(mockElement.animate).toHaveBeenCalledWith(
          fadeIn.keyframes,
          expect.objectContaining({
            duration: 200,
            fill: 'forwards',
          })
        );

        cleanup();
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

      const service = createParallelService();

      const start = performance.now();

      const cleanup = service({
        sendBack: vi.fn(),
        input: {
          groups: [
            {
              elements,
              keyframes: [{ opacity: 0 }, { opacity: 1 }],
              options: { duration: 300 },
            },
          ],
        },
        receive: vi.fn(),
      });

      const animationTime = performance.now() - start;

      expect(animationTime).toBeLessThan(50);

      cleanup();
    });

    it('generates animation presets efficiently', async () => {
      await performanceTestUtils.expectPerformant(() => {
        const presets = [
          AnimationPresets.fadeIn(),
          AnimationPresets.fadeOut(),
          AnimationPresets.slideInUp(),
          AnimationPresets.slideInDown(),
          AnimationPresets.scaleIn(),
          AnimationPresets.bounce(),
          AnimationPresets.pulse(),
        ];

        expect(presets).toHaveLength(7);
      }, 5);
    });
  });
});
