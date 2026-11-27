import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { startCluster } from './launcher.js';

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'sdlc-viewers-'));
  const cluster = await startCluster();
  const input = createInterface({ input: process.stdin });
  try {
    await cluster.control.call('begin');
    await cluster.control.call('timeout', 'checkout');
    const path = join(directory, 'viewers.json');
    await writeFile(
      path,
      JSON.stringify({ gateway: cluster.control.ready.gatewayUrl, viewers: cluster.viewers }),
      { mode: 0o600 }
    );
    console.log(
      `Open /parallel-sdlc-teams/loopback.html on the local examples server and select ${path}.`
    );
    console.log('Enter: look up Checkout. Type quit to stop.');
    const close = () => input.close();
    process.once('SIGTERM', close);
    input.once('SIGINT', close);
    for await (const line of input) {
      if (line.trim() === 'quit') break;
      if (!line.trim()) await cluster.control.call('lookup', 'checkout');
    }
  } finally {
    input.close();
    await cluster.stop();
    await rm(directory, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
