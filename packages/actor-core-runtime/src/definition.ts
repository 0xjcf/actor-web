/** A deliberately limited data profile, not a general XState loader or security sandbox. */
export const machineDefinitionProfile = 'xstate-v5-flat-v1' as const;

export type DefinitionJson =
  | null
  | string
  | number
  | boolean
  | DefinitionJson[]
  | { [key: string]: DefinitionJson };
export type DefinitionParameterKind = 'string' | 'number' | 'integer' | 'boolean';
export type DefinitionParameterFields = Readonly<Record<string, DefinitionParameterKind>>;

/** Trusted, data-only metadata. All listed parameter fields are required; extras refuse. */
export interface DefinitionBindingManifest {
  readonly actions: Readonly<Record<string, DefinitionParameterFields>>;
  readonly guards: Readonly<Record<string, DefinitionParameterFields>>;
}

export interface DefinitionValidationOptions {
  readonly limits: {
    readonly maxInputBytes: number;
    /** Inclusive container depth; must be at most 64. */
    readonly maxDepth: number;
    readonly maxStates: number;
    readonly maxTransitions: number;
  };
  readonly bindings: DefinitionBindingManifest;
}

export type DefinitionReference =
  | string
  | { type: string; params?: Record<string, string | number | boolean> };
export type DefinitionActions = DefinitionReference | DefinitionReference[];
export type DefinitionTransition =
  | string
  | { target?: string; guard?: DefinitionReference; actions?: DefinitionActions };

/** Runtime output is deeply frozen; types remain directly consumable by XState v5. */
export interface MachineDefinition {
  id: string;
  initial: string;
  context?: Record<string, DefinitionJson>;
  states: Record<
    string,
    {
      type?: 'atomic' | 'final';
      entry?: DefinitionActions;
      exit?: DefinitionActions;
      on?: Record<string, DefinitionTransition | DefinitionTransition[]>;
    }
  >;
}

export type DefinitionIssueCode =
  | 'invalidOptions'
  | 'inputTooLarge'
  | 'invalidJson'
  | 'depthLimit'
  | 'duplicateKey'
  | 'forbiddenKey'
  | 'nonFiniteNumber'
  | 'invalidDefinition'
  | 'unsupportedConstruct'
  | 'unknownTarget'
  | 'unknownBinding'
  | 'invalidParameters'
  | 'stateLimit'
  | 'transitionLimit';

export interface DefinitionIssue {
  readonly code: DefinitionIssueCode;
  /** JSON Pointer, or empty for a source-level refusal. */
  readonly path: string;
  readonly message: string;
}

export type DefinitionValidationResult =
  | {
      readonly ok: false;
      readonly profile: typeof machineDefinitionProfile;
      readonly issue: DefinitionIssue;
    }
  | {
      readonly ok: true;
      readonly profile: typeof machineDefinitionProfile;
      readonly definition: MachineDefinition;
      readonly counts: {
        readonly inputBytes: number;
        readonly states: number;
        readonly transitions: number;
      };
      readonly checks: {
        readonly structure: 'passed';
        readonly bindingManifest: 'passed';
        readonly implementationBinding: 'notChecked';
        readonly authorization: 'notChecked';
        readonly behavior: 'notChecked';
      };
    };

const namePattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const eventPattern = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const protectedKeys = new Set(['__proto__', 'prototype', 'constructor']);
const parameterKinds = new Set(['string', 'number', 'integer', 'boolean']);

class DefinitionRefusal extends Error {
  constructor(readonly issue: DefinitionIssue) {
    super(issue.message);
  }
}

function refuse(code: DefinitionIssueCode, path: string, message: string): never {
  throw new DefinitionRefusal({ code, path, message });
}

function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) refuse('invalidDefinition', path, 'Expected an object.');
  return value;
}

function fields(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      refuse('unsupportedConstruct', pointer(path, key), 'Field is outside this profile.');
    }
  }
}

function name(value: unknown, path: string): string {
  if (typeof value !== 'string' || !namePattern.test(value) || protectedKeys.has(value)) {
    refuse('invalidDefinition', path, 'Expected a supported identifier.');
  }
  return value;
}

