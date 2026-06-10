#!/usr/bin/env node

/**
 * actor-web CLI entry point — terminal host for the actor-web runtime
 * (design doc: docs/actor-web-cli-runtime-host-design.md, phase v0).
 *
 * `serve` boots an in-process runtime node from a topology module and opens an
 * operator console (interactive REPL, or scripted via --exec). In v0 there is
 * no network and no LLM; the console verbs (ls/spawn/send/ask/watch) operate
 * on the in-process system. Remote connection arrives in v2.
 *
 * Convention: user-facing program output goes to stdout via `console.log`;
 * diagnostics and failures go through the runtime `Logger`.
 */

import { createInterface } from 'node:readline';
import { Logger } from '@actor-web/runtime';
import chalk from 'chalk';
import { program } from 'commander';
import {
  createRuntimeHostFromFile,
  executeCommand,
  type RuntimeHost,
  splitExecScript,
} from '../host/runtime-host.js';
import { getDescriptionSync, getVersionSync, initializePackageInfo } from '../package-info.js';

const log = Logger.namespace('ACTOR_WEB_CLI');

function printOutcomeLines(lines: readonly string[], ok: boolean): void {
  for (const line of lines) {
    console.log(ok ? line : chalk.red(line));
  }
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
      .option('--exec <commands>', 'run semicolon-separated console commands, then exit')
      .action(async (topologyPath: string, options: { node?: string; exec?: string }) => {
        const started = await createRuntimeHostFromFile(topologyPath, { node: options.node });
        if (!started.ok) {
          console.error(chalk.red(started.error));
          process.exit(1);
        }
        const host = started.value;
        const nodeLabel = options.node ?? host.nodeKeys[0] ?? 'local';
        console.log(
          chalk.green(`Hosting ${topologyPath} in-process`) +
            chalk.gray(` (nodes: ${host.nodeKeys.join(', ')})`)
        );

        if (options.exec !== undefined) {
          const ok = await runExecScript(host, options.exec);
          process.exit(ok ? 0 : 1);
        }
        runConsole(host, nodeLabel);
      });

    program
      .command('info')
      .description('Show CLI status')
      .action(() => {
        console.log(chalk.blue('actor-web CLI'));
        console.log(
          chalk.gray(
            'v0 in-process runtime host: actor-web serve ./topology.(mjs|js|ts) [--node key] [--exec "ls; ..."]. Remote hosting (gateway/transport) arrives in v2 — see docs/actor-web-cli-runtime-host-design.md.'
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

main().catch((error) => {
  log.error('CLI failed', error);
  process.exit(1);
});
