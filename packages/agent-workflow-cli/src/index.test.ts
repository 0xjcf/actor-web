import { describe, expect, it } from 'vitest';
import { getCLIInfo, getPackageInfo } from './index';

describe('@actor-web/cli stub', () => {
  it('reports package metadata', async () => {
    const info = await getPackageInfo();
    expect(info.name).toBe('@actor-web/cli');
    expect(typeof info.version).toBe('string');
    expect(info.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exposes a work-in-progress CLI info surface with no commands yet', async () => {
    const cli = await getCLIInfo();
    expect(cli.name).toBe('@actor-web/cli');
    expect(cli.status).toBe('work-in-progress');
    expect(cli.commands).toHaveLength(0);
  });
});
