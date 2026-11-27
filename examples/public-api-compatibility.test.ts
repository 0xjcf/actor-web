import { ACTOR_WEB_LLM_TOOL_NAME, LLM_TOOL_NAME } from '@actor-web/agent';
import * as runtime from '@actor-web/runtime';
import * as browser from '@actor-web/runtime/browser';
import * as server from '@actor-web/runtime/node';
import * as topology from '@actor-web/runtime/topology';
import { expect, expectTypeOf, it } from 'vitest';

it('keeps old imports as aliases, without wrapping functions or changing the tool ID', () => {
  expect(topology.defineActorWebTopology).toBe(topology.defineTopology);
  expect(runtime.defineActorWebTopology).toBe(runtime.defineTopology);
  expect(browser.startActorWebNode).toBe(browser.startNode);
  expect(server.serveActorWebHttp).toBe(server.serveHttp);
  for (const entry of [runtime, browser]) {
    expect(entry.createActorWebClient).toBe(entry.createClient);
    expect(entry.createActorWebReadModelClient).toBe(entry.createReadModelClient);
  }
  for (const entry of [runtime, browser, server]) {
    expect(entry.createActorWebSource).toBe(entry.createGatewaySource);
    expect(entry.createActorWebReadModelSource).toBe(entry.createGatewayReadModelSource);
    expect(entry.createActorWebCommandSource).toBe(entry.createGatewayCommandSource);
    expect(entry.createActorWebTraceSource).toBe(entry.createGatewayTraceSource);
    expect(entry.createActorWebSourceHandle).toBe(entry.createSourceHandle);
  }
  expect(LLM_TOOL_NAME).toBe('llm');
  expect(ACTOR_WEB_LLM_TOOL_NAME).toBe(LLM_TOOL_NAME);
});

it('preserves actor inference and reuses the runtime address and supervision types', () => {
  type Command = { type: 'READ' };
  const app = topology.defineTopology({
    nodes: { local: topology.node('local') },
    actors: {
      reader: topology.actor({
        id: 'reader',
        node: 'local',
        behavior: runtime
          .defineBehavior<Command>()
          .withContext({ count: 0 })
          .onMessage(() => {}),
      }),
    },
  });
  type Reader = typeof app.actors.reader;
  expectTypeOf<topology.ActorMessageOf<Reader>>().toEqualTypeOf<Command>();
  expectTypeOf<topology.ActorWebActorMessage<Reader>>().toEqualTypeOf<Command>();
  expectTypeOf<topology.ActorContextOf<Reader>>().toEqualTypeOf<{ count: number }>();
  expectTypeOf<topology.ActorAddress>().toEqualTypeOf<runtime.ActorAddress>();
  expectTypeOf<topology.ActorWebSupervisionStrategy>().toEqualTypeOf<runtime.ActorSupervisionStrategy>();
  expectTypeOf<topology.ActorSupervisionPolicy>().toEqualTypeOf<runtime.ActorSupervisionPolicy>();
  expectTypeOf<topology.ActorSupervisionStrategy>().not.toEqualTypeOf<runtime.SupervisionStrategy>();
});
