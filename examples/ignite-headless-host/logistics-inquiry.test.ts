// @vitest-environment node
import { createLlmProvider } from '@actor-web/agent';
import { expect, it, vi } from 'vitest';
import { runShipmentInquiry } from './logistics-inquiry';

const shipment = {
  shipmentId: 'SHIP-42',
  status: 'route-assigned',
  providerFacility: 'East Depot',
} as const;
const providerFor = (fetch: typeof globalThis.fetch) =>
  createLlmProvider({
    endpoint: 'https://example.invalid/v1/chat/completions',
    model: 'scripted',
    fetch,
  });

function call(id: string, name: string, input: Record<string, string>) {
  const tool_calls = [
    { id, type: 'function', function: { name, arguments: JSON.stringify(input) } },
  ];
  return Response.json({
    choices: [{ message: { role: 'assistant', content: null, tool_calls } }],
  });
}

it('puts examples in native tool descriptions and keeps only observed shipment facts in history', async () => {
  const summary =
    'SHIP-42: route assigned. Last known facility: East Depot. No active alerts reported.';
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      call('lookup', 'get_shipment_status', { tracking_id: shipment.shipmentId })
    )
    .mockImplementationOnce(async (_url, init) => {
      const observation = JSON.parse(String(init?.body)).messages.at(-1);
      const { facility } = JSON.parse(observation.content).output;
      return call('alerts', 'check_facility_alerts', { facility_name: facility });
    })
    .mockResolvedValueOnce(
      Response.json({ choices: [{ message: { role: 'assistant', content: summary } }] })
    );
  await expect(runShipmentInquiry(shipment, [], providerFor(fetch))).resolves.toBe(summary);

  const [first, second, third] = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(first.messages).toEqual([
    {
      role: 'system',
      content: expect.stringMatching(/get_shipment_status[\s\S]+check_facility_alerts/),
    },
    { role: 'user', content: '{"tracking_id":"SHIP-42"}' },
  ]);
  expect(first.messages[0].content).toContain('Examples in tool descriptions are not observations');
  expect(first.tools).toMatchObject([
    {
      type: 'function',
      function: { name: 'get_shipment_status', parameters: { required: ['tracking_id'] } },
    },
    {
      type: 'function',
      function: { name: 'check_facility_alerts', parameters: { required: ['facility_name'] } },
    },
  ]);
  const examples = (description: string) => {
    const [, label, ...pairs] = description.split('\n');
    expect(label).toContain('not observations from this task');
    return pairs.map((pair) => JSON.parse(pair));
  };
  expect(examples(first.tools[0].function.description)).toEqual([
    {
      input: { tracking_id: 'EXAMPLE-1' },
      result: { facility: 'Example Yard', status: 'in-transit' },
    },
  ]);
  expect(examples(first.tools[1].function.description)).toEqual([
    {
      input: { facility_name: 'Example Yard' },
      result: { alerts: ['Loading suspended by weather.'] },
    },
    { input: { facility_name: 'Example Dock' }, result: { alerts: [] } },
  ]);
  expect(second.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'lookup' });
  expect(JSON.parse(second.messages.at(-1).content)).toEqual({
    ok: true,
    output: { facility: 'East Depot', status: 'route-assigned' },
  });
  expect(third.messages.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'alerts' });
  expect(JSON.parse(third.messages.at(-1).content)).toEqual({ ok: true, output: { alerts: [] } });
  expect(JSON.stringify(third.messages)).not.toMatch(
    /EXAMPLE-1|Example Yard|Example Dock|Loading suspended/
  );
});

it('can finish from a status observation without claiming an alert lookup when the facility is unknown', async () => {
  const summary = 'Route assigned. Facility unknown; alerts were not checked.';
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      call('lookup', 'get_shipment_status', { tracking_id: shipment.shipmentId })
    )
    .mockImplementationOnce(async (_url, init) => {
      const { messages } = JSON.parse(String(init?.body));
      expect(messages[0].content).toContain('skip the alert lookup');
      expect(JSON.parse(messages.at(-1).content).output).toEqual({
        status: shipment.status,
        facility: null,
      });
      return Response.json({ choices: [{ message: { role: 'assistant', content: summary } }] });
    });
  await expect(
    runShipmentInquiry({ ...shipment, providerFacility: null }, [], providerFor(fetch))
  ).resolves.toBe(summary);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it('refuses a lookup using the illustrative facility instead of the assigned one', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      call('alerts', 'check_facility_alerts', { facility_name: 'Example Yard' })
    );
  await expect(runShipmentInquiry(shipment, [], providerFor(fetch))).rejects.toMatchObject({
    code: 'LOOKUP_DENIED',
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
