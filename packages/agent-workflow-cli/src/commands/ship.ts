import chalk from 'chalk';
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

  console.log(chalk.blue('🚀 Ship Workflow'));
  if (isDryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No changes will be made'));
  }
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    console.log(chalk.gray('🔍 Checking repository status...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      console.log(chalk.red('❌ Not a git repository'));
      return;
    }

    const currentBranch = await git.getCurrentBranch();
    if (!currentBranch) {
      console.log(chalk.red('❌ Could not determine current branch'));
      return;
    }

    console.log(chalk.blue(`📋 Current branch: ${currentBranch}`));

    // Handle uncommitted changes
    const hasChanges = await git.hasUncommittedChanges();
    if (hasChanges) {
      console.log(chalk.yellow('⚠️  Uncommitted changes detected'));

      if (isDryRun) {
        console.log(chalk.cyan('📝 [DRY RUN] Would commit changes with message:'));
        const commitMessage = generateAutoCommitMessage(currentBranch);
        console.log(chalk.gray(`   "${commitMessage.split('\n')[0]}"`));
      } else {
        // Generate and commit changes
        const commitMessage = generateAutoCommitMessage(currentBranch);
        console.log(chalk.gray('📝 Committing changes...'));

        await git.addAll();
        const commitHash = await git.commit(commitMessage);

        console.log(chalk.green(`✅ Changes committed! Commit: ${commitHash.substring(0, 7)}`));
      }
    } else {
      console.log(chalk.green('✅ No uncommitted changes'));
    }

    // Check integration status
    console.log(chalk.gray('🔍 Checking integration status...'));
    const integrationStatus = await git.getIntegrationStatus();

    const { ahead, behind } = integrationStatus;
    console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      console.log(chalk.yellow(`⚠️  Your branch is ${behind} commits behind integration`));
      console.log(chalk.gray('   Consider merging or rebasing before shipping'));
    }

    // Push changes
    if (isDryRun) {
      console.log(chalk.cyan(`🚀 [DRY RUN] Would push changes to origin/${currentBranch}`));
      console.log(chalk.cyan('✅ [DRY RUN] Ship workflow would complete successfully!'));
      console.log(
        chalk.gray('💡 [DRY RUN] Changes would be available in the integration environment')
      );
    } else {
      console.log(chalk.gray('🚀 Pushing changes...'));
      await git.pushChanges(currentBranch);

      console.log(chalk.green('✅ Changes pushed successfully'));
      console.log(chalk.green('🚀 Ship workflow completed successfully!'));
      console.log(chalk.gray('💡 Your changes are now in the integration environment'));
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
