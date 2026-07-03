import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

async function readAgentPackageSource(): Promise<string> {
  try {
    return await readFile(join(process.cwd(), 'packages/actor-agent/src/index.ts'), 'utf8');
  } catch {
    return '';
  }
}

describe('@actor-web/agent package surface', () => {
  it('exports the llm tool registry helper and agent-loop behavior constructor', async () => {
    const source = await readAgentPackageSource();

    expect(source).toContain('export const ACTOR_WEB_LLM_TOOL_NAME');
    expect(source).toContain('createActorAgentToolRegistry');
    expect(source).toContain('createAgentLoopBehavior');
  });
});
