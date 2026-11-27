// @vitest-environment node
import { expect, it, vi } from 'vitest';

it.each([false, true])('keeps comparison stdout JSON-only (terminal trace: %s)', async (trace) => {
  const argv = process.argv;
  const exitCode = process.exitCode;
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    process.argv = [
      ...argv.slice(0, 2),
      '--compare',
      '--color',
      ...(trace ? ['--trace-terminal'] : []),
    ];
    vi.resetModules();
    await import('./demo.js');

    const summaries = stdout.mock.calls.map(([line]) => JSON.parse(line));
    expect(summaries).toHaveLength(18);
    if (trace) {
      const blocks = stderr.mock.calls.map(([block]) => block);
      expect(blocks.filter((block) => block.startsWith('\nEVALUATION ·'))).toEqual(
        summaries.map(({ caseId, strategy }) => `\nEVALUATION · ${caseId} · ${strategy}`)
      );
      expect(blocks.filter((block) => block.includes('\u001b[90mRUN START'))).toHaveLength(18);
      expect(blocks.some((block) => block.includes('TOOL REQUEST · read_sales'))).toBe(true);
    } else {
      expect(stderr).not.toHaveBeenCalled();
    }
  } finally {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
  }
});
