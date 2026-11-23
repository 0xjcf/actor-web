import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('behavior boundary configuration', () => {
  it('classifies runtime transport adapters in the project boundary map', () => {
    const config = JSON.parse(
      readFileSync(new URL('../../../../architecture.boundaries.json', import.meta.url), 'utf8')
    ) as {
      layers?: {
        executionBoundary?: { paths?: string[] };
        projection?: { paths?: string[] };
      };
    };

    expect(config.layers?.executionBoundary?.paths).toEqual(
      expect.arrayContaining([
        'packages/actor-core-runtime/src/node-websocket-message-transport.ts',
        'packages/actor-core-runtime/src/browser-websocket-message-transport.ts',
        'packages/actor-core-runtime/src/message-port-transport.ts',
      ])
    );
    expect(config.layers?.projection?.paths).toContain('packages/actor-core-runtime/src/testing');
  });
});
