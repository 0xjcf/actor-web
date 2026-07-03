import { artifactIdentity, stableStringify } from './artifact.js';
import type {
  ArtifactMatcher,
  ArtifactRecord,
  DependencyMode,
  RegisteredDependency,
} from './protocol.js';

export interface DependencySatisfaction {
  readonly dependencyId: string;
  readonly artifacts: readonly ArtifactRecord[];
  readonly satisfactionKey: string;
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `d${(hash >>> 0).toString(16)}`;
}

function normalizeMatchers(matchers: readonly ArtifactMatcher[]): readonly ArtifactMatcher[] {
  return [...matchers].sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right))
  );
}

export function deriveDependencyId(
  lattice: string,
  actorKey: string,
  requires: readonly ArtifactMatcher[],
  mode: DependencyMode = 'once'
): string {
  const stableKey = stableStringify({
    actorKey,
    lattice,
    mode,
    requires: normalizeMatchers(requires),
  });
  return `dependency:${lattice}:${actorKey}:${hashText(stableKey)}`;
}

export function createRegisteredDependency(
  dependency: Omit<RegisteredDependency, 'dependencyId' | 'mode'> & {
    readonly dependencyId?: string;
    readonly mode?: DependencyMode;
    readonly declarationIndex?: number;
  }
): RegisteredDependency {
  return {
    ...dependency,
    dependencyId:
      dependency.dependencyId ??
      deriveDependencyId(
        dependency.lattice,
        dependency.actorKey,
        dependency.requires,
        dependency.mode ?? 'once'
      ),
    mode: dependency.mode ?? 'once',
  };
}

export function dependencyKey(dependency: RegisteredDependency): string {
  return stableStringify({
    actorKey: dependency.actorKey,
    dependencyId: dependency.dependencyId,
    lattice: dependency.lattice,
    mode: dependency.mode,
    requires: dependency.requires,
  });
}

export function matcherMatchesArtifact(
  artifact: ArtifactRecord,
  matcher: ArtifactMatcher
): boolean {
  if (artifact.type !== matcher.type) {
    return false;
  }
  if (matcher.key !== undefined && artifact.key !== matcher.key) {
    return false;
  }
  if (!matcher.fields) {
    return true;
  }
  if (artifact.payload === null || typeof artifact.payload !== 'object') {
    return false;
  }

  return Object.entries(matcher.fields).every(
    ([key, value]) =>
      stableStringify((artifact.payload as Record<string, unknown>)[key]) === stableStringify(value)
  );
}

function selectLatestMatchingArtifact(
  artifacts: readonly ArtifactRecord[],
  matcher: ArtifactMatcher
): ArtifactRecord | undefined {
  return artifacts
    .filter((artifact) => matcherMatchesArtifact(artifact, matcher))
    .sort((left, right) => {
      if (left.publishedAt !== right.publishedAt) {
        return right.publishedAt - left.publishedAt;
      }
      if (left.version !== right.version) {
        return right.version - left.version;
      }
      return artifactIdentity(left.type, left.key).localeCompare(
        artifactIdentity(right.type, right.key)
      );
    })[0];
}

export function evaluateDependencySatisfaction(
  artifacts: readonly ArtifactRecord[],
  dependency: RegisteredDependency
): DependencySatisfaction | null {
  const matchedArtifacts = dependency.requires
    .map((matcher) => selectLatestMatchingArtifact(artifacts, matcher))
    .filter((artifact): artifact is ArtifactRecord => artifact !== undefined);

  if (matchedArtifacts.length !== dependency.requires.length) {
    return null;
  }

  const satisfactionKey = matchedArtifacts
    .map((artifact) => `${artifactIdentity(artifact.type, artifact.key)}@${artifact.version}`)
    .sort((left, right) => left.localeCompare(right))
    .join('|');

  return {
    dependencyId: dependency.dependencyId,
    artifacts: matchedArtifacts,
    satisfactionKey,
  };
}
