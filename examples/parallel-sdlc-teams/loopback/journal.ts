import { randomUUID } from 'node:crypto';
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReceiptLookupReply } from '../check-protocol.js';
import { type CheckBinding, type HostReceipt, matchesBinding } from '../task-check.js';
import type { TeamCheckpoint, TeamRecovery } from '../team-recovery.js';
import type { Lane } from './topology.js';

// Process-loss fixture on a local filesystem. Never take filenames from a peer.
// Publish a complete record with rename; use link (no replacement) for first claims.
function record<T>(directory: string, name: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, name);
  return {
    read(): T | null {
      try {
        return JSON.parse(readFileSync(path, 'utf8'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    write(value: T, exclusive = false) {
      const tmp = join(directory, randomUUID());
      writeFileSync(tmp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
      if (!exclusive) {
        renameSync(tmp, path);
        return true;
      }
      try {
        linkSync(tmp, path);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
        throw error;
      } finally {
        unlinkSync(tmp);
      }
    },
  };
}

export function hostJournal(directory: string) {
  const claim = record<CheckBinding>(directory, 'claim.json');
  const count = record<number>(directory, 'executions.json');
  const receipt = record<HostReceipt>(directory, 'receipt.json');
  return {
    claim: (binding: CheckBinding) => claim.write(binding, true),
    // Count the work returned by each actual executor, not winning claims or replies.
    executed: (executions: number) => count.write((count.read() ?? 0) + executions),
    store: (value: HostReceipt) => receipt.write(value, true),
    executions: () => count.read() ?? (claim.read() ? null : 0),
    lookup(binding: CheckBinding): ReceiptLookupReply {
      const stored = receipt.read();
      return stored && matchesBinding(binding, stored)
        ? { type: 'HOST_RECEIPT', receipt: stored }
        : { type: 'RECEIPT_UNAVAILABLE', binding };
    },
  };
}

export function teamJournal(directory: string, lane: Lane): TeamRecovery {
  const file = record<TeamCheckpoint>(directory, `${lane}.json`);
  function current() {
    const saved = file.read();
    if (!saved || saved.pending.execute.binding.taskId !== lane)
      throw new Error('Invalid task checkpoint');
    return saved;
  }
  return {
    load: file.read,
    open(assignment, pending, records) {
      if (
        !file.write(
          {
            assignment,
            pending,
            records,
            decision: 'awaitingReceipt',
            handoff: null,
            claimed: null,
            reviewSessions: 0,
          },
          true
        )
      )
        throw new Error('Task already admitted');
    },
    decide(decision, handoff) {
      const saved = current();
      if (saved.decision === 'reviewReady' || saved.decision === 'checkFailed')
        throw new Error('Decision already settled');
      file.write({ ...saved, decision, handoff });
    },
    claim(offered) {
      const saved = current();
      const expected = saved.handoff;
      if (
        saved.decision !== 'reviewReady' ||
        saved.claimed ||
        !expected ||
        offered.handoffId !== expected.handoffId ||
        !matchesBinding(expected.binding, offered.binding) ||
        expected.trace.teamId !== offered.trace?.teamId ||
        expected.trace.testSessionId !== offered.trace?.testSessionId
      )
        return false;
      file.write({ ...saved, claimed: expected.handoffId });
      return true;
    },
    spawned() {
      const saved = current();
      file.write({ ...saved, reviewSessions: saved.reviewSessions + 1 });
    },
    finish(records) {
      file.write({ ...current(), handoff: null, records });
    },
  };
}
