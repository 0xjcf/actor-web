import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';

export async function syncCommand() {
  console.log(chalk.blue('🔄 Agent Daily Sync'));
  console.log(chalk.blue('==========================================='));

  const git = new GitOperations();

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    const integrationBranch = 'feature/actor-ref-integration';
    const _currentBranch = await git.getCurrentBranch();

    // Check for uncommitted changes
    if (await git.hasUncommittedChanges()) {
      console.log(chalk.yellow('⚠️  You have uncommitted changes'));
      console.log(chalk.blue('💡 Commit your work first: pnpm aw:save or pnpm aw:ship'));
      return;
    }

    console.log(chalk.blue(`🔄 Syncing with ${integrationBranch}...`));

    try {
      // Fetch latest changes
      console.log('   → Fetching latest changes...');
      await git.getGit().fetch(['origin']);

      // Check if integration branch exists
      try {
        await git
          .getGit()
          .raw(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${integrationBranch}`]);
      } catch {
        console.log(chalk.yellow(`⚠️  Integration branch ${integrationBranch} not found`));
        console.log(chalk.blue('💡 It will be created when someone ships first'));
        return;
      }

      // Get status before merge
      const statusBefore = await git.getIntegrationStatus(integrationBranch);

      if (statusBefore.behind === 0) {
        console.log(chalk.green('✅ Already up to date with integration!'));
        return;
      }

      console.log(`   → Merging ${statusBefore.behind} commits from integration...`);

      // Merge integration branch
      await git.getGit().merge([`origin/${integrationBranch}`]);

      console.log(chalk.green('✅ Successfully synced with integration!'));
      console.log(chalk.blue(`📥 Pulled ${statusBefore.behind} commits from other agents`));

      // Show what changed
      try {
        const mergeCommit = await git.getGit().raw(['log', '--oneline', '-1']);
        console.log(chalk.gray(`   Latest: ${mergeCommit.trim()}`));
      } catch {
        // Ignore if we can't get the commit info
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('CONFLICT')) {
        console.log(chalk.red('❌ Merge conflicts detected!'));
        console.log(chalk.blue('💡 Resolve conflicts manually:'));
        console.log('   1. Edit conflicted files');
        console.log('   2. git add <resolved-files>');
        console.log('   3. git commit');
        console.log('   4. Try sync again');
      } else {
        console.error(chalk.red('❌ Failed to sync:'), errorMessage);
        console.log(chalk.blue('💡 Try: git status to see current state'));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during sync:'), error);
    process.exit(1);
  }
}
