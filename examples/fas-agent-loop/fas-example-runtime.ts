import type { ActorRef, GatewaySocket } from '@actor-web/runtime/browser';
import { type ServedNode, serveNode } from '@actor-web/runtime/node';
import { FAS_AGENT_TOOL_ACCESS, type FasAgentRole } from './fas-contract';
import { createFasTaskLoop, type FasAgentPorts } from './fas-task-loop';
import {
  createDeterministicFasTools,
  type DeterministicFasToolOptions,
  type DeterministicFasTools,
} from './fas-tool-adapters';
import { FAS_WORKER_NODE, fasAgentLoop } from './fas-topology';

export type { SubmitFasTaskInput } from './fas-task-loop';

export interface FasAgentLoopExampleOptions {
  readonly tools?: DeterministicFasToolOptions;
}

type FasServedNode = ServedNode<typeof fasAgentLoop>;
type GatewaySocketFactory = (url: string) => GatewaySocket;

export type FasAgentLoopExampleRuntime = ReturnType<typeof createFasTaskLoop> & {
  readonly tools: DeterministicFasTools;
  getRuntimeTopology(): FasAgentLoopRuntimeTopology;
};

export interface FasAgentLoopRuntimeTopology {
  readonly coordinatorNode: string;
  readonly workerNode: string;
  readonly gatewayUrl: string;
  readonly coordinatorTransportUrl: string;
  readonly workerTransportUrl: string;
  readonly workerPeer: ReturnType<FasServedNode['getPeerStatus']>;
  readonly toolPorts: Readonly<Record<FasAgentRole, readonly string[]>>;
}

function createFasTaskBoardSource(gatewayUrl: string, createSocket: GatewaySocketFactory) {
  return fasAgentLoop.actors.taskBoard.source({
    gateway: {
      url: gatewayUrl,
    },
    createSocket,
  });
}

async function resolveGatewaySocketFactory(): Promise<GatewaySocketFactory> {
  if (typeof globalThis.WebSocket !== 'undefined') {
    return (url) => new globalThis.WebSocket(url) as GatewaySocket;
  }

  const { WebSocket: NodeWebSocket } = await import('ws');
  return (url) => new NodeWebSocket(url) as unknown as GatewaySocket;
}

async function waitForWorkerPeer(coordinator: FasServedNode): Promise<void> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const status = coordinator.getPeerStatus(FAS_WORKER_NODE);
    if (status.connected && status.fresh) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for FAS worker runtime peer connection.');
}

async function requireRemoteActor<TRef extends ActorRef>(
  coordinator: FasServedNode,
  path: string,
  label: string
): Promise<TRef> {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const actorRef = await coordinator.system.lookup(path);
    if (actorRef) {
      return actorRef as TRef;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out resolving remote FAS actor "${label}".`);
}

async function createAgentPorts(coordinator: FasServedNode): Promise<FasAgentPorts> {
  const [planner, implementer, verifier, reviewer] = await Promise.all([
    requireRemoteActor<FasAgentPorts['planner']>(
      coordinator,
      fasAgentLoop.actors.plannerAgent.address,
      'plannerAgent'
    ),
    requireRemoteActor<FasAgentPorts['implementer']>(
      coordinator,
      fasAgentLoop.actors.implementerAgent.address,
      'implementerAgent'
    ),
    requireRemoteActor<FasAgentPorts['verifier']>(
      coordinator,
      fasAgentLoop.actors.verifierAgent.address,
      'verifierAgent'
    ),
    requireRemoteActor<FasAgentPorts['reviewer']>(
      coordinator,
      fasAgentLoop.actors.reviewerAgent.address,
      'reviewerAgent'
    ),
  ]);

  return {
    planner,
    implementer,
    verifier,
    reviewer,
  };
}

export async function startFasAgentLoopExample(
  options: FasAgentLoopExampleOptions = {}
): Promise<FasAgentLoopExampleRuntime> {
  const tools = createDeterministicFasTools(options.tools);
  const worker = await serveNode(fasAgentLoop, {
    node: 'worker',
    transport: true,
    tools: tools.registry,
  });
  const coordinator = await serveNode(fasAgentLoop, {
    node: 'coordinator',
    transport: true,
    peers: {
      worker: worker.getTransportUrl() ?? '',
    },
    connect: ['worker'],
    gateway: {
      expose: ['taskBoard'],
    },
  });
  await waitForWorkerPeer(coordinator);
  const agents = await createAgentPorts(coordinator);
  const gatewayUrl = coordinator.getGatewayUrl();
  const coordinatorTransportUrl = coordinator.getTransportUrl();
  const workerTransportUrl = worker.getTransportUrl();
  if (!gatewayUrl || !coordinatorTransportUrl || !workerTransportUrl) {
    await coordinator.stop();
    await worker.stop();
    throw new Error('FAS agent loop runtime did not expose required gateway and transport URLs.');
  }
  const createSocket = await resolveGatewaySocketFactory();
  return {
    tools,
    ...createFasTaskLoop({
      coordinator,
      worker,
      agents,
      createTaskBoardSource: () => createFasTaskBoardSource(gatewayUrl, createSocket),
      stop: async () => {
        await coordinator.stop();
        await worker.stop();
      },
    }),
    getRuntimeTopology: () => ({
      coordinatorNode: fasAgentLoop.nodes.coordinator.address,
      workerNode: fasAgentLoop.nodes.worker.address,
      gatewayUrl,
      coordinatorTransportUrl,
      workerTransportUrl,
      workerPeer: coordinator.getPeerStatus(FAS_WORKER_NODE),
      toolPorts: {
        supervisor: [],
        planner: FAS_AGENT_TOOL_ACCESS.planner,
        implementer: FAS_AGENT_TOOL_ACCESS.implementer,
        verifier: FAS_AGENT_TOOL_ACCESS.verifier,
        reviewer: FAS_AGENT_TOOL_ACCESS.reviewer,
      },
    }),
  };
}
