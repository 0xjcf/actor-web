import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
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

    // Setup agent worktrees
    const agentCount = Number.parseInt(options.agents);

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

    const worktrees = await git.setupAgentWorktrees(agentCount, configOptions);

    if (worktrees.length === 0) {
      console.log(chalk.red('❌ Failed to set up any worktrees'));
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
    console.error(chalk.red('❌ Error during initialization:'), error);
    console.log(chalk.blue('💡 Try specifying the repository root explicitly:'));
    console.log(chalk.gray('   pnpm aw init --root /path/to/your/repo'));
    process.exit(1);
  }
}
