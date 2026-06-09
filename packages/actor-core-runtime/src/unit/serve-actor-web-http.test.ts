import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { serveActorWebHttp } from '../serve-actor-web-http.js';
import { serveNode } from '../serve-actor-web-node.js';
import { actor, defineActorWebTopology, node } from '../topology.js';
import { defineBehavior } from '../unified-actor-builder.js';

vi.mock('node:http', async () => {
  const actual = await vi.importActual<typeof import('node:http')>('node:http');
  return {
    ...actual,
    createServer: vi.fn(actual.createServer),
  };
});

type CounterCommand =
  | { type: 'INCREMENT'; amount?: number }
  | { type: 'GET_COUNT' }
  | { type: 'SET_COUNT'; count: number };

interface CounterContext {
  count: number;
}

function createCounterBehavior() {
  return defineBehavior<CounterCommand>()
    .withContext<CounterContext>({ count: 0 })
    .onMessage(({ message, actor }) => {
      const context = actor.getSnapshot().context;
      if (message.type === 'GET_COUNT') {
        return { reply: context.count };
      }
      if (message.type === 'SET_COUNT') {
        return { context: { count: message.count } };
      }

      return { context: { count: context.count + (message.amount ?? 1) } };
    })
    .build();
}

const topology = defineActorWebTopology({
  nodes: {
    server: node('server-node'),
  },
  actors: {
    counter: actor({
      id: 'counter',
      node: 'server',
      behavior: createCounterBehavior,
    }),
  },
});

const createServerMock = vi.mocked(createServer);

class FakeHttpServer extends EventEmitter {
  constructor(
    private readonly addressValue: ReturnType<ReturnType<typeof createServer>['address']>,
    private readonly listenImpl: () => void
  ) {
    super();
  }

  listen(_port: number, _host: string): void {
    this.listenImpl();
  }

  address() {
    return this.addressValue;
  }

  close(callback: (error?: Error) => void): void {
    callback();
  }
}

describe('serveActorWebHttp', () => {
  it('serves route-first HTTP handlers with topology actors and response helpers', async () => {
    const runtime = await serveNode(topology, { node: 'server' });
    const http = await serveActorWebHttp(runtime)
      .post('/counters/:id', async (request, response, { actors }) => {
        const body = request.body as { amount?: number };
        await actors.counter.send({ type: 'INCREMENT', amount: body.amount });
        return response.accepted({ id: request.params.id });
      })
      .get('/counters/count', async (_request, response, { actors, runtime: servedRuntime }) => {
        const count = await actors.counter.ask<number>({ type: 'GET_COUNT' });
        return response.ok({
          count,
          transportUrl: servedRuntime.getTransportUrl(),
        });
      })
      .listen();

    try {
      const createResponse = await fetch(`${http.url}/counters/main`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount: 3 }),
      });
      expect(createResponse.status).toBe(202);
      await expect(createResponse.json()).resolves.toEqual({ id: 'main' });

      const countResponse = await fetch(`${http.url}/counters/count`);
      expect(countResponse.status).toBe(200);
      await expect(countResponse.json()).resolves.toMatchObject({ count: 3 });
    } finally {
      await http.stop();
      await runtime.stop();
    }
  });

  it('infers a selected actor for .for() bound routes', async () => {
    const runtime = await serveNode(topology, { node: 'server' });
    const http = await serveActorWebHttp(runtime)
      .for(topology.actors.counter)
      .put('/counter', async (request, response, { actor }) => {
        const body = request.body as { count: number };
        await actor.send({ type: 'SET_COUNT', count: body.count });
        return response.noContent();
      })
      .get('/counter', async (_request, response, { actor }) => {
        const count = await actor.ask<number>({ type: 'GET_COUNT' });
        return response.ok({ count });
      })
      .listen();

    try {
      const setResponse = await fetch(`${http.url}/counter`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ count: 7 }),
      });
      expect(setResponse.status).toBe(204);

      const getResponse = await fetch(`${http.url}/counter`);
      expect(getResponse.status).toBe(200);
      await expect(getResponse.json()).resolves.toEqual({ count: 7 });
    } finally {
      await http.stop();
      await runtime.stop();
    }
  });

  it('removes the opposite one-shot HTTP listen listener after success', async () => {
    const fakeServer = new FakeHttpServer(
      { address: '127.0.0.1', family: 'IPv4', port: 4401 },
      () => {
        fakeServer.emit('listening');
      }
    );
    createServerMock.mockImplementationOnce(() => fakeServer as never);

    const http = await serveActorWebHttp({
      getActor: () => undefined,
      requireActor: () => {
        throw new Error('not used');
      },
    } as never).listen();

    expect(http.url).toBe('http://127.0.0.1:4401');
    expect(fakeServer.listenerCount('listening')).toBe(0);
    expect(fakeServer.listenerCount('error')).toBe(0);
  });

  it('removes the opposite one-shot HTTP listen listener after error', async () => {
    const fakeServer = new FakeHttpServer(
      { address: '127.0.0.1', family: 'IPv4', port: 4402 },
      () => {
        fakeServer.emit('error', new Error('listen failed'));
      }
    );
    createServerMock.mockImplementationOnce(() => fakeServer as never);

    await expect(
      serveActorWebHttp({
        getActor: () => undefined,
        requireActor: () => {
          throw new Error('not used');
        },
      } as never).listen()
    ).rejects.toThrow('listen failed');

    expect(fakeServer.listenerCount('listening')).toBe(0);
    expect(fakeServer.listenerCount('error')).toBe(0);
  });
});
