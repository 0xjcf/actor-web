import { describe, expect, it } from 'vitest';
import { raiseAdapterFailure } from '../adapter-failure.js';

describe('raiseAdapterFailure', () => {
  it('preserves native cause for string failures', () => {
    const cause = { code: 'adapter_failed' };

    expect(() => raiseAdapterFailure('adapter failed', { cause })).toThrowError(
      expect.objectContaining({
        message: 'adapter failed',
        cause,
      })
    );
  });

  it('attaches cause to existing Error instances before throwing the same error', () => {
    expect.assertions(2);
    const cause = { code: 'existing_failure' };
    const failure = new Error('existing failure');

    try {
      raiseAdapterFailure(failure, { cause });
    } catch (error) {
      expect(error).toBe(failure);
      expect(error).toMatchObject({ cause });
    }
  });
});
