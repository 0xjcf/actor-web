export const roles = ['plan', 'build', 'test', 'review', 'document'] as const;
export type Role = (typeof roles)[number];

// The deterministic stages need these inputs. Review may also read the candidate artifact.
const requiredGrants = {
  plan: ['read_target'],
  build: ['read_plan'],
  test: ['read_candidate', 'read_target'],
  review: ['read_test'],
  document: ['read_candidate', 'read_review'],
} as const satisfies Record<Role, readonly string[]>;
export type EvidenceGrant = (typeof requiredGrants)[Role][number];
const defaultGrants: Record<Role, readonly EvidenceGrant[]> = {
  ...requiredGrants,
  review: ['read_candidate', 'read_test'],
};

export type Definition = {
  id: string;
  role: Role;
  instruction: string;
  evidenceGrants: readonly EvidenceGrant[];
};
export type Version = { id: string; revision: number };
export type PinnedDefinition = Definition & Version;
export type Roster = Record<Role, Version>;
export type Task = { id: string; revision: number; request: string; expectedLabel: string };
export type Assignment = { task: Task; team: Record<Role, PinnedDefinition> };

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const refuse = (reason: string) => ({ ok: false, reason }) as const;
export function expectOk<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

function valid(definition: Definition): boolean {
  if (!roles.includes(definition.role)) return false;
  const { id, role, instruction, evidenceGrants } = definition;
  return (
    /^[a-z][a-z0-9-]*$/.test(id) &&
    instruction.trim() !== '' &&
    evidenceGrants.length === new Set(evidenceGrants).size &&
    requiredGrants[role].every((grant) => evidenceGrants.includes(grant)) &&
    evidenceGrants.every((grant) => defaultGrants[role].includes(grant))
  );
}

// Trusted, in-memory host state; none of these operations creates a running actor.
export class DefinitionRegistry {
  private readonly entries = new Map<string, { versions: PinnedDefinition[]; retired: boolean }>();

  register(definition: Definition): Result<Version> {
    if (!valid(definition) || this.entries.has(definition.id)) return refuse('INVALID_DEFINITION');
    const first = { ...structuredClone(definition), revision: 1 };
    this.entries.set(first.id, { versions: [first], retired: false });
    return ok({ id: first.id, revision: 1 });
  }

  read(version: Version): Result<PinnedDefinition> {
    const found = this.entries.get(version.id)?.versions.at(version.revision - 1);
    return found && found.revision === version.revision
      ? ok(structuredClone(found))
      : refuse('UNKNOWN_REVISION');
  }

  list() {
    return Array.from(this.entries.values()).flatMap(({ versions, retired }) =>
      versions.map((definition) => ({ definition: structuredClone(definition), retired }))
    );
  }

  revise(
    previous: Version,
    changes: Pick<Definition, 'instruction' | 'evidenceGrants'>
  ): Result<Version> {
    const entry = this.entries.get(previous.id);
    const latest = entry?.versions.at(-1);
    if (!entry || entry.retired || !latest || latest.revision !== previous.revision) {
      return refuse('NOT_CURRENT_DEFINITION');
    }
    const next = {
      ...latest,
      instruction: changes.instruction,
      evidenceGrants: [...changes.evidenceGrants],
      revision: latest.revision + 1,
    };
    if (!valid(next)) return refuse('INVALID_DEFINITION');
    entry.versions.push(next);
    return ok({ id: next.id, revision: next.revision });
  }

  retire(id: string): Result<string> {
    const entry = this.entries.get(id);
    if (!entry || entry.retired) return refuse('NOT_ACTIVE_DEFINITION');
    entry.retired = true;
    return ok(id);
  }

  pin(task: Task, roster: Roster): Result<Assignment> {
    if (
      !task ||
      typeof task.id !== 'string' ||
      !task.id.trim() ||
      !Number.isSafeInteger(task.revision) ||
      task.revision < 1 ||
      typeof task.request !== 'string' ||
      !task.request.trim() ||
      typeof task.expectedLabel !== 'string' ||
      !task.expectedLabel.trim()
    )
      return refuse('INVALID_TASK');

    const team = {} as Assignment['team'];
    for (const role of roles) {
      const version = roster?.[role];
      if (
        !version ||
        typeof version.id !== 'string' ||
        !Number.isSafeInteger(version.revision) ||
        version.revision < 1
      ) {
        return refuse(`INVALID_ROSTER:${role}`);
      }
      const definition = this.read(version);
      if (
        !definition.ok ||
        definition.value.role !== role ||
        this.entries.get(version.id)?.retired
      ) {
        return refuse(`UNAVAILABLE_ROLE:${role}`);
      }
      team[role] = definition.value;
    }
    return ok({ task: structuredClone(task), team });
  }
}

export function registerDefaults(registry: DefinitionRegistry): Roster {
  const register = (role: Role, id: string, instruction: string) =>
    expectOk(registry.register({ id, role, instruction, evidenceGrants: defaultGrants[role] }));
  return {
    plan: register('plan', 'planner', 'Plan the label change from the approved requirement.'),
    build: register('build', 'builder', 'Produce only the candidate label from the plan.'),
    test: register('test', 'tester', 'Compare the candidate with the approved label.'),
    review: register(
      'review',
      'reviewer',
      'Read the tested candidate and the check record. Advise approval or rejection.'
    ),
    document: register('document', 'documenter', 'Describe the reviewed label change.'),
  };
}
