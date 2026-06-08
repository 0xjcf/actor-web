import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  readonly private?: boolean;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly files?: readonly string[];
  readonly exports?: unknown;
  readonly publishConfig?: unknown;
  readonly scripts?: Record<string, string>;
}

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as PackageJson;

describe('root package metadata', () => {
  it('treats the root package as private workspace orchestration', () => {
    expect(packageJson.private).toBe(true);
    expect(packageJson.main).toBeUndefined();
    expect(packageJson.module).toBeUndefined();
    expect(packageJson.types).toBeUndefined();
    expect(packageJson.files).toBeUndefined();
    expect(packageJson.exports).toBeUndefined();
    expect(packageJson.publishConfig).toBeUndefined();
  });

  it('builds workspace packages instead of a missing root source entrypoint', () => {
    expect(packageJson.scripts?.build).toContain('@actor-web/runtime');
    expect(packageJson.scripts?.build).toContain('@actor-web/testing');
    expect(packageJson.scripts?.build).toContain('@actor-web/cli');
    expect(packageJson.scripts?.build).not.toContain('src/index.ts');
  });
});
