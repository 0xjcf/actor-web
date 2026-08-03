import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, '..');
const repoRoot = resolve(packageRoot, '../..');

type CliPackageManifest = {
  name: string;
  version: string;
  private?: boolean;
  main?: string;
  module?: string;
  types?: string;
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
  scripts?: Record<string, string>;
  publishConfig?: Record<string, unknown>;
  dependencies?: Record<string, string>;
};

type ChangesetConfig = {
  ignore?: string[];
};

type ChangesetStatus = {
  releases: Array<{
    name: string;
    oldVersion: string;
    newVersion: string;
    changesets: string[];
  }>;
};

type CommandResult = {
  stdout: string;
  stderr: string;
};

const tempDirs: string[] = [];

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T;
}

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runCommand(
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
  }
): Promise<CommandResult> {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          [
            `${command} ${args.join(' ')} exited with ${code ?? 'unknown code'}.`,
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join('\n')
        )
      );
    });
  });
}

async function readChangesetStatus(): Promise<ChangesetStatus> {
  const statusFile = join(await makeTempDir('actor-web-cli-changeset-'), 'status.json');
  await runCommand('pnpm', ['exec', 'changeset', 'status', `--output=${statusFile}`], {
    cwd: repoRoot,
  });
  return await readJson<ChangesetStatus>(statusFile);
}

function assertReleasePlanForCli(status: ChangesetStatus): void {
  const cliRelease = status.releases.find((entry) => entry.name === '@actor-web/cli');
  expect(cliRelease).toBeDefined();
  expect(cliRelease).toMatchObject({
    oldVersion: '0.1.0-alpha',
    newVersion: '0.1.0',
  });
  expect(cliRelease?.changesets).toContain('tall-pugs-tell');
}

async function packPackage(packageDir: string, packDir: string): Promise<string> {
  const before = new Set(
    (await readdir(packDir).catch(() => [])).filter((entry) => entry.endsWith('.tgz')).sort()
  );
  await runCommand('pnpm', ['pack', '--pack-destination', packDir, '--json'], {
    cwd: packageDir,
  });
  const tarballs = (await readdir(packDir))
    .filter((entry) => entry.endsWith('.tgz'))
    .filter((entry) => !before.has(entry))
    .sort();
  if (tarballs.length === 0) {
    throw new Error(`pnpm pack produced no tarball in ${packDir}`);
  }
  return join(packDir, tarballs[0]);
}

async function unpackTarball(tarball: string, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  await runCommand('tar', ['-xzf', tarball, '-C', targetDir, '--strip-components', '1'], {
    cwd: repoRoot,
  });
}

