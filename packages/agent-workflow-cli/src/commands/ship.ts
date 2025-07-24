import chalk from 'chalk';
import { createGitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Ship Command - Pure Actor Model Implementation
 *
 * ✅ PURE ACTOR MODEL: Uses only ask/tell patterns
 * ❌ NO subscriptions, handlers, or classes
 */
export async function shipCommand() {
  console.log(chalk.blue('🚀 Ship Workflow'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // ✅ PURE ACTOR MODEL: Get status using ask pattern
    const status = await gitActor.ask({
      type: 'REQUEST_STATUS',
    });

    if (!status.isGitRepo) {
      console.log(chalk.red('❌ Not a git repository'));
      return;
    }

    if (!status.currentBranch) {
      console.log(chalk.red('❌ Could not determine current branch'));
      return;
    }

    console.log(chalk.blue(`📋 Current branch: ${status.currentBranch}`));

    // Handle uncommitted changes
    if (status.uncommittedChanges) {
      console.log(chalk.yellow('⚠️  Uncommitted changes detected'));

      // ✅ PURE ACTOR MODEL: Commit changes using ask pattern
      const commitResponse = await gitActor.ask({
        type: 'COMMIT_CHANGES',
        payload: { message: generateAutoCommitMessage(status.currentBranch) },
      });

      console.log(
        chalk.green(`✅ Changes committed! Commit: ${commitResponse.commitHash.substring(0, 7)}`)
      );
    }

    // ✅ PURE ACTOR MODEL: Check integration status using ask pattern
    const integrationStatus = await gitActor.ask({
      type: 'GET_INTEGRATION_STATUS',
    });

    const { ahead, behind } = integrationStatus;
    console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      console.log(chalk.yellow(`⚠️  Your branch is ${behind} commits behind integration`));
      console.log(chalk.gray('   Consider merging or rebasing before shipping'));
    }

    // ✅ PURE ACTOR MODEL: Push changes using ask pattern
    await gitActor.ask({
      type: 'PUSH_CHANGES',
      payload: { branch: status.currentBranch },
    });

    console.log(chalk.green('✅ Changes pushed successfully'));
    console.log(chalk.green('🚀 Ship workflow completed successfully!'));
    console.log(chalk.gray('💡 Your changes are now in the integration environment'));
  } catch (error) {
    console.error(chalk.red('❌ Ship failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
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
