import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { ActorRef } from './actor-ref.js';
import type { ServedNode } from './serve-actor-web-node.js';
import type {
  ActorContextOf,
  ActorDescriptor,
  ActorMessageOf,
  Topology,
  TopologyInput,
} from './topology.js';

export type HttpMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT';

export type HttpActors<TTopology extends Topology<TopologyInput>> = {
  readonly [TKey in keyof TTopology['actors'] & string]: ActorRef<
    ActorContextOf<TTopology['actors'][TKey]>,
    ActorMessageOf<TTopology['actors'][TKey]>
  >;
};

export interface HttpRequest {
  readonly raw: IncomingMessage;
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface HttpResponseResult {
  readonly handled: true;
}

export interface HttpResponse {
  json(statusCode: number, body: unknown): HttpResponseResult;
  ok(body: unknown): HttpResponseResult;
  accepted(body: unknown): HttpResponseResult;
  created(body: unknown): HttpResponseResult;
  noContent(): HttpResponseResult;
  badRequest(body: unknown): HttpResponseResult;
  notFound(body: unknown): HttpResponseResult;
  error(error: unknown): HttpResponseResult;
}

export interface HttpContext<TTopology extends Topology<TopologyInput>> {
  readonly runtime: ServedNode<TTopology>;
  readonly actors: HttpActors<TTopology>;
}

export interface BoundHttpContext<
  TTopology extends Topology<TopologyInput>,
  TActor extends ActorDescriptor,
> extends HttpContext<TTopology> {
  readonly actor: ActorRef<ActorContextOf<TActor>, ActorMessageOf<TActor>>;
}

export type HttpHandler<TTopology extends Topology<TopologyInput>> = (
  request: HttpRequest,
  response: HttpResponse,
  context: HttpContext<TTopology>
) => HttpResponseResult | undefined | Promise<HttpResponseResult | undefined>;

export type BoundHttpHandler<
  TTopology extends Topology<TopologyInput>,
  TActor extends ActorDescriptor,
> = (
  request: HttpRequest,
  response: HttpResponse,
  context: BoundHttpContext<TTopology, TActor>
) => HttpResponseResult | undefined | Promise<HttpResponseResult | undefined>;

export interface HttpListenOptions {
  readonly host?: string;
  readonly port?: number;
}

export interface ServedHttp {
  readonly url: string;
  stop(): Promise<void>;
}

export interface HttpRouter<TTopology extends Topology<TopologyInput>> {
  get(path: string, handler: HttpHandler<TTopology>): HttpRouter<TTopology>;
  post(path: string, handler: HttpHandler<TTopology>): HttpRouter<TTopology>;
  put(path: string, handler: HttpHandler<TTopology>): HttpRouter<TTopology>;
  patch(path: string, handler: HttpHandler<TTopology>): HttpRouter<TTopology>;
  delete(path: string, handler: HttpHandler<TTopology>): HttpRouter<TTopology>;
  for<TKey extends keyof TTopology['actors'] & string>(
    actor: TTopology['actors'][TKey]
  ): BoundHttpRouter<TTopology, TTopology['actors'][TKey]>;
  listen(options?: HttpListenOptions): Promise<ServedHttp>;
}

export interface BoundHttpRouter<
  TTopology extends Topology<TopologyInput>,
  TActor extends ActorDescriptor,
> {
  get(
    path: string,
    handler: BoundHttpHandler<TTopology, TActor>
  ): BoundHttpRouter<TTopology, TActor>;
  post(
    path: string,
    handler: BoundHttpHandler<TTopology, TActor>
  ): BoundHttpRouter<TTopology, TActor>;
  put(
    path: string,
    handler: BoundHttpHandler<TTopology, TActor>
  ): BoundHttpRouter<TTopology, TActor>;
  patch(
    path: string,
    handler: BoundHttpHandler<TTopology, TActor>
  ): BoundHttpRouter<TTopology, TActor>;
  delete(
    path: string,
    handler: BoundHttpHandler<TTopology, TActor>
  ): BoundHttpRouter<TTopology, TActor>;
  for<TKey extends keyof TTopology['actors'] & string>(
    actor: TTopology['actors'][TKey]
  ): BoundHttpRouter<TTopology, TTopology['actors'][TKey]>;
  listen(options?: HttpListenOptions): Promise<ServedHttp>;
}

type Route<TTopology extends Topology<TopologyInput>> = {
  readonly method: HttpMethod;
  readonly matcher: RouteMatcher;
  readonly handler: HttpHandler<TTopology>;
};

type RouteMatcher = {
  readonly path: string;
  match(pathname: string): Record<string, string> | null;
};

const handled: HttpResponseResult = { handled: true };

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

function createResponse(response: ServerResponse): HttpResponse {
  const sendJson = (statusCode: number, body: unknown): HttpResponseResult => {
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

function createActorAccess<TTopology extends Topology<TopologyInput>>(
  runtime: ServedNode<TTopology>
): HttpActors<TTopology> {
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
  ) as HttpActors<TTopology>;
}

function createBoundHandler<
  TTopology extends Topology<TopologyInput>,
  TKey extends keyof TTopology['actors'] & string,
>(
  runtime: ServedNode<TTopology>,
  actor: TTopology['actors'][TKey],
  handler: BoundHttpHandler<TTopology, TTopology['actors'][TKey]>
): HttpHandler<TTopology> {
  return (request, response, context) => {
    const actorRef = runtime.requireActor(actor.key as TKey);

    return handler(request, response, {
      ...context,
      actor: actorRef,
    });
  };
}

export function serveHttp<TTopology extends Topology<TopologyInput>>(
  runtime: ServedNode<TTopology>
): HttpRouter<TTopology> {
  const routes: Route<TTopology>[] = [];
  const actors = createActorAccess(runtime);

  const addRoute = (
    method: HttpMethod,
    path: string,
    handler: HttpHandler<TTopology>
  ): HttpRouter<TTopology> => {
    routes.push({ method, matcher: compileRoutePath(path), handler });
    return router;
  };

  const routeMethod = (method: HttpMethod) => {
    return (path: string, handler: HttpHandler<TTopology>) => addRoute(method, path, handler);
  };

  const boundRouteMethod = <TKey extends keyof TTopology['actors'] & string>(
    boundRouter: BoundHttpRouter<TTopology, TTopology['actors'][TKey]>,
    actor: TTopology['actors'][TKey],
    method: HttpMethod
  ) => {
    return (path: string, handler: BoundHttpHandler<TTopology, TTopology['actors'][TKey]>) =>
      addBoundRoute(boundRouter, method, path, createBoundHandler(runtime, actor, handler));
  };

  const addBoundRoute = <TActor extends ActorDescriptor>(
    boundRouter: BoundHttpRouter<TTopology, TActor>,
    method: HttpMethod,
    path: string,
    handler: HttpHandler<TTopology>
  ): BoundHttpRouter<TTopology, TActor> => {
    routes.push({ method, matcher: compileRoutePath(path), handler });
    return boundRouter;
  };

  const router: HttpRouter<TTopology> = {
    get: routeMethod('GET'),
    post: routeMethod('POST'),
    put: routeMethod('PUT'),
    patch: routeMethod('PATCH'),
    delete: routeMethod('DELETE'),
    for(actor) {
      const boundRouter = {} as BoundHttpRouter<TTopology, typeof actor>;
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
    async listen(options: HttpListenOptions = {}) {
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

async function handleRequest<TTopology extends Topology<TopologyInput>>(
  runtime: ServedNode<TTopology>,
  actors: HttpActors<TTopology>,
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

    const request: HttpRequest = {
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

function listen(server: Server, options: Required<HttpListenOptions>): Promise<string> {
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

export type {
  /** @deprecated Use BoundHttpContext instead. */
  BoundHttpContext as ActorWebBoundHttpContext,
  /** @deprecated Use BoundHttpHandler instead. */
  BoundHttpHandler as ActorWebBoundHttpHandler,
  /** @deprecated Use BoundHttpRouter instead. */
  BoundHttpRouter as ActorWebBoundHttpRouter,
  /** @deprecated Use HttpActors instead. */
  HttpActors as ActorWebHttpActors,
  /** @deprecated Use HttpContext instead. */
  HttpContext as ActorWebHttpContext,
  /** @deprecated Use HttpHandler instead. */
  HttpHandler as ActorWebHttpHandler,
  /** @deprecated Use HttpListenOptions instead. */
  HttpListenOptions as ActorWebHttpListenOptions,
  /** @deprecated Use HttpMethod instead. */
  HttpMethod as ActorWebHttpMethod,
  /** @deprecated Use HttpRequest instead. */
  HttpRequest as ActorWebHttpRequest,
  /** @deprecated Use HttpResponse instead. */
  HttpResponse as ActorWebHttpResponse,
  /** @deprecated Use HttpResponseResult instead. */
  HttpResponseResult as ActorWebHttpResponseResult,
  /** @deprecated Use HttpRouter instead. */
  HttpRouter as ActorWebHttpRouter,
  /** @deprecated Use ServedHttp instead. */
  ServedHttp as ServedActorWebHttp,
};
export {
  /** @deprecated Use serveHttp instead. */
  serveHttp as serveActorWebHttp,
};
