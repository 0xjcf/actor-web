import type { AgentTraceCapture, AgentTraceEvent } from '@actor-web/agent';

/** Read model-authored explanation metadata, never infer an internal reasoning process. */
export function decisionSummaryFrom(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const field = Object.getOwnPropertyDescriptor(input, 'decision_summary');
  if (!field || !('value' in field) || typeof field.value !== 'string') return undefined;
  const text = field.value.trim();
  return text.length > 0 && text.length <= 320 ? text : undefined;
}

function content<T>(capture: AgentTraceCapture<T>): T | string {
  if (capture.status === 'omitted') return `[content omitted: ${capture.reason}]`;
  if (capture.status === 'redacted')
    return `[redacted: ${capture.policyId}]\n${JSON.stringify(capture.value, null, 2)}`;
  return capture.value;
}

/** Pure presentation; JSONL retains full requests while the terminal summarizes their size. */
export function formatTrace(event: AgentTraceEvent, { color = false } = {}): string {
  const paint = (code: number, text: string) => (color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const clean = (text: string) =>
    Array.from(text, (character) => {
      const code = character.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159)
        ? `\\u${code.toString(16).padStart(4, '0')}`
        : character;
    }).join('');
  const block = (label: string, code: number, body: unknown) => {
    const title = `${label}\nrun ${event.runId}  ·  #${event.sequence}`;
    const text = clean(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
    return `${paint(code, '─'.repeat(76))}\n${paint(code, clean(title))}\n${paint(code, '─'.repeat(76))}\n${text}`;
  };
  switch (event.type) {
    case 'run.started':
      return block('RUN START', 90, event.payload);
    case 'model.requested': {
      const { request, model, turn } = event.payload;
      return block(`MODEL INPUT · turn ${turn}`, 90, {
        model,
        capture: request.status,
        ...(request.status === 'omitted'
          ? { reason: request.reason }
          : { messages: request.value.messages.length, tools: request.value.tools }),
      });
    }
    case 'model.returned': {
      const { message: captured, turn } = event.payload;
      if (captured.status !== 'captured')
        return block(`MODEL OUTPUT · turn ${turn}`, 33, content(captured));
      const message = captured.value;
      const sections: string[] = [];
      if (message.toolCalls?.length) {
        if (message.content.trim()) {
          sections.push(
            block(`MODEL EXPLANATION · turn ${turn} · assistant text`, 36, message.content)
          );
        }
        for (const call of message.toolCalls) {
          const summary = decisionSummaryFrom(call.input);
          sections.push(
            block(
              `${summary ? 'DECISION SUMMARY' : 'INVALID DECISION SUMMARY'} · ${call.name} · model-authored argument`,
              summary ? 36 : 31,
              summary
                ? `${summary}\n\nTool call: ${call.id}`
                : `Missing or invalid required decision_summary. This request cannot execute. Tool call: ${call.id}`
            )
          );
        }
      } else {
        sections.push(
          block(`FINAL CANDIDATE · turn ${turn} · awaiting validation`, 33, message.content)
        );
      }
      if (message.reasoningSummaries?.length) {
        sections.push(
          block(
            'REASONING SUMMARY · provider-returned',
            35,
            message.reasoningSummaries.join('\n\n')
          )
        );
      }
      return sections.join('\n\n');
    }
    case 'tool.requested':
      return block(`TOOL REQUEST · ${event.payload.name}`, 33, {
        turn: event.payload.turn,
        toolCallId: event.payload.toolCallId,
        input: content(event.payload.input),
      });
    case 'tool.observed':
      return block(`OBSERVATION · ${event.payload.name}`, 34, {
        turn: event.payload.turn,
        toolCallId: event.payload.toolCallId,
        output: content(event.payload.output),
      });
    case 'tool.rejected':
    case 'tool.failed':
      return block(
        `${event.type === 'tool.rejected' ? 'TOOL REJECTED' : 'TOOL FAILED'} · ${event.payload.name}`,
        31,
        event.payload.failure.code
      );
    case 'output.validated':
      return event.payload.outcome === 'passed'
        ? [
            block(
              'VALIDATION · PASSED',
              32,
              'Schema, numeric facts, and required observations checked; not a prose-quality score.'
            ),
            block('ACCEPTED RESULT', 32, content(event.payload.output)),
          ].join('\n\n')
        : block('VALIDATION · FAILED', 31, event.payload.failure.code);
    case 'run.completed':
      return block(
        'EXECUTION COMPLETED · awaiting host validation',
        90,
        'Raw model output returned; not yet an accepted analysis.'
      );
    case 'model.failed':
      return block(`MODEL FAILURE · turn ${event.payload.turn}`, 31, event.payload.failure.code);
    case 'run.failed':
      return block('RUN FAILED', 31, event.payload.failure.code);
    case 'run.cancelled':
      return block('RUN CANCELLED', 31, event.payload.code);
  }
}
