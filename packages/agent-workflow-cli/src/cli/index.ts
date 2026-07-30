#!/usr/bin/env node

/**
 * actor-web CLI entry point — terminal host for the actor-web runtime
 * (design doc: docs/actor-web-cli-runtime-host-design.md, v2 distributed-host slice).
 *
 * `serve` boots either an in-process host or a thin distributed node host from
 * a topology module and opens an operator console (interactive REPL, or
 * scripted via --exec). Distributed mode reuses the runtime's existing node,
 * transport, and gateway seams; the CLI remains an operator shell.
 *
 * Convention: user-facing program output goes to stdout via `console.log`;
 * diagnostics and failures go through the runtime `Logger`.
 */

import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Logger } from '@actor-web/runtime';
import chalk from 'chalk';
import { program } from 'commander';
import { createNodeFileSystemAgentSessionCheckpointStore } from '../../../actor-core-runtime/src/node-agent-session-checkpoint-store.js';
import { loadModuleExport } from '../host/load-module.js';
import {
  createRuntimeHostFromFile,
  executeCommand,
  type RuntimeHost,
  type RuntimeHostCheckpointOptions,
  type RuntimeHostCommandAdmissionOptions,
  splitExecScript,
} from '../host/runtime-host.js';
import { getDescriptionSync, getVersionSync, initializePackageInfo } from '../package-info.js';

const log = Logger.namespace('ACTOR_WEB_CLI');

type CommandAdmissionLoadResult =
  | { ok: true; value: RuntimeHostCommandAdmissionOptions }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function loadCommandAdmissionConfig(
  modulePath: string
): Promise<CommandAdmissionLoadResult> {
  const loaded = await loadModuleExport(modulePath);
  if (!loaded.ok) {
    return loaded;
  }
  if (!isPlainObject(loaded.value)) {
    return {
      ok: false,
      error: `${modulePath} must export a commandAdmission object.`,
    };
  }

  const config = loaded.value as Record<string, unknown>;
  if (!('principal' in config) || !isPlainObject(config.principal)) {
    return {
      ok: false,
      error: `${modulePath} commandAdmission.principal must be a JSON-safe object.`,
    };
  }
  if (typeof config.policy !== 'function') {
    return {
      ok: false,
      error: `${modulePath} commandAdmission.policy must be a function.`,
    };
  }
  if ('idempotency' in config && typeof config.idempotency !== 'function') {
    return {
      ok: false,
      error: `${modulePath} commandAdmission.idempotency must be a function when provided.`,
    };
  }
  if (typeof config.onDecision !== 'function') {
    return {
      ok: false,
      error: `${modulePath} commandAdmission.onDecision must be a function.`,
    };
  }

  return { ok: true, value: config as unknown as RuntimeHostCommandAdmissionOptions };
}

function printOutcomeLines(lines: readonly string[], ok: boolean): void {
  for (const line of lines) {
    console.log(ok ? line : chalk.red(line));
  }
}

function collectRepeatableOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

type PeerMappingParseResult =
  | { ok: true; value: Record<string, string> | undefined }
  | { ok: false; error: string };

function parsePeerMappings(input: readonly string[] | undefined): PeerMappingParseResult {
  if (!input || input.length === 0) {
    return { ok: true, value: undefined };
  }
  const mappings = input.map((entry) => {
    const separator = entry.indexOf('=');
    if (separator <= 0 || separator === entry.length - 1) {
      return {
        ok: false as const,
        error: `Invalid --peer mapping "${entry}". Expected <node>=<ws-url>.`,
      };
    }
    return {
      ok: true as const,
      value: [entry.slice(0, separator), entry.slice(separator + 1)] as const,
    };
  });
  const invalid = mappings.find((entry) => !entry.ok);
  if (invalid && !invalid.ok) {
    return invalid;
  }
  return {
    ok: true,
    value: Object.fromEntries(
      mappings.map((entry) => {
        if (!entry.ok) {
          return ['', ''];
        }
        return entry.value;
      })
    ),
  };
}

function resolveCheckpointOptions(input: {
  checkpointDir?: string;
  requireCheckpointStore?: boolean;
}): RuntimeHostCheckpointOptions | undefined {
  if (!input.checkpointDir && !input.requireCheckpointStore) {
    return undefined;
  }
  return {
    ...(input.checkpointDir
      ? {
          store: createNodeFileSystemAgentSessionCheckpointStore({
            directory: input.checkpointDir,
          }),
        }
      : {}),
    ...(input.requireCheckpointStore ? { required: true } : {}),
  };
}

