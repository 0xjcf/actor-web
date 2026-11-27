import type { ActorAgentLlmProvider, ActorAgentLlmResult } from '@actor-web/agent';
import { SalesIncrease } from './baseline-analyst.js';

export const scriptedProvider: ActorAgentLlmProvider = (request) => {
  const receipts = request.messages.filter((message) => message.role === 'tool');
  const tool = (name: string, input: unknown): ActorAgentLlmResult => ({
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: `call-${receipts.length + 1}`,
            name,
            input: {
              ...(input as Record<string, unknown>),
              decision_summary:
                name === 'get_sales_data'
                  ? 'Retrieve the assigned sales records to compare quantities across dates.'
                  : name === 'find_largest_sales_increase'
                    ? 'Compare every observed daily pair to find the largest sales increase.'
                    : 'Check weather on the largest-spike date for possible contributing factors.',
            },
          },
        ],
      },
    },
  });
  if (receipts.length === 0) return tool('get_sales_data', {});
  if (receipts.length === 1) return tool('find_largest_sales_increase', {});
  const maximum = receipts.find((message) => message.toolName === 'find_largest_sales_increase');
  if (!maximum) throw new Error('Expected a maximum-increase tool observation.');
  const receipt: unknown = JSON.parse(maximum.content);
  if (
    !receipt ||
    typeof receipt !== 'object' ||
    !('ok' in receipt) ||
    receipt.ok !== true ||
    !('output' in receipt)
  ) {
    throw new Error('Expected a successful maximum-increase observation.');
  }
  const spike = SalesIncrease.parse(receipt.output);
  if (receipts.length === 2) return tool('call_weather_api', { date: spike.date });
  return {
    ok: true,
    value: {
      message: {
        role: 'assistant',
        content: JSON.stringify({
          ...spike,
          causes: [
            'Heavy rain and a flood warning coincided with the spike and may have influenced demand; correlation does not establish causation.',
          ],
        }),
      },
    },
  };
};
