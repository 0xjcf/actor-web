import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMachine } from 'xstate';
import type { ActorRef } from '../actor-ref.js';
import type { ActorMessage, ActorSystem } from '../actor-system.js';
import { Address } from '../utils/factories.js';

vi.mock('../actor-system-impl.js', async () => {
  const actual =
    await vi.importActual<typeof import('../actor-system-impl.js')>('../actor-system-impl.js');
  return {
    ...actual,
    createActorSystem: vi.fn(),
  };
});

import { createActorSystem } from '../actor-system-impl.js';
import { createComponent } from '../create-component.js';

type InternalComponentElement = ReturnType<typeof createComponent> extends {
  create: (...args: never[]) => infer TElement;
}
  ? TElement & {
      connectedCallback(): Promise<void>;
      disconnectedCallback(): Promise<void>;
    }
  : never;

class FakeHTMLElement {
  id = '';

  attachShadow(): ShadowRoot {
    return {
      appendChild: vi.fn(),
    } as unknown as ShadowRoot;
  }
}

function installDomGlobals(): void {
  const registry = new Map<string, CustomElementConstructor>();

  vi.stubGlobal('HTMLElement', FakeHTMLElement);
  vi.stubGlobal('customElements', {
    define: (tagName: string, elementConstructor: CustomElementConstructor) => {
      registry.set(tagName, elementConstructor);
    },
    get: (tagName: string) => registry.get(tagName),
  });
  vi.stubGlobal('document', {
    createElement: (tagName: string) => {
      if (tagName === 'style') {
        return { textContent: '' };
      }

      const elementConstructor = registry.get(tagName);
      if (!elementConstructor) {
        throw new Error(`Unknown element: ${tagName}`);
      }
      return new elementConstructor();
    },
  });
}

function createActorRef(path: string): ActorRef {
  return {
    // The address IS the branded path string under the opaque address model.
    address: Address.from(path),
    send: vi.fn(async (_message: ActorMessage<{ type: string }>) => undefined),
    ask: vi.fn(async () => ({})),
    stop: vi.fn(async () => undefined),
    isAlive: vi.fn(async () => true),
    getStats: vi.fn(async () => ({
      messagesReceived: 0,
      messagesProcessed: 0,
      errors: 0,
      uptime: 0,
    })),
  } as unknown as ActorRef;
}

function createRuntimeMock(label: string): {
  runtime: ActorSystem;
  spawn: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  actorRef: ActorRef;
} {
  const actorRef = createActorRef(`actor://${label}/component-actor`);
  const spawn = vi.fn(async () => actorRef);
  const lookup = vi.fn(async (path: string) => createActorRef(path));
  const start = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);

  return {
    actorRef,
    spawn,
    lookup,
    start,
    stop,
    runtime: {
      start,
      stop,
      isRunning: vi.fn(() => true),
      spawn,
      lookup,
      listActors: vi.fn(async () => []),
      getSystemStats: vi.fn(async () => ({
        totalActors: 0,
        messagesPerSecond: 0,
        uptime: 0,
        clusterState: { nodes: [label], leader: label, status: 'up' as const },
      })),
      subscribe: vi.fn(async () => async () => undefined),
      spawnEventCollector: vi.fn(async () => actorRef),
      enableTestMode: vi.fn(),
      disableTestMode: vi.fn(),
      isTestMode: vi.fn(() => false),
      flush: vi.fn(async () => undefined),
      join: vi.fn(async () => undefined),
      leave: vi.fn(async () => undefined),
      getClusterState: vi.fn(() => ({ nodes: [label], leader: label, status: 'up' as const })),
      subscribeToClusterEvents: vi.fn(() => () => undefined),
      registerGlobalInterceptor: vi.fn(() => 'global-interceptor'),
      registerActorInterceptor: vi.fn(() => 'actor-interceptor'),
      unregisterGlobalInterceptor: vi.fn(() => true),
      unregisterActorInterceptor: vi.fn(() => true),
      onShutdown: vi.fn(),
      subscribeToSystemEvents: vi.fn(() => () => undefined),
    } as unknown as ActorSystem,
  };
}

const machine = createMachine({
  id: 'test-component',
  initial: 'idle',
  states: {
    idle: {},
  },
});

const template = () => '<div>test</div>';

const createActorSystemMock = vi.mocked(createActorSystem);

