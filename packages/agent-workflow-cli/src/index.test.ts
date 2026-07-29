import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCommandAdmissionConfig } from './cli/index.js';
import { getCLIInfo, getPackageInfo } from './index';

describe('@actor-web/cli stub', () => {
  it('reports package metadata', async () => {
    const info = await getPackageInfo();
    expect(info.name).toBe('@actor-web/cli');
    expect(typeof info.version).toBe('string');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('describes the v0 runtime-host surface', async () => {
    const cli = await getCLIInfo();
    expect(cli.name).toBe('@actor-web/cli');
    expect(cli.status).toBe('v0-in-process-host');
    expect(cli.commands).toContain('serve');
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
