import chalk from 'chalk';
import { createGitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Status Command - Pure Actor Model Implementation
 *
 * ✅ PURE ACTOR MODEL: Uses only ask/tell patterns
 * ❌ NO subscriptions, handlers, or classes
 */
export async function statusCommand() {
  console.log(chalk.blue('📊 Status Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // ✅ PURE ACTOR MODEL: Step 1 - Check repository status using ask pattern
    console.log(chalk.gray('🔍 Checking repository...'));
    const repoStatus = await gitActor.ask({
      type: 'REQUEST_STATUS',
    });

    if (!repoStatus.isGitRepo) {
      console.log(chalk.red('❌ Not a git repository'));
      return;
    }

    console.log(chalk.green('✅ Git repository confirmed'));

    // ✅ PURE ACTOR MODEL: Step 2 - Check for uncommitted changes using ask pattern
    console.log(chalk.gray('🔍 Checking for uncommitted changes...'));
    const changesStatus = await gitActor.ask({
      type: 'CHECK_UNCOMMITTED_CHANGES',
    });

    // ✅ PURE ACTOR MODEL: Step 3 - Get integration status using ask pattern
    console.log(chalk.gray('🔍 Checking integration status...'));
    const integrationStatus = await gitActor.ask({
      type: 'GET_INTEGRATION_STATUS',
    });

    // ✅ PURE ACTOR MODEL: Step 4 - Display status summary
    displayStatusSummary({
      currentBranch: repoStatus.currentBranch,
      agentType: repoStatus.agentType,
      uncommittedChanges: changesStatus.uncommittedChanges,
      integrationStatus,
    });
  } catch (error) {
    console.error(chalk.red('❌ Status check failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * Display status summary
 */
function displayStatusSummary(status: {
  currentBranch?: string;
  agentType?: string;
  uncommittedChanges?: boolean;
  integrationStatus?: { ahead: number; behind: number };
}): void {
  console.log(chalk.blue('\n📊 Repository Status'));
  console.log(chalk.blue('==========================================='));

  // Branch information
  if (status.currentBranch) {
    console.log(chalk.white(`📍 Current Branch: ${chalk.cyan(status.currentBranch)}`));
  }

  // Agent type
  if (status.agentType) {
    console.log(chalk.white(`🤖 Agent Type: ${chalk.yellow(status.agentType)}`));
  }

  // Uncommitted changes
  if (status.uncommittedChanges) {
    console.log(chalk.yellow('📝 Uncommitted changes present'));
  } else {
    console.log(chalk.green('✅ Working directory clean'));
  }

  // Integration status
  if (status.integrationStatus) {
    const { ahead, behind } = status.integrationStatus;
    if (ahead > 0 || behind > 0) {
      console.log(chalk.white('🔄 Integration Status:'));
      if (ahead > 0) {
        console.log(chalk.green(`   ↑ ${ahead} commits ahead`));
      }
      if (behind > 0) {
        console.log(chalk.yellow(`   ↓ ${behind} commits behind`));
      }
    } else {
      console.log(chalk.green('✅ In sync with integration branch'));
    }
  }

  console.log(chalk.blue('==========================================='));
}
