/**
 * @module framework/core/observables/operators
 * @description Core operators for Observable transformations
 * @author Agent B - 2024-01-15
 */

import { CustomObservable, type Observable } from './observable.js';

/**
 * Operator function type
 */
export type OperatorFunction<T, R> = (source: Observable<T>) => Observable<R>;

/**
 * Monad operator function type (same input/output type)
 */
export type MonadOperatorFunction<T> = OperatorFunction<T, T>;

/**
 * Predicate function type for filtering
 */
export type PredicateFunction<T> = (value: T, index: number) => boolean;

/**
 * Transform each emitted value with a function
 */
export function map<T, R>(transform: (value: T, index: number) => R): OperatorFunction<T, R> {
  return (source: Observable<T>): Observable<R> => {
    return new CustomObservable<R>((observer) => {
      let index = 0;

      const subscription = source.subscribe({
        next: (value: T) => {
          try {
            const transformedValue = transform(value, index++);
            observer.next(transformedValue);
          } catch (error) {
            if (observer.error) {
              observer.error(error as Error);
            }
          }
        },
        error: observer.error,
        complete: observer.complete,
      });

      return () => subscription.unsubscribe();
    });
  };
}

/**
 * Filter values based on a predicate function
 */
export function filter<T>(predicate: PredicateFunction<T>): MonadOperatorFunction<T> {
  return (source: Observable<T>): Observable<T> => {
    return new CustomObservable<T>((observer) => {
      let index = 0;

      const subscription = source.subscribe({
        next: (value: T) => {
          try {
            if (predicate(value, index++)) {
              observer.next(value);
            }
          } catch (error) {
            if (observer.error) {
              observer.error(error as Error);
            }
          }
        },
        error: observer.error,
        complete: observer.complete,
      });

      return () => subscription.unsubscribe();
    });
  };
}

/**
 * Perform a side effect for each emitted value without changing the stream
 */
export function tap<T>(sideEffect: (value: T, index: number) => void): MonadOperatorFunction<T> {
  return (source: Observable<T>): Observable<T> => {
    return new CustomObservable<T>((observer) => {
      let index = 0;

      const subscription = source.subscribe({
        next: (value: T) => {
          try {
            sideEffect(value, index++);
            observer.next(value);
          } catch (error) {
            if (observer.error) {
              observer.error(error as Error);
            }
          }
        },
        error: observer.error,
        complete: observer.complete,
      });

      return () => subscription.unsubscribe();
    });
  };
}

/**
 * Helper function to pipe operators together
 */
export function pipe<T, A>(op1: OperatorFunction<T, A>): OperatorFunction<T, A>;
export function pipe<T, A, B>(
  op1: OperatorFunction<T, A>,
  op2: OperatorFunction<A, B>
): OperatorFunction<T, B>;
export function pipe<T, A, B, C>(
  op1: OperatorFunction<T, A>,
  op2: OperatorFunction<A, B>,
  op3: OperatorFunction<B, C>
): OperatorFunction<T, C>;
export function pipe<T>(
  ...operators: OperatorFunction<unknown, unknown>[]
): OperatorFunction<T, unknown> {
  return (source: Observable<T>) => {
    return operators.reduce((acc, op) => op(acc), source as Observable<unknown>);
  };
}

/**
 * Utility functions for working with observables
 */
export const observableUtils = {
  /**
   * Check if a value is an observable
   */
  isObservable<T>(value: unknown): value is Observable<T> {
    return (
      value != null &&
      typeof value === 'object' &&
      'subscribe' in value &&
      typeof (value as Observable<T>).subscribe === 'function'
    );
  },

  /**
   * Convert a value to an observable
   */
  toObservable<T>(value: T | Observable<T>): Observable<T> {
    if (this.isObservable(value)) {
      return value;
    }
    return new CustomObservable<T>((observer) => {
      observer.next(value);
      if (observer.complete) {
        observer.complete();
      }
    });
  },
};
