import { describe, expect, it, vi } from 'vitest';
import type { ActorToolExecutor } from '../actor-tools.js';
import { createActorToolbox } from '../actor-tools.js';

type ScanInput = { readonly label: string };
type ScanResult = { readonly accepted: true; readonly label: string };
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
        actorId: 'actor://worker/actor/scanner',
        nodeAddress: 'worker',
      },
      ['provider.scan.verify']
    );

    const result = await toolbox.execute('provider.scan.verify', { label: 'HVAC' });

    expect(result).toEqual({
      accepted: true,
      label: 'actor://worker/actor/scanner:HVAC',
    });
    expect(scan).toHaveBeenCalledWith(
      { label: 'HVAC' },
      {
        actorId: 'actor://worker/actor/scanner',
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
        actorId: 'actor://worker/actor/scanner',
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
});
