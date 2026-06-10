#!/usr/bin/env node

/**
 * actor-web CLI entry point.
 *
 * The git-workflow commands that used to live here have been removed (they
 * duplicated FAS and plain git). This package is being reconceived as a
 * terminal host for the actor-web runtime — see
 * `docs/actor-web-cli-runtime-host-design.md`. Until the v0 host commands
 * (serve/spawn/send/watch) land, this entry only reports version/help/info.
 *
 * Convention: user-facing program output goes to stdout via `console.log`;
 * diagnostics and failures go through the runtime `Logger`.
 */

import { Logger } from '@actor-web/runtime';
import chalk from 'chalk';
import { program } from 'commander';
import { getDescriptionSync, getVersionSync, initializePackageInfo } from '../package-info.js';

const log = Logger.namespace('ACTOR_WEB_CLI');

async function main() {
  try {
    await initializePackageInfo();
    log.debug('actor-web CLI starting');

    program.name('actor-web').description(getDescriptionSync()).version(getVersionSync());

    program
      .command('info')
      .description('Show CLI status')
      .action(() => {
        console.log(chalk.blue('actor-web CLI'));
        console.log(
          chalk.gray(
            'Runtime host commands (serve/spawn/send/watch) are not implemented yet. See docs/actor-web-cli-runtime-host-design.md.'
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
