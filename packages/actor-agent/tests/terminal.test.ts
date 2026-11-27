import { describe, expect, it, vi } from 'vitest';
import { createTerminalTraceReporter, formatTerminalTraceEvent } from '../src/terminal.js';
import type { AgentTraceEvent } from '../src/trace.js';

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
    const output = formatTerminalTraceEvent(decision, { color: true });
    expect(output).toContain('\u001b[36mMODEL EXPLANATION');
    expect(output).toContain('\u001b[35mREASONING SUMMARY');
    expect(output).toContain('─'.repeat(76));
    expect(output).toContain('call-1');
  });
  it('supports plain logs and uses the structured summary when assistant prose is absent', () => {
    const output = formatTerminalTraceEvent({
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
    const output = formatTerminalTraceEvent({
      ...decision,
      payload: {
        ...decision.payload,
        message: {
          status: 'captured',
          value: { ...decision.payload.message.value, toolCalls: [], content: '{"answer":1}' },
        },
      },
    });
    expect(output).toContain('FINAL CANDIDATE');
    expect(output).not.toMatch(/VALIDATED OUTPUT|VALIDATION · PASSED|ACCEPTED/);
  });
  it('escapes untrusted terminal controls while preserving trusted color codes', () => {
    const output = formatTerminalTraceEvent({
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

it('shows supplied reasons and stays neutral about tools without explanation fields', () => {
  const output = formatTerminalTraceEvent({
    ...decision,
    payload: {
      ...decision.payload,
      message: {
        status: 'captured',
        value: {
          ...decision.payload.message.value,
          content: '',
          toolCalls: [
            { id: 'search-1', name: 'search_catalog', input: { reason: 'Compare availability.' } },
            { id: 'diff-1', name: 'read_diff', input: { path: 'src' } },
          ],
        },
      },
    },
  });
  expect(output).toContain('DECISION SUMMARY · search_catalog');
  expect(output).toContain('Compare availability.');
  expect(output).toContain('PROPOSED TOOL CALL · read_diff');
  expect(output).toContain('diff-1');
  expect(output).not.toMatch(/INVALID|cannot execute|TOOL REJECTED/);
});

it('renders actual rejection, execution failure, and validation outcomes separately', () => {
  const ref = { modelCallId: 'm1', toolCallId: 't1', name: 'read_diff', turn: 1 };
  const failure = { code: 'NOT_ALLOWED' };
  expect(
    formatTerminalTraceEvent({ ...decision, type: 'tool.rejected', payload: { ...ref, failure } })
  ).toContain('TOOL REJECTED · read_diff');
  const failed = formatTerminalTraceEvent({
    ...decision,
    type: 'tool.failed',
    payload: { ...ref, attempt: 1, durationMs: 1, failure },
  });
  expect(failed).toContain('TOOL FAILED · read_diff');
  expect(failed).toContain('NOT_ALLOWED');
  const validation = { modelCallId: 'm1', validator: { id: 'parse-output', revision: '1' } };
  const output = { status: 'captured', value: null } as const;
  expect(
    formatTerminalTraceEvent({ ...decision, type: 'run.completed', payload: { output } })
  ).not.toMatch(/VALIDATED OUTPUT|VALIDATION · PASSED/);
  const passed = formatTerminalTraceEvent({
    ...decision,
    type: 'output.validated',
    payload: { ...validation, outcome: 'passed', output },
  });
  expect(passed).toContain('VALIDATED OUTPUT');
  expect(passed).toContain('parse-output');
  expect(
    formatTerminalTraceEvent({
      ...decision,
      type: 'output.validated',
      payload: { ...validation, outcome: 'failed', failure },
    })
  ).toContain('VALIDATION · FAILED');
});

it('marks omitted and policy-redacted messages without treating them as full content', () => {
  const payload = decision.payload;
  const omitted = formatTerminalTraceEvent({
    ...decision,
    payload: { ...payload, message: { status: 'omitted', reason: 'disabled' } },
  });
  expect(omitted).toContain('[content omitted: disabled]');
  expect(omitted).not.toContain('DECISION SUMMARY');
  const redacted = formatTerminalTraceEvent({
    ...decision,
    payload: {
      ...payload,
      message: {
        status: 'redacted',
        policyId: 'hide-text',
        value: { role: 'assistant', content: '[removed]' },
      },
    },
  });
  expect(redacted).toContain('[redacted: hide-text]');
  expect(redacted).toContain('[removed]');
  expect(redacted).not.toContain('I need sales records.');
});

it.each([false, true])(
  'writes exactly one block per event and returns sink completion (color=%s)',
  (color) => {
    const completion = Promise.resolve();
    const writeLine = vi.fn(() => completion);
    const onEvent = createTerminalTraceReporter({ writeLine, color });
    expect(writeLine).not.toHaveBeenCalled();
    expect(onEvent(decision)).toBe(completion);
    expect(writeLine.mock.calls).toEqual([[formatTerminalTraceEvent(decision, { color })]]);
  }
);
