#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../../package.json' assert { type: 'json' };
import { initCommand } from '../commands/init.js';
import { saveCommand } from '../commands/save.js';
import { shipCommand } from '../commands/ship.js';
import { statusCommand } from '../commands/status.js';
import { syncCommand } from '../commands/sync.js';
import { validateCommand } from '../commands/validate.js';

const program = new Command();

program
  .name('agent-workflow')
  .description('Agent-centric development workflow automation')
  .version(version);

program
  .command('init')
  .description('Initialize agent-centric workflow in current project')
  .option('-a, --agents <number>', 'number of agents', '3')
  .option('-t, --template <name>', 'workflow template', 'standard')
  .action(initCommand);

program
  .command('sync')
  .description('Sync with integration branch (daily routine)')
  .action(syncCommand);

program.command('validate').description('Validate only your changed files').action(validateCommand);

program
  .command('ship')
  .description('Complete workflow: validate + commit + push to integration')
  .action(shipCommand);

program
  .command('save')
  .description('Quick save your work (commit without shipping)')
  .action(saveCommand);

program.command('status').description('Show agent status and suggestions').action(statusCommand);

// Parse CLI arguments
program.parse();
