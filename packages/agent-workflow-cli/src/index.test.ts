import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCommandAdmissionConfig, validateDistributedCliOptions } from './cli/index.js';
import { getCLIInfo, getPackageInfo } from './index';

describe('@actor-web/cli stub', () => {
  it('reports package metadata', async () => {
    const info = await getPackageInfo();
    expect(info.name).toBe('@actor-web/cli');
    expect(typeof info.version).toBe('string');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('describes the distributed runtime-host surface', async () => {
    const cli = await getCLIInfo();
    expect(cli.name).toBe('@actor-web/cli');
    expect(cli.status).toBe('v2-distributed-runtime-host');
    expect(cli.commands).toContain('serve');
    expect(cli.commands).toContain('connect');
    expect(cli.features).toContain('Localhost-safe gateway and transport listeners');
    expect(cli.features).toContain('Standalone remote gateway operator shells');
  });

  it('uses public runtime entrypoints instead of deep actor-core-runtime src imports', () => {
    const runtimeSources = [
      readFileSync(new URL('./host/runtime-host.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('./cli/index.ts', import.meta.url), 'utf8'),
    ];

    expect(runtimeSources.join('\n')).not.toContain('../../../actor-core-runtime/src/');
    expect(runtimeSources.join('\n')).toContain('@actor-web/runtime/node');
  });

  it('rejects unmapped connect targets and ineffective unsafe-exposure flags', () => {
    expect(
      validateDistributedCliOptions({
        connect: ['worker'],
        peers: { storage: 'ws://127.0.0.1:9001' },
      })
    ).toEqual({
      ok: false,
      error: 'Invalid --connect target "worker": add a matching --peer worker=<ws-url> mapping.',
    });
    expect(
      validateDistributedCliOptions({
        allowUnsafeExposure: true,
      })
    ).toEqual({
      ok: false,
      error: '--allow-unsafe-exposure requires --gateway or --transport.',
    });
  });

  it('rejects malformed admission modules before topology startup', async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), 'actor-web-cli-admission-'));
    try {
      const writeFixture = async (name: string, source: string): Promise<string> => {
        const fixturePath = join(fixtureDir, name);
        await writeFile(fixturePath, source);
        return fixturePath;
      };

      const missingPolicyPath = await writeFixture(
        'missing-policy.mjs',
        'export default { principal: { id: "principal:test", kind: "system" }, onDecision: async () => {} };\n'
      );
      const missingPrincipalPath = await writeFixture(
        'missing-principal.mjs',
        'export default { policy: async () => ({ outcome: "authorized", policy: "p" }), onDecision: async () => {} };\n'
      );
      const missingOnDecisionPath = await writeFixture(
        'missing-on-decision.mjs',
        'export default { principal: { id: "principal:test", kind: "system" }, policy: async () => ({ outcome: "authorized", policy: "p" }) };\n'
      );
      const nonObjectDefaultPath = await writeFixture(
        'non-object-default.mjs',
        'export default 42;\n'
      );

      await expect(loadCommandAdmissionConfig(missingPolicyPath)).resolves.toEqual({
        ok: false,
        error: `${missingPolicyPath} commandAdmission.policy must be a function.`,
      });
      await expect(loadCommandAdmissionConfig(missingPrincipalPath)).resolves.toEqual({
        ok: false,
        error: `${missingPrincipalPath} commandAdmission.principal must be a JSON-safe object.`,
      });
      await expect(loadCommandAdmissionConfig(missingOnDecisionPath)).resolves.toEqual({
        ok: false,
        error: `${missingOnDecisionPath} commandAdmission.onDecision must be a function.`,
      });
      await expect(loadCommandAdmissionConfig(nonObjectDefaultPath)).resolves.toEqual({
        ok: false,
        error: `${nonObjectDefaultPath} must export a commandAdmission object.`,
      });
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });
});
