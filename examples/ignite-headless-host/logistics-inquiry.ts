import type { ActorAgentLlmProvider } from '@actor-web/agent';
import { ActorRuntimeError, createActorRuntime } from '@actor-web/agent/actor-runtime';
import { type AgentTool, type AgentToolExample, createAgent } from '@actor-web/agent/portable';
import type { ShipmentContext } from './logistics-contract';

function lookup(
  name: string,
  parameter: string,
  description: string,
  examples: AgentToolExample[]
) {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: { [parameter]: { type: 'string' } },
      required: [parameter],
      additionalProperties: false,
    },
    examples,
  } satisfies AgentTool;
}

const status = lookup(
  'get_shipment_status',
  'tracking_id',
  'Read a shipment’s status and last known facility.',
  [
    {
      input: { tracking_id: 'EXAMPLE-1' },
      result: { status: 'in-transit', facility: 'Example Yard' },
    },
  ]
);
const alerts = lookup(
  'check_facility_alerts',
  'facility_name',
  'List active alerts for a facility.',
  [
    {
      input: { facility_name: 'Example Yard' },
      result: { alerts: ['Loading suspended by weather.'] },
    },
    { input: { facility_name: 'Example Dock' }, result: { alerts: [] } },
  ]
);

const definition = {
  purpose: 'shipment-inquiry' as const,
  systemPrompt:
    'Look up the assigned shipment. If its facility is known, check alerts for the facility returned by the lookup. Summarize the observations; do not infer a delay or cause from an empty alert list.',
  tools: [status, alerts],
  parse: (text: string) => text,
};

function scopedArgument(key: string, expected: string | null) {
  return (input: unknown) => {
    const entries =
      input && typeof input === 'object' && !Array.isArray(input) ? Object.entries(input) : [];
    if (
      expected === null ||
      entries.length !== 1 ||
      entries[0][0] !== key ||
      entries[0][1] !== expected
    ) {
      throw new ActorRuntimeError('LOOKUP_DENIED', `Expected the assigned ${key}.`);
    }
    return { value: expected };
  };
}

/** Investigate one shipment snapshot; the host supplies the alert list for its facility. */
export function runShipmentInquiry(
  shipment: Pick<ShipmentContext, 'shipmentId' | 'status' | 'providerFacility'>,
  facilityAlerts: readonly string[],
  provider: ActorAgentLlmProvider,
  signal = new AbortController().signal
) {
  const { shipmentId, status: shipmentStatus, providerFacility } = shipment;
  if (!shipmentId) throw new Error('Select a shipment before starting an inquiry.');
  const currentAlerts = [...facilityAlerts];
  const runtime = createActorRuntime<{ tracking_id: string }, 'shipment-inquiry'>({
    definition,
    provider,
    toolExampleMode: 'description',
    encodeTask: ({ tracking_id }) => JSON.stringify({ tracking_id }),
    grants: [status.name, alerts.name],
    tools: [
      {
        name: status.name,
        validateInput: scopedArgument('tracking_id', shipmentId),
        execute: () => ({ status: shipmentStatus, facility: providerFacility }),
      },
      {
        name: alerts.name,
        validateInput: scopedArgument('facility_name', providerFacility),
        execute: () => ({ alerts: currentAlerts }),
      },
    ],
    limits: {
      runTimeoutMs: 15_000,
      askTimeoutMs: 5_000,
      providerTimeoutMs: 4_000,
      toolTimeoutMs: 500,
      maxToolCallsPerBatch: 1,
      maxToolAttempts: 2,
      maxModelTurns: 3,
      maxPayloadBytes: 32 * 1024,
    },
  });
  return createAgent(runtime, definition).run({ tracking_id: shipmentId, signal });
}
