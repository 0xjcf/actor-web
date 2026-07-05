import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('behavior boundary configuration', () => {
  it('enforces errors-as-data for runtime adapters and transport wrappers', () => {
    const config = JSON.parse(
      readFileSync(new URL('../../../../.fas-config.json', import.meta.url), 'utf8')
    ) as {
      behaviorBoundaryProfile?: string;
      behaviorBoundaries?: {
        adapters?: string[];
      };
    };

    expect(config.behaviorBoundaryProfile).toBe('errors-as-data');
    expect(config.behaviorBoundaries?.adapters).toEqual(
      expect.arrayContaining([
        'packages/actor-core-runtime/src/node-websocket-message-transport.ts',
        'packages/actor-core-runtime/src/browser-websocket-message-transport.ts',
        'packages/actor-core-runtime/src/message-port-transport.ts',
        'packages/actor-core-runtime/src/testing/in-memory-message-transport.ts',
      ])
    );
  });
});
