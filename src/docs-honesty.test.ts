import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function normalizeWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, ' ');
}

function firstMarkdownQuote(content: string): string {
  return content.split('\n').find((line) => line.startsWith('> ')) ?? '';
}

function heroTagline(content: string): string {
  return content.match(/^ {2}tagline: (.+)$/m)?.[1] ?? '';
}

function tableRow(content: string, label: string): string {
  return content.split('\n').find((line) => line.startsWith(`| ${label} |`)) ?? '';
}

describe('location transparency docs honesty', () => {
  it('qualifies first-mention location transparency claims and links transport status', () => {
    const rootReadme = readText('README.md');
    const runtimeReadme = readText('packages/actor-core-runtime/README.md');
    const siteIndex = readText('docs/site/index.md');
    const firstRootClaim = firstMarkdownQuote(rootReadme);
    const firstRuntimeClaim = firstMarkdownQuote(runtimeReadme);
    const firstSiteClaim = heroTagline(siteIndex);

    expect(firstRootClaim).toContain('directly connected runtime nodes');
    expect(firstRootClaim).toContain('production multi-machine transport remain in progress');
    expect(firstRuntimeClaim).toContain('directly connected runtime nodes');
    expect(firstRuntimeClaim).toContain('production multi-machine transport remain roadmap work');
    expect(firstSiteClaim).toContain('directly connected runtime nodes');
    expect(firstSiteClaim).toContain('production multi-machine transport remain in progress');

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

  it('keeps proposed ecosystem governance out of current-state maturity labels', () => {
    const ecosystemAlignment = readText('docs/actor-web-ecosystem-alignment.md');

    expect(tableRow(ecosystemAlignment, 'FAS workflow policy ownership')).toContain(
      '| `Partial` |'
    );
    expect(tableRow(ecosystemAlignment, 'fas-local public runtime semantics')).toContain(
      '| `Partial` |'
    );
    expect(tableRow(ecosystemAlignment, 'actor-web runtime substrate')).toContain('| `Current` |');
  });
});
