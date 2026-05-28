import { mkdtempSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createInMemoryRuntimeTransportTelemetrySink,
  createRuntimeTransportTelemetryExporter,
  type RuntimeTransportTelemetryEvent,
  serializeRuntimeTransportTelemetryEvent,
} from '../runtime-transport-telemetry.js';
import { createRuntimeTransportTelemetryJsonlFileSink } from '../runtime-transport-telemetry-node.js';

const testEvent: RuntimeTransportTelemetryEvent = {
  type: 'peer.connected',
  nodeAddress: 'server-node',
  peerNodeAddress: 'worker-node',
  timestamp: '2026-04-29T00:00:00.000Z',
};

describe('runtime transport telemetry export', () => {
  const tempDirectories: string[] = [];

  afterEach(() => {
    for (const directory of tempDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('exports transport telemetry events to an in-memory sink as snapshots', async () => {
    const sink = createInMemoryRuntimeTransportTelemetrySink();
    const exporter = createRuntimeTransportTelemetryExporter({ sink });

    exporter.observe(testEvent);
    await exporter.flush();

    expect(sink.getEvents()).toEqual([testEvent]);
    const events = sink.getEvents();
    (events[0] as RuntimeTransportTelemetryEvent).reason = 'mutated';
    expect(sink.getEvents()[0]).toEqual(testEvent);
  });

  it('tracks dropped events when sink writes fail', async () => {
    const errors: unknown[] = [];
    const exporter = createRuntimeTransportTelemetryExporter({
      sink: {
        write() {
          throw new Error('sink unavailable');
        },
      },
      onError: (error) => errors.push(error),
    });

    exporter.observe(testEvent);
    await exporter.flush();

    expect(exporter.getDroppedEventCount()).toBe(1);
    expect(errors).toHaveLength(1);
  });

  it('serializes events as one JSON object per line for durable sinks', () => {
    expect(JSON.parse(serializeRuntimeTransportTelemetryEvent(testEvent))).toEqual(testEvent);
  });

  it('preserves additive idempotency telemetry fields during serialization', () => {
    expect(
      JSON.parse(
        serializeRuntimeTransportTelemetryEvent({
          ...testEvent,
          type: 'frame.dropped',
          reason: 'provider unavailable',
          dropCode: 'idempotency_provider_error',
          idempotencyScope:
            'runtime-transport:local:server-node:server-node:peer:worker-node:worker-node',
          idempotencyKey:
            'runtime-transport:local:server-node:server-node:peer:worker-node:worker-node:message:message-1',
        })
      )
    ).toMatchObject({
      type: 'frame.dropped',
      reason: 'provider unavailable',
      dropCode: 'idempotency_provider_error',
      idempotencyScope:
        'runtime-transport:local:server-node:server-node:peer:worker-node:worker-node',
      idempotencyKey:
        'runtime-transport:local:server-node:server-node:peer:worker-node:worker-node:message:message-1',
    });
  });

  it('writes Node telemetry JSONL files without requiring an observability backend', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actor-web-telemetry-'));
    tempDirectories.push(directory);
    const filePath = join(directory, 'transport.jsonl');
    const sink = createRuntimeTransportTelemetryJsonlFileSink(filePath);
    const exporter = createRuntimeTransportTelemetryExporter({ sink });

    exporter.observe(testEvent);
    exporter.observe({
      ...testEvent,
      type: 'frame.sent',
      messageType: 'PING',
      messageId: 'message-1',
    });
    await exporter.close();

    const lines = (await readFile(filePath, 'utf8')).trim().split('\n');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      testEvent,
      {
        ...testEvent,
        type: 'frame.sent',
        messageType: 'PING',
        messageId: 'message-1',
      },
    ]);
  });

  it('initializes append-disabled Node telemetry sinks through async fs APIs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'actor-web-telemetry-'));
    tempDirectories.push(directory);
    const filePath = join(directory, 'transport.jsonl');
    await writeFile(filePath, 'stale-data\n');

    const sink = createRuntimeTransportTelemetryJsonlFileSink(filePath);
    await sink.flush?.();

    expect(await readFile(filePath, 'utf8')).toBe('');

    await sink.write(testEvent);
    expect((await readFile(filePath, 'utf8')).trim()).toBe(
      serializeRuntimeTransportTelemetryEvent(testEvent)
    );
  });
});
