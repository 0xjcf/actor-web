import { mkdtemp, writeFile } from 'node:fs/promises';
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
    const malformedAdmissionPath = join(fixtureDir, 'missing-policy.mjs');
    await writeFile(
      malformedAdmissionPath,
      'export default { principal: { id: "principal:test", kind: "system" }, onDecision: async () => {} };\n'
    );

    await expect(loadCommandAdmissionConfig(malformedAdmissionPath)).resolves.toEqual({
      ok: false,
      error: `${malformedAdmissionPath} commandAdmission.policy must be a function.`,
    });
  });
});
