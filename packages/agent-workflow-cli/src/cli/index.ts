#!/usr/bin/env node

import chalk from 'chalk';
import { program } from 'commander';
import {
  actorCreateCommand,
  actorStatusCommand,
  actorWorktreesCommand,
} from '../commands/advanced-git.js';
import {
  agentsConflictsCommand,
  agentsStatusCommand,
  agentsSyncCommand,
} from '../commands/agent-coordination.js';
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

program
  .name('aw')
  .description('Agent-centric development workflow automation')
  .version('0.1.0-alpha');

// ============================================================================
// CORE WORKFLOW COMMANDS
// ============================================================================

program
  .command('init')
  .description('Initialize agent workflow environment')
  .option('--agents <count>', 'Number of agents to set up', '3')
  .option('--template <name>', 'Template to use', 'default')
  .action(initCommand);

program.command('sync').description('Sync with integration branch').action(syncCommand);

program
  .command('validate')
  .description('Validate current work using smart analysis')
  .action(validateCommand);

program.command('save').description('Save current work to agent branch').action(saveCommand);

program.command('ship').description('Ship work to integration branch').action(shipCommand);

program
  .command('status')
  .description('Show current agent and repository status')
  .action(statusCommand);

// ============================================================================
// ENHANCED COMMIT SYSTEM
// ============================================================================

program
  .command('commit')
  .alias('c')
  .description('Enhanced commit with actor-powered analysis')
  .option('--message <msg>', 'Custom commit message')
  .option('--no-verify', 'Skip git hooks')
  .action(commitEnhancedCommand);

program
  .command('generate-message')
  .alias('gm')
  .description('Generate intelligent commit message')
  .action(generateCommitMessageCommand);

program
  .command('validate-dates')
  .alias('vd')
  .description('Validate dates in documentation')
  .option('--files <files>', 'Comma-separated list of files to check')
  .action(validateDatesCommand);

// ============================================================================
// ADVANCED GIT ACTOR COMMANDS
// ============================================================================

program
  .command('actor:status')
  .description('Show git actor system status')
  .action(actorStatusCommand);

program
  .command('actor:worktrees')
  .description('Manage git actor worktrees')
  .option('--count <num>', 'Number of worktrees to create', '3')
  .option('--list', 'List current worktrees')
  .option('--cleanup', 'Clean up old worktrees')
  .action(actorWorktreesCommand);

program
  .command('actor:create')
  .description('Create custom git actor')
  .option('--type <type>', 'Actor type', 'custom')
  .option('--config <config>', 'Actor configuration')
  .action(actorCreateCommand);

// ============================================================================
// AGENT COORDINATION COMMANDS
// ============================================================================

program
  .command('agents:status')
  .description('Show status of all agents')
  .action(agentsStatusCommand);

program
  .command('agents:sync')
  .description('Sync with all agent branches')
  .action(agentsSyncCommand);

program
  .command('agents:conflicts')
  .description('Detect potential conflicts between agents')
  .action(agentsConflictsCommand);

// ============================================================================
// HELP AND ALIASES
// ============================================================================

program
  .command('help')
  .description('Show comprehensive help')
  .action(() => {
    console.log(chalk.blue('🤖 Agent Workflow CLI - Comprehensive Help'));
    console.log(chalk.blue('=========================================='));
    console.log();

    console.log(chalk.yellow('📚 Core Workflow:'));
    console.log(chalk.gray('  aw init           - Initialize agent environment'));
    console.log(chalk.gray('  aw sync           - Sync with integration branch'));
    console.log(chalk.gray('  aw validate       - Validate current work'));
    console.log(chalk.gray('  aw save           - Save work to agent branch'));
    console.log(chalk.gray('  aw ship           - Ship work to integration'));
    console.log(chalk.gray('  aw status         - Show current status'));
    console.log();

    console.log(chalk.yellow('🎯 Enhanced Commits:'));
    console.log(chalk.gray('  aw commit, c      - Enhanced commit with AI analysis'));
    console.log(chalk.gray('  aw generate-message, gm - Generate smart commit message'));
    console.log(chalk.gray('  aw validate-dates, vd   - Validate documentation dates'));
    console.log();

    console.log(chalk.yellow('🎭 Actor System:'));
    console.log(chalk.gray('  aw actor:status   - Show git actor status'));
    console.log(chalk.gray('  aw actor:worktrees - Manage worktrees'));
    console.log(chalk.gray('  aw actor:create   - Create custom actor'));
    console.log();

    console.log(chalk.yellow('🤝 Agent Coordination:'));
    console.log(chalk.gray('  aw agents:status  - Multi-agent status dashboard'));
    console.log(chalk.gray('  aw agents:sync    - Sync with all agents'));
    console.log(chalk.gray('  aw agents:conflicts - Detect agent conflicts'));
    console.log();

    console.log(chalk.green('💡 Examples:'));
    console.log(chalk.gray('  aw init --agents 3'));
    console.log(chalk.gray('  aw commit --message "feat: add new feature"'));
    console.log(chalk.gray('  aw actor:worktrees --count 5'));
    console.log(chalk.gray('  aw validate-dates --files "docs/*.md"'));
  });

// Error handling
program.on('command:*', (operands) => {
  console.error(chalk.red(`Unknown command: ${operands[0]}`));
  console.log(chalk.gray('Run "aw help" for available commands'));
  process.exit(1);
});

program.parse();
