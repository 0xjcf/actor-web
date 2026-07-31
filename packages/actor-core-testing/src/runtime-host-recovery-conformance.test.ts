import { describe, expect, it } from 'vitest';
import {
  assertRuntimeHostRecoveryConformanceFixture,
  getRuntimeHostRecoveryConformanceFixture,
} from './runtime-host-recovery-conformance.js';

describe('runtime host recovery conformance fixture', () => {
  it('proves restart recovery stays reconciliation-gated before a receipt and resumes without duplicate irreversible effects after recovery', () => {
    const fixture = getRuntimeHostRecoveryConformanceFixture();
    assertRuntimeHostRecoveryConformanceFixture(fixture);

    expect(fixture).toMatchObject({
      name: 'agent-loop-restart-recovery',
      expected: {
        restartBeforeReceipt: 'deferred_for_reconciliation',
        noDuplicateIrreversibleEffect: 'deferred_for_reconciliation',
        reconciliationReceiptRequired: true,
      },
    });
  });
});
