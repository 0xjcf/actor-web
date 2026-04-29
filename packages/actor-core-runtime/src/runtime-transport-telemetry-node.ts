import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  RuntimeTransportTelemetryEvent,
  RuntimeTransportTelemetrySink,
} from './runtime-transport-telemetry.js';
import { serializeRuntimeTransportTelemetryEvent } from './runtime-transport-telemetry.js';

export interface RuntimeTransportTelemetryJsonlFileSinkOptions {
  readonly append?: boolean;
}

export function createRuntimeTransportTelemetryJsonlFileSink(
  filePath: string,
  options: RuntimeTransportTelemetryJsonlFileSinkOptions = {}
): RuntimeTransportTelemetrySink {
  const directory = dirname(filePath);
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }

  if (!options.append) {
    writeFileSync(filePath, '');
  }

  return {
    write(event: RuntimeTransportTelemetryEvent): void {
      appendFileSync(filePath, `${serializeRuntimeTransportTelemetryEvent(event)}\n`);
    },
  };
}
