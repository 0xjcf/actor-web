import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, ' ');
}

describe('location transparency docs honesty', () => {
  it('qualifies first-mention location transparency claims and links transport status', () => {
    const rootReadme = readText('README.md');
    const runtimeReadme = readText('packages/actor-core-runtime/README.md');
    const siteIndex = readText('docs/site/index.md');

    for (const content of [rootReadme, runtimeReadme, siteIndex]) {
      expect(content).toContain('directly connected runtime nodes');
      expect(content).toContain('production multi-machine transport remain');
    }

    expect(rootReadme).toContain('./docs/spikes/actor-web-external-transport-design.md');
    expect(runtimeReadme).toContain(
      'https://github.com/0xjcf/actor-web/blob/main/docs/spikes/actor-web-external-transport-design.md'
    );
    expect(siteIndex).toContain('Transport status');
    expect(siteIndex).toContain(
      'https://github.com/0xjcf/actor-web/blob/main/docs/spikes/actor-web-external-transport-design.md'
    );

    expect(rootReadme).not.toContain('Actors work identically local or distributed');
    expect(rootReadme).not.toContain('Same API for local and distributed actors');
    expect(siteIndex).not.toContain('Location-transparent actors for JavaScript/TypeScript');
  });

  it('distinguishes the completed localhost prove-out from true multi-host work', () => {
    const rootReadme = readText('README.md');
    const externalTransportStatus = readText('docs/spikes/actor-web-external-transport-design.md');
    const normalizedExternalTransportStatus = normalizeWhitespace(externalTransportStatus);

    expect(rootReadme).toContain('true multi-host rehearsals');
    expect(normalizedExternalTransportStatus).toContain('multi-process localhost rehearsal');
    expect(normalizedExternalTransportStatus).toContain('physical multi-host deployment');
    expect(normalizedExternalTransportStatus).toContain('True multi-host prove-out');
    expect(normalizedExternalTransportStatus).toContain('true multi-host rehearsal');
    expect(externalTransportStatus).not.toContain('multi-machine prove-out');
  });
});
