import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const actorWebRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const agentStarterRoot = path.resolve(actorWebRoot, '../agent-starter');
const child = spawn('pnpm', ['board:dev', ...process.argv.slice(2)], {
  cwd: agentStarterRoot,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
