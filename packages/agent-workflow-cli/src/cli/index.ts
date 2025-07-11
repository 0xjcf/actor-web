#!/usr/bin/env node
import { Command } from 'commander';
import { version } from '../../package.json' assert { type: 'json' };
import {
  commitEnhancedCommand,
  generateCommitMessageCommand,
  validateDatesCommand,
} from '../commands/commit-enhanced.js';
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

// Enhanced actor-based commands
program
  .command('commit-enhanced')
  .alias('commit')
  .description('🎭 Enhanced conventional commit using actor system')
  .option('-m, --message <message>', 'custom commit message')
  .action((options) => commitEnhancedCommand(options.message));

program
  .command('generate-message')
  .alias('genmsg')
  .description('🧠 Generate smart conventional commit message')
  .action(generateCommitMessageCommand);

program
  .command('validate-dates')
  .alias('dates')
  .description('📅 Validate dates in documentation files')
  .option('-f, --files <files...>', 'specific files to check')
  .action((options) => validateDatesCommand(options.files));

// Parse CLI arguments
program.parse();
