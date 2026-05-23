import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { ActorRef } from './actor-ref.js';
import type { ServedActorWebNode } from './serve-actor-web-node.js';
import type {
  ActorWebActorContext,
  ActorWebActorDescriptor,
  ActorWebActorMessage,
  ActorWebTopology,
  ActorWebTopologyInput,
} from './topology.js';

export type ActorWebHttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export type ActorWebHttpActors<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly [TKey in keyof TTopology['actors'] & string]: ActorRef<
    ActorWebActorContext<TTopology['actors'][TKey]>,
    ActorWebActorMessage<TTopology['actors'][TKey]>
  >;
};

export interface ActorWebHttpRequest {
  readonly raw: IncomingMessage;
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface ActorWebHttpResponseResult {
  readonly handled: true;
}

export interface ActorWebHttpResponse {
  json(statusCode: number, body: unknown): ActorWebHttpResponseResult;
  ok(body: unknown): ActorWebHttpResponseResult;
  accepted(body: unknown): ActorWebHttpResponseResult;
  created(body: unknown): ActorWebHttpResponseResult;
  noContent(): ActorWebHttpResponseResult;
  badRequest(body: unknown): ActorWebHttpResponseResult;
  notFound(body: unknown): ActorWebHttpResponseResult;
  error(error: unknown): ActorWebHttpResponseResult;
}

export interface ActorWebHttpContext<TTopology extends ActorWebTopology<ActorWebTopologyInput>> {
  readonly runtime: ServedActorWebNode<TTopology>;
  readonly actors: ActorWebHttpActors<TTopology>;
}

export interface ActorWebBoundHttpContext<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TActor extends ActorWebActorDescriptor,
> extends ActorWebHttpContext<TTopology> {
  readonly actor: ActorRef<ActorWebActorContext<TActor>, ActorWebActorMessage<TActor>>;
}

export type ActorWebHttpHandler<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = (
  request: ActorWebHttpRequest,
  response: ActorWebHttpResponse,
  actorWeb: ActorWebHttpContext<TTopology>
) => ActorWebHttpResponseResult | undefined | Promise<ActorWebHttpResponseResult | undefined>;

export type ActorWebBoundHttpHandler<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TActor extends ActorWebActorDescriptor,
> = (
  request: ActorWebHttpRequest,
  response: ActorWebHttpResponse,
  actorWeb: ActorWebBoundHttpContext<TTopology, TActor>
) => ActorWebHttpResponseResult | undefined | Promise<ActorWebHttpResponseResult | undefined>;

export interface ActorWebHttpListenOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface ServedActorWebHttp {
  readonly url: string;
  stop(): Promise<void>;
}

export interface ActorWebHttpRouter<TTopology extends ActorWebTopology<ActorWebTopologyInput>> {
  get(path: string, handler: ActorWebHttpHandler<TTopology>): ActorWebHttpRouter<TTopology>;
  post(path: string, handler: ActorWebHttpHandler<TTopology>): ActorWebHttpRouter<TTopology>;
  put(path: string, handler: ActorWebHttpHandler<TTopology>): ActorWebHttpRouter<TTopology>;
  patch(path: string, handler: ActorWebHttpHandler<TTopology>): ActorWebHttpRouter<TTopology>;
  delete(path: string, handler: ActorWebHttpHandler<TTopology>): ActorWebHttpRouter<TTopology>;
  for<TKey extends keyof TTopology['actors'] & string>(
    actor: TTopology['actors'][TKey]
  ): ActorWebBoundHttpRouter<TTopology, TTopology['actors'][TKey]>;
  listen(options?: ActorWebHttpListenOptions): Promise<ServedActorWebHttp>;
}

export interface ActorWebBoundHttpRouter<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TActor extends ActorWebActorDescriptor,
> {
  get(
    path: string,
    handler: ActorWebBoundHttpHandler<TTopology, TActor>
  ): ActorWebBoundHttpRouter<TTopology, TActor>;
  post(
    path: string,
    handler: ActorWebBoundHttpHandler<TTopology, TActor>
  ): ActorWebBoundHttpRouter<TTopology, TActor>;
  put(
    path: string,
    handler: ActorWebBoundHttpHandler<TTopology, TActor>
  ): ActorWebBoundHttpRouter<TTopology, TActor>;
  patch(
    path: string,
    handler: ActorWebBoundHttpHandler<TTopology, TActor>
  ): ActorWebBoundHttpRouter<TTopology, TActor>;
  delete(
    path: string,
    handler: ActorWebBoundHttpHandler<TTopology, TActor>
  ): ActorWebBoundHttpRouter<TTopology, TActor>;
  for<TKey extends keyof TTopology['actors'] & string>(
    actor: TTopology['actors'][TKey]
  ): ActorWebBoundHttpRouter<TTopology, TTopology['actors'][TKey]>;
  listen(options?: ActorWebHttpListenOptions): Promise<ServedActorWebHttp>;
}

type Route<TTopology extends ActorWebTopology<ActorWebTopologyInput>> = {
  readonly method: ActorWebHttpMethod;
  readonly matcher: RouteMatcher;
  readonly handler: ActorWebHttpHandler<TTopology>;
};

type RouteMatcher = {
  readonly path: string;
  match(pathname: string): Record<string, string> | null;
};

const handled: ActorWebHttpResponseResult = { handled: true };

function compileRoutePath(path: string): RouteMatcher {
  const names: string[] = [];
  const escaped = path
    .split('/')
    .map((part) => {
      if (part.startsWith(':') && part.length > 1) {
        names.push(part.slice(1));
        return '([^/]+)';
      }

      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  const pattern = new RegExp(`^${escaped}$`);

  return {
    path,
    match(pathname) {
      const match = pattern.exec(pathname);
      if (!match) {
        return null;
      }

      return Object.fromEntries(
        names.map((name, index) => [name, decodeURIComponent(match[index + 1] ?? '')])
      );
    },
  };
}

function createResponse(response: ServerResponse): ActorWebHttpResponse {
  const sendJson = (statusCode: number, body: unknown): ActorWebHttpResponseResult => {
    response.writeHead(statusCode, {
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-origin': '*',
      'content-type': 'application/json',
    });
    response.end(JSON.stringify(body));
    return handled;
  };

  return {
    json: sendJson,
    ok(body) {
      return sendJson(200, body);
    },
    accepted(body) {
      return sendJson(202, body);
    },
    created(body) {
      return sendJson(201, body);
    },
    noContent() {
      response.writeHead(204, {
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-origin': '*',
      });
      response.end();
      return handled;
    },
    badRequest(body) {
      return sendJson(400, body);
    },
    notFound(body) {
      return sendJson(404, body);
    },
    error(error) {
      return sendJson(500, {
        error: error instanceof Error ? error.message : String(error),
      });
    },
  };
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  const text = Buffer.concat(chunks).toString('utf8');
  const contentType = request.headers['content-type'];
  if (typeof contentType === 'string' && contentType.includes('application/json')) {
    return JSON.parse(text);
  }

  return text;
}

function createActorAccess<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  runtime: ServedActorWebNode<TTopology>
): ActorWebHttpActors<TTopology> {
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== 'string') {
          return undefined;
        }

        const actor = runtime.getActor(property as keyof TTopology['actors'] & string);
        if (!actor) {
          throw new Error(`Actor-Web HTTP route requested unknown actor "${property}".`);
        }

        return actor;
      },
    }
  ) as ActorWebHttpActors<TTopology>;
}

