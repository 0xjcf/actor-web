/**
 * @module actor-core/runtime/unit/actor-address.test
 * @description Unit tests for the opaque branded actor-address value object.
 *
 * `ActorAddress` is now an opaque branded string — the path IS the address. Only
 * `Address.from` (and the thin `createActorAddress` alias / the reserved guardian
 * sentinel) may mint one, so hand-built address object literals and raw unbranded
 * strings are compile errors. Addresses are 2-segment for actors
 * (actor://<node>/<id>) and 3-segment for callbacks (actor://<node>/callback/<id>);
 * `parse` is the boundary reader that returns { id, kind, node } and `parseActorPath`
 * stays the wire/ingress parser. `node` is always set ('local' is the canonical marker).
 */

import { describe, expect, it } from 'vitest';
import type { ActorAddress, AddressQuery } from '../actor-system.js';
import { parseActorPath } from '../actor-system.js';
import {
  Address,
  createActorAddress,
  createLocalActorAddress,
  createRemoteActorAddress,
  matchesAddressQuery,
  parse,
} from '../utils/factories.js';

describe('Address.from (sole smart constructor)', () => {
  it('mints a branded 2-segment actor address string from a structured id', () => {
    const address = Address.from({ id: 'a1' });
    // The path IS the address: identity, not an object wrapper.
    expect(address).toBe('actor://local/a1');
    expect(typeof address).toBe('string');
    // The redundant /actor/ segment is dropped for actors.
    expect(address).not.toContain('/actor/');
  });

  it('mints from a structured input object', () => {
    expect(Address.from({ id: 'a1' })).toBe('actor://local/a1');
    expect(Address.from({ id: 'a1', node: 'n2' })).toBe('actor://n2/a1');
    expect(Address.from({ id: 'c1', node: 'n1', kind: 'callback' })).toBe('actor://n1/callback/c1');
  });

  it('re-normalizes an existing path string (idempotent string input)', () => {
    // The string form is for re-branding a raw/branded wire path, not a bare id.
    expect(Address.from('actor://local/a1')).toBe('actor://local/a1');
    expect(Address.from('actor://n2/a1')).toBe('actor://n2/a1');
    expect(Address.from('actor://n1/callback/c1')).toBe('actor://n1/callback/c1');
  });

  it('defaults node to local for the structured shape', () => {
    expect(Address.from({ id: 'a1' })).toBe('actor://local/a1');
    expect(Address.from({ id: 'a1', kind: 'actor' })).toBe('actor://local/a1');
  });

  it('mints a 3-segment callback address with kind=callback', () => {
    expect(Address.from({ id: 'c1', node: 'n1', kind: 'callback' })).toBe('actor://n1/callback/c1');
  });

  it('preserves slash-bearing ids', () => {
    expect(Address.from({ id: 'group/sub', node: 'n1' })).toBe('actor://n1/group/sub');
  });

  it('is idempotent: re-branding an already-minted address is a no-op', () => {
    const once = Address.from({ id: 'a1' });
    expect(Address.from(once)).toBe(once);
    const remote = Address.from({ id: 'a1', node: 'n2' });
    expect(Address.from(remote)).toBe(remote);
    const callback = Address.from({ id: 'c1', node: 'n1', kind: 'callback' });
    expect(Address.from(callback)).toBe(callback);
    const slashed = Address.from({ id: 'group/sub', node: 'n1' });
    expect(Address.from(slashed)).toBe(slashed);
  });

  it('throws on an empty id but not on a valid callback', () => {
    expect(() => Address.from({ id: '' })).toThrow();
    expect(() => Address.from({ id: 'c1', node: 'n1', kind: 'callback' })).not.toThrow();
  });

  it('throws on a malformed string input (not a path, not a bare id)', () => {
    expect(() => Address.from('a1')).toThrow();
    expect(() => Address.from('not-an-actor-path')).toThrow();
  });

  it('rejects an actor id colliding with the reserved callback/ prefix', () => {
    // `/callback/` is the load-bearing delivery discriminator, so an actor id
    // starting with `callback/` would round-trip back as kind:'callback' and
    // misroute; the prefix is reserved (a real callback kind is still allowed).
    expect(() => Address.from({ id: 'callback/c1' })).toThrow(/reserved/i);
    expect(() => Address.from({ id: 'c1', node: 'n1', kind: 'callback' })).not.toThrow();
  });

  it('rejects the reserved guardian id for user actors', () => {
    // 'guardian' is the well-known system root supervisor id; no user actor may claim it.
    expect(() => Address.from({ id: 'guardian' })).toThrow(/guardian/i);
  });

  it('rejects a node that is empty or breaks the path with a slash', () => {
    // `node` is a single path segment (parse captures it as [^/]+); a slash-bearing
    // node would mis-split the minted path and corrupt round-tripping.
    expect(() => Address.from({ id: 'a1', node: '' })).toThrow();
    expect(() => Address.from({ id: 'a1', node: 'a/b' })).toThrow(/node/i);
    expect(() => Address.from({ id: 'c1', node: 'a/b', kind: 'callback' })).toThrow(/node/i);
    // A benign single-segment node is still accepted (regression guard).
    expect(Address.from({ id: 'a1', node: 'n2' })).toBe('actor://n2/a1');
  });

  it('rejects an actor id that embeds a /callback/ segment (mid-string misroute)', () => {
    // The start-anchored `callback/` guard above only catches the prefix. An id
    // like `group/callback/sub` still round-trips back through parse as
    // kind:'callback' (the callback regex matches `/callback/` anywhere), so the
    // reserved discriminator segment must be rejected wherever it appears.
    expect(() => Address.from({ id: 'group/callback/sub' })).toThrow(/callback/i);
    // Benign hierarchical (slash-bearing) ids without the reserved segment stay valid.
    expect(Address.from({ id: 'group/sub', node: 'n1' })).toBe('actor://n1/group/sub');
  });

  it('rejects unbranded values at the type level (brand is not cosmetic)', () => {
    // A hand-built object literal can no longer masquerade as an ActorAddress.
    // @ts-expect-error address object literals are a compile error under the branded model
    const fromLiteral: ActorAddress = {
      id: 'a1',
      kind: 'actor',
      node: 'local',
      path: 'actor://local/a1',
    };
    // A raw string is not branded; only Address.from may mint one.
    // @ts-expect-error a raw string is not a branded ActorAddress
    const fromRaw: ActorAddress = 'actor://local/a1';
    expect([fromLiteral, fromRaw]).toBeDefined();
  });
});

