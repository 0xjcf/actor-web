import { describe, expect, it } from 'vitest';
import { acceptClientTraceBody, clientTraceRecord, formatClientTrace } from './client-trace';

describe('client trace', () => {
  it('formats a browser error with its source location', () => {
    const record = clientTraceRecord({
      level: 'error',
      source: 'window',
      message: 'Module "node:crypto" has been externalized for browser compatibility.',
      filename: 'runtime-gateway.ts',
      line: 1,
    });
    expect(formatClientTrace(record)).toBe(
      '[actor-web:client] error window: Module "node:crypto" has been externalized for browser compatibility. (runtime-gateway.ts:1)'
    );
  });

  it('rejects a body that is not json and clips oversized text', () => {
    expect(acceptClientTraceBody('not-json').status).toBe(400);
    const accepted = acceptClientTraceBody(
      JSON.stringify({
        level: 'info',
        source: 'queue-board',
        message: 'm'.repeat(900),
        detail: 'ticket shipped',
      })
    );
    expect(accepted.status).toBe(204);
    expect(accepted.level).toBe('info');
    expect(accepted.line.endsWith('… ticket shipped')).toBe(true);
    expect(accepted.line.length).toBeLessThan(900);
  });
});
