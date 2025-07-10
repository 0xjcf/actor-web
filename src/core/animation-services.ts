/**
 * Animation Services - XState-based animation coordination utilities
 *
 * Provides XState invoke patterns for animations, Web Animations API integration,
 * CSS transition coordination, and animation sequence orchestration.
 *
 * Part of Phase 0.7 Reactive Infrastructure
 */

import type { AnyEventObject } from 'xstate';
import { fromCallback, fromPromise } from 'xstate';

// ===== TYPE DEFINITIONS =====

export interface AnimationKeyframe {
  /** CSS properties for this keyframe */
  [property: string]: string | number;
}

export interface AnimationOptions {
  /** Animation duration in milliseconds */
  duration?: number;
  /** Animation easing function */
  easing?: string;
  /** Animation delay in milliseconds */
  delay?: number;
  /** Number of iterations (Infinity for infinite) */
  iterations?: number;
  /** Animation direction */
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  /** Fill mode */
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  /** Optional data to pass with events */
  data?: unknown;
}

export interface SequenceStep {
  /** Target element for this step */
  element: Element;
  /** Animation keyframes */
  keyframes: AnimationKeyframe[];
  /** Animation options */
  options?: AnimationOptions;
  /** Whether to wait for this animation to complete before next step */
  waitForCompletion?: boolean;
  /** Step identifier */
  id?: string;
}

export interface ParallelAnimationGroup {
  /** Array of elements to animate simultaneously */
  elements: Element[];
  /** Shared keyframes for all elements */
  keyframes: AnimationKeyframe[];
  /** Shared options for all elements */
  options?: AnimationOptions;
  /** Group identifier */
  id?: string;
}

export interface TransitionConfig {
  /** Target element */
  element: Element;
  /** CSS property to transition */
  property: string;
  /** Target value */
  to: string;
  /** Starting value (optional, uses current value) */
  from?: string;
  /** Transition duration */
  duration?: number;
  /** Transition easing */
  easing?: string;
  /** Transition delay */
  delay?: number;
}

export interface SpringConfig {
  /** Spring stiffness (higher = stiffer) */
  stiffness?: number;
  /** Spring damping (higher = less oscillation) */
  damping?: number;
  /** Mass of the object */
  mass?: number;
  /** Initial velocity */
  velocity?: number;
}

// ===== SINGLE ANIMATION SERVICE =====

