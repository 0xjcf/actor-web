import type { ActorAgentLlmProvider } from '@actor-web/agent';
import type { Observation } from './evidence.js';
import type { Assignment } from './investigation.js';
import { assessEvidence, nextHybridSource, nextSource } from './policy.js';

/** Offline protocol exercise only: the same explicit rules used by the rule-directed host. */
export const scriptedProvider: ActorAgentLlmProvider = (request) => {
  const task: Assignment = JSON.parse(request.messages[0].content);
  const receipts = request.messages.filter((m) => m.role === 'tool');
  const observations: Observation[] = [
    ...task.observations,
    ...receipts.map((m) => {
      const receipt = JSON.parse(m.content);
      if (!receipt.ok) throw new Error('Expected a successful receipt.');
      return receipt.output.evidence;
    }),
  ];
  const remainingReads = receipts.length
    ? JSON.parse(receipts[receipts.length - 1].content).output.remainingReads
    : task.remainingReads;
  const source =
    request.tools.length > 0 && remainingReads > 0
      ? task.reconciliation
        ? nextHybridSource(task.reconciliation, observations)
        : nextSource(observations)
      : undefined;
  return {
    ok: true,
    value: {
      message: source
        ? {
            role: 'assistant',
            content: '',
            toolCalls: [
              {
                id: `read-${receipts.length + 1}`,
                name: source,
                input: {
                  reason: `Inspect ${source} to distinguish explanations using the evidence gathered so far.`,
                },
              },
            ],
          }
        : {
            role: 'assistant',
            content: JSON.stringify(assessEvidence(observations, task.reconciliation)),
          },
    },
  };
};
