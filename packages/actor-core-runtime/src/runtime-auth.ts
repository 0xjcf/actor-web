export interface RuntimeTransportAuthPayload {
  readonly scheme?: string;
  readonly token?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

export type RuntimeTransportAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type RuntimeTransportAuthVerifier<TInput> = (
  input: TInput & {
    readonly auth?: RuntimeTransportAuthPayload;
    readonly token?: string;
  }
) => boolean | RuntimeTransportAuthResult | Promise<boolean | RuntimeTransportAuthResult>;

export interface RuntimeTransportAuthProvider<TVerifyInput = object> {
  readonly token?:
    | string
    | RuntimeTransportAuthPayload
    | (() =>
        | string
        | RuntimeTransportAuthPayload
        | undefined
        | Promise<string | RuntimeTransportAuthPayload | undefined>);
  readonly verifyToken?: RuntimeTransportAuthVerifier<TVerifyInput>;
  readonly verify?: RuntimeTransportAuthVerifier<TVerifyInput>;
}

export type RuntimeGatewayAuthResult<TAuthContext = unknown> =
  | { readonly ok: true; readonly authContext?: TAuthContext }
  | { readonly ok: false; readonly reason: string };

export type RuntimeGatewayAuthVerifier<TInput = object, TAuthContext = unknown> = (
  input: TInput & {
    readonly auth?: RuntimeTransportAuthPayload;
    readonly token?: string;
  }
) =>
  | boolean
  | RuntimeGatewayAuthResult<TAuthContext>
  | Promise<boolean | RuntimeGatewayAuthResult<TAuthContext>>;

export interface RuntimeGatewayAuthProvider<TVerifyInput = object, TAuthContext = unknown> {
  readonly token?:
    | string
    | RuntimeTransportAuthPayload
    | (() =>
        | string
        | RuntimeTransportAuthPayload
        | undefined
        | Promise<string | RuntimeTransportAuthPayload | undefined>);
  readonly verifyToken?: RuntimeGatewayAuthVerifier<TVerifyInput, TAuthContext>;
  readonly verify?: RuntimeGatewayAuthVerifier<TVerifyInput, TAuthContext>;
}

export async function resolveRuntimeAuthPayload<TInput = unknown>(
  auth: RuntimeTransportAuthProvider<TInput> | RuntimeGatewayAuthProvider<TInput> | undefined
): Promise<RuntimeTransportAuthPayload | undefined> {
  if (!auth?.token) {
    return undefined;
  }

  const token = typeof auth.token === 'function' ? await auth.token() : auth.token;
  if (!token) {
    return undefined;
  }

  if (typeof token === 'string') {
    return { scheme: 'token', token };
  }

  return sanitizeRuntimeAuthPayload(token);
}

export function sanitizeRuntimeAuthPayload(
  auth: RuntimeTransportAuthPayload
): RuntimeTransportAuthPayload {
  return {
    ...(auth.scheme ? { scheme: auth.scheme } : {}),
    ...(auth.token ? { token: auth.token } : {}),
    ...(auth.metadata ? { metadata: { ...auth.metadata } } : {}),
  };
}

export async function verifyRuntimeAuth<TInput>(
  provider: RuntimeTransportAuthProvider<TInput> | RuntimeGatewayAuthProvider<TInput> | undefined,
  input: TInput & { readonly auth?: RuntimeTransportAuthPayload }
): Promise<RuntimeTransportAuthResult> {
  const verifier = provider?.verifyToken ?? provider?.verify;
  if (!verifier) {
    return { ok: true };
  }

  const result = await verifier({
    ...input,
    ...(input.auth ? { auth: input.auth, token: input.auth.token } : {}),
  });

  if (typeof result === 'boolean') {
    return result ? { ok: true } : { ok: false, reason: 'Authentication rejected.' };
  }

  return result.ok ? { ok: true } : { ok: false, reason: result.reason };
}

export async function verifyRuntimeGatewayAuth<TInput, TAuthContext>(
  provider: RuntimeGatewayAuthProvider<TInput, TAuthContext> | undefined,
  input: TInput & { readonly auth?: RuntimeTransportAuthPayload }
): Promise<RuntimeGatewayAuthResult<TAuthContext>> {
  const verifier = provider?.verifyToken ?? provider?.verify;
  if (!verifier) {
    return { ok: true };
  }

  const result = await verifier({
    ...input,
    ...(input.auth ? { auth: input.auth, token: input.auth.token } : {}),
  });

  if (typeof result === 'boolean') {
    return result ? { ok: true } : { ok: false, reason: 'Authentication rejected.' };
  }

  return result.ok
    ? { ok: true, ...('authContext' in result ? { authContext: result.authContext } : {}) }
    : { ok: false, reason: result.reason };
}