function createBoundHandler<
  TTopology extends ActorWebTopology<ActorWebTopologyInput>,
  TKey extends keyof TTopology['actors'] & string,
>(
  runtime: ServedActorWebNode<TTopology>,
  actor: TTopology['actors'][TKey],
  handler: ActorWebBoundHttpHandler<TTopology, TTopology['actors'][TKey]>
): ActorWebHttpHandler<TTopology> {
  return (request, response, actorWeb) => {
    const actorRef = runtime.requireActor(actor.key as TKey);

    return handler(request, response, {
      ...actorWeb,
      actor: actorRef,
    });
  };
}

export function serveActorWebHttp<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  runtime: ServedActorWebNode<TTopology>
): ActorWebHttpRouter<TTopology> {
  const routes: Route<TTopology>[] = [];
  const actors = createActorAccess(runtime);

  const addRoute = (
    method: ActorWebHttpMethod,
    path: string,
    handler: ActorWebHttpHandler<TTopology>
  ): ActorWebHttpRouter<TTopology> => {
    routes.push({ method, matcher: compileRoutePath(path), handler });
    return router;
  };

  const routeMethod = (method: ActorWebHttpMethod) => {
    return (path: string, handler: ActorWebHttpHandler<TTopology>) =>
      addRoute(method, path, handler);
  };

  const boundRouteMethod = <TKey extends keyof TTopology['actors'] & string>(
    boundRouter: ActorWebBoundHttpRouter<TTopology, TTopology['actors'][TKey]>,
    actor: TTopology['actors'][TKey],
    method: ActorWebHttpMethod
  ) => {
    return (
      path: string,
      handler: ActorWebBoundHttpHandler<TTopology, TTopology['actors'][TKey]>
    ) => addBoundRoute(boundRouter, method, path, createBoundHandler(runtime, actor, handler));
  };

  const addBoundRoute = <TActor extends ActorWebActorDescriptor>(
    boundRouter: ActorWebBoundHttpRouter<TTopology, TActor>,
    method: ActorWebHttpMethod,
    path: string,
    handler: ActorWebHttpHandler<TTopology>
  ): ActorWebBoundHttpRouter<TTopology, TActor> => {
    routes.push({ method, matcher: compileRoutePath(path), handler });
    return boundRouter;
  };

  const router: ActorWebHttpRouter<TTopology> = {
    get: routeMethod('GET'),
    post: routeMethod('POST'),
    put: routeMethod('PUT'),
    patch: routeMethod('PATCH'),
    delete: routeMethod('DELETE'),
    for(actor) {
      const boundRouter = {} as ActorWebBoundHttpRouter<TTopology, typeof actor>;
      Object.assign(boundRouter, {
        get: boundRouteMethod(boundRouter, actor, 'GET'),
        post: boundRouteMethod(boundRouter, actor, 'POST'),
        put: boundRouteMethod(boundRouter, actor, 'PUT'),
        patch: boundRouteMethod(boundRouter, actor, 'PATCH'),
        delete: boundRouteMethod(boundRouter, actor, 'DELETE'),
        for: router.for,
        listen: router.listen,
      });
      return boundRouter;
    },
    async listen(options: ActorWebHttpListenOptions = {}) {
      const server = createServer((request, response) => {
        void handleRequest(runtime, actors, routes, request, response);
      });
      const url = await listen(server, {
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 0,
      });

      return {
        url,
        async stop(): Promise<void> {
          await new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }

              resolve();
            });
          });
        },
      };
    },
  };

  return router;
}

