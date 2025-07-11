import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';

export async function saveCommand() {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  const git = new GitOperations();

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    // Check for changes
    if (!(await git.hasUncommittedChanges())) {
      console.log(chalk.green('✅ No changes to save'));
      return;
    }

    console.log(chalk.blue('📝 Saving your work...'));

    try {
      // Stage all changes
      await git.getGit().add('.');

      // Auto-commit with agent context
      const _currentBranch = await git.getCurrentBranch();
      const agentType = await git.detectAgentType();
      const timestamp = new Date().toISOString().split('T')[0];
      const message = `[${agentType}] WIP: ${timestamp}`;

      await git.getGit().commit(message);

      console.log(chalk.green('✅ Work saved successfully!'));
      console.log(chalk.gray(`   Commit: ${message}`));
      console.log(chalk.blue('💡 Next steps:'));
      console.log('   • Continue working: make more changes');
      console.log(`   • Ship when ready: ${chalk.yellow('pnpm aw:ship')}`);
      console.log(`   • Check status: ${chalk.yellow('pnpm aw:status')}`);
    } catch (error) {
      console.error(chalk.red('❌ Failed to save changes:'), error);
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during save:'), error);
    process.exit(1);
  }
}
