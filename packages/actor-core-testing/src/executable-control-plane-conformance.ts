import { getControlPlaneConformanceFixture } from './control-plane-conformance.js';

export interface ExecutableControlPlaneTraceEvent {
  readonly scenario:
    | 'success'
    | 'rejection'
    | 'interruption_resume'
    | 'duplicate_suppression'
    | 'stale_projection'
    | 'operator_reconciliation';
  readonly receiptKind:
    | 'command_admission'
    | 'authorization'
    | 'result'
    | 'reconciliation'
    | 'stale_projection'
    | 'rejection';
  readonly commandType: string;
  readonly sessionId: string;
  readonly revision?: number;
  readonly detail?: string;
}

export interface ExecutableControlPlaneScenarioEvidence {
  readonly traceEvents: readonly ExecutableControlPlaneTraceEvent[];
  readonly authoritativeRevision?: number;
  readonly projectedRevision?: number;
  readonly effectCount?: number;
  readonly reconciliationState?: 'clear' | 'pending' | 'required';
  readonly checkpointId?: string;
}

export interface ExecutableControlPlaneScenarioResult {
  readonly ok: true;
  readonly evidence: ExecutableControlPlaneScenarioEvidence;
}

export interface ExecutableControlPlaneConformanceTraceWatch {
  readonly traceEvents: ExecutableControlPlaneTraceEvent[];
  stop(): void;
}

export interface ExecutableControlPlaneConformanceDriver {
  describeTarget(): string;
  watchTrace(): Promise<ExecutableControlPlaneConformanceTraceWatch>;
  rejectUnauthorized(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
  executeAuthorized(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
  interruptAndResume(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
  suppressDuplicateEffect(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
  detectStaleProjection(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
  reconcileSession(
    watch: ExecutableControlPlaneConformanceTraceWatch
  ): Promise<ExecutableControlPlaneScenarioResult>;
}

export interface ExecutableControlPlaneConformanceReport {
  readonly ok: true;
  readonly target: string;
  readonly scenarios: Readonly<{
    readonly success: ExecutableControlPlaneScenarioEvidence;
    readonly rejection: ExecutableControlPlaneScenarioEvidence;
    readonly interruption_resume: ExecutableControlPlaneScenarioEvidence;
    readonly duplicate_suppression: ExecutableControlPlaneScenarioEvidence;
    readonly stale_projection: ExecutableControlPlaneScenarioEvidence;
    readonly operator_reconciliation: ExecutableControlPlaneScenarioEvidence;
  }>;
}

function expectReceiptKinds(
  evidence: ExecutableControlPlaneScenarioEvidence,
  expectedKinds: readonly ExecutableControlPlaneTraceEvent['receiptKind'][],
  scenario: string
): void {
  const actualKinds = evidence.traceEvents.map((event) => event.receiptKind);
  for (const kind of expectedKinds) {
    if (!actualKinds.includes(kind)) {
      throw new Error(
        `Executable control-plane conformance for ${scenario} is missing receipt kind ${kind}.`
      );
    }
  }
}

export async function runExecutableControlPlaneConformance(
  driver: ExecutableControlPlaneConformanceDriver
): Promise<ExecutableControlPlaneConformanceReport> {
  const fixture = getControlPlaneConformanceFixture();
  const watch = await driver.watchTrace();

  try {
    const rejection = await driver.rejectUnauthorized(watch);
    expectReceiptKinds(rejection.evidence, ['rejection'], 'rejection');

    const success = await driver.executeAuthorized(watch);
    expectReceiptKinds(
      success.evidence,
      ['command_admission', 'authorization', 'result'],
      'success'
    );

    const interruption = await driver.interruptAndResume(watch);
    expectReceiptKinds(interruption.evidence, ['reconciliation'], 'interruption_resume');
    if (interruption.evidence.reconciliationState !== 'pending') {
      throw new Error('Interrupted session must remain reconciliation-pending after resume.');
    }

    const duplicate = await driver.suppressDuplicateEffect(watch);
    expectReceiptKinds(duplicate.evidence, ['rejection'], 'duplicate_suppression');
    if (duplicate.evidence.effectCount !== 1) {
      throw new Error('Duplicate suppression must preserve a single irreversible effect.');
    }

    const staleProjection = await driver.detectStaleProjection(watch);
    expectReceiptKinds(staleProjection.evidence, ['stale_projection'], 'stale_projection');
    if (
      staleProjection.evidence.projectedRevision === undefined ||
      staleProjection.evidence.authoritativeRevision === undefined ||
      staleProjection.evidence.projectedRevision >= staleProjection.evidence.authoritativeRevision
    ) {
      throw new Error(
        'Stale projection detection must prove the consumer projection lags authoritative revision.'
      );
    }

    const reconciliation = await driver.reconcileSession(watch);
    expectReceiptKinds(
      reconciliation.evidence,
      ['reconciliation', 'result'],
      'operator_reconciliation'
    );
    if (reconciliation.evidence.reconciliationState !== 'clear') {
      throw new Error('Operator reconciliation must clear the reconciliation requirement.');
    }

    const requiredScenarioNames = fixture.scenarios.map((scenario) => scenario.name);
    const executedScenarioNames = [
      'success',
      'rejection',
      'interruption_resume',
      'duplicate_suppression',
      'stale_projection',
      'operator_reconciliation',
    ] as const;
    for (const name of requiredScenarioNames) {
      if (!executedScenarioNames.includes(name)) {
        throw new Error(`Executable conformance omitted required scenario ${name}.`);
      }
    }

    return {
      ok: true,
      target: driver.describeTarget(),
      scenarios: {
        success: success.evidence,
        rejection: rejection.evidence,
        interruption_resume: interruption.evidence,
        duplicate_suppression: duplicate.evidence,
        stale_projection: staleProjection.evidence,
        operator_reconciliation: reconciliation.evidence,
      },
    };
  } finally {
    watch.stop();
  }
}
