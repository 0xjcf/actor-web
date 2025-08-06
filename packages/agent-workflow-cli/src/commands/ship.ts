import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';

const log = Logger.namespace('SHIP_COMMAND');

import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

interface ShipOptions {
  dryRun?: boolean;
}

/**
 * Ship Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function shipCommand(options: ShipOptions = {}) {
  const isDryRun = options.dryRun || false;

  log.debug(chalk.blue('🚀 Ship Workflow'));
  if (isDryRun) {
    log.debug(chalk.yellow('🔍 DRY RUN MODE - No changes will be made'));
  }
  log.debug(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    log.debug(chalk.gray('🔍 Checking repository status...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      log.debug(chalk.red('❌ Not a git repository'));
      return;
    }

    const currentBranch = await git.getCurrentBranch();
    if (!currentBranch) {
      log.debug(chalk.red('❌ Could not determine current branch'));
      return;
    }

    log.debug(chalk.blue(`📋 Current branch: ${currentBranch}`));

    // Handle uncommitted changes
    const hasChanges = await git.hasUncommittedChanges();
    if (hasChanges) {
      log.debug(chalk.yellow('⚠️  Uncommitted changes detected'));

      if (isDryRun) {
        log.debug(chalk.cyan('📝 [DRY RUN] Would commit changes with message:'));
        const commitMessage = generateAutoCommitMessage(currentBranch);
        log.debug(chalk.gray(`   "${commitMessage.split('\n')[0]}"`));
      } else {
        // Generate and commit changes
        const commitMessage = generateAutoCommitMessage(currentBranch);
        log.debug(chalk.gray('📝 Committing changes...'));

        await git.addAll();
        const commitHash = await git.commit(commitMessage);

        log.debug(chalk.green(`✅ Changes committed! Commit: ${commitHash.substring(0, 7)}`));
      }
    } else {
      log.debug(chalk.green('✅ No uncommitted changes'));
    }

    // Check integration status
    log.debug(chalk.gray('🔍 Checking integration status...'));
    const integrationStatus = await git.getIntegrationStatus();

    const { ahead, behind } = integrationStatus;
    log.debug(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      log.debug(chalk.yellow(`⚠️  Your branch is ${behind} commits behind integration`));
      log.debug(chalk.gray('   Consider merging or rebasing before shipping'));
    }

    // Push changes
    if (isDryRun) {
      log.debug(chalk.cyan(`🚀 [DRY RUN] Would push changes to origin/${currentBranch}`));
      log.debug(chalk.cyan('✅ [DRY RUN] Ship workflow would complete successfully!'));
      log.debug(
        chalk.gray('💡 [DRY RUN] Changes would be available in the integration environment')
      );
    } else {
      log.debug(chalk.gray('🚀 Pushing changes...'));
      await git.pushChanges(currentBranch);

      log.debug(chalk.green('✅ Changes pushed successfully'));
      log.debug(chalk.green('🚀 Ship workflow completed successfully!'));
      log.debug(chalk.gray('💡 Your changes are now in the integration environment'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Ship failed:'), error);
    process.exit(1);
  }
}

/**
 * Generate auto-commit message
 */
function generateAutoCommitMessage(branchName: string): string {
  const currentDate = new Date().toISOString();

  return `ship: auto-commit for integration deployment

Branch: ${branchName}
Date: ${currentDate}
Context: Automatic commit created by ship workflow

[actor-web] Ship workflow - auto-commit for integration`;
}