beforeEach(() => {
  installDomGlobals();
  createActorSystemMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('component runtime ownership', () => {
  it('uses the config runtime and reuses the resolved runtime for spawn and dependency lookup', async () => {
    const configRuntime = createRuntimeMock('config-runtime');
    const runtimeProvider = vi.fn(async () => configRuntime.runtime);
    const component = createComponent({
      machine,
      template,
      runtime: runtimeProvider,
      dependencies: { backend: 'actor://config-runtime/backend' },
    });

    const element = component.create() as InternalComponentElement;
    await element.connectedCallback();

    expect(runtimeProvider).toHaveBeenCalledTimes(1);
    expect(configRuntime.spawn).toHaveBeenCalledTimes(1);
    expect(configRuntime.lookup).toHaveBeenCalledTimes(1);
    expect(createActorSystemMock).not.toHaveBeenCalled();
  });

  it('lets a per-call create runtime override win over the config runtime', async () => {
    const configRuntime = createRuntimeMock('config-runtime');
    const overrideRuntime = createRuntimeMock('override-runtime');
    const component = createComponent({
      machine,
      template,
      runtime: configRuntime.runtime,
      dependencies: { backend: 'actor://override-runtime/backend' },
    });

    const element = component.create({
      runtime: overrideRuntime.runtime,
    }) as InternalComponentElement;
    await element.connectedCallback();

    expect(overrideRuntime.spawn).toHaveBeenCalledTimes(1);
    expect(overrideRuntime.lookup).toHaveBeenCalledTimes(1);
    expect(configRuntime.spawn).not.toHaveBeenCalled();
    expect(configRuntime.lookup).not.toHaveBeenCalled();
  });

  it('supports a per-call runtime override for createWithDependencies', async () => {
    const configRuntime = createRuntimeMock('config-runtime');
    const overrideRuntime = createRuntimeMock('override-runtime');
    const injectedDependency = createActorRef('actor://override-runtime/injected');
    const component = createComponent({
      machine,
      template,
      runtime: configRuntime.runtime,
    });

    const element = component.createWithDependencies(
      { injected: injectedDependency },
      { runtime: overrideRuntime.runtime }
    ) as InternalComponentElement;
    await element.connectedCallback();

    expect(overrideRuntime.spawn).toHaveBeenCalledTimes(1);
    expect(configRuntime.spawn).not.toHaveBeenCalled();
    expect(overrideRuntime.actorRef.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_DEPENDENCIES',
        dependencyRefs: {
          injected: 'actor://override-runtime/injected',
        },
      })
    );
  });

  it('does not start or stop injected runtimes implicitly', async () => {
    const injectedRuntime = createRuntimeMock('injected-runtime');
    const component = createComponent({
      machine,
      template,
      runtime: injectedRuntime.runtime,
    });

    const element = component.create() as InternalComponentElement;
    await element.connectedCallback();
    await element.disconnectedCallback();

    expect(injectedRuntime.start).not.toHaveBeenCalled();
    expect(injectedRuntime.stop).not.toHaveBeenCalled();
    expect(injectedRuntime.actorRef.stop).toHaveBeenCalledTimes(1);
  });

  it('preserves the fallback path through a closure-local runtime', async () => {
    const fallbackRuntime = createRuntimeMock('fallback-runtime');
    createActorSystemMock.mockReturnValue(fallbackRuntime.runtime);

    const component = createComponent({
      machine,
      template,
      dependencies: { backend: 'actor://fallback-runtime/backend' },
    });

    const firstElement = component.create() as InternalComponentElement;
    const secondElement = component.create() as InternalComponentElement;

    await firstElement.connectedCallback();
    await secondElement.connectedCallback();

    expect(createActorSystemMock).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.start).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.spawn).toHaveBeenCalledTimes(2);
    expect(fallbackRuntime.lookup).toHaveBeenCalledTimes(2);
  });

  it('reference-counts the fallback runtime and stops it after the last disconnect only once', async () => {
    const fallbackRuntime = createRuntimeMock('fallback-runtime');
    createActorSystemMock.mockReturnValue(fallbackRuntime.runtime);

    const component = createComponent({
      machine,
      template,
    });

    const firstElement = component.create() as InternalComponentElement;
    const secondElement = component.create() as InternalComponentElement;

    await firstElement.connectedCallback();
    await secondElement.connectedCallback();
    await firstElement.disconnectedCallback();
    await secondElement.disconnectedCallback();
    await secondElement.disconnectedCallback();

    expect(createActorSystemMock).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.start).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it('releases the fallback runtime after a failed connect without over-releasing on later disconnects', async () => {
    const fallbackRuntime = createRuntimeMock('fallback-runtime');
    fallbackRuntime.spawn.mockRejectedValueOnce(new Error('spawn failed'));
    createActorSystemMock.mockReturnValue(fallbackRuntime.runtime);

    const component = createComponent({
      machine,
      template,
    });

    const element = component.create() as InternalComponentElement;
    await expect(element.connectedCallback()).rejects.toThrow('spawn failed');
    await element.disconnectedCallback();

    expect(createActorSystemMock).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.start).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it('preserves the original connect failure when fallback runtime cleanup also fails', async () => {
    const fallbackRuntime = createRuntimeMock('fallback-runtime');
    fallbackRuntime.spawn.mockRejectedValueOnce(new Error('spawn failed'));
    fallbackRuntime.stop.mockRejectedValueOnce(new Error('fallback stop failed'));
    createActorSystemMock.mockReturnValue(fallbackRuntime.runtime);

    const component = createComponent({
      machine,
      template,
    });

    const element = component.create() as InternalComponentElement;
    await expect(element.connectedCallback()).rejects.toThrow('spawn failed');

    expect(fallbackRuntime.stop).toHaveBeenCalledTimes(1);
  });

  it('does not reject disconnectedCallback when fallback runtime cleanup fails', async () => {
    const fallbackRuntime = createRuntimeMock('fallback-runtime');
    fallbackRuntime.stop.mockRejectedValueOnce(new Error('fallback stop failed'));
    createActorSystemMock.mockReturnValue(fallbackRuntime.runtime);

    const component = createComponent({
      machine,
      template,
    });

    const element = component.create() as InternalComponentElement;
    await element.connectedCallback();

    await expect(element.disconnectedCallback()).resolves.toBeUndefined();

    expect(fallbackRuntime.actorRef.stop).toHaveBeenCalledTimes(1);
    expect(fallbackRuntime.stop).toHaveBeenCalledTimes(1);
  });
});
