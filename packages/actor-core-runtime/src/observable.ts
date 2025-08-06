/**
 * @module actor-core/runtime/observable
 * @description Minimal Observable implementation for actor runtime
 */

import type { Observable, Observer, Subscription } from './types.js';

/**
 * Subscriber function type for Observable creation
 */
export type SubscriberFunction<T> = (observer: Observer<T>) => TeardownLogic;

/**
 * Teardown logic can be a function or void
 */
export type TeardownLogic = (() => void) | undefined;

/**
 * Internal subscription implementation
 */
class ObservableSubscription implements Subscription {
  private _closed = false;
  public teardownLogic: (() => void) | null = null;

  constructor(teardown?: TeardownLogic) {
    if (typeof teardown === 'function') {
      this.teardownLogic = teardown;
    }
  }

  get closed(): boolean {
    return this._closed;
  }

  unsubscribe(): void {
    if (this._closed) {
      return;
    }

    this._closed = true;

    if (this.teardownLogic) {
      try {
        this.teardownLogic();
      } catch (error) {
        // Swallow teardown errors to prevent subscription leaks
        console.warn('Error during unsubscribe:', error);
      }
    }
  }
}

/**
 * Safe Observer wrapper that handles errors and completion
 */
class SafeObserver<T> implements Observer<T> {
  private _isStopped = false;

  constructor(
    private destination: Observer<T>,
    private subscription: ObservableSubscription
  ) {}

  next(value: T): void {
    if (this._isStopped || this.subscription.closed) {
      return;
    }

    try {
      this.destination.next(value);
    } catch (error) {
      this.error(error as Error);
    }
  }

  error(error: Error): void {
    if (this._isStopped || this.subscription.closed) {
      return;
    }

    this._isStopped = true;

    try {
      if (this.destination.error) {
        this.destination.error(error);
      }
    } finally {
      this.subscription.unsubscribe();
    }
  }

  complete(): void {
    if (this._isStopped || this.subscription.closed) {
      return;
    }

    this._isStopped = true;

    try {
      if (this.destination.complete) {
        this.destination.complete();
      }
    } finally {
      this.subscription.unsubscribe();
    }
  }
}

/**
 * Custom Observable implementation
 */
export class CustomObservable<T> implements Observable<T> {
  constructor(private subscriberFunction: SubscriberFunction<T>) {}

  subscribe(observer: Observer<T>): Subscription;
  subscribe(next: (value: T) => void): Subscription;
  subscribe(observerOrNext: Observer<T> | ((value: T) => void)): Subscription {
    // Normalize arguments to Observer interface
    const observer: Observer<T> = this.normalizeObserver(observerOrNext);

    // Create subscription
    const subscription = new ObservableSubscription();

    // Create safe observer
    const safeObserver = new SafeObserver(observer, subscription);

    try {
      // Execute subscriber function
      const teardown = this.subscriberFunction(safeObserver);

      // Add teardown logic to subscription
      if (typeof teardown === 'function') {
        subscription.teardownLogic = teardown;
      }
    } catch (error) {
      // If subscription fails, error immediately
      safeObserver.error(error as Error);
    }

    return subscription;
  }

  private normalizeObserver(observerOrNext: Observer<T> | ((value: T) => void)): Observer<T> {
    if (observerOrNext && typeof observerOrNext === 'object') {
      return observerOrNext as Observer<T>;
    }

    return {
      next: observerOrNext as (value: T) => void,
      error: (error: Error) => {
        throw error;
      },
      complete: () => {
        // No-op
      },
    };
  }

  // Static factory methods
  static of<T>(...values: T[]): Observable<T> {
    return new CustomObservable((observer) => {
      for (const value of values) {
        observer.next(value);
      }
      observer.complete?.();
      return undefined;
    });
  }

  static from<T>(iterable: Iterable<T>): Observable<T> {
    return new CustomObservable((observer) => {
      for (const value of iterable) {
        observer.next(value);
      }
      observer.complete?.();
      return undefined;
    });
  }

  static empty<T>(): Observable<T> {
    return new CustomObservable((observer) => {
      observer.complete?.();
      return undefined;
    });
  }

  static never<T>(): Observable<T> {
    return new CustomObservable(() => {
      // Never emits anything
      return undefined;
    });
  }

  static throw<T>(error: Error): Observable<T> {
    return new CustomObservable((observer) => {
      observer.error?.(error);
      return undefined;
    });
  }
}
