import path from 'node:path';
import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';
import inquirer from 'inquirer';

const log = Logger.namespace('INIT_COMMAND');

import type { AgentWorktreeConfig } from '../core/agent-config.js';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRootWithOptions } from '../core/repo-root-finder.js';

export interface InitOptions {
  agents: string;
  template: string;
  configPath?: string;
  agentAPath?: string;
  agentBPath?: string;
  agentCPath?: string;
  baseDir?: string;
  integrationBranch?: string;
  root?: string;
}

export async function initCommand(options: InitOptions) {
  log.debug(chalk.blue('🤖 Initializing agent-centric workflow...'));
  log.debug(chalk.gray(`  Agents: ${options.agents}`));
  log.debug(chalk.gray(`  Template: ${options.template}`));
  log.debug('');

  try {
    // Validate agent count input
    const agentCount = Number.parseInt(options.agents);
    if (Number.isNaN(agentCount) || agentCount <= 0 || agentCount > 10) {
      log.debug(chalk.red('❌ Error: Invalid agent count'));
      log.debug(chalk.blue('💡 Agent count must be a positive integer between 1 and 10'));
      log.debug(chalk.gray(`   Received: "${options.agents}"`));
      process.exit(1);
    }

    // Dynamically find repository root using multiple strategies
    const repoRoot = await findRepoRootWithOptions({
      root: options.root,
      cwd: process.cwd(),
    });

    log.debug(chalk.gray(`  Repository root: ${repoRoot}`));
    const git = new GitOperations(repoRoot);

    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      log.debug(chalk.red('❌ Error: Not in a Git repository'));
      log.debug(chalk.blue('💡 Initialize a Git repo first: git init'));
      return;
    }

    // Check if package.json exists (project root indicator)
    const fs = await import('node:fs');
    const packageJsonPath = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      log.debug(chalk.yellow('⚠️  Warning: No package.json found in repository root'));

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue setup anyway?',
          default: false,
        },
      ]);

      if (!proceed) {
        log.debug(chalk.yellow('❌ Setup cancelled'));
        return;
      }
    }

    log.debug(chalk.blue('🌿 Setting up Agent Worktrees...'));
    log.debug('');

    // Build configuration options from CLI parameters
    const configOptions = {
      configPath: options.configPath,
      agentPaths: {
        ...(options.agentAPath && { 'agent-a': options.agentAPath }),
        ...(options.agentBPath && { 'agent-b': options.agentBPath }),
        ...(options.agentCPath && { 'agent-c': options.agentCPath }),
      },
      baseDir: options.baseDir,
      integrationBranch: options.integrationBranch,
    };

    let worktrees: AgentWorktreeConfig[];
    try {
      worktrees = await git.setupAgentWorktrees(agentCount, configOptions);
    } catch (setupError: unknown) {
      console.error(chalk.red('❌ Error setting up agent worktrees:'));
      if (setupError instanceof Error) {
        console.error(chalk.gray(`   ${setupError.message}`));

        // Provide specific guidance based on common error patterns
        if (setupError.message.includes('already exists')) {
          log.debug(chalk.blue('💡 Some worktrees or branches already exist'));
          log.debug(chalk.gray('   Try cleaning up existing worktrees first:'));
          log.debug(chalk.gray('   pnpm aw actor:worktrees --cleanup'));
        } else if (setupError.message.includes('permission')) {
          log.debug(chalk.blue('💡 Permission denied'));
          log.debug(chalk.gray('   Check file permissions and try again'));
        } else if (setupError.message.includes('not found')) {
          log.debug(chalk.blue('💡 Path not found'));
          log.debug(chalk.gray('   Check that the specified paths exist'));
        }
      } else {
        console.error(chalk.gray(`   ${String(setupError)}`));
      }
      process.exit(1);
    }

    if (worktrees.length === 0) {
      log.debug(chalk.red('❌ Failed to set up any worktrees'));
      log.debug(chalk.blue('💡 Check the logs above for specific error details'));
      return;
    }

    log.debug('');
    log.debug(chalk.green('🎉 Worktrees setup complete!'));
    log.debug('');
    log.debug(chalk.blue('📋 Next steps for each agent:'));
    log.debug('');

    // Show agent-specific instructions
    worktrees.forEach((config, index) => {
      const emoji = index === 0 ? '🔧' : index === 1 ? '💻' : '🧪';
      log.debug(chalk.blue(`${emoji} Agent ${config.agentId.toUpperCase()} (${config.role}):`));
      log.debug(`   cd ${config.path}`);
      log.debug('   # Open this directory in your IDE');
      log.debug('');
    });

    log.debug(chalk.blue('📚 Each agent now has an independent workspace!'));
    log.debug('   - No more branch jumping conflicts');
    log.debug('   - Shared Git history and objects');
    log.debug('   - Minimal disk space usage');
    log.debug('   - Ready for parallel development');
    log.debug('');

    log.debug(chalk.green('✅ Agent workflow initialization complete!'));
    log.debug(chalk.blue('💡 Next: Run `pnpm aw status` in each agent workspace'));
  } catch (error) {
    console.error(chalk.red('❌ Error during initialization:'));

    if (error instanceof Error) {
      console.error(chalk.gray(`   ${error.message}`));

      // Provide contextual help based on error type
      if (error.message.includes('repository root')) {
        log.debug(chalk.blue('💡 Try specifying the repository root explicitly:'));
        log.debug(chalk.gray('   pnpm aw init --root /path/to/your/repo'));
      } else if (error.message.includes('not a git repository')) {
        log.debug(chalk.blue('💡 Initialize a Git repository first:'));
        log.debug(chalk.gray('   git init'));
      } else if (error.message.includes('permission')) {
        log.debug(chalk.blue('💡 Check file permissions and try again'));
      }
    } else {
      console.error(chalk.gray(`   ${String(error)}`));
    }

    process.exit(1);
  }
}
