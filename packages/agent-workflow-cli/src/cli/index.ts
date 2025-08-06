#!/usr/bin/env node

import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';
import { program } from 'commander';

const log = Logger.namespace('CLI_INDEX');

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
import { generateCommitMessageCommand } from '../commands/commit-enhanced.js';
import { initCommand } from '../commands/init.js';
import { saveCommand } from '../commands/save.js';
import { shipCommand } from '../commands/ship.js';
import { statusCommand } from '../commands/status.js';
import { syncCommand } from '../commands/sync.js';
import { validateCommand } from '../commands/validate.js';
import { getDescriptionSync, getVersionSync, initializePackageInfo } from '../package-info.js';

// ============================================================================
// SIMPLIFIED INITIALIZATION - No Actor System by Default
// ============================================================================

async function initializeBasics() {
  try {
    // Only load package info - no heavy actor system initialization
    await initializePackageInfo();
    return true;
  } catch (error) {
    console.error(chalk.red('CLI Initialization Error:'), error);
    return false;
  }
}

// Initialize basics at module load time (lightweight)
const initPromise = initializeBasics();

// ============================================================================
// CORE WORKFLOW COMMANDS
// ============================================================================

program
  .command('init')
  .description('Initialize agent workflow environment')
  .option('--agents <count>', 'Number of agents to set up', '3')
  .option('--template <name>', 'Template to use', 'default')
  .option('--config-path <path>', 'Path to agent configuration file')
  .option('--agent-a-path <path>', 'Custom path for Agent A workspace')
  .option('--agent-b-path <path>', 'Custom path for Agent B workspace')
  .option('--agent-c-path <path>', 'Custom path for Agent C workspace')
  .option('--base-dir <path>', 'Base directory for relative paths')
  .option('--integration-branch <branch>', 'Integration branch name')
  .option('--root <path>', 'Specify repository root path explicitly')
  .action(async (options) => {
    await initPromise; // Ensure initialization is complete
    await initCommand(options);
  });

program.command('sync').description('Sync with integration branch').action(syncCommand);

program
  .command('validate')
  .description('Validate current work using smart analysis')
  .option('--root <path>', 'Specify repository root path explicitly')
  .action(validateCommand);

program
  .command('save [message]')
  .description('Save current work to agent branch with optional commit message')
  .option('--dry-run', 'Show what would be done without actually doing it')
  .option('--interactive', 'Enhanced commit with confirmation and detailed analysis')
  .action(saveCommand);

program
  .command('ship')
  .description('Ship work to integration branch')
  .option('--dry-run', 'Show what would be done without actually doing it')
  .action(shipCommand);

program
  .command('status')
  .description('Show current agent and repository status')
  .option('--root <path>', 'Specify repository root path explicitly')
  .action(async () => {
    await initPromise; // Ensure initialization is complete
    await statusCommand();
  });

// ============================================================================
// MESSAGE GENERATION UTILITIES
// ============================================================================

program
  .command('generate-message')
  .alias('gm')
  .description('Generate intelligent commit message')
  .action(generateCommitMessageCommand);

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
// STATE MACHINE ANALYSIS COMMANDS
// ============================================================================