/**
 * Create a Web Animations API service for state machines
 * Provides fine-grained control over individual animations
 *
 * @example
 * ```typescript
 * const animationService = createAnimationService();
 *
 * const machine = setup({
 *   actors: { animation: animationService }
 * }).createMachine({
 *   states: {
 *     animating: {
 *       invoke: {
 *         src: 'animation',
 *         input: {
 *           element: buttonElement,
 *           keyframes: [
 *             { transform: 'scale(1)' },
 *             { transform: 'scale(1.1)' },
 *             { transform: 'scale(1)' }
 *           ],
 *           options: { duration: 200, easing: 'ease-out' }
 *         }
 *       },
 *       on: {
 *         ANIMATION_COMPLETE: 'idle',
 *         ANIMATION_CANCELLED: 'idle'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createAnimationService = () => {
  return fromCallback<
    AnyEventObject,
    {
      element: Element;
      keyframes: AnimationKeyframe[];
      options?: AnimationOptions;
    }
  >(({ sendBack, input, receive }) => {
    const { element, keyframes, options = {} } = input;

    if (!element || !keyframes) {
      sendBack({ type: 'ANIMATION_ERROR', error: 'Element and keyframes are required' });
      return;
    }

    // Default animation options
    const animationOptions: KeyframeAnimationOptions = {
      duration: options.duration || 300,
      easing: options.easing || 'ease',
      delay: options.delay || 0,
      iterations: options.iterations || 1,
      direction: options.direction || 'normal',
      fill: options.fill || 'none',
    };

    // Start the animation
    const animation = element.animate(keyframes, animationOptions);

    // Send animation started event
    sendBack({
      type: 'ANIMATION_STARTED',
      animation,
      element,
      data: options.data || null,
    });

    // Handle animation completion
    animation.addEventListener('finish', () => {
      sendBack({
        type: 'ANIMATION_COMPLETE',
        animation,
        element,
        data: options.data || null,
      });
    });

    // Handle animation cancellation
    animation.addEventListener('cancel', () => {
      sendBack({
        type: 'ANIMATION_CANCELLED',
        animation,
        element,
        data: options.data || null,
      });
    });

    // Handle external control events
    receive((event) => {
      if (event.type === 'PAUSE') {
        animation.pause();
        sendBack({ type: 'ANIMATION_PAUSED', animation });
      } else if (event.type === 'RESUME') {
        animation.play();
        sendBack({ type: 'ANIMATION_RESUMED', animation });
      } else if (event.type === 'CANCEL') {
        animation.cancel();
      } else if (event.type === 'REVERSE') {
        animation.reverse();
        sendBack({ type: 'ANIMATION_REVERSED', animation });
      } else if (event.type === 'SET_PLAYBACK_RATE') {
        const { rate } = event as { type: 'SET_PLAYBACK_RATE'; rate: number };
        animation.playbackRate = rate;
        sendBack({ type: 'PLAYBACK_RATE_CHANGED', rate, animation });
      }
    });

    // Cleanup function
    return () => {
      if (animation.playState !== 'finished') {
        animation.cancel();
      }
    };
  });
};

// ===== SEQUENCE ANIMATION SERVICE =====

/**
 * Create an animation sequence service for state machines
 * Orchestrates multiple animations in sequence
 *
 * @example
 * ```typescript
 * const sequenceService = createSequenceService();
 *
 * const machine = setup({
 *   actors: { sequence: sequenceService }
 * }).createMachine({
 *   states: {
 *     animating: {
 *       invoke: {
 *         src: 'sequence',
 *         input: {
 *           steps: [
 *             {
 *               element: card1,
 *               keyframes: [{ opacity: 0 }, { opacity: 1 }],
 *               options: { duration: 300 }
 *             },
 *             {
 *               element: card2,
 *               keyframes: [{ transform: 'translateY(20px)' }, { transform: 'translateY(0)' }],
 *               options: { duration: 200 }
 *             }
 *           ]
 *         }
 *       },
 *       on: {
 *         SEQUENCE_STEP_COMPLETE: { actions: 'logStep' },
 *         SEQUENCE_COMPLETE: 'idle'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createSequenceService = () => {
  return fromCallback<AnyEventObject, { steps: SequenceStep[] }>(({ sendBack, input, receive }) => {
    const { steps } = input;

    if (!steps || steps.length === 0) {
      sendBack({ type: 'SEQUENCE_ERROR', error: 'No steps provided' });
      return;
    }

    let currentStepIndex = 0;
    let currentAnimation: Animation | null = null;
    let _isPaused = false;
    let isCancelled = false;

    const executeStep = (stepIndex: number) => {
      if (stepIndex >= steps.length || isCancelled) {
        sendBack({ type: 'SEQUENCE_COMPLETE', totalSteps: steps.length });
        return;
      }

      const step = steps[stepIndex];
      const { element, keyframes, options = {} } = step;

      if (!element || !keyframes) {
        sendBack({
          type: 'SEQUENCE_STEP_ERROR',
          stepIndex,
          stepId: step.id,
          error: 'Element and keyframes are required',
        });
        executeStep(stepIndex + 1);
        return;
      }

      const animationOptions: KeyframeAnimationOptions = {
        duration: options.duration || 300,
        easing: options.easing || 'ease',
        delay: options.delay || 0,
        iterations: options.iterations || 1,
        direction: options.direction || 'normal',
        fill: options.fill || 'forwards',
      };

      currentAnimation = element.animate(keyframes, animationOptions);

      sendBack({
        type: 'SEQUENCE_STEP_STARTED',
        stepIndex,
        stepId: step.id,
        animation: currentAnimation,
        element,
      });

      currentAnimation.addEventListener('finish', () => {
        sendBack({
          type: 'SEQUENCE_STEP_COMPLETE',
          stepIndex,
          stepId: step.id,
          animation: currentAnimation,
          element,
        });

        if (step.waitForCompletion !== false) {
          currentStepIndex++;
          executeStep(currentStepIndex);
        }
      });

      currentAnimation.addEventListener('cancel', () => {
        if (!isCancelled) {
          sendBack({
            type: 'SEQUENCE_STEP_CANCELLED',
            stepIndex,
            stepId: step.id,
          });
        }
      });

      // If step doesn't wait for completion, start next step immediately
      if (step.waitForCompletion === false) {
        currentStepIndex++;
        executeStep(currentStepIndex);
      }
    };

    // Start the sequence
    executeStep(0);

    // Handle external control events
    receive((event) => {
      if (event.type === 'PAUSE_SEQUENCE') {
        _isPaused = true;
        if (currentAnimation) {
          currentAnimation.pause();
        }
        sendBack({ type: 'SEQUENCE_PAUSED', currentStep: currentStepIndex });
      } else if (event.type === 'RESUME_SEQUENCE') {
        _isPaused = false;
        if (currentAnimation) {
          currentAnimation.play();
        }
        sendBack({ type: 'SEQUENCE_RESUMED', currentStep: currentStepIndex });
      } else if (event.type === 'CANCEL_SEQUENCE') {
        isCancelled = true;
        if (currentAnimation) {
          currentAnimation.cancel();
        }
        sendBack({ type: 'SEQUENCE_CANCELLED', totalSteps: steps.length });
      } else if (event.type === 'SKIP_STEP') {
        if (currentAnimation) {
          currentAnimation.finish();
        }
      }
    });

    // Cleanup function
    return () => {
      isCancelled = true;
      if (currentAnimation && currentAnimation.playState !== 'finished') {
        currentAnimation.cancel();
      }
    };
  });
};

// ===== PARALLEL ANIMATION SERVICE =====

/**
 * Create a parallel animation service for state machines
 * Runs multiple animations simultaneously
 *
 * @example
 * ```typescript
 * const parallelService = createParallelService();
 *
 * const machine = setup({
 *   actors: { parallel: parallelService }
 * }).createMachine({
 *   states: {
 *     animating: {
 *       invoke: {
 *         src: 'parallel',
 *         input: {
 *           groups: [
 *             {
 *               elements: [card1, card2, card3],
 *               keyframes: [{ opacity: 0 }, { opacity: 1 }],
 *               options: { duration: 300, delay: 100 }
 *             }
 *           ]
 *         }
 *       },
 *       on: {
 *         PARALLEL_GROUP_COMPLETE: { actions: 'logGroup' },
 *         PARALLEL_COMPLETE: 'idle'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createParallelService = () => {
  return fromCallback<AnyEventObject, { groups: ParallelAnimationGroup[] }>(
    ({ sendBack, input, receive }) => {
      const { groups } = input;

      if (!groups || groups.length === 0) {
        sendBack({ type: 'PARALLEL_ERROR', error: 'No groups provided' });
        return;
      }

      const activeAnimations = new Map<string, Animation[]>();
      let completedGroups = 0;
      let isCancelled = false;

      // Start all groups
      groups.forEach((group, groupIndex) => {
        const { elements, keyframes, options = {} } = group;
        const groupId = group.id || `group-${groupIndex}`;
        const groupAnimations: Animation[] = [];

        if (!elements || elements.length === 0 || !keyframes) {
          sendBack({
            type: 'PARALLEL_GROUP_ERROR',
            groupId,
            error: 'Elements and keyframes are required',
          });
          return;
        }

        const animationOptions: KeyframeAnimationOptions = {
          duration: options.duration || 300,
          easing: options.easing || 'ease',
          delay: options.delay || 0,
          iterations: options.iterations || 1,
          direction: options.direction || 'normal',
          fill: options.fill || 'forwards',
        };

        // Start animations for all elements in the group
        elements.forEach((element, elementIndex) => {
          const animation = element.animate(keyframes, {
            ...animationOptions,
            delay: (animationOptions.delay || 0) + elementIndex * 50, // Stagger by 50ms
          });

          groupAnimations.push(animation);
        });

        activeAnimations.set(groupId, groupAnimations);

        sendBack({
          type: 'PARALLEL_GROUP_STARTED',
          groupId,
          groupIndex,
          animationCount: groupAnimations.length,
        });

        // Wait for all animations in the group to complete
        Promise.all(groupAnimations.map((anim) => anim.finished))
          .then(() => {
            if (!isCancelled) {
              completedGroups++;
              sendBack({
                type: 'PARALLEL_GROUP_COMPLETE',
                groupId,
                groupIndex,
                completedGroups,
                totalGroups: groups.length,
              });

              if (completedGroups >= groups.length) {
                sendBack({ type: 'PARALLEL_COMPLETE', totalGroups: groups.length });
              }
            }
          })
          .catch(() => {
            if (!isCancelled) {
              sendBack({
                type: 'PARALLEL_GROUP_CANCELLED',
                groupId,
                groupIndex,
              });
            }
          });
      });

      // Handle external control events
      receive((event) => {
        if (event.type === 'PAUSE_PARALLEL') {
          activeAnimations.forEach((animations) => {
            animations.forEach((anim) => anim.pause());
          });
          sendBack({ type: 'PARALLEL_PAUSED' });
        } else if (event.type === 'RESUME_PARALLEL') {
          activeAnimations.forEach((animations) => {
            animations.forEach((anim) => anim.play());
          });
          sendBack({ type: 'PARALLEL_RESUMED' });
        } else if (event.type === 'CANCEL_PARALLEL') {
          isCancelled = true;
          activeAnimations.forEach((animations) => {
            animations.forEach((anim) => anim.cancel());
          });
          sendBack({ type: 'PARALLEL_CANCELLED' });
        }
      });

      // Cleanup function
      return () => {
        isCancelled = true;
        activeAnimations.forEach((animations) => {
          animations.forEach((anim) => {
            if (anim.playState !== 'finished') {
              anim.cancel();
            }
          });
        });
      };
    }
  );
};

// ===== CSS TRANSITION SERVICE =====

/**
 * Create a CSS transition service for state machines
 * Provides promise-based CSS transitions
 *
 * @example
 * ```typescript
 * const transitionService = createTransitionService();
 *
 * const machine = setup({
 *   actors: { transition: transitionService }
 * }).createMachine({
 *   states: {
 *     transitioning: {
 *       invoke: {
 *         src: 'transition',
 *         input: {
 *           element: modalElement,
 *           property: 'opacity',
 *           to: '1',
 *           duration: 200
 *         },
 *         onDone: 'visible'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createTransitionService = () => {
  return fromPromise<void, TransitionConfig>(async ({ input }) => {
    const { element, property, to, from, duration = 300, easing = 'ease', delay = 0 } = input;

    if (!element || !property || to === undefined) {
      throw new Error('Element, property, and to value are required');
    }

    return new Promise<void>((resolve, reject) => {
      // Set initial value if provided
      if (from !== undefined) {
        (element as HTMLElement).style.setProperty(property, from);
      }

      // Force reflow to ensure initial value is applied
      element.getBoundingClientRect();

      // Set up transition
      const transitionValue = `${property} ${duration}ms ${easing} ${delay}ms`;
      const currentTransition = (element as HTMLElement).style.transition;
      (element as HTMLElement).style.transition = currentTransition
        ? `${currentTransition}, ${transitionValue}`
        : transitionValue;

      // Set up event listener for transition end
      const handleTransitionEnd = (e: TransitionEvent) => {
        if (e.target === element && e.propertyName === property) {
          element.removeEventListener('transitionend', handleTransitionEnd as EventListener);
          element.removeEventListener('transitioncancel', handleTransitionCancel as EventListener);

          // Restore original transition
          (element as HTMLElement).style.transition = currentTransition;
          resolve();
        }
      };

      const handleTransitionCancel = (e: TransitionEvent) => {
        if (e.target === element && e.propertyName === property) {
          element.removeEventListener('transitionend', handleTransitionEnd as EventListener);
          element.removeEventListener('transitioncancel', handleTransitionCancel as EventListener);

          // Restore original transition
          (element as HTMLElement).style.transition = currentTransition;
          reject(new Error('Transition was cancelled'));
        }
      };

      element.addEventListener('transitionend', handleTransitionEnd as EventListener);
      element.addEventListener('transitioncancel', handleTransitionCancel as EventListener);

      // Start transition by setting target value
      setTimeout(() => {
        (element as HTMLElement).style.setProperty(property, to);
      }, 10); // Small delay to ensure transition is set up
    });
  });
};

// ===== SPRING ANIMATION SERVICE =====

/**
 * Create a spring animation service for state machines
 * Provides physics-based spring animations
 *
 * @example
 * ```typescript
 * const springService = createSpringService();
 *
 * const machine = setup({
 *   actors: { spring: springService }
 * }).createMachine({
 *   states: {
 *     springing: {
 *       invoke: {
 *         src: 'spring',
 *         input: {
 *           element: buttonElement,
 *           property: 'transform',
 *           from: 'scale(0.8)',
 *           to: 'scale(1)',
 *           config: { stiffness: 200, damping: 20 }
 *         }
 *       },
 *       on: {
 *         SPRING_COMPLETE: 'idle'
 *       }
 *     }
 *   }
 * });
 * ```
 */
