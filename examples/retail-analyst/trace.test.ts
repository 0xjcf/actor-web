import type { AgentTraceEvent } from '@actor-web/agent';
import { describe, expect, it } from 'vitest';
import { formatTrace } from './trace.js';

const decision = {
  type: 'model.returned',
  id: 'event-1',
  kind: 'fact',
  schemaVersion: 1,
  sourceActor: 'actor://test/analyst',
  occurredAt: '2026-11-24T00:00:00.000Z',
  runId: 'test',
  sequence: 1,
  payload: {
    turn: 1,
    modelCallId: 'model-1',
    attempt: 1,
    durationMs: 1,
    usage: null,
    message: {
      status: 'captured',
      value: {
        role: 'assistant',
        content: 'I need sales records.',
        reasoningSummaries: ['Inspect the assigned data.'],
        toolCalls: [
          {
            id: 'call-1',
            name: 'get_sales_data',
            input: { decision_summary: 'Retrieve assigned records before comparing dates.' },
          },
        ],
      },
    },
  },
} satisfies AgentTraceEvent;
describe('trace presentation', () => {
  it('distinguishes model explanations, provider summaries, and requests with colors and dividers', () => {
    const output = formatTrace(decision, { color: true });
    expect(output).toContain('\u001b[36mMODEL EXPLANATION');
    expect(output).toContain('\u001b[35mREASONING SUMMARY');
    expect(output).toContain('─'.repeat(76));
    expect(output).toContain('call-1');
  });
  it('supports plain logs and uses the structured summary when assistant prose is absent', () => {
    const output = formatTrace({
      ...decision,
      payload: {
        ...decision.payload,
        message: {
          status: 'captured',
          value: { ...decision.payload.message.value, content: '', reasoningSummaries: [] },
        },
      },
    });
    expect(output).not.toContain('\u001b[');
    expect(output).toContain('Retrieve assigned records before comparing dates.');
    expect(output).not.toContain('No explanation returned');
    expect(output).not.toContain('REASONING SUMMARY');
  });
  it('does not label final candidates as accepted before validation', () => {
    const output = formatTrace({
      ...decision,
      payload: {
        ...decision.payload,
        message: {
          status: 'captured',
          value: { ...decision.payload.message.value, toolCalls: [], content: '{"answer":1}' },
        },
      },
    });
    expect(output).toContain('awaiting validation');
    expect(output).not.toContain('ACCEPTED RESULT');
  });
  it('escapes untrusted terminal controls while preserving trusted color codes', () => {
    const output = formatTrace({
      ...decision,
      runId: 'bad\u001b[2J',
      payload: {
        ...decision.payload,
        message: {
          status: 'captured',
          value: { ...decision.payload.message.value, content: 'bad\u001b[2J' },
        },
      },
    });
    expect(output).not.toContain('\u001b');
    expect(output).toContain('\\u001b[2J');
  });
});

it('renders an absent required summary as an invalid request rather than inventing an explanation', () => {
  const output = formatTrace({
    ...decision,
    payload: {
      ...decision.payload,
      message: {
        status: 'captured',
        value: {
          ...decision.payload.message.value,
          content: '',
          toolCalls: [{ id: 'bad', name: 'get_sales_data', input: {} }],
        },
      },
    },
  });
  expect(output).toContain('INVALID DECISION SUMMARY');
  expect(output).toContain('cannot execute');
});
