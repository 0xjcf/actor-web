export const clientTracePath = '/__actor-web/client-trace';

const fieldLimit = 700;

export interface ClientTraceRecord {
  readonly level: 'info' | 'error';
  readonly source: string;
  readonly message: string;
  readonly detail?: string;
  readonly stack?: string;
  readonly filename?: string;
  readonly line?: number;
  readonly column?: number;
}

declare global {
  interface Window {
    __ACTOR_WEB_CLIENT_TRACE__?: boolean;
  }
}

function clip(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value.length > fieldLimit ? `${value.slice(0, fieldLimit)}…` : value;
}

function clipRequired(value: unknown, fallback: string): string {
  return clip(value) ?? fallback;
}

export function clientTraceRecord(input: unknown): ClientTraceRecord {
  const record = input && typeof input === 'object' ? (input as Partial<ClientTraceRecord>) : {};
  const line =
    typeof record.line === 'number' && Number.isFinite(record.line) ? record.line : undefined;
  const column =
    typeof record.column === 'number' && Number.isFinite(record.column) ? record.column : undefined;
  const detail = clip(record.detail);
  const stack = clip(record.stack);
  const filename = clip(record.filename);
  return {
    level: record.level === 'info' ? 'info' : 'error',
    source: clipRequired(record.source, 'client'),
    message: clipRequired(record.message, 'client trace'),
    ...(detail ? { detail } : {}),
    ...(stack ? { stack } : {}),
    ...(filename ? { filename } : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}

export function formatClientTrace(record: ClientTraceRecord): string {
  const place = record.filename
    ? ` (${record.filename}${record.line ? `:${record.line}` : ''})`
    : '';
  const detail = record.detail ? ` ${record.detail}` : '';
  return `[actor-web:client] ${record.level} ${record.source}: ${record.message}${detail}${place}`;
}

export function acceptClientTraceBody(raw: string): {
  readonly status: number;
  readonly level: 'info' | 'error';
  readonly line: string;
} {
  try {
    const record = clientTraceRecord(JSON.parse(raw) as unknown);
    return { status: 204, level: record.level, line: formatClientTrace(record) };
  } catch {
    return {
      status: 400,
      level: 'error',
      line: '[actor-web:client] error dev-server: client trace was not json',
    };
  }
}

export function clientTraceBootstrapSource(): string {
  return `window.__ACTOR_WEB_CLIENT_TRACE__=true;(function(){var endpoint=${JSON.stringify(clientTracePath)};function send(record){try{fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(record),keepalive:true}).catch(function(){})}catch(e){}}window.addEventListener("error",function(event){send({level:"error",source:"window",message:String(event.message||"window error"),filename:event.filename||"",line:event.lineno,column:event.colno,stack:event.error&&event.error.stack||""})});window.addEventListener("unhandledrejection",function(event){var reason=event.reason;send({level:"error",source:"unhandledrejection",message:reason&&reason.message?String(reason.message):String(reason),stack:reason&&reason.stack||""})});})();`;
}

export function reportClientTrace(input: {
  readonly level: 'info' | 'error';
  readonly source: string;
  readonly message: string;
  readonly detail?: string;
  readonly stack?: string;
}): void {
  const record = clientTraceRecord(input);
  const line = formatClientTrace(record);
  if (record.level === 'error') {
    console.error(line);
  } else {
    console.info(line);
  }
  if (
    typeof window === 'undefined' ||
    window.__ACTOR_WEB_CLIENT_TRACE__ !== true ||
    typeof fetch !== 'function'
  ) {
    return;
  }
  void fetch(clientTracePath, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
    keepalive: true,
  }).catch(() => undefined);
}
