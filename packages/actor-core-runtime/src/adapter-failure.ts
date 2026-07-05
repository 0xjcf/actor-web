/**
 * Route truly exceptional adapter failures through one narrow runtime helper.
 */
export interface AdapterFailureOptions {
  readonly cause?: unknown;
}

export function raiseAdapterFailure(
  failure: string | Error,
  options?: AdapterFailureOptions
): never {
  if (failure instanceof Error) {
    throw failure;
  }

  const error = new Error(failure);
  if (options && 'cause' in options) {
    Object.defineProperty(error, 'cause', {
      configurable: true,
      value: options.cause,
    });
  }

  throw error;
}
