import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

const log = Logger.namespace('STATUS_COMMAND');

/**
 * Status Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function statusCommand() {
  log.debug(chalk.blue('📊 Status Check'));
  log.debug(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    log.debug(chalk.gray('🔍 Checking repository...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      log.debug(chalk.red('❌ Not a git repository'));
      return;
    }

    log.debug(chalk.green('✅ Git repository confirmed'));

    // Get all status information in parallel for speed
    log.debug(chalk.gray('🔍 Gathering status information...'));

    const [currentBranch, hasChanges, integrationStatus, changedFiles] = await Promise.all([
      git.getCurrentBranch(),
      git.hasUncommittedChanges(),
      git.getIntegrationStatus(),
      git.getChangedFiles(),
    ]);

    // Determine agent type based on branch name
    const agentType = determineAgentType(currentBranch);

    // ✅ SIMPLIFIED: Display status summary
    displayStatusSummary({
      currentBranch,
      agentType,
      uncommittedChanges: hasChanges,
      integrationStatus,
      changedFiles,
    });
  } catch (error) {
    console.error(chalk.red('❌ Status check failed:'), error);
    process.exit(1);
  }
}

/**
 * Determine agent type from branch name
 */
function determineAgentType(branchName: string | null): string {
  if (!branchName) return 'unknown';

  if (branchName.includes('agent-a')) return 'Agent A';
  if (branchName.includes('agent-b')) return 'Agent B';
  if (branchName.includes('agent-c')) return 'Agent C';
  if (branchName.includes('integration')) return 'Integration';

  return 'Independent';
}

/**
 * Display status summary
 */
function displayStatusSummary(status: {
  currentBranch?: string | null;
  agentType?: string;
  uncommittedChanges?: boolean;
  integrationStatus?: { ahead: number; behind: number };
  changedFiles?: string[];
}): void {
  log.debug(chalk.blue('\n📊 Repository Status'));
  log.debug(chalk.blue('==========================================='));

  // Branch information
  if (status.currentBranch) {
    log.debug(chalk.white(`📍 Current Branch: ${chalk.cyan(status.currentBranch)}`));
  }

  // Agent type
  if (status.agentType) {
    log.debug(chalk.white(`🤖 Agent Type: ${chalk.yellow(status.agentType)}`));
  }

  // Uncommitted changes
  if (status.uncommittedChanges) {
    log.debug(chalk.yellow('📝 Uncommitted changes present'));
    if (status.changedFiles && status.changedFiles.length > 0) {
      log.debug(chalk.gray(`   ${status.changedFiles.length} files changed`));
      // Show first few files if not too many
      if (status.changedFiles.length <= 5) {
        for (const file of status.changedFiles) {
          log.debug(chalk.gray(`   • ${file}`));
        }
      } else {
        for (const file of status.changedFiles.slice(0, 3)) {
          log.debug(chalk.gray(`   • ${file}`));
        }
        log.debug(chalk.gray(`   ... and ${status.changedFiles.length - 3} more`));
      }
    }
  } else {
    log.debug(chalk.green('✅ Working directory clean'));
  }

  // Integration status
  if (status.integrationStatus) {
    const { ahead, behind } = status.integrationStatus;
    if (ahead > 0 || behind > 0) {
      log.debug(chalk.white('🔄 Integration Status:'));
      if (ahead > 0) {
        log.debug(chalk.green(`   ↑ ${ahead} commits ahead`));
      }
      if (behind > 0) {
        log.debug(chalk.yellow(`   ↓ ${behind} commits behind`));
      }
    } else {
      log.debug(chalk.green('✅ In sync with integration branch'));
    }
  }

  log.debug(chalk.blue('==========================================='));
}
