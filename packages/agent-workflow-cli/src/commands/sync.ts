import path from 'node:path';
import { Logger } from '@actor-web/runtime';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';

const log = Logger.namespace('SYNC_COMMAND');

export async function syncCommand() {
  log.debug(chalk.blue('🔄 Agent Daily Sync'));
  log.debug(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      log.debug(chalk.red('❌ Not in a Git repository'));
      return;
    }

    const integrationBranch = 'feature/actor-ref-integration';
    const _currentBranch = await git.getCurrentBranch();

    // Check for uncommitted changes
    if (await git.hasUncommittedChanges()) {
      log.debug(chalk.yellow('⚠️  You have uncommitted changes'));
      log.debug(chalk.blue('💡 Commit your work first: pnpm aw:save or pnpm aw:ship'));
      return;
    }

    log.debug(chalk.blue(`🔄 Syncing with ${integrationBranch}...`));

    try {
      // Fetch latest changes
      log.debug('   → Fetching latest changes...');
      await git.getGit().fetch(['origin']);

      // Check if integration branch exists
      try {
        await git
          .getGit()
          .raw(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${integrationBranch}`]);
      } catch {
        log.debug(chalk.yellow(`⚠️  Integration branch ${integrationBranch} not found`));
        log.debug(chalk.blue('💡 It will be created when someone ships first'));
        return;
      }

      // Get status before merge
      const statusBefore = await git.getIntegrationStatus(integrationBranch);

      if (statusBefore.behind === 0) {
        log.debug(chalk.green('✅ Already up to date with integration!'));
        return;
      }

      log.debug(`   → Merging ${statusBefore.behind} commits from integration...`);

      // Merge integration branch
      await git.getGit().merge([`origin/${integrationBranch}`]);

      log.debug(chalk.green('✅ Successfully synced with integration!'));
      log.debug(chalk.blue(`📥 Pulled ${statusBefore.behind} commits from other agents`));

      // Show what changed
      try {
        const mergeCommit = await git.getGit().raw(['log', '--oneline', '-1']);
        log.debug(chalk.gray(`   Latest: ${mergeCommit.trim()}`));
      } catch {
        // Ignore if we can't get the commit info
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (errorMessage.includes('CONFLICT')) {
        log.debug(chalk.red('❌ Merge conflicts detected!'));
        log.debug(chalk.blue('💡 Resolve conflicts manually:'));
        log.debug('   1. Edit conflicted files');
        log.debug('   2. git add <resolved-files>');
        log.debug('   3. git commit');
        log.debug('   4. Try sync again');
      } else {
        console.error(chalk.red('❌ Failed to sync:'), errorMessage);
        log.debug(chalk.blue('💡 Try: git status to see current state'));
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during sync:'), error);
    process.exit(1);
  }
}