program
  .command('analyze')
  .description('Analyze state machine definitions for unreachable states')
  .option('--target <target>', 'Target machine to analyze (default: git-actor)')
  .option('--verbose', 'Show detailed analysis output')
  .option('--assert', 'Run assertion tests for unreachable states')
  .option('--debug', 'Show detailed debugging information about state transitions')
  .option('--subscribe', 'Subscribe to live state transitions for debugging')
  .option('--validate', 'Run comprehensive validation checks for workflow consistency')
  .option(
    '--workflow',
    'Run enhanced workflow analysis to detect dead-end states and missing transitions'
  )
  .option(
    '--events <events>',
    'Comma-separated list of events to send in sequence (e.g., "CHECK_STATUS,PUSH_CHANGES")'
  )
  .option('--event-delay <ms>', 'Delay between events in milliseconds (default: 1000)', '1000')
  .option(
    '--event-data <json>',
    'JSON data for events that need parameters (e.g., \'{"branch":"feature/agent-a"}\')'
  )
  .option('--auto-run', 'Run events automatically without interactive mode')
  .action(async (options) => {
    const { analyzeCommand } = await import('../commands/state-machine-analysis.js');
    await analyzeCommand(options);
  });

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
    log.debug(chalk.blue('🤖 Agent Workflow CLI - Comprehensive Help'));
    log.debug(chalk.blue('=========================================='));
    log.debug();

    log.debug(chalk.yellow('📚 Core Workflow:'));
    log.debug(chalk.gray('  aw init           - Initialize agent environment'));
    log.debug(chalk.gray('  aw sync           - Sync with integration branch'));
    log.debug(chalk.gray('  aw validate       - Validate current work'));
    log.debug(chalk.gray('  aw save           - Save work to agent branch'));
    log.debug(chalk.gray('  aw ship           - Ship work to integration'));
    log.debug(chalk.gray('  aw status         - Show current status'));
    log.debug();

    log.debug(chalk.yellow('🎯 Enhanced Commits:'));
    log.debug(chalk.gray('  aw commit, c      - Enhanced commit with AI analysis'));
    log.debug(chalk.gray('  aw generate-message, gm - Generate smart commit message'));
    log.debug(chalk.gray('  aw validate-dates, vd   - Validate documentation dates'));
    log.debug();

    log.debug(chalk.yellow('🎭 Actor System:'));
    log.debug(chalk.gray('  aw actor:status   - Show git actor status'));
    log.debug(chalk.gray('  aw actor:worktrees - Manage worktrees'));
    log.debug(chalk.gray('  aw actor:create   - Create custom actor'));
    log.debug();

    log.debug(chalk.yellow('🔍 Analysis Tools:'));
    log.debug(chalk.gray('  aw analyze        - Analyze state machines'));
    log.debug(chalk.gray('  aw analyze --verbose - Detailed analysis output'));
    log.debug(chalk.gray('  aw analyze --assert  - Assert no unreachable states'));
    log.debug(chalk.gray('  aw analyze --workflow - Enhanced workflow analysis'));
    log.debug();

    log.debug(chalk.yellow('🤝 Agent Coordination:'));
    log.debug(chalk.gray('  aw agents:status  - Multi-agent status dashboard'));
    log.debug(chalk.gray('  aw agents:sync    - Sync with all agents'));
    log.debug(chalk.gray('  aw agents:conflicts - Detect agent conflicts'));
    log.debug();

    log.debug(chalk.green('💡 Examples:'));
    log.debug(chalk.gray('  aw init --agents 3'));
    log.debug(chalk.gray('  aw commit --message "feat: add new feature"'));
    log.debug(chalk.gray('  aw actor:worktrees --count 5'));
    log.debug(chalk.gray('  aw analyze --target git-actor --verbose'));
    log.debug(chalk.gray('  aw validate-dates --files "docs/*.md"'));
  });

// Async main function to handle program execution
async function main() {
  try {
    // Wait for basic initialization to complete (lightweight)
    const initialized = await initPromise;
    if (!initialized) {
      process.exit(1);
    }

    // Configure program with loaded package info
    program.name('aw').description(getDescriptionSync()).version(getVersionSync());

    // Error handling
    program.on('command:*', (operands) => {
      console.error(chalk.red(`Unknown command: ${operands[0]}`));
      log.debug(chalk.gray('Run "aw help" for available commands'));
      process.exit(1);
    });

    // Parse command line arguments first to determine what we're running
    await program.parseAsync();

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      log.debug(chalk.yellow('\n⚠️  Received SIGINT, shutting down gracefully...'));
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      log.debug(chalk.yellow('\n⚠️  Received SIGTERM, shutting down gracefully...'));
      process.exit(0);
    });

    // Handle process exit
    process.on('exit', () => {
      log.debug(chalk.gray('👋 CLI process exiting'));
    });
  } catch (error) {
    console.error(chalk.red('CLI Error:'), error);
    process.exit(1);
  }
}

// Handle async main
main().catch(async (error) => {
  console.error(chalk.red('CLI Error:'), error);
  process.exit(1);
});
