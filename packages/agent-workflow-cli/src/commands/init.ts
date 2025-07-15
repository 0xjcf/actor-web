import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { GitOperations } from '../core/git-operations.js';

export interface InitOptions {
  agents: string;
  template: string;
  configPath?: string;
  agentAPath?: string;
  agentBPath?: string;
  agentCPath?: string;
  baseDir?: string;
  integrationBranch?: string;
}

export async function initCommand(options: InitOptions) {
  console.log(chalk.blue('🤖 Initializing agent-centric workflow...'));
  console.log(chalk.gray(`  Agents: ${options.agents}`));
  console.log(chalk.gray(`  Template: ${options.template}`));
  console.log('');

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Error: Not in a Git repository'));
      console.log(chalk.blue('💡 Initialize a Git repo first: git init'));
      return;
    }

    // Check if package.json exists (project root indicator)
    const fs = await import('node:fs');
    if (!fs.existsSync('package.json')) {
      console.log(chalk.yellow('⚠️  Warning: No package.json found'));

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
    console.log('');
    console.log(chalk.blue('🔄 Daily workflow:'));
    console.log('   1. Work in your agent directory');
    console.log(`   2. Save changes: ${chalk.yellow('pnpm aw:save')}`);
    console.log(`   3. Ship features: ${chalk.yellow('pnpm aw:ship')}`);
    console.log(`   4. Daily sync: ${chalk.yellow('pnpm aw:sync')}`);
    console.log('');
    console.log(chalk.blue('📖 See docs/AGENT-WORKFLOW-GUIDE.md for detailed instructions.'));

    // Create basic integration branch if it doesn't exist
    try {
      await git.getGit().checkout(['-b', 'feature/actor-ref-integration']);
      await git.getGit().push(['origin', 'feature/actor-ref-integration']);
      console.log(chalk.green('✅ Created integration branch: feature/actor-ref-integration'));
    } catch {
      console.log(chalk.blue('ℹ️  Integration branch already exists or will be created later'));
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(chalk.red('❌ Error during initialization:'), errorMessage);
    console.log('');
    console.log(chalk.blue('💡 Troubleshooting:'));
    console.log('   - Ensure you have Git installed');
    console.log('   - Ensure you have write permissions');
    console.log('   - Check that parent directories exist');
    process.exit(1);
  }
}
