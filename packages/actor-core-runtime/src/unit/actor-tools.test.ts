import { describe, expect, it, vi } from 'vitest';
import type { ActorToolExecutor } from '../actor-tools.js';
import { createActorToolbox } from '../actor-tools.js';
import { actor, defineActorWebTopology, node, tool } from '../topology.js';

type ScanInput = { readonly label: string };
type ScanResult = { readonly accepted: true; readonly label: string };
type ScanCommand = { readonly type: 'SCAN'; readonly label: string };
type ShipmentParams = { readonly shipmentId: string };
type ScanTools = {
  readonly 'provider.scan.verify': ActorToolExecutor<ScanInput, ScanResult>;
  readonly 'provider.secret': ActorToolExecutor<{ readonly token: string }, string>;
};

describe('ActorToolbox', () => {
  it('executes typed tool ports with runtime context', async () => {
    const scan = vi.fn<ScanTools['provider.scan.verify']>((input, context) => ({
      accepted: true,
      label: `${context.actorId}:${input.label}`,
    }));
    const toolbox = createActorToolbox<ScanTools>(
      {
        'provider.scan.verify': scan,
        'provider.secret': () => 'hidden',
      },
      {
        actorId: 'actor://worker/scanner',
        nodeAddress: 'worker',
      },
      ['provider.scan.verify']
    );

    const result = await toolbox.execute('provider.scan.verify', { label: 'HVAC' });

    expect(result).toEqual({
      accepted: true,
      label: 'actor://worker/scanner:HVAC',
    });
    expect(scan).toHaveBeenCalledWith(
      { label: 'HVAC' },
      {
        actorId: 'actor://worker/scanner',
        nodeAddress: 'worker',
      }
    );
    expect(toolbox.list()).toEqual(['provider.scan.verify']);
    expect(toolbox.has('provider.secret')).toBe(false);
  });

  it('rejects unassigned registered tools with the unavailable-tool error', async () => {
    const toolbox = createActorToolbox<ScanTools>(
      {
        'provider.scan.verify': () => ({ accepted: true, label: 'ok' }),
        'provider.secret': () => 'hidden',
      },
      {
        actorId: 'actor://worker/scanner',
        nodeAddress: 'worker',
      },
      ['provider.scan.verify']
    );

    await expect(
      toolbox.execute('provider.secret', {
        token: 'operator-only',
      })
    ).rejects.toThrow('Actor tool "provider.secret" is not registered.');
  });

  it('narrows topology-authored actor builders from the declared allowlist', async () => {
    const scan = vi.fn<ScanTools['provider.scan.verify']>((input, context) => ({
      accepted: true,
      label: `${context.actorId}:${input.label}`,
    }));
    const scanActor = actor.withTools<ScanTools>()({
      id: 'scanner',
      node: 'worker',
      tools: ['provider.scan.verify'] as const,
      behavior: (defineBehavior) =>
        defineBehavior<ScanCommand, ScanResult>()
          .onMessage(async ({ message, tools }) => {
            return {
              reply: await tools.execute('provider.scan.verify', { label: message.label }),
            };
          })
          .build(),
    });
    const shipmentActor = actor.withTools<ScanTools>()({
      id: ({ shipmentId }: ShipmentParams) => `shipment-${shipmentId}`,
      node: 'worker',
      tools: ['provider.scan.verify'] as const,
      behavior: (_params: ShipmentParams, defineBehavior) =>
        defineBehavior<ScanCommand, ScanResult>()
          .onMessage(async ({ message, tools }) => {
            return {
              reply: await tools.execute('provider.scan.verify', { label: message.label }),
            };
          })
          .build(),
    });
    const topology = defineActorWebTopology({
      tools: [tool('provider.scan.verify')],
      nodes: {
        worker: node('worker'),
      },
      actors: {
        scanner: scanActor,
        shipment: shipmentActor,
      },
    });
    const nodeKey: 'worker' = topology.actors.scanner.node;
    const toolbox = createActorToolbox<ScanTools>(
      {
        'provider.scan.verify': scan,
        'provider.secret': () => 'hidden',
      },
      {
        actorId: 'actor://worker/scanner',
        nodeAddress: 'worker',
      },
      scanActor.tools
    );

    const result = await (
      scanActor.behavior as { onMessage?: (params: unknown) => Promise<unknown> | unknown }
    )?.onMessage?.({
      message: { type: 'SCAN', label: 'HVAC' },
      actor: {
        id: 'actor://worker/scanner',
        getSnapshot: () => ({ context: undefined }),
      },
      tools: toolbox,
    });

    expect(nodeKey).toBe('worker');
    expect(topology.actors.shipment.resolveId({ shipmentId: '1001' })).toBe('shipment-1001');
    expect(scanActor.tools).toEqual(['provider.scan.verify']);
    expect(result).toMatchObject({
      reply: {
        accepted: true,
        label: 'actor://worker/scanner:HVAC',
      },
    });
    expect(scan).toHaveBeenCalledOnce();
  });
});
