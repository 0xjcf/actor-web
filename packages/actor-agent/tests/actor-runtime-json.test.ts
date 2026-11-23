import { describe, expect, it, vi } from 'vitest';
import {
  InvalidJsonPayload,
  JsonPayloadTooLarge,
  measureJson,
  snapshotJson,
} from '../src/actor-runtime-json.js';

const reference = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

describe('local JSON payload accounting', () => {
  it('agrees with native compact JSON for repeated strings, all individual UTF-16 units, and numbers', () => {
    const utf16 = Array.from({ length: 0x10000 }, (_, code) => String.fromCharCode(code));
    const text = utf16.join('');
    const value = [
      text,
      text,
      utf16.slice(0xd7ff, 0xe001),
      '\ud83d\ude00\ud83d\udfff\udfff\ud800\ud800\udc00',
      0,
      -0,
      -12.34,
      1e-6,
      1e-7,
      1e20,
      1e21,
      Number.MAX_SAFE_INTEGER,
      Number.MIN_VALUE,
      Number.MAX_VALUE,
      true,
      false,
      null,
    ];
    const bytes = reference(value);
    expect(measureJson(value, bytes)).toBe(bytes);
    expect(snapshotJson(value, bytes)).toStrictEqual({ value, bytes });
    expect(() => measureJson(value, bytes - 1)).toThrow(JsonPayloadTooLarge);
  });

  it('charges expanded aliases while preserving alias identity in a detached snapshot', () => {
    const shared: { é: (string | number)[] } = Object.assign(Object.create(null), {
      é: ['🏔', '"\\', -0],
    });
    const value = { first: shared, second: shared };
    const bytes = reference(value);
    expect(() => snapshotJson(value, bytes - 1)).toThrow(JsonPayloadTooLarge);
    const copy = snapshotJson(value, bytes);
    expect(copy.bytes).toBe(bytes);
    expect(copy.value).not.toBe(value);
    expect(copy.value.first).not.toBe(shared);
    expect(copy.value.second).toBe(copy.value.first);
    expect(Object.getPrototypeOf(copy.value.first)).toBeNull();
    expect(copy.value.first.é[2]).toBe(-0);
  });

  it('refuses exponentially expanded aliases without materializing or scanning the expansion', () => {
    const expansion = Array.from({ length: 60 }).reduce<unknown>((child) => [child, child], 'leaf');
    expect(() => snapshotJson(expansion, Number.MAX_SAFE_INTEGER)).toThrow(JsonPayloadTooLarge);
  });

  it('refuses cycles, sparse/accessor arrays, and hooks without calling the hooks', () => {
    const nested: { itself?: unknown } = {};
    nested.itself = nested;
    const hook = vi.fn(() => 'not plain data');
    const accessor = Object.defineProperty([null], '0', { enumerable: true, get: hook });
    for (const invalid of [nested, new Array(2), accessor, { toJSON: hook }]) {
      expect(() => measureJson(invalid, 10_000)).toThrow(InvalidJsonPayload);
    }
    expect(hook).not.toHaveBeenCalled();
  });
});