async function shutdown(host: RuntimeHost, watches: Map<string, () => void>): Promise<void> {
  for (const unsubscribe of watches.values()) {
    unsubscribe();
  }
  watches.clear();
  // Drain queued work before stopping so a `send` immediately followed by
  // exit still lands — keeps the REPL and --exec shutdown paths identical.
  await host.flush();
  await host.stop();
}

/**
 * Run a semicolon-separated command script against the host, then stop.
 * Returns false when any command failed (process exits non-zero).
 */
async function runExecScript(host: RuntimeHost, script: string): Promise<boolean> {
  const watches = new Map<string, () => void>();
  let allOk = true;
  for (const command of splitExecScript(script)) {
    const outcome = await executeCommand(host, command, watches, {
      onEvent: (target, event) =>
        console.log(`${chalk.cyan(`[${target}]`)} ${JSON.stringify(event)}`),
    });
    printOutcomeLines(outcome.lines, outcome.ok);
    if (!outcome.ok) {
      allOk = false;
    }
    if (outcome.exit) {
      break;
    }
  }
  await shutdown(host, watches);
  return allOk;
}

/** Interactive operator console over a started host. */
function runConsole(host: RuntimeHost, nodeLabel: string): void {
  const watches = new Map<string, () => void>();
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.blue(`actor-web(${nodeLabel})> `),
  });

  console.log(chalk.gray('Type "help" for commands, "exit" to stop the host.'));
  rl.prompt();

  rl.on('line', (line) => {
    void executeCommand(host, line, watches, {
      onEvent: (target, event) =>
        console.log(`${chalk.cyan(`[${target}]`)} ${JSON.stringify(event)}`),
    })
      .then((outcome) => {
        printOutcomeLines(outcome.lines, outcome.ok);
        if (outcome.exit) {
          rl.close();
          return;
        }
        rl.prompt();
      })
      .catch((error) => {
        log.error('Console command failed', error);
        rl.prompt();
      });
  });

  rl.on('SIGINT', () => {
    rl.close();
  });

  rl.on('close', () => {
    void shutdown(host, watches)
      .then(() => {
        console.log(chalk.gray('Host stopped.'));
        process.exit(0);
      })
      .catch((error) => {
        log.error('Failed to stop host', error);
        process.exit(1);
      });
  });
}