export const createSpringService = () => {
  return fromCallback<
    AnyEventObject,
    {
      element: Element;
      property: string;
      from: number;
      to: number;
      config?: SpringConfig;
    }
  >(({ sendBack, input, receive }) => {
    const { element, property, from, to, config = {} } = input;

    if (!element || !property || from === undefined || to === undefined) {
      sendBack({
        type: 'SPRING_ERROR',
        error: 'Element, property, from, and to values are required',
      });
      return;
    }

    const { stiffness = 100, damping = 10, mass = 1, velocity = 0 } = config;

    let currentValue = from;
    let currentVelocity = velocity;
    let animationId: number;
    let isCancelled = false;

    const animate = () => {
      if (isCancelled) return;

      // Spring physics calculation
      const force = -stiffness * (currentValue - to);
      const acceleration = force / mass;
      currentVelocity += acceleration;
      currentVelocity *= 1 - damping / 100;
      currentValue += currentVelocity;

      // Apply the current value
      if (property === 'transform') {
        (element as HTMLElement).style.transform = `scale(${currentValue})`;
      } else {
        (element as HTMLElement).style.setProperty(property, currentValue.toString());
      }

      sendBack({
        type: 'SPRING_UPDATE',
        currentValue,
        velocity: currentVelocity,
        progress: Math.abs((currentValue - from) / (to - from)),
      });

      // Check if spring has settled
      const threshold = 0.01;
      if (Math.abs(currentValue - to) < threshold && Math.abs(currentVelocity) < threshold) {
        // Snap to final value
        if (property === 'transform') {
          (element as HTMLElement).style.transform = `scale(${to})`;
        } else {
          (element as HTMLElement).style.setProperty(property, to.toString());
        }

        sendBack({ type: 'SPRING_COMPLETE', finalValue: to });
        return;
      }

      animationId = requestAnimationFrame(animate);
    };

    // Start the spring animation
    animationId = requestAnimationFrame(animate);
    sendBack({ type: 'SPRING_STARTED', from, to });

    // Handle external control events
    receive((event) => {
      if (event.type === 'CANCEL_SPRING') {
        isCancelled = true;
        cancelAnimationFrame(animationId);
        sendBack({ type: 'SPRING_CANCELLED', currentValue });
      }
    });

    // Cleanup function
    return () => {
      isCancelled = true;
      cancelAnimationFrame(animationId);
    };
  });
};

