/**
 * Route truly exceptional adapter failures through one narrow runtime helper.
 */
export interface AdapterFailureOptions {
  readonly cause?: unknown;
}

function hasCause(options?: AdapterFailureOptions): options is Required<AdapterFailureOptions> {
  return options !== undefined && 'cause' in options;
}

function attachCause(error: Error, options?: AdapterFailureOptions): Error {
  if (!hasCause(options)) {
    return error;
  }

  Object.defineProperty(error, 'cause', {
    configurable: true,
    value: options.cause,
  });
  return error;
}

export function raiseAdapterFailure(
  failure: string | Error,
  options?: AdapterFailureOptions
): never {
  if (failure instanceof Error) {
    throw attachCause(failure, options);
  }

  if (hasCause(options)) {
    throw new Error(failure, { cause: options.cause });
  }

  throw new Error(failure);
}