async function main() {
  try {
    await initializePackageInfo();
    log.debug('actor-web CLI starting');

    program.name('actor-web').description(getDescriptionSync()).version(getVersionSync());

    program
      .command('serve <topology>')
      .description('Host an in-process runtime node from a topology module and open the console')
      .option('--node <key>', 'topology node that dynamic spawns target (default: first node)')
      .option(
        '--admission <module>',
        'load provider-neutral command admission config from a module export'
      )
      .option('--gateway', 'expose a localhost-only runtime gateway for this node')
      .option('--transport', 'accept localhost-only runtime transport peers for this node')
      .option(
        '--connect <node>',
        'connect this node to a named topology peer (repeatable; requires matching --peer mapping)',
        collectRepeatableOption,
        []
      )
      .option(
        '--peer <node=url>',
        'provide a topology peer WebSocket URL mapping (repeatable)',
        collectRepeatableOption,
        []
      )
      .option(
        '--allow-unsafe-exposure',
        'allow --gateway or --transport listeners to bind outside localhost'
      )
      .option(
        '--checkpoint-dir <dir>',
        'persist host checkpoint envelopes in this directory and report checkpoint readiness'
      )
      .option(
        '--require-checkpoint-store',
        'fail closed when checkpoint readiness is required but no checkpoint store is configured'
      )
      .option('--exec <commands>', 'run semicolon-separated console commands, then exit')
      .action(
        async (
          topologyPath: string,
          options: {
            node?: string;
            admission?: string;
            gateway?: boolean;
            transport?: boolean;
            connect?: string[];
            peer?: string[];
            allowUnsafeExposure?: boolean;
            checkpointDir?: string;
            requireCheckpointStore?: boolean;
            exec?: string;
          }
        ) => {
          const commandAdmission =
            options.admission === undefined
              ? undefined
              : await loadCommandAdmissionConfig(options.admission);
          if (commandAdmission && !commandAdmission.ok) {
            console.error(chalk.red(commandAdmission.error));
            process.exit(1);
          }
          const peerMappings = parsePeerMappings(options.peer);
          if (!peerMappings.ok) {
            console.error(chalk.red(peerMappings.error));
            process.exit(1);
          }

          const checkpoint = resolveCheckpointOptions(options);
          const distributed =
            options.gateway ||
            options.transport ||
            (options.connect?.length ?? 0) > 0 ||
            (options.peer?.length ?? 0) > 0
              ? {
                  ...(options.gateway ? { gateway: true } : {}),
                  ...(options.transport ? { transport: true } : {}),
                  ...(options.connect && options.connect.length > 0
                    ? { connect: options.connect }
                    : {}),
                  ...(peerMappings.value ? { peers: peerMappings.value } : {}),
                  ...(options.allowUnsafeExposure ? { allowUnsafeExposure: true } : {}),
                }
              : undefined;

          const started = await createRuntimeHostFromFile(topologyPath, {
            node: options.node,
            ...(commandAdmission?.ok ? { commandAdmission: commandAdmission.value } : {}),
            ...(distributed ? { distributed } : {}),
            ...(checkpoint ? { checkpoint } : {}),
          });
          if (!started.ok) {
            console.error(chalk.red(started.error));
            process.exit(1);
          }
          const host = started.value;
          const nodeLabel = options.node ?? host.nodeKeys[0] ?? 'local';
          const status = host.getStatus();
          console.log(
            chalk.green(
              `Hosting ${topologyPath} ${status.mode === 'distributed' ? 'as a distributed node' : 'in-process'}`
            ) + chalk.gray(` (nodes: ${host.nodeKeys.join(', ')})`)
          );
          if (status.gatewayUrl) {
            console.log(chalk.gray(`Gateway: ${status.gatewayUrl}`));
          }
          if (status.transportUrl) {
            console.log(chalk.gray(`Transport: ${status.transportUrl}`));
          }

          if (options.exec !== undefined) {
            const ok = await runExecScript(host, options.exec);
            process.exit(ok ? 0 : 1);
          }
          runConsole(host, nodeLabel);
        }
      );

    program
      .command('connect <topology> <gatewayUrl>')
      .description('Connect an operator shell to a remote runtime gateway using a topology module')
      .option('--token <token>', 'send a gateway auth token on the hello frame')
      .option(
        '--checkpoint-dir <dir>',
        'persist host checkpoint envelopes in this directory and report checkpoint readiness'
      )
      .option(
        '--require-checkpoint-store',
        'fail closed when checkpoint readiness is required but no checkpoint store is configured'
      )
      .option('--exec <commands>', 'run semicolon-separated console commands, then exit')
      .action(
        async (
          topologyPath: string,
          gatewayUrl: string,
          options: {
            token?: string;
            checkpointDir?: string;
            requireCheckpointStore?: boolean;
            exec?: string;
          }
        ) => {
          const checkpoint = resolveCheckpointOptions(options);
          const started = await createRuntimeHostFromFile(topologyPath, {
            remote: {
              gateway: {
                url: gatewayUrl,
                ...(options.token ? { auth: { token: options.token } } : {}),
              },
            },
            ...(checkpoint ? { checkpoint } : {}),
          });
          if (!started.ok) {
            console.error(chalk.red(started.error));
            process.exit(1);
          }
          const host = started.value;
          const status = host.getStatus();
          console.log(
            chalk.green(`Connected ${topologyPath} to remote gateway`) +
              chalk.gray(` (${status.gatewayUrl ?? gatewayUrl})`)
          );

          if (options.exec !== undefined) {
            const ok = await runExecScript(host, options.exec);
            process.exit(ok ? 0 : 1);
          }
          runConsole(host, 'remote');
        }
      );

    program
      .command('info')
      .description('Show CLI status')
      .action(() => {
        console.log(chalk.blue('actor-web CLI'));
        console.log(
          chalk.gray(
            'Distributed runtime host: actor-web serve ./topology.(mjs|js|ts) [--node key] [--gateway] [--transport] [--peer worker=ws://127.0.0.1:9001] [--connect worker] [--admission ./command-admission.(mjs|js|ts)] [--checkpoint-dir ./.actor-web/checkpoints] [--exec "status; ls; ..."]; actor-web connect ./topology.(mjs|js|ts) ws://127.0.0.1:9000 [--token gateway-secret]. See docs/actor-web-cli-runtime-host-design.md.'
          )
        );
      });

    program.on('command:*', (operands) => {
      console.error(chalk.red(`Unknown command: ${operands[0]}`));
      console.error(chalk.gray('Run "actor-web --help" for available commands'));
      process.exit(1);
    });

    await program.parseAsync();
  } catch (error) {
    log.error('CLI failed', error);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    log.error('CLI failed', error);
    process.exit(1);
  });
}