// ===== EXPORT SERVICES =====

/**
 * Pre-configured animation services for common use cases
 */
export const AnimationServices = {
  single: createAnimationService(),
  sequence: createSequenceService(),
  parallel: createParallelService(),
  transition: createTransitionService(),
  spring: createSpringService(),
} as const;

// ===== UTILITY FUNCTIONS =====

/**
 * Common animation presets
 */
export const AnimationPresets = {
  fadeIn: (duration = 300): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [{ opacity: '0' }, { opacity: '1' }],
    options: { duration, fill: 'forwards' },
  }),

  fadeOut: (duration = 300): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [{ opacity: '1' }, { opacity: '0' }],
    options: { duration, fill: 'forwards' },
  }),

  slideInUp: (
    distance = 20,
    duration = 300
  ): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [
      { transform: `translateY(${distance}px)`, opacity: '0' },
      { transform: 'translateY(0)', opacity: '1' },
    ],
    options: { duration, fill: 'forwards', easing: 'ease-out' },
  }),

  slideInDown: (
    distance = 20,
    duration = 300
  ): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [
      { transform: `translateY(-${distance}px)`, opacity: '0' },
      { transform: 'translateY(0)', opacity: '1' },
    ],
    options: { duration, fill: 'forwards', easing: 'ease-out' },
  }),

  scaleIn: (duration = 200): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [
      { transform: 'scale(0.8)', opacity: '0' },
      { transform: 'scale(1)', opacity: '1' },
    ],
    options: { duration, fill: 'forwards', easing: 'ease-out' },
  }),

  bounce: (duration = 600): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [
      { transform: 'scale(1)' },
      { transform: 'scale(1.1)' },
      { transform: 'scale(0.95)' },
      { transform: 'scale(1)' },
    ],
    options: { duration, easing: 'ease-in-out' },
  }),

  pulse: (
    scale = 1.05,
    duration = 1000
  ): { keyframes: AnimationKeyframe[]; options: AnimationOptions } => ({
    keyframes: [
      { transform: 'scale(1)' },
      { transform: `scale(${scale})` },
      { transform: 'scale(1)' },
    ],
    options: { duration, iterations: Number.POSITIVE_INFINITY, easing: 'ease-in-out' },
  }),
};

// ===== DEFAULT EXPORT =====

export default AnimationServices;