function validateOptions(options: DefinitionValidationOptions): void {
  if (!isRecord(options) || !isRecord(options.limits) || !isRecord(options.bindings)) {
    refuse('invalidOptions', '', 'Explicit limits and binding metadata are required.');
  }
  const expected = ['maxInputBytes', 'maxDepth', 'maxStates', 'maxTransitions'];
  if (
    Object.keys(options.limits).length !== expected.length ||
    expected.some((key) => {
      const value = options.limits[key as keyof typeof options.limits];
      return !Number.isSafeInteger(value) || value < 1;
    }) ||
    options.limits.maxDepth > 64
  ) {
    refuse(
      'invalidOptions',
      '/limits',
      'Limits must be positive safe integers; maxDepth cannot exceed 64.'
    );
  }
  if (
    Object.keys(options).some((key) => !['limits', 'bindings'].includes(key)) ||
    Object.keys(options.bindings).some((key) => !['actions', 'guards'].includes(key))
  ) {
    refuse('invalidOptions', '', 'Unknown validation option.');
  }
  for (const kind of ['actions', 'guards'] as const) {
    const registry = options.bindings[kind];
    if (!isRecord(registry))
      refuse('invalidOptions', `/bindings/${kind}`, 'Expected binding metadata.');
    for (const [binding, parameters] of Object.entries(registry)) {
      if (!namePattern.test(binding) || protectedKeys.has(binding) || !isRecord(parameters)) {
        refuse('invalidOptions', `/bindings/${kind}`, 'Invalid binding metadata.');
      }
      for (const [key, type] of Object.entries(parameters)) {
        if (
          !namePattern.test(key) ||
          protectedKeys.has(key) ||
          typeof type !== 'string' ||
          !parameterKinds.has(type)
        ) {
          refuse('invalidOptions', `/bindings/${kind}`, 'Invalid parameter metadata.');
        }
      }
    }
  }
}

/**
 * Preflight only: native JSON.parse remains the grammar authority.
 * Bound depth before parsing, and detect decoded duplicate/prototype keys that
 * JSON.parse would otherwise overwrite or retain. Never inspect JS input objects.
 */
function preflight(source: string, maxDepth: number): void {
  const stack: Array<{ closing: string; keys: Set<string> | null }> = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') index += 1;
        index += 1;
      }
      if (index >= source.length) refuse('invalidJson', '', 'Malformed JSON.');
      let next = index + 1;
      while (next < source.length && /[ \t\r\n]/.test(source[next])) next += 1;
      if (source[next] === ':') {
        let key: unknown;
        try {
          key = JSON.parse(source.slice(start, index + 1));
        } catch {
          refuse('invalidJson', '', 'Malformed JSON.');
        }
        const keys = stack.at(-1)?.keys;
        if (typeof key !== 'string' || !keys) refuse('invalidJson', '', 'Malformed JSON.');
        if (protectedKeys.has(key))
          refuse('forbiddenKey', '', 'Protected object key is not supported.');
        if (keys.has(key)) refuse('duplicateKey', '', 'Duplicate object key.');
        keys.add(key);
      }
    } else if (character === '{' || character === '[') {
      stack.push({
        closing: character === '{' ? '}' : ']',
        keys: character === '{' ? new Set() : null,
      });
      if (stack.length > maxDepth) refuse('depthLimit', '', 'JSON nesting limit exceeded.');
    } else if (character === '}' || character === ']') {
      if (stack.pop()?.closing !== character) refuse('invalidJson', '', 'Malformed JSON.');
    }
  }
  if (stack.length !== 0) refuse('invalidJson', '', 'Malformed JSON.');
}

function finiteData(value: unknown, path: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    refuse('nonFiniteNumber', path, 'JSON number must be finite.');
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finiteData(child, pointer(path, key));
  }
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function reference(
  value: unknown,
  registry: Readonly<Record<string, DefinitionParameterFields>>,
  path: string
): void {
  const declaration = typeof value === 'string' ? { type: value } : object(value, path);
  fields(declaration, ['type', 'params'], path);
  const binding = name(declaration.type, pointer(path, 'type'));
  if (!Object.hasOwn(registry, binding)) {
    refuse('unknownBinding', path, 'Named implementation is absent from the binding manifest.');
  }
  const shape = registry[binding];
  const params = declaration.params === undefined ? {} : declaration.params;
  if (!isRecord(params) || Object.keys(params).length !== Object.keys(shape).length) {
    refuse(
      'invalidParameters',
      pointer(path, 'params'),
      'Parameters must match the declared fields.'
    );
  }
  for (const [key, type] of Object.entries(shape)) {
    const parameter = params[key];
    if (
      !Object.hasOwn(params, key) ||
      (type === 'integer' ? !Number.isSafeInteger(parameter) : typeof parameter !== type)
    ) {
      refuse(
        'invalidParameters',
        pointer(pointer(path, 'params'), key),
        'Parameter type does not match.'
      );
    }
  }
}

function actions(value: unknown, manifest: DefinitionBindingManifest, path: string): void {
  if (Array.isArray(value)) {
    if (!value.length) refuse('invalidDefinition', path, 'Action arrays must not be empty.');
    value.forEach((item, index) => reference(item, manifest.actions, pointer(path, index)));
  } else {
    reference(value, manifest.actions, path);
  }
}

function target(value: unknown, states: Record<string, unknown>, path: string): void {
  const key = name(value, path);
  if (!Object.hasOwn(states, key)) refuse('unknownTarget', path, 'Target state does not exist.');
}

