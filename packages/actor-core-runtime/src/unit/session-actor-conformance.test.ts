import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as browserEntry from '../browser.js';
import * as rootEntry from '../index.js';
import * as nodeEntry from '../node.js';
import { createNodeSessionActor } from '../node-session-actor.js';
import { describeSessionActorConformance } from '../testing/session-actor-conformance.js';

describeSessionActorConformance({
  name: 'node-only session actor',
  createScenario() {
    return {
      actor: createNodeSessionActor(),
      sessionId: 'session:001',
      providerId: 'provider:fake',
      firstTurnId: 'turn:001',
      secondTurnId: 'turn:002',
      openedAt: '2026-07-02T16:00:00.000Z',
      attachedAt: '2026-07-02T16:00:01.000Z',
      submittedAt: '2026-07-02T16:00:02.000Z',
      deltaObservedAt: '2026-07-02T16:00:03.000Z',
      completedAt: '2026-07-02T16:00:04.000Z',
      cancelledAt: '2026-07-02T16:00:05.000Z',
      failedAt: '2026-07-02T16:00:06.000Z',
      closedAt: '2026-07-02T16:00:07.000Z',
    };
  },
});

describe('node session actor exports', () => {
  it('exports the session actor only from the node entrypoint', () => {
    expect(nodeEntry.createNodeSessionActor).toBeTypeOf('function');
    expect('createNodeSessionActor' in rootEntry).toBe(false);
    expect('createNodeSessionActor' in browserEntry).toBe(false);
  });

  it('keeps the new session actor sources free of fas-local imports', async () => {
    const contractPath = fileURLToPath(
      new URL('../node-session-actor-contract.ts', import.meta.url)
    );
    const actorPath = fileURLToPath(new URL('../node-session-actor.ts', import.meta.url));
    const [contractSource, actorSource] = await Promise.all([
      readFile(contractPath, 'utf8'),
      readFile(actorPath, 'utf8'),
    ]);

    expect(contractSource).not.toMatch(/fas-local/);
    expect(actorSource).not.toMatch(/fas-local/);
    expect(path.basename(contractPath)).toBe('node-session-actor-contract.ts');
    expect(path.basename(actorPath)).toBe('node-session-actor.ts');
  });
});
