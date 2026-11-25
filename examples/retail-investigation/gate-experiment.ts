import type { CaseId } from './fixtures.js';
import type { ReadPrompt, Strategy } from './investigation.js';
import type { SynthesisPrompt } from './synthesis.js';

/** Evaluation design only. Never pass arm or fixture identifiers to the provider. */
export function arm(
  strategy: Strategy,
  gated = false,
  readPrompt: ReadPrompt = 'standard',
  synthesisPrompt?: SynthesisPrompt
) {
  return {
    id: synthesisPrompt
      ? `synthesis-${synthesisPrompt}`
      : `${strategy}${gated ? '-gated' : ''}${readPrompt === 'standard' ? '' : `-${readPrompt}`}`,
    strategy,
    gated,
    readPrompt,
    synthesisPrompt,
  };
}

export const gateArms = [
  arm('rules'),
  arm('fixed'),
  arm('hybrid'),
  arm('adaptive'),
  arm('hybrid', true),
  arm('hybrid', false, 'discriminate'),
  arm('hybrid', true, 'discriminate'),
];

export const gateScenarios: readonly { caseId: CaseId; maxReads: number }[] = [
  { caseId: 'bulk-order', maxReads: 6 },
  { caseId: 'data-defect', maxReads: 6 },
  { caseId: 'restocking', maxReads: 6 },
  { caseId: 'mixed-order-promotion', maxReads: 6 },
  { caseId: 'partial-availability', maxReads: 6 },
  { caseId: 'confounded', maxReads: 3 },
];

export function callCap(strategy: Strategy, maxReads: number) {
  return strategy === 'adaptive' ? maxReads + 1 : strategy === 'hybrid' ? maxReads - 1 : 1;
}