function transition(
  value: unknown,
  states: Record<string, unknown>,
  bindings: DefinitionBindingManifest,
  path: string
): void {
  if (typeof value === 'string') {
    target(value, states, path);
    return;
  }
  const config = object(value, path);
  fields(config, ['target', 'actions', 'guard'], path);
  if (config.target === undefined && config.actions === undefined) {
    refuse('invalidDefinition', path, 'Transition needs a target or actions.');
  }
  if (config.target !== undefined) target(config.target, states, pointer(path, 'target'));
  if (config.guard !== undefined) reference(config.guard, bindings.guards, pointer(path, 'guard'));
  if (config.actions !== undefined) actions(config.actions, bindings, pointer(path, 'actions'));
}

function validateGraph(
  value: unknown,
  options: DefinitionValidationOptions
): { states: number; transitions: number } {
  const root = object(value, '');
  fields(root, ['id', 'initial', 'context', 'states'], '');
  name(root.id, '/id');
  if (root.context !== undefined) object(root.context, '/context');
  const states = object(root.states, '/states');
  const entries = Object.entries(states);
  if (entries.length === 0)
    refuse('invalidDefinition', '/states', 'At least one state is required.');
  if (entries.length > options.limits.maxStates)
    refuse('stateLimit', '/states', 'State limit exceeded.');
  target(root.initial, states, '/initial');
  let transitions = 0;
  for (const [key, value] of entries) {
    const path = pointer('/states', key);
    name(key, path);
    const state = object(value, path);
    fields(state, ['type', 'entry', 'exit', 'on'], path);
    if (state.type !== undefined && state.type !== 'atomic' && state.type !== 'final') {
      refuse(
        'unsupportedConstruct',
        pointer(path, 'type'),
        'Only atomic and final states are supported.'
      );
    }
    if (state.type === 'final' && state.on !== undefined) {
      refuse(
        'invalidDefinition',
        pointer(path, 'on'),
        'Final states cannot declare event transitions.'
      );
    }
    for (const field of ['entry', 'exit']) {
      if (state[field] !== undefined) actions(state[field], options.bindings, pointer(path, field));
    }
    if (state.on === undefined) continue;
    const events = object(state.on, pointer(path, 'on'));
    for (const [event, config] of Object.entries(events)) {
      const eventPath = pointer(pointer(path, 'on'), event);
      if (!eventPattern.test(event) || event.startsWith('xstate.')) {
        refuse('unsupportedConstruct', eventPath, 'Only exact external event names are supported.');
      }
      const alternatives = Array.isArray(config) ? config : [config];
      if (!alternatives.length)
        refuse('invalidDefinition', eventPath, 'Transition arrays must not be empty.');
      for (let index = 0; index < alternatives.length; index += 1) {
        transitions += 1;
        if (transitions > options.limits.maxTransitions) {
          refuse('transitionLimit', eventPath, 'Transition limit exceeded.');
        }
        transition(
          alternatives[index],
          states,
          options.bindings,
          Array.isArray(config) ? pointer(eventPath, index) : eventPath
        );
      }
    }
  }
  return { states: entries.length, transitions };
}

/**
 * Validate untrusted JSON text against explicit trusted data-only metadata.
 * No machine construction, guard/action calls, tool binding, I/O or actor start.
 * A successful result is NOT permission to execute the definition.
 */
export function validateMachineDefinition(
  source: string,
  options: DefinitionValidationOptions
): DefinitionValidationResult {
  try {
    validateOptions(options);
    if (typeof source !== 'string') refuse('invalidJson', '', 'Expected JSON text.');
    if (source.length > options.limits.maxInputBytes) {
      refuse('inputTooLarge', '', 'JSON input byte limit exceeded.');
    }
    const inputBytes = new TextEncoder().encode(source).byteLength;
    if (inputBytes > options.limits.maxInputBytes) {
      refuse('inputTooLarge', '', 'JSON input byte limit exceeded.');
    }
    preflight(source, options.limits.maxDepth);
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      refuse('invalidJson', '', 'Malformed JSON.');
    }
    finiteData(parsed, '');
    const counts = validateGraph(parsed, options);
    // All fields, variants and references were checked above; no coercion or stripping.
    return freeze({
      ok: true,
      profile: machineDefinitionProfile,
      definition: parsed as MachineDefinition,
      counts: { inputBytes, ...counts },
      checks: {
        structure: 'passed',
        bindingManifest: 'passed',
        implementationBinding: 'notChecked',
        authorization: 'notChecked',
        behavior: 'notChecked',
      },
    });
  } catch (error) {
    if (!(error instanceof DefinitionRefusal)) throw error;
    return freeze({ ok: false, profile: machineDefinitionProfile, issue: error.issue });
  }
}
