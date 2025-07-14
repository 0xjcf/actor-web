import path from 'node:path';
import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';

export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitActorIntegration(repoRoot);

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
      // Generate commit message based on whether custom message is provided
      if (customMessage) {
        // Use conventional commit with custom description
        await git.commitWithConvention(customMessage);
        console.log(chalk.green('✅ Work saved successfully!'));
        console.log(chalk.gray(`   Commit: feat: ${customMessage}`));
      } else {
        // Use conventional commit with auto-generated description
        await git.commitWithConvention('auto-save with updated files');
        console.log(chalk.green('✅ Work saved successfully!'));
        console.log(chalk.gray('   Commit: feat: auto-save with updated files'));
      }

      console.log(chalk.blue('💡 Next steps:'));
      console.log('   • Continue working: make more changes');
      console.log(`   • Ship when ready: ${chalk.yellow('pnpm aw:ship')}`);
      console.log(`   • Check status: ${chalk.yellow('pnpm aw:status')}`);
    } catch (error) {
      console.error(chalk.red('❌ Failed to save changes:'), error);
      process.exit(1);
    } finally {
      // Clean up git-actor resources
      await git.stop();
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during save:'), error);
    process.exit(1);
  }
}
