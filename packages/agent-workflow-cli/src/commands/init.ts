import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
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
  console.log(chalk.blue('🤖 Initializing agent-centric workflow...'));
  console.log(chalk.gray(`  Agents: ${options.agents}`));
  console.log(chalk.gray(`  Template: ${options.template}`));
  console.log('');

  try {
    // Validate agent count input
    const agentCount = Number.parseInt(options.agents);
    if (Number.isNaN(agentCount) || agentCount <= 0 || agentCount > 10) {
      console.log(chalk.red('❌ Error: Invalid agent count'));
      console.log(chalk.blue('💡 Agent count must be a positive integer between 1 and 10'));
      console.log(chalk.gray(`   Received: "${options.agents}"`));
      process.exit(1);
    }

    // Dynamically find repository root using multiple strategies
    const repoRoot = await findRepoRootWithOptions({
      root: options.root,
      cwd: process.cwd(),
    });

    console.log(chalk.gray(`  Repository root: ${repoRoot}`));
    const git = new GitOperations(repoRoot);

    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Error: Not in a Git repository'));
      console.log(chalk.blue('💡 Initialize a Git repo first: git init'));
      return;
    }

    // Check if package.json exists (project root indicator)
    const fs = await import('node:fs');
    const packageJsonPath = path.join(repoRoot, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      console.log(chalk.yellow('⚠️  Warning: No package.json found in repository root'));

      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue setup anyway?',
          default: false,
        },
      ]);

      if (!proceed) {
        console.log(chalk.yellow('❌ Setup cancelled'));
        return;
      }
    }

    console.log(chalk.blue('🌿 Setting up Agent Worktrees...'));
    console.log('');

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
          console.log(chalk.blue('💡 Some worktrees or branches already exist'));
          console.log(chalk.gray('   Try cleaning up existing worktrees first:'));
          console.log(chalk.gray('   pnpm aw actor:worktrees --cleanup'));
        } else if (setupError.message.includes('permission')) {
          console.log(chalk.blue('💡 Permission denied'));
          console.log(chalk.gray('   Check file permissions and try again'));
        } else if (setupError.message.includes('not found')) {
          console.log(chalk.blue('💡 Path not found'));
          console.log(chalk.gray('   Check that the specified paths exist'));
        }
      } else {
        console.error(chalk.gray(`   ${String(setupError)}`));
      }
      process.exit(1);
    }

    if (worktrees.length === 0) {
      console.log(chalk.red('❌ Failed to set up any worktrees'));
      console.log(chalk.blue('💡 Check the logs above for specific error details'));
      return;
    }

    console.log('');
    console.log(chalk.green('🎉 Worktrees setup complete!'));
    console.log('');
    console.log(chalk.blue('📋 Next steps for each agent:'));
    console.log('');

    // Show agent-specific instructions
    worktrees.forEach((config, index) => {
      const emoji = index === 0 ? '🔧' : index === 1 ? '💻' : '🧪';
      console.log(chalk.blue(`${emoji} Agent ${config.agentId.toUpperCase()} (${config.role}):`));
      console.log(`   cd ${config.path}`);
      console.log('   # Open this directory in your IDE');
      console.log('');
    });

    console.log(chalk.blue('📚 Each agent now has an independent workspace!'));
    console.log('   - No more branch jumping conflicts');
    console.log('   - Shared Git history and objects');
    console.log('   - Minimal disk space usage');
    console.log('   - Ready for parallel development');
    console.log('');

    console.log(chalk.green('✅ Agent workflow initialization complete!'));
    console.log(chalk.blue('💡 Next: Run `pnpm aw status` in each agent workspace'));
  } catch (error) {
    console.error(chalk.red('❌ Error during initialization:'));

    if (error instanceof Error) {
      console.error(chalk.gray(`   ${error.message}`));

      // Provide contextual help based on error type
      if (error.message.includes('repository root')) {
        console.log(chalk.blue('💡 Try specifying the repository root explicitly:'));
        console.log(chalk.gray('   pnpm aw init --root /path/to/your/repo'));
      } else if (error.message.includes('not a git repository')) {
        console.log(chalk.blue('💡 Initialize a Git repository first:'));
        console.log(chalk.gray('   git init'));
      } else if (error.message.includes('permission')) {
        console.log(chalk.blue('💡 Check file permissions and try again'));
      }
    } else {
      console.error(chalk.gray(`   ${String(error)}`));
    }

    process.exit(1);
  }
}