describe('createActorAddress (thin alias kept for existing call sites)', () => {
  it('mints the same branded string as the structured Address.from', () => {
    expect(createActorAddress('a1')).toBe(Address.from({ id: 'a1' }));
    expect(createLocalActorAddress('a1')).toBe(createActorAddress('a1'));
  });

  it('carries the concrete node and callback kind', () => {
    expect(createRemoteActorAddress('a1', 'n2')).toBe('actor://n2/a1');
    expect(createActorAddress('c1', 'n1', 'callback')).toBe('actor://n1/callback/c1');
  });
});

describe('parse (boundary reader)', () => {
  it('reads structured fields back from an actor address', () => {
    expect(parse(Address.from({ id: 'a1' }))).toEqual({ id: 'a1', kind: 'actor', node: 'local' });
    expect(parse(Address.from({ id: 'a1', node: 'n2' }))).toEqual({
      id: 'a1',
      kind: 'actor',
      node: 'n2',
    });
  });

  it('matches the callback pattern first (id is not "callback/...")', () => {
    const parsed = parse(Address.from({ id: 'c1', node: 'n1', kind: 'callback' }));
    expect(parsed).toEqual({ id: 'c1', kind: 'callback', node: 'n1' });
    expect(parsed.id).not.toBe('callback/c1');
  });

  it('round-trips id/kind/node through Address.from', () => {
    const minted = Address.from({ id: 'a1', node: 'n2' });
    const { id, kind, node } = parse(minted);
    expect(Address.from({ id, node, kind })).toBe(minted);
  });

  it('round-trips a slash-bearing id', () => {
    const minted = Address.from({ id: 'group/sub', node: 'n1' });
    expect(parse(minted).id).toBe('group/sub');
  });

  it('throws on a malformed address', () => {
    expect(() => parse('not-an-actor-path' as ActorAddress)).toThrow();
  });
});

