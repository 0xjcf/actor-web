import {
  createRuntimeGatewayReadModelSource,
  type RuntimeGatewayReadModelSource,
} from '@actor-web/runtime';
import { defineBehavior } from '@actor-web/runtime/browser';
import { serveNode } from '@actor-web/runtime/node';
import type { ReceiptLookupReply } from '../check-protocol.js';
import { expectOk } from '../definitions.js';
import { allocateDemoTeams, publishDemoDefinitions } from '../scenario.js';
import { matchesBinding, type ReceiptSignal } from '../task-check.js';
import { type AllocatedTeam, startTeams } from '../teams.js';
import { address, type CheckPacket, type ControlConfig, peerAuth } from './peer.js';
import { type Lane, lanes, targets, topology } from './topology.js';

async function openLane(
  app: Awaited<ReturnType<typeof startTeams>>,
  team: AllocatedTeam,
  lane: Lane
) {
  const attempt = expectOk(await app.beginAttempt(team.address, targets[lane]));
  const owner = await app.system.lookup(attempt.ownerAddress);
  if (!owner) throw new Error('Missing task owner');
  const progress = () => ({
    binding: attempt.execute.binding,
    ownerPhase: owner.getSnapshot().value,
    ...attempt.readStages(),
  });
  const view = await app.system.spawn(
    defineBehavior<{ type: 'REFRESH' }>()
      .withContext(progress())
      .onMessage(() => ({
        context: progress(),
        reply: { ok: true },
      })),
    { id: `${lane}-view` }
  );
  return {
    attempt,
    progress,
    source: createRuntimeGatewayReadModelSource(view),
    async deliver(signal: ReceiptSignal) {
      await attempt.deliver(signal);
      await view.ask({ type: 'REFRESH' });
    },
  };
}

export async function startControl(config: ControlConfig) {
  // Transport is a trust boundary: generic remote actor routing must not also
  // address the allocator, task owners, teams, or the writers of projections.
  const app = await startTeams();
  const sources = new Map<Lane, RuntimeGatewayReadModelSource>();
  const node = await serveNode<typeof topology, Lane>(topology, {
    node: 'control',
    transport: {
      listen: { host: '127.0.0.1', port: 0 },
      auth: peerAuth(
        config.token,
        new Map(lanes.map((lane) => [address(lane), config.peers[lane]]))
      ),
    },
    gateway: {
      host: '127.0.0.1',
      port: 0,
      expose: [],
      auth: {
        verifyToken({ token }) {
          const lane = lanes.find((key) => token && config.viewers[key] === token);
          return lane
            ? { ok: true, authContext: lane }
            : { ok: false, reason: 'Viewer not authorized' };
        },
      },
      resolveScope: async (scope, lane) =>
        lane && scope.kind === 'progress' && scope.params?.workspace === targets[lane].workspaceId
          ? (sources.get(lane) ?? null)
          : null,
    },
  });
  try {
    const teams = await allocateDemoTeams(app, publishDemoDefinitions(app.registry));
    const [checkout, profile] = await Promise.all([
      openLane(app, teams[0], 'checkout'),
      openLane(app, teams[1], 'profile'),
    ]);
    const runs = { checkout, profile };
    for (const lane of lanes) sources.set(lane, runs[lane].source);
    const queues = { checkout: Promise.resolve(), profile: Promise.resolve() };
    const unsubscribe = node.transport.subscribe(({ source, message }) => {
      if (message.type !== 'HOST_RECEIPT' && message.type !== 'RECEIPT_UNAVAILABLE') return;
      const lane = lanes.find((key) => source === address(key));
      if (!lane) return;
      const reply = message as ReceiptLookupReply;
      const { attempt, deliver } = runs[lane];
      const binding = reply.type === 'HOST_RECEIPT' ? reply.receipt : reply.binding;
      if (!matchesBinding(attempt.execute.binding, binding)) return;
      queues[lane] = queues[lane]
        .then(() =>
          deliver(
            reply.type === 'HOST_RECEIPT'
              ? { type: 'HOST_RECEIPT', receipt: reply.receipt }
              : { type: 'RECEIPT_TIMEOUT', attemptId: binding.attemptId }
          )
        )
        .catch(() => console.error('Control could not settle check response'));
    });
    let started = false;
    return {
      gatewayUrl: node.getGatewayUrl(),
      transportUrl: node.getTransportUrl(),
      async begin() {
        if (started) throw new Error('Checks already dispatched');
        started = true;
        await Promise.all(
          lanes.map((lane) => {
            const { execute, candidate } = runs[lane].attempt;
            const packet: CheckPacket = { ...execute, label: candidate.label };
            return node.transport.send(address(lane), packet);
          })
        );
      },
      timeout: (lane: Lane) =>
        runs[lane].deliver({
          type: 'RECEIPT_TIMEOUT',
          attemptId: runs[lane].attempt.execute.binding.attemptId,
        }),
      async lookup(lane: Lane) {
        const { trace, binding } = runs[lane].attempt.execute;
        const request = { type: 'LOOKUP_RECEIPT', trace, binding } as const;
        await node.transport.send(address(lane), request);
      },
      stats: () => ({ checkout: checkout.progress(), profile: profile.progress() }),
      async stop() {
        unsubscribe();
        await Promise.all(Object.values(queues));
        await node.stop();
        await app.stop();
      },
    };
  } catch (error) {
    await node.stop();
    await app.stop();
    throw error;
  }
}
