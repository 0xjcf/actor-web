import { startControl } from './control.js';
import type { ControlConfig, WorkerConfig } from './peer.js';
import type { Lane } from './topology.js';
import { startWorker } from './worker.js';

export type Operation =
  | 'begin'
  | 'recover'
  | 'reconnect'
  | 'timeout'
  | 'lookup'
  | 'health'
  | 'stats'
  | 'stop';
type Command = { id: number; op: Operation; lane?: Lane };

// Private launcher IPC: configuration, fixture controls and evidence queries only.
// No check request or receipt is routed through the parent.
process.once('message', async (config: ControlConfig | WorkerConfig) => {
  try {
    const service =
      config.role === 'control' ? await startControl(config) : await startWorker(config);
    const shutdown = async () => {
      await service.stop();
      process.disconnect?.();
    };
    process.once('disconnect', () => process.exit());
    process.on('message', async ({ id, op, lane }: Command) => {
      try {
        if (op === 'stop') {
          await shutdown();
          return;
        }
        let value: unknown;
        if (op === 'stats') value = service.stats();
        else if (op === 'health' && 'health' in service) value = service.health();
        else if (op === 'reconnect' && 'reconnect' in service) await service.reconnect();
        else if ('begin' in service) {
          if (op === 'begin') await service.begin();
          else if (op === 'recover') await service.recover();
          else if ((op === 'lookup' || op === 'timeout') && lane) await service[op](lane);
          else throw new Error('Invalid control operation');
        } else throw new Error('Invalid worker operation');
        process.send?.({ id, value });
      } catch (error) {
        process.send?.({ id, error: String(error) });
      }
    });
    process.send?.({
      id: 0,
      value: {
        pid: process.pid,
        ...('begin' in service
          ? { transportUrl: service.transportUrl, gatewayUrl: service.gatewayUrl }
          : {}),
      },
    });
  } catch (error) {
    process.send?.({ id: 0, error: String(error) });
    process.disconnect?.();
  }
});
process.send?.({ boot: true });
