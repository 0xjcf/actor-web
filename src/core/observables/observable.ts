/**
 * @module framework/core/observables/observable
 * @description Minimal Observable implementation with RxJS compatibility
 * @author Agent B - 2024-01-15
 */

/**
 * Observer interface - matches RxJS Observer pattern
 */
export interface Observer<T> {
  next: (value: T) => void;
  error?: (error: Error) => void;
  complete?: () => void;
}

/**
 * Subscription interface - matches RxJS Subscription pattern
 */
export interface Subscription {
  unsubscribe(): void;
  readonly closed: boolean;
}

/**
 * Observable interface - compatible with RxJS Observable
 */
export interface Observable<T> {
  subscribe(observer: Observer<T>): Subscription;
  subscribe(
    next?: (value: T) => void,
    error?: (error: Error) => void,
    complete?: () => void
  ): Subscription;

  // RxJS Symbol.observable compatibility
  [Symbol.observable](): Observable<T>;
}

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
  subscribe(
    next?: (value: T) => void,
    error?: (error: Error) => void,
    complete?: () => void
  ): Subscription;
  subscribe(
    observerOrNext?: Observer<T> | ((value: T) => void),
    error?: (error: Error) => void,
    complete?: () => void
  ): Subscription {
    // Normalize arguments to Observer interface
    const observer: Observer<T> = this.normalizeObserver(observerOrNext, error, complete);

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

  // RxJS Symbol.observable compatibility
  [Symbol.observable](): Observable<T> {
    return this;
  }

  private normalizeObserver(
    observerOrNext?: Observer<T> | ((value: T) => void),
    error?: (error: Error) => void,
    complete?: () => void
  ): Observer<T> {
    if (observerOrNext && typeof observerOrNext === 'object') {
      return observerOrNext as Observer<T>;
    }

    return {
      next: (observerOrNext as (value: T) => void) || (() => {}),
      error:
        error ||
        ((err: Error) => {
          throw err;
        }),
      complete: complete || (() => {}),
    };
  }
}

/**
 * Factory functions for creating observables
 */
export const createObservable = {
  /**
   * Create an observable from a subscriber function
   */
  create<T>(subscriberFunction: SubscriberFunction<T>): Observable<T> {
    return new CustomObservable(subscriberFunction);
  },

  /**
   * Create an observable that emits a single value
   */
  of<T>(...values: T[]): Observable<T> {
    return new CustomObservable<T>((observer) => {
      for (const value of values) {
        observer.next(value);
      }
      if (observer.complete) {
        observer.complete();
      }
    });
  },

  /**
   * Create an observable that emits values from an array
   */
  from<T>(arrayLike: ArrayLike<T>): Observable<T> {
    return new CustomObservable<T>((observer) => {
      for (let i = 0; i < arrayLike.length; i++) {
        observer.next(arrayLike[i]);
      }
      if (observer.complete) {
        observer.complete();
      }
    });
  },

  /**
   * Create an observable that never emits
   */
  never<T>(): Observable<T> {
    return new CustomObservable<T>(() => {
      // Never calls next, error, or complete
    });
  },

  /**
   * Create an observable that emits an error
   */
  throwError<T>(error: Error): Observable<T> {
    return new CustomObservable<T>((observer) => {
      if (observer.error) {
        observer.error(error);
      }
    });
  },

  /**
   * Create an observable from a Promise
   */
  fromPromise<T>(promise: Promise<T>): Observable<T> {
    return new CustomObservable<T>((observer) => {
      promise
        .then((value) => {
          observer.next(value);
          if (observer.complete) {
            observer.complete();
          }
        })
        .catch((error) => {
          if (observer.error) {
            observer.error(error);
          }
        });
    });
  },
};
