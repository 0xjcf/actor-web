import { describe, expect, it } from 'vitest';
import { createActor, createMachine } from 'xstate';
import { type DefinitionValidationOptions, validateMachineDefinition } from '../definition.js';

const options: DefinitionValidationOptions = {
  limits: { maxInputBytes: 16_384, maxDepth: 16, maxStates: 16, maxTransitions: 32 },
  bindings: {
    actions: { record: { label: 'string' } },
    guards: { allowed: { minimum: 'integer' } },
  },
};

const fixture = () => ({
  id: 'example',
  initial: 'idle',
  context: { count: 0 },
  states: {
    idle: {
      on: {
        NEXT: {
          target: 'done',
          guard: { type: 'allowed', params: { minimum: 1 } },
          actions: [{ type: 'record', params: { label: 'observed' } }],
        },
      },
    },
    done: { type: 'final' },
  },
});

function check(value: unknown, config = options) {
  return validateMachineDefinition(JSON.stringify(value), config);
}

function issue(value: unknown, code: string, config = options) {
  const result = check(value, config);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.issue.code).toBe(code);
  return result;
}

describe('validateMachineDefinition', () => {
  it('returns a deterministic frozen definition without claiming authorization or execution', () => {
    const result = check(fixture());
    expect(result).toEqual(check(fixture()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toBe('xstate-v5-flat-v1');
    expect(result.checks).toEqual({
      structure: 'passed',
      bindingManifest: 'passed',
      implementationBinding: 'notChecked',
      authorization: 'notChecked',
      behavior: 'notChecked',
    });
    expect(result.counts).toMatchObject({ states: 2, transitions: 1 });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.definition.states.idle.on?.NEXT)).toBe(true);
    expect(Object.isFrozen(result.definition.context)).toBe(true);
  });

  it('passes its result to installed XState and invokes behavior only on explicit execution', () => {
    let actionCalls = 0;
    let guardCalls = 0;
    const result = check(fixture());
    expect(result.ok).toBe(true);
    expect([actionCalls, guardCalls]).toEqual([0, 0]);
    if (!result.ok) return;
    const machine = createMachine(result.definition, {
      actions: {
        record: () => {
          actionCalls += 1;
        },
      },
      guards: {
        allowed: () => {
          guardCalls += 1;
          return true;
        },
      },
    });
    expect([actionCalls, guardCalls]).toEqual([0, 0]);
    const actor = createActor(machine).start();
    try {
      expect(actor.getSnapshot().value).toBe('idle');
      actor.send({ type: 'NEXT' });
      expect(actor.getSnapshot().status).toBe('done');
      expect([actionCalls, guardCalls]).toEqual([1, 1]);
    } finally {
      actor.stop();
    }
  });

  it.each(['null', '[]', 'true', '"text"', '42'])('rejects non-machine JSON %s', (source) => {
    expect(validateMachineDefinition(source, options)).toMatchObject({
      ok: false,
      issue: { code: 'invalidDefinition' },
    });
  });

  it.each(['{', '{"x":}', '{"x": "unterminated}', '{"x": [1,]}'])(
    'reports malformed JSON without reflecting parser content: %s',
    (source) => {
      expect(validateMachineDefinition(source, options)).toMatchObject({
        ok: false,
        issue: { code: 'invalidJson', path: '' },
      });
    }
  );

  it.each([
    '{"id":"first","id":"second"}',
    '{"id":"first","\\u0069d":"second"}',
    '{"context":{"key":1,"key":2}}',
  ])('refuses duplicate keys including escaped aliases', (source) => {
    expect(validateMachineDefinition(source, options)).toMatchObject({
      ok: false,
      issue: { code: 'duplicateKey' },
    });
  });

  it.each(['__proto__', 'prototype', 'constructor'])('rejects protected key %s', (key) => {
    expect(validateMachineDefinition(`{"context":{"${key}":1}}`, options)).toMatchObject({
      ok: false,
      issue: { code: 'forbiddenKey' },
    });
  });

  it('refuses overflow numbers anywhere in literal data', () => {
    const source = JSON.stringify(fixture()).replace('"count":0', '"count":1e400');
    expect(validateMachineDefinition(source, options)).toMatchObject({
      ok: false,
      issue: { code: 'nonFiniteNumber' },
    });
  });

  it('measures UTF-8 bytes rather than UTF-16 units with an inclusive byte boundary', () => {
    const value = { ...fixture(), context: { text: 'é🙂' } };
    const source = JSON.stringify(value);
    const size = new TextEncoder().encode(source).byteLength;
    const limited = { ...options, limits: { ...options.limits, maxInputBytes: size } };
    expect(validateMachineDefinition(source, limited).ok).toBe(true);
    expect(
      validateMachineDefinition(source, {
        ...limited,
        limits: { ...limited.limits, maxInputBytes: size - 1 },
      })
    ).toMatchObject({ ok: false, issue: { code: 'inputTooLarge' } });
  });

  it('bounds nesting before parsing and ignores braces and escaped quotes inside strings', () => {
    const source = `${'['.repeat(17)}0${']'.repeat(17)}`;
    expect(validateMachineDefinition(source, options)).toMatchObject({
      ok: false,
      issue: { code: 'depthLimit' },
    });
    expect(check({ ...fixture(), context: { text: '{"quoted": "\\"[[[{"}' } }).ok).toBe(true);
  });

  it('checks state and transition counts at their inclusive bounds', () => {
    const tight = { ...options, limits: { ...options.limits, maxStates: 2, maxTransitions: 1 } };
    expect(check(fixture(), tight).ok).toBe(true);
    issue(fixture(), 'stateLimit', { ...tight, limits: { ...tight.limits, maxStates: 1 } });
    const value = fixture();
    value.states.idle.on.NEXT.actions = [];
    const extra = {
      ...value,
      states: { ...value.states, idle: { on: { NEXT: ['done', 'idle'] } } },
    };
    issue(extra, 'transitionLimit', tight);
  });

  it.each(['always', 'after', 'invoke', 'states', 'onDone'])(
    'reports unsupported state construct %s instead of discarding it',
    (field) => {
      const value = fixture();
      issue(
        { ...value, states: { ...value.states, idle: { [field]: {} } } },
        'unsupportedConstruct'
      );
    }
  );

  it.each(['parallel', 'history', 'compound'])('refuses unsupported state type %s', (type) => {
    const value = fixture();
    issue({ ...value, states: { ...value.states, idle: { type } } }, 'unsupportedConstruct');
  });

  it('rejects unknown root fields and absent initial/target states', () => {
    issue({ ...fixture(), typo: true }, 'unsupportedConstruct');
    issue({ ...fixture(), initial: 'missing' }, 'unknownTarget');
    const value = fixture();
    value.states.idle.on.NEXT.target = 'missing';
    expect(issue(value, 'unknownTarget')).toMatchObject({
      issue: { path: '/states/idle/on/NEXT/target' },
    });
  });

  it('refuses unknown bindings, reserved names and invalid parameter fields/types', () => {
    const value = fixture();
    value.states.idle.on.NEXT.actions[0].type = 'missing';
    issue(value, 'unknownBinding');
    for (const params of [{}, { label: 2 }, { label: 'ok', extra: true }]) {
      issue(
        {
          ...fixture(),
          states: { idle: { on: { NEXT: { actions: { type: 'record', params } } } } },
        },
        'invalidParameters'
      );
    }
    const invalid = fixture();
    invalid.states.idle.on.NEXT.guard.params.minimum = 1.5;
    issue(invalid, 'invalidParameters');
    const builtin = fixture();
    builtin.states.idle.on.NEXT.actions[0].type = 'xstate.raise';
    issue(builtin, 'invalidDefinition');
  });

  it('accepts exact no-parameter names, entry/exit actions and targetless actions', () => {
    expect(
      check(
        {
          id: 'simple',
          initial: 'idle',
          states: { idle: { entry: 'log', exit: ['log'], on: { PING: { actions: 'log' } } } },
        },
        { ...options, bindings: { actions: { log: {} }, guards: {} } }
      ).ok
    ).toBe(true);
  });

  it('rejects final-state outgoing transitions and wildcard/internal event descriptors', () => {
    issue(
      { ...fixture(), states: { idle: { type: 'final', on: { NEXT: 'idle' } } } },
      'invalidDefinition'
    );
    for (const event of ['*', 'event.*', 'xstate.done.actor.child', '']) {
      issue(
        { ...fixture(), states: { idle: { on: { [event]: 'idle' } } } },
        'unsupportedConstruct'
      );
    }
  });

  it('rejects invalid options and callable parameter validators without invoking them', () => {
    let calls = 0;
    const badOptions = {
      ...options,
      bindings: {
        actions: {
          record: () => {
            calls += 1;
            return true;
          },
        },
        guards: {},
      },
    } as unknown as DefinitionValidationOptions;
    issue(fixture(), 'invalidOptions', badOptions);
    expect(calls).toBe(0);
    for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      issue(fixture(), 'invalidOptions', {
        ...options,
        limits: { ...options.limits, maxStates: value },
      });
    }
    issue(fixture(), 'invalidOptions', { ...options, limits: { ...options.limits, maxDepth: 65 } });
  });

  it('checks bounded generated target fixtures against an independent state inventory', () => {
    for (let stateCount = 1; stateCount <= 8; stateCount += 1) {
      const names = Array.from({ length: stateCount }, (_, index) => `state${index}`);
      for (let targetIndex = 0; targetIndex <= stateCount; targetIndex += 1) {
        const target = `state${targetIndex}`;
        const states = Object.fromEntries(names.map((name) => [name, { on: { NEXT: target } }]));
        expect(check({ id: 'generated', initial: names[0], states }).ok).toBe(
          names.includes(target)
        );
      }
    }
  });

  it('does not mutate input metadata and refuses mutations of returned nested data', () => {
    const before = JSON.stringify(options);
    const result = check(fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => {
      result.definition.states.idle.type = 'final';
    }).toThrow();
    expect(JSON.stringify(options)).toBe(before);
  });

  it('supports boolean and finite numeric parameters but rejects primitive/null parameter objects', () => {
    const configuration = {
      ...options,
      bindings: { actions: { record: { active: 'boolean', ratio: 'number' } }, guards: {} },
    } as const;
    const value = (params: unknown) => ({
      id: 'parameters',
      initial: 'idle',
      states: { idle: { entry: { type: 'record', params } } },
    });
    expect(check(value({ active: false, ratio: 0.5 }), configuration).ok).toBe(true);
    for (const params of [null, [], false, 'text', { active: false, ratio: '0.5' }]) {
      issue(value(params), 'invalidParameters', configuration);
    }
  });

  it('enforces exact nesting boundaries and isolates duplicate detection per object', () => {
    const value = {
      id: 'depth',
      initial: 'idle',
      context: { first: { same: 1 }, second: { same: 2 } },
      states: { idle: {} },
    };
    expect(check(value, { ...options, limits: { ...options.limits, maxDepth: 3 } }).ok).toBe(true);
    issue(value, 'depthLimit', { ...options, limits: { ...options.limits, maxDepth: 2 } });
  });

  it('matches installed XState for ordered alternatives and targetless actions', () => {
    let calls = 0;
    const result = check(
      {
        id: 'branches',
        initial: 'idle',
        states: {
          idle: {
            entry: 'log',
            exit: 'log',
            on: {
              PING: { actions: 'log' },
              NEXT: [{ target: 'rejected', guard: 'never' }, { target: 'done' }],
            },
          },
          rejected: { type: 'final' },
          done: { type: 'final' },
        },
      },
      { ...options, bindings: { actions: { log: {} }, guards: { never: {} } } }
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const actor = createActor(
      createMachine(result.definition, {
        actions: {
          log: () => {
            calls += 1;
          },
        },
        guards: { never: () => false },
      })
    ).start();
    try {
      expect(calls).toBe(1);
      actor.send({ type: 'PING' });
      expect(actor.getSnapshot().value).toBe('idle');
      expect(calls).toBe(2);
      actor.send({ type: 'NEXT' });
      expect(actor.getSnapshot().value).toBe('done');
      expect(calls).toBe(3);
    } finally {
      actor.stop();
    }
  });

  it.each([
    { id: 'empty', initial: 'idle', states: {} },
    { initial: 'idle', states: { idle: {} } },
    { id: 'empty', initial: 'idle', states: { idle: { on: { NEXT: [] } } } },
    { id: 'empty', initial: 'idle', states: { idle: { on: { NEXT: {} } } } },
    { id: 'empty', initial: 'idle', states: { idle: { entry: [] } } },
    { id: 'empty', initial: 'idle', states: { idle: { on: { NEXT: null } } } },
  ])('rejects incomplete machine/transition data', (value) => {
    issue(value, 'invalidDefinition');
  });
});