describe('parseActorPath (wire/ingress parser)', () => {
  it('parses a raw 2-segment actor path into a branded address', () => {
    const address = parseActorPath('actor://local/a1');
    expect(address).toBe('actor://local/a1');
    expect(parse(address)).toEqual({ id: 'a1', kind: 'actor', node: 'local' });
  });

  it('parses a remote 2-segment actor path', () => {
    expect(parseActorPath('actor://n2/a1')).toBe('actor://n2/a1');
  });

  it('parses a callback path into a callback-kind address', () => {
    const address = parseActorPath('actor://n1/callback/c1');
    expect(parse(address)).toEqual({ id: 'c1', kind: 'callback', node: 'n1' });
  });

  it('round-trips a minted address back to itself', () => {
    const minted = Address.from({ id: 'a1', node: 'n2' });
    expect(parseActorPath(minted)).toBe(minted);
  });

  it('throws on a malformed path', () => {
    expect(() => parseActorPath('not-an-actor-path')).toThrow();
  });

  it('rejects an ingress path that embeds a /callback/ segment (mirror the minter)', () => {
    // Ingress must reject exactly what the minter rejects. A path like
    // actor://n1/group/callback/sub round-trips back through parse as
    // kind:'callback' (the callback regex matches `/callback/` anywhere) and
    // would trip enqueueMessage's `.includes('/callback/')` fast path, so it
    // must not be admitted as a branded actor address.
    expect(() => parseActorPath('actor://n1/group/callback/sub')).toThrow(/callback/i);
  });

  it('admits a valid 2-segment actor path', () => {
    expect(parseActorPath('actor://n1/orders')).toBe('actor://n1/orders');
    expect(parse(parseActorPath('actor://n1/orders'))).toEqual({
      id: 'orders',
      kind: 'actor',
      node: 'n1',
    });
  });

  it('round-trips a real callback ingress path', () => {
    const address = parseActorPath('actor://n1/callback/x');
    expect(address).toBe('actor://n1/callback/x');
    expect(parse(address)).toEqual({ id: 'x', kind: 'callback', node: 'n1' });
  });

  it('round-trips the reserved guardian sentinel only on the local node', () => {
    // The guardian's own wire address must survive ingress even though the
    // minter reserves the `guardian` id; it is only valid on the local node.
    expect(parseActorPath('actor://local/guardian')).toBe('actor://local/guardian');
    expect(() => parseActorPath('actor://other/guardian')).toThrow(/guardian/i);
  });
});

describe('matchesAddressQuery (pure functional-core predicate)', () => {
  const a1 = Address.from({ id: 'a1' });
  const a1n2 = Address.from({ id: 'a1', node: 'n2' });
  const c1 = Address.from({ id: 'c1', node: 'n1', kind: 'callback' });

  it('an empty query matches every address', () => {
    const empty: AddressQuery = {};
    expect(matchesAddressQuery(a1, empty)).toBe(true);
    expect(matchesAddressQuery(c1, empty)).toBe(true);
  });

  it('matches on id', () => {
    expect(matchesAddressQuery(a1, { id: 'a1' })).toBe(true);
    expect(matchesAddressQuery(a1, { id: 'other' })).toBe(false);
  });

  it('matches on kind', () => {
    expect(matchesAddressQuery(a1, { kind: 'actor' })).toBe(true);
    expect(matchesAddressQuery(a1, { kind: 'callback' })).toBe(false);
    expect(matchesAddressQuery(c1, { kind: 'callback' })).toBe(true);
  });

  it('matches on node', () => {
    expect(matchesAddressQuery(a1, { node: 'local' })).toBe(true);
    expect(matchesAddressQuery(a1n2, { node: 'n2' })).toBe(true);
    expect(matchesAddressQuery(a1n2, { node: 'local' })).toBe(false);
  });

  it('requires every provided field to match (conjunction)', () => {
    expect(matchesAddressQuery(a1n2, { id: 'a1', kind: 'actor', node: 'n2' })).toBe(true);
    expect(matchesAddressQuery(a1n2, { id: 'a1', kind: 'actor', node: 'local' })).toBe(false);
  });
});
