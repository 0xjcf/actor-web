/**
 * @module actor-core/runtime/unit/actor-address.test
 * @description Unit tests for the canonical opaque actor-address factory and parser.
 *
 * Covers the single minting site (createActorAddress / createLocalActorAddress /
 * createRemoteActorAddress) and the round-trip parser (parseActorPath). Addresses
 * are 2-segment for actors (actor://<node>/<id>) and 3-segment for callbacks
 * (actor://<node>/callback/<id>); `kind` replaces the old `type` field and `node`
 * is always set.
 */

import { describe, expect, it } from 'vitest';
import { parseActorPath } from '../actor-system.js';
import {
  createActorAddress,
  createLocalActorAddress,
  createRemoteActorAddress,
} from '../utils/factories.js';

describe('createActorAddress (canonical factory)', () => {
  it('mints a 2-segment actor address with node defaulted to local', () => {
    const address = createActorAddress('a1');
    expect(address).toEqual({
      id: 'a1',
      kind: 'actor',
      node: 'local',
      path: 'actor://local/a1',
    });
    // The redundant /actor/ segment is dropped for actors.
    expect(address.path).not.toContain('/actor/');
  });

  it('createLocalActorAddress deep-equals the defaulted factory output', () => {
    expect(createLocalActorAddress('a1')).toEqual(createActorAddress('a1'));
  });

  it('createRemoteActorAddress carries the concrete node', () => {
    const address = createRemoteActorAddress('a1', 'n2');
    expect(address).toEqual({
      id: 'a1',
      kind: 'actor',
      node: 'n2',
      path: 'actor://n2/a1',
    });
  });

  it('always sets node on factory output (local and remote)', () => {
    expect(createActorAddress('a1').node).toBe('local');
    expect(createActorAddress('a1', 'n2').node).toBe('n2');
    expect(createLocalActorAddress('a1').node).toBe('local');
    expect(createRemoteActorAddress('a1', 'n2').node).toBe('n2');
  });

  it('mints a 3-segment callback address with kind=callback', () => {
    const address = createActorAddress('c1', 'n1', 'callback');
    expect(address).toEqual({
      id: 'c1',
      kind: 'callback',
      node: 'n1',
      path: 'actor://n1/callback/c1',
    });
  });

  it('preserves slash-bearing ids in the path', () => {
    const address = createActorAddress('group/sub', 'n1');
    expect(address.path).toBe('actor://n1/group/sub');
  });

  it('throws on an empty id but not on a valid callback', () => {
    expect(() => createActorAddress('')).toThrow();
    expect(() => createActorAddress('a1', 'n1', 'callback')).not.toThrow();
  });

  it('rejects an actor id colliding with the reserved callback/ prefix', () => {
    // `/callback/` is the load-bearing delivery discriminator, so an actor id
    // starting with `callback/` is ambiguous and must be rejected to keep the
    // mint -> parse round-trip lossless (a real callback kind is still allowed).
    expect(() => createActorAddress('callback/c1')).toThrow(/reserved/i);
    expect(() => createActorAddress('c1', 'n1', 'callback')).not.toThrow();
  });
});

describe('parseActorPath', () => {
  it('parses a 2-segment actor path with node always defined (local)', () => {
    const address = parseActorPath('actor://local/a1');
    expect(address).toEqual({
      id: 'a1',
      kind: 'actor',
      node: 'local',
      path: 'actor://local/a1',
    });
    expect(address.node).toBe('local');
  });

  it('parses a remote 2-segment actor path', () => {
    const address = parseActorPath('actor://n2/a1');
    expect(address).toMatchObject({ id: 'a1', kind: 'actor', node: 'n2' });
  });

  it('matches the callback pattern first (id is not "callback/...")', () => {
    const address = parseActorPath('actor://n1/callback/c1');
    expect(address).toMatchObject({ id: 'c1', kind: 'callback', node: 'n1' });
    expect(address.id).not.toBe('callback/c1');
  });

  it('round-trips an actor address through the factory', () => {
    const minted = createActorAddress('a1', 'n2');
    expect(parseActorPath(minted.path)).toEqual(minted);
  });

  it('round-trips a callback address through the factory', () => {
    const minted = createActorAddress('c1', 'n1', 'callback');
    expect(parseActorPath(minted.path)).toEqual(minted);
  });

  it('round-trips a slash-bearing id', () => {
    const minted = createActorAddress('group/sub', 'n1');
    expect(parseActorPath(minted.path)).toEqual(minted);
    expect(parseActorPath(minted.path).id).toBe('group/sub');
  });

  it('throws on a malformed path', () => {
    expect(() => parseActorPath('not-an-actor-path')).toThrow();
  });
});