describe('@actor-web/cli release contract', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('keeps the source manifest alpha while changesets plans the first stable public release', async () => {
    const manifest = await readJson<CliPackageManifest>(resolve(packageRoot, 'package.json'));
    const changesetConfig = await readJson<ChangesetConfig>(
      resolve(repoRoot, '.changeset/config.json')
    );
    const changesetStatus = await readChangesetStatus();

    expect(manifest.name).toBe('@actor-web/cli');
    expect(manifest.version).toBe('0.1.0-alpha');
    expect(manifest.private).toBe(false);

    expect(manifest.main).toBe('dist/index.cjs');
    expect(manifest.module).toBe('dist/index.js');
    expect(manifest.types).toBe('dist/index.d.ts');
    expect(manifest.bin).toEqual({
      'actor-web': 'dist/cli/index.js',
    });
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js',
        require: './dist/index.cjs',
      },
    });
    expect(manifest.files).toEqual(
      expect.arrayContaining(['dist', 'README.md', 'LICENSE', 'CHANGELOG.md'])
    );
    expect(manifest.publishConfig).toMatchObject({
      access: 'public',
      provenance: true,
    });
    expect(manifest.scripts?.build).toContain('--clean');
    expect(manifest.scripts?.prepack).toBe('pnpm build');
    expect(manifest.scripts?.prepublishOnly).toBe('pnpm build');

    expect(changesetConfig.ignore ?? []).not.toContain('@actor-web/cli');
    assertReleasePlanForCli(changesetStatus);
  });

  it('packs a clean consumer-ready artifact with rewritten workspace dependencies', async () => {
    const packDir = await makeTempDir('actor-web-cli-pack-');
    await runCommand('pnpm', ['--filter', '@actor-web/runtime', 'build'], { cwd: repoRoot });
    await runCommand('pnpm', ['--filter', '@actor-web/agent', 'build'], { cwd: repoRoot });
    await runCommand('pnpm', ['--filter', '@actor-web/cli', 'build'], { cwd: repoRoot });

    const runtimeTarball = await packPackage(
      resolve(repoRoot, 'packages/actor-core-runtime'),
      packDir
    );
    const agentTarball = await packPackage(resolve(repoRoot, 'packages/actor-agent'), packDir);
    const cliTarball = await packPackage(packageRoot, packDir);

    const packedManifestText = (
      await runCommand('tar', ['-xOzf', cliTarball, 'package/package.json'], {
        cwd: repoRoot,
      })
    ).stdout;
    const packedManifest = JSON.parse(packedManifestText) as CliPackageManifest;
    expect(packedManifest.version).toBe('0.1.0-alpha');
    expect(packedManifest.dependencies?.['@actor-web/runtime']).toBe('0.2.0');
    expect(packedManifest.dependencies?.['@actor-web/agent']).toBe('0.2.0');
    expect(JSON.stringify(packedManifest)).not.toContain('workspace:*');

    const tarListing = (
      await runCommand('tar', ['-tzf', cliTarball], {
        cwd: repoRoot,
      })
    ).stdout;
    expect(tarListing).toContain('package/dist/index.js');
    expect(tarListing).toContain('package/dist/index.cjs');
    expect(tarListing).toContain('package/dist/cli/index.js');
    expect(tarListing).not.toContain('package/dist/commands/save.js');
    expect(tarListing).not.toContain('package/dist/commands/ship.js');
    expect(tarListing).not.toContain('package/dist/commands/sync.js');
    expect(tarListing).not.toContain('package/dist/actors/git-actor.js');

    const consumerDir = await makeTempDir('actor-web-cli-consumer-');
    await writeFile(
      join(consumerDir, 'package.json'),
      JSON.stringify(
        {
          name: 'actor-web-cli-clean-consumer',
          private: true,
          type: 'module',
        },
        null,
        2
      )
    );

    const consumerNodeModules = join(consumerDir, 'node_modules');
    const consumerActorWebModules = join(consumerNodeModules, '@actor-web');
    await mkdir(consumerActorWebModules, { recursive: true });
    await unpackTarball(runtimeTarball, join(consumerActorWebModules, 'runtime'));
    await unpackTarball(agentTarball, join(consumerActorWebModules, 'agent'));
    await unpackTarball(cliTarball, join(consumerActorWebModules, 'cli'));

    const externalDeps = new Map<string, string>([
      ['chalk', join(repoRoot, 'packages/agent-workflow-cli/node_modules/chalk')],
      ['commander', join(repoRoot, 'packages/agent-workflow-cli/node_modules/commander')],
      ['uuid', join(repoRoot, 'packages/actor-core-runtime/node_modules/uuid')],
      ['ws', join(repoRoot, 'packages/actor-core-runtime/node_modules/ws')],
      ['xstate', join(repoRoot, 'packages/actor-core-runtime/node_modules/xstate')],
      [
        '@msgpack/msgpack',
        join(repoRoot, 'packages/actor-core-runtime/node_modules/@msgpack/msgpack'),
      ],
    ]);
    for (const [dependency, source] of externalDeps) {
      const segments = dependency.split('/');
      const packageName = segments.pop();
      if (!packageName) {
        throw new Error(`Invalid dependency name: ${dependency}`);
      }
      const targetDir = join(consumerNodeModules, ...segments);
      await mkdir(targetDir, { recursive: true });
      await symlink(source, join(targetDir, packageName));
    }

    const installedManifest = await readJson<CliPackageManifest>(
      join(consumerDir, 'node_modules/@actor-web/cli/package.json')
    );
    expect(installedManifest.version).toBe('0.1.0-alpha');
    expect(JSON.stringify(installedManifest)).not.toContain('workspace:*');

    await writeFile(
      join(consumerDir, 'topology.mjs'),
      [
        "import { actor, defineActorWebTopology, defineBehavior, node } from '@actor-web/runtime';",
        '',
        'const counter = defineBehavior()',
        '  .withContext({ count: 0 })',
        '  .onMessage(({ message, context }) => {',
        "    if (message.type === 'INCREMENT') {",
        '      return { context: { count: context.count + 1 } };',
        '    }',
        "    if (message.type === 'GET_COUNT') {",
        '      return { reply: { count: context.count } };',
        '    }',
        '    return {};',
        '  });',
        '',
        'export default defineActorWebTopology({',
        "  nodes: { local: node('local') },",
        "  actors: { counter: actor({ id: 'counter', node: 'local', behavior: counter }) },",
        '});',
        '',
      ].join('\n')
    );

    const serveResult = await runCommand(
      'node',
      [
        './node_modules/@actor-web/cli/dist/cli/index.js',
        'serve',
        './topology.mjs',
        '--checkpoint-dir',
        './checkpoints',
        '--require-checkpoint-store',
        '--exec',
        'status; send counter {"type":"INCREMENT"}; ask counter {"type":"GET_COUNT"}; exit',
      ],
      {
        cwd: consumerDir,
      }
    );
    expect(serveResult.stdout).toContain('mode=in-process');
    expect(serveResult.stdout).toContain('readiness.checkpointStore=ready');
    expect(serveResult.stdout).toContain('Sent INCREMENT');
    expect(serveResult.stdout).toContain('{"count":1}');

    const consumerBinDir = join(consumerNodeModules, '.bin');
    await mkdir(consumerBinDir, { recursive: true });
    await symlink(
      join(consumerDir, 'node_modules/@actor-web/cli/dist/cli/index.js'),
      join(consumerBinDir, 'actor-web')
    );
    const binInfoResult = await runCommand('node', ['./node_modules/.bin/actor-web', 'info'], {
      cwd: consumerDir,
    });
    expect(binInfoResult.stdout).toContain('actor-web CLI');

    const apiSmokePath = join(consumerDir, 'api-smoke.mjs');
    await writeFile(
      apiSmokePath,
      [
        "import { actor, createInMemoryAgentSessionCheckpointStore, defineActorWebTopology, defineBehavior, node } from '@actor-web/runtime';",
        "import { createRuntimeHost } from '@actor-web/cli';",
        '',
        'const controlPlane = defineBehavior()',
        '  .withContext({ sessions: {} })',
        '  .onMessage(({ message, context }) => {',
        '    const current = context.sessions[message.sessionId] ?? {',
        '      sessionId: message.sessionId,',
        '      checkpointId: null,',
        '      revision: 0,',
        '      status: "idle",',
        '      reconciliationState: "clear",',
        '    };',
        '',
        "    if (message.type === 'START_AGENT_SESSION') {",
        '      const next = { ...current, revision: current.revision + 1, status: "running" };',
        '      return {',
        '        context: { sessions: { ...context.sessions, [message.sessionId]: next } },',
        '        reply: next,',
        '        emit: [{ type: "TRACE_UPDATED", scenario: "success", receiptKind: "result", sessionId: message.sessionId, revision: next.revision }],',
        '      };',
        '    }',
        '',
        "    if (message.type === 'INTERRUPT_AGENT_SESSION') {",
        '      const next = {',
        '        ...current,',
        '        checkpointId: `checkpoint:\\u0024{message.sessionId}:\\u0024{current.revision + 1}`,',
        '        revision: current.revision + 1,',
        '        status: "interrupted",',
        '        reconciliationState: "pending",',
        '      };',
        '      return {',
        '        context: { sessions: { ...context.sessions, [message.sessionId]: next } },',
        '        reply: next,',
        '        emit: [{ type: "TRACE_UPDATED", scenario: "interruption_resume", receiptKind: "reconciliation", detail: "checkpoint_recorded_before_resume", sessionId: message.sessionId, revision: next.revision }],',
        '      };',
        '    }',
        '',
        "    if (message.type === 'EXPORT_AGENT_SESSION_CHECKPOINT') {",
        '      return { reply: current };',
        '    }',
        '',
        "    if (message.type === 'IMPORT_AGENT_SESSION_CHECKPOINT') {",
        '      return {',
        '        context: {',
        '          sessions: {',
        '            ...context.sessions,',
        '            [message.sessionId]: message.checkpoint,',
        '          },',
        '        },',
        '        reply: message.checkpoint,',
        '      };',
        '    }',
        '',
        "    if (message.type === 'RESUME_AGENT_SESSION') {",
        '      const next = { ...current, status: "reconciliation_required", reconciliationState: "pending" };',
        '      return {',
        '        context: { sessions: { ...context.sessions, [message.sessionId]: next } },',
        '        reply: next,',
        '        emit: [{ type: "TRACE_UPDATED", scenario: "interruption_resume", receiptKind: "reconciliation", detail: "resume_requires_reconciliation", sessionId: message.sessionId, revision: next.revision }],',
        '      };',
        '    }',
        '',
        "    if (message.type === 'GET_AGENT_SESSION') {",
        '      return { reply: current };',
        '    }',
        '',
        '    return { reply: current };',
        '  });',
        '',
        'const topology = defineActorWebTopology({',
        "  nodes: { server: node('server') },",
        '  actors: {',
        '    controlPlaneSession: actor({',
        "      id: 'control-plane-session',",
        "      node: 'server',",
        '      behavior: controlPlane,',
        '    }),',
        '  },',
        '});',
        '',
        'const serverCheckpoints = createInMemoryAgentSessionCheckpointStore();',
        'const serverStarted = await createRuntimeHost(topology, {',
        "  node: 'server',",
        '  distributed: {',
        '    gateway: {',
        '      auth: { token: "gateway-secret" },',
        '      expose: ["controlPlaneSession"],',
        '      commandAdmission: {',
        '        resolvePrincipal: () => ({ id: "principal:control-plane-operator", kind: "authenticated", role: "operator" }),',
        `        policy: async ({ message }) => ({ outcome: "authorized", policy: \`control-plane:\${message.type.toLowerCase()}\` }),`,
        '        idempotency: async () => ({ outcome: "available", settle: async () => {} }),',
        '        onDecision: async () => {},',
        '      },',
        '    },',
        '  },',
        '  checkpoint: {',
        '    store: serverCheckpoints,',
        '    required: true,',
        '  },',
        '});',
        'if (!serverStarted.ok) throw new Error(serverStarted.error);',
        'const server = serverStarted.value;',
        '',
        'const localStatus = server.getStatus();',
        'if (localStatus.readiness?.checkpointStore !== "ready") throw new Error("local checkpoint readiness missing");',
        'if (!localStatus.gatewayUrl) throw new Error("gateway url missing");',
        '',
        'const remoteCheckpoints = createInMemoryAgentSessionCheckpointStore();',
        'const remoteStarted = await createRuntimeHost(topology, {',
        '  remote: {',
        '    gateway: {',
        '      url: localStatus.gatewayUrl,',
        '      auth: { token: "gateway-secret" },',
        '    },',
        '  },',
        '  checkpoint: {',
        '    store: remoteCheckpoints,',
        '    required: true,',
        '  },',
        '});',
        'if (!remoteStarted.ok) throw new Error(remoteStarted.error);',
        'const remote = remoteStarted.value;',
        '',
        'const remoteStatus = remote.getStatus();',
        `if (remoteStatus.mode !== "remote") throw new Error(\`expected remote mode, got \${remoteStatus.mode}\`);`,
        'if (remoteStatus.readiness?.policyAdmission !== "authenticated") throw new Error("remote auth readiness missing");',
        '',
        'const traces = [];',
        'function getResultOutput(projection) {',
        '  const receipts = projection?.trace?.receipts;',
        '  if (!Array.isArray(receipts)) return null;',
        '  for (const receipt of receipts) {',
        '    if (receipt?.receiptKind === "result") {',
        '      return receipt?.result?.output ?? null;',
        '    }',
        '  }',
        '  return null;',
        '}',
        'async function waitForProjection(commandId, predicate, timeoutMs = 1500) {',
        '  const deadline = Date.now() + timeoutMs;',
        '  while (Date.now() < deadline) {',
        '    const matched = traces.find((projection) => projection?.trace?.commandId === commandId);',
        '    if (matched && predicate(matched)) {',
        '      return matched;',
        '    }',
        '    await new Promise((resolve) => setTimeout(resolve, 25));',
        '  }',
        '  throw new Error(`trace watch missed \\u0024{commandId}`);',
        '}',
        'const traceWatch = remote.watchTrace("controlPlaneSession", (projection) => traces.push(projection));',
        'if (!traceWatch.ok) throw new Error(traceWatch.error);',
        '',
        'const startedSession = await remote.ask("controlPlaneSession", JSON.stringify({ type: "START_AGENT_SESSION", sessionId: "resume-session-1" }));',
        'if (!startedSession.ok) throw new Error(startedSession.error);',
        'const interrupted = await remote.ask("controlPlaneSession", JSON.stringify({ type: "INTERRUPT_AGENT_SESSION", sessionId: "resume-session-1" }), 2000, { commandId: "cmd:interrupt:resume-session-1" });',
        'if (!interrupted.ok) throw new Error(interrupted.error);',
        'const exported = await remote.ask("controlPlaneSession", JSON.stringify({ type: "EXPORT_AGENT_SESSION_CHECKPOINT", sessionId: "resume-session-1" }));',
        'if (!exported.ok) throw new Error(exported.error);',
        'const imported = await remote.ask("controlPlaneSession", JSON.stringify({ type: "IMPORT_AGENT_SESSION_CHECKPOINT", sessionId: "resume-session-1", checkpoint: exported.value }));',
        'if (!imported.ok) throw new Error(imported.error);',
        'const resumed = await remote.ask("controlPlaneSession", JSON.stringify({ type: "RESUME_AGENT_SESSION", sessionId: "resume-session-1" }), 2000, { commandId: "cmd:resume:resume-session-1" });',
        'if (!resumed.ok) throw new Error(resumed.error);',
        'await remote.flush();',
        '',
        'const interruptProjection = await waitForProjection("cmd:interrupt:resume-session-1", (projection) => {',
        '  const output = getResultOutput(projection);',
        '  return output?.sessionId === "resume-session-1" && output?.checkpointId && output?.reconciliationState === "pending";',
        '});',
        'const resumeProjection = await waitForProjection("cmd:resume:resume-session-1", (projection) => {',
        '  const output = getResultOutput(projection);',
        '  return output?.sessionId === "resume-session-1" && output?.status === "reconciliation_required" && output?.reconciliationState === "pending";',
        '});',
        'if (!getResultOutput(interruptProjection)?.checkpointId) throw new Error("interrupt trace missing checkpoint result");',
        'if (getResultOutput(resumeProjection)?.reconciliationState !== "pending") throw new Error("resume trace missing reconciliation result");',
        'traceWatch.value();',
        '',
        'await remote.stop();',
        'await server.stop();',
        'console.log(JSON.stringify({',
        '  localMode: localStatus.mode,',
        '  remoteMode: remoteStatus.mode,',
        '  remoteAdmission: remoteStatus.readiness?.policyAdmission,',
        '  traceEvents: traces.length,',
        '}));',
        '',
      ].join('\n')
    );

    try {
      const apiSmoke = await runCommand('node', [apiSmokePath], {
        cwd: consumerDir,
      });
      expect(apiSmoke.stdout).toContain('"localMode":"distributed"');
      expect(apiSmoke.stdout).toContain('"remoteMode":"remote"');
      expect(apiSmoke.stdout).toContain('"remoteAdmission":"authenticated"');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('listen EPERM')) {
        throw error;
      }

      const exportSmokePath = join(consumerDir, 'api-export-smoke.mjs');
      await writeFile(
        exportSmokePath,
        [
          "import { createRuntimeHost, getCLIInfo } from '@actor-web/cli';",
          '',
          'const info = await getCLIInfo();',
          'if (!Array.isArray(info.commands)) throw new Error("cli commands missing");',
          'if (!info.commands.includes("connect")) throw new Error("connect command missing");',
          'if (!info.commands.includes("serve")) throw new Error("serve command missing");',
          'if (!info.commands.includes("info")) throw new Error("info command missing");',
          'if (!Array.isArray(info.features)) throw new Error("cli features missing");',
          'if (!info.features.some((feature) => feature.includes("checkpoint"))) throw new Error("checkpoint feature missing");',
          'if (!info.features.some((feature) => feature.includes("remote gateway"))) throw new Error("remote gateway feature missing");',
          'if (typeof createRuntimeHost !== "function") throw new Error("createRuntimeHost export missing");',
          'console.log(JSON.stringify({',
          '  remoteExecutionDeferred: "listen EPERM",',
          '  exportedCommands: info.commands,',
          '  featureCount: info.features.length,',
          '  hasCreateRuntimeHost: typeof createRuntimeHost === "function",',
          '}));',
          '',
        ].join('\n')
      );

      const exportSmoke = await runCommand('node', [exportSmokePath], {
        cwd: consumerDir,
      });
      expect(exportSmoke.stdout).toContain('"remoteExecutionDeferred":"listen EPERM"');
      expect(exportSmoke.stdout).toContain('"hasCreateRuntimeHost":true');
      expect(exportSmoke.stdout).toContain('"connect"');
      expect(exportSmoke.stdout).toContain('"serve"');
      expect(exportSmoke.stdout).toContain('"info"');
    }
  }, 15_000);
});
