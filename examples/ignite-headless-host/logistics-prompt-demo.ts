import { createLlmProvider } from '@actor-web/agent';
import { runShipmentInquiry } from './logistics-inquiry';

// Capture the serialized request at the fetch boundary without opening a connection.
const preview = createLlmProvider({
  endpoint: 'https://example.invalid/v1/chat/completions',
  model: 'offline-preview',
  fetch: async (_url, init) => {
    console.log(JSON.stringify(JSON.parse(String(init?.body)), null, 2));
    return Response.json({
      choices: [{ message: { role: 'assistant', content: 'Preview complete.' } }],
    });
  },
});

await runShipmentInquiry(
  { shipmentId: 'SHIP-42', status: 'route-assigned', providerFacility: 'East Depot' },
  [],
  preview
);