async function handleRequest<TTopology extends ActorWebTopology<ActorWebTopologyInput>>(
  runtime: ServedActorWebNode<TTopology>,
  actors: ActorWebHttpActors<TTopology>,
  routes: readonly Route<TTopology>[],
  rawRequest: IncomingMessage,
  rawResponse: ServerResponse
): Promise<void> {
  const response = createResponse(rawResponse);
  try {
    if (rawRequest.method === 'OPTIONS') {
      response.noContent();
      return;
    }

    const url = new URL(rawRequest.url ?? '/', 'http://localhost');
    const method = (rawRequest.method ?? 'GET').toUpperCase();
    const routeMatch = routes
      .filter((route) => route.method === method)
      .map((route) => ({ route, params: route.matcher.match(url.pathname) }))
      .find((match) => match.params !== null);

    if (!routeMatch || !routeMatch.params) {
      response.notFound({ error: 'not found' });
      return;
    }

    const request: ActorWebHttpRequest = {
      raw: rawRequest,
      method,
      path: url.pathname,
      params: routeMatch.params,
      query: url.searchParams,
      headers: rawRequest.headers,
      body: await readBody(rawRequest),
    };

    await routeMatch.route.handler(request, response, { runtime, actors });
  } catch (error) {
    response.error(error);
  }
}

function listen(server: Server, options: Required<ActorWebHttpListenOptions>): Promise<string> {
  return new Promise((resolve, reject) => {
    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Actor-Web HTTP server did not expose a TCP address.'));
        return;
      }

      resolve(`http://${address.address}:${address.port}`);
    };
    const onError = (error: Error): void => {
      server.off('listening', onListening);
      reject(error);
    };

    server.once('listening', onListening);
    server.once('error', onError);
    server.listen(options.port, options.host);
  });
}
