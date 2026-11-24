/** Internal signals; the adapter supplies the boundary-specific failure code. */
export class JsonPayloadTooLarge extends Error {}
export class InvalidJsonPayload extends Error {}

export function ownData(value: object, key: PropertyKey): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (typeof key !== 'string' || !field?.enumerable || !('value' in field)) {
    throw new InvalidJsonPayload();
  }
  return field.value;
}

type Frame = {
  readonly source: object;
  readonly target: object;
  readonly keys: readonly PropertyKey[] | undefined;
  readonly length: number;
  readonly before: number;
  index: number;
};

// Equivalent to the byte length of compact, well-formed JSON.stringify for plain JSON data.
// A stack avoids JS recursion limits, and each completed alias is charged at its expanded size
// without revisiting or copying it. The remaining allowance never goes negative or overflows.
function walkJson<T>(
  input: T,
  allowance: number,
  detach: boolean,
  orderKeys = false
): { value: T; bytes: number } {
  let remaining = allowance;
  const stack: Frame[] = [];
  const visited = new Map<object, { value: object; bytes: number } | undefined>();
  const spend = (bytes: number) => {
    if (bytes > remaining) throw new JsonPayloadTooLarge();
    remaining -= bytes;
  };
  const spendString = (value: string) => {
    spend(2);
    spend(value.length); // Every UTF-16 code unit accounts for at least one output byte.
    for (let index = 0; index < value.length; index++) {
      const unit = value.charCodeAt(index);
      if (unit < 0x20) {
        // Backspace, tab, LF, FF and CR use a short escape; other controls use \uXXXX.
        spend(unit === 8 || unit === 9 || unit === 10 || unit === 12 || unit === 13 ? 1 : 5);
      } else if (unit === 0x22 || unit === 0x5c || (unit >= 0x80 && unit < 0x800)) {
        spend(1);
      } else if (unit >= 0xd800 && unit <= 0xdfff) {
        const next = value.charCodeAt(index + 1);
        if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          spend(2);
          index++;
        } else {
          spend(5);
        }
      } else if (unit >= 0x800) {
        spend(2);
      }
    }
  };
  const visit = (value: unknown): unknown => {
    if (value === null) spend(4);
    else if (typeof value === 'string') spendString(value);
    else if (typeof value === 'boolean') spend(value ? 4 : 5);
    else if (typeof value === 'number' && Number.isFinite(value)) spend(String(value).length);
    else if (typeof value === 'object' && value !== null) {
      const previous = visited.get(value);
      if (previous) {
        spend(previous.bytes);
        return previous.value;
      }
      if (visited.has(value)) throw new InvalidJsonPayload();
      const before = remaining;
      spend(2);
      const prototype = Object.getPrototypeOf(value);
      let target = value;
      let keys: readonly PropertyKey[] | undefined;
      let length: number;
      if (Array.isArray(value)) {
        const size: unknown = Object.getOwnPropertyDescriptor(value, 'length')?.value;
        if (typeof size !== 'number' || prototype !== Array.prototype) {
          throw new InvalidJsonPayload();
        }
        if (size > remaining) throw new JsonPayloadTooLarge();
        if (Reflect.ownKeys(value).length !== size + 1) throw new InvalidJsonPayload();
        length = size;
        if (detach) target = [];
      } else {
        if (prototype !== Object.prototype && prototype !== null) throw new InvalidJsonPayload();
        const ownKeys = Reflect.ownKeys(value);
        if (orderKeys) {
          if (!ownKeys.every((key): key is string => typeof key === 'string')) {
            throw new InvalidJsonPayload();
          }
          ownKeys.sort();
        }
        keys = ownKeys;
        length = ownKeys.length;
        if (detach) target = prototype === null ? Object.create(null) : {};
      }
      visited.set(value, undefined);
      stack.push({ source: value, target, keys, length, before, index: 0 });
      return target;
    } else {
      throw new InvalidJsonPayload();
    }
    return value;
  };

  const value = visit(input) as T;
  for (let frame = stack.at(-1); frame; frame = stack.at(-1)) {
    if (frame.index === frame.length) {
      visited.set(frame.source, { value: frame.target, bytes: frame.before - remaining });
      stack.pop();
      continue;
    }
    if (frame.index > 0) spend(1);
    const key = frame.keys ? frame.keys[frame.index] : String(frame.index);
    frame.index++;
    if (typeof key !== 'string') throw new InvalidJsonPayload();
    if (frame.keys) {
      spendString(key);
      spend(1);
    }
    const child = visit(ownData(frame.source, key));
    if (detach) {
      Object.defineProperty(frame.target, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
  }
  return { value, bytes: allowance - remaining };
}

export function snapshotJson<T>(
  value: T,
  allowance: number,
  orderKeys = false
): { value: T; bytes: number } {
  return walkJson(value, allowance, true, orderKeys);
}

export function measureJson(value: unknown, allowance: number): number {
  return walkJson(value, allowance, false).bytes;
}

/** Compare two validated JSON snapshots, ignoring key order and retaining bounded alias traversal. */
export function equalJson(left: unknown, right: unknown): boolean {
  const pending: [unknown, unknown][] = [[left, right]];
  const compared = new Map<object, Set<object>>();
  for (let pair = pending.pop(); pair; pair = pending.pop()) {
    const [a, b] = pair;
    if (a === b) continue;
    if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const matches = compared.get(a) ?? new Set();
    if (matches.has(b)) continue;
    matches.add(b);
    compared.set(a, matches);
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(b, key)) return false;
      pending.push([ownData(a, key), ownData(b, key)]);
    }
  }
  return true;
}
