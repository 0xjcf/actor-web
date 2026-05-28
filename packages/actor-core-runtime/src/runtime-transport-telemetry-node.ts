import { appendFile, mkdir, writeFile } from 'node:fs/promises';
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
  const initialized = mkdir(directory, { recursive: true }).then(async () => {
    if (!options.append) {
      await writeFile(filePath, '');
    }
  });

  return {
    async write(event: RuntimeTransportTelemetryEvent): Promise<void> {
      await initialized;
      await appendFile(filePath, `${serializeRuntimeTransportTelemetryEvent(event)}\n`);
    },
    async flush(): Promise<void> {
      await initialized;
    },
  };
}
