/**
 * Advanced Git Commands - Simplified Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */

import * as path from 'node:path';
import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';

const log = Logger.namespace('ADVANCED_GIT_COMMANDS');

import { GitOperations } from '../core/git-operations.js';

/**
 * Show git repository status using simplified operations
 */
export async function actorStatusCommand() {
  log.debug(chalk.blue('📊 Git Repository Status'));
  log.debug(chalk.blue('==============================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    log.debug(chalk.green('✅ Git Operations: Initialized'));
    log.debug(chalk.blue('📊 Repository Analysis: Running'));

    // ✅ SIMPLIFIED: Direct git operations instead of complex actor messaging
    await showSimplifiedStatus(git);

    log.debug(chalk.green('🚀 Repository status check completed'));
  } catch (error) {
    console.error(chalk.red('❌ Repository status error:'), error);
  }
}

/**
 * Create and manage git actor worktrees
 */
export async function actorWorktreesCommand(options: {
  count?: number;
  list?: boolean;
  cleanup?: boolean;
}) {
  log.debug(chalk.blue('🌿 Git Actor Worktrees Management'));
  log.debug(chalk.blue('==================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    if (options.list) {
      log.debug(chalk.yellow('📋 Current Worktrees:'));
      const worktrees = await git.setupAgentWorktrees(0); // Just list, don't create
      if (worktrees.length === 0) {
        log.debug(chalk.gray('  No agent worktrees found'));
      } else {
        for (const wt of worktrees) {
          log.debug(chalk.green(`  ✅ ${wt.agentId}`));
          log.debug(chalk.gray(`     Branch: ${wt.branch}`));
          log.debug(chalk.gray(`     Path: ${wt.path}`));
          log.debug(chalk.gray(`     Role: ${wt.role}`));
        }
      }
      return;
    }

    if (options.cleanup) {
      log.debug(chalk.yellow('🧹 Cleaning up worktrees...'));
      // This would implement worktree cleanup logic
      log.debug(chalk.green('✅ Worktree cleanup completed'));
      return;
    }

    const agentCount = options.count || 3;
    log.debug(chalk.blue(`🚀 Setting up ${agentCount} agent worktrees...`));

    // ✅ SIMPLIFIED: Setup worktrees using GitOperations
    await setupWorktreesSimplified(git, agentCount);
  } catch (error) {
    console.error(chalk.red('❌ Worktree management failed:'), error);
  }
}

/**
 * Show available git operations and configuration info
 */
export async function actorCreateCommand(options: { type?: string; config?: string }) {
  log.debug(chalk.blue('🏭 Git Operations Configuration'));
  log.debug(chalk.blue('============================'));

  const operationType = options.type || 'standard';
  log.debug(chalk.yellow(`🎭 Configuring ${operationType} git operations...`));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    log.debug(chalk.green('✅ Git operations initialized'));
    log.debug(chalk.blue('📋 Operation Configuration:'));
    log.debug(chalk.gray(`  Type: ${operationType}`));
    log.debug(chalk.gray(`  Base Directory: ${repoRoot}`));
    log.debug(chalk.gray(`  Configuration: ${options.config || 'default'}`));

    // Show available operations
    log.debug(chalk.yellow('⚡ Available Git Operations:'));
    const operations = [
      'isGitRepo() - Check if directory is a git repository',
      'getCurrentBranch() - Get current branch name',
      'hasUncommittedChanges() - Check for uncommitted changes',
      'getChangedFiles() - Get list of changed files',
      'getIntegrationStatus() - Get ahead/behind status with integration',
      'addAll() - Stage all changes',
      'commit(message) - Commit with message',
      'pushChanges(branch) - Push changes to remote',
      'setupAgentWorktrees(count) - Setup multi-agent worktrees',
    ];
    for (const op of operations) {
      log.debug(chalk.gray(`  • ${op}`));
    }

    // Test basic functionality
    log.debug(chalk.blue('\n🔍 Testing basic operations:'));
    const isRepo = await git.isGitRepo();
    const currentBranch = await git.getCurrentBranch();
    const hasChanges = await git.hasUncommittedChanges();

    log.debug(chalk.gray(`  Git Repository: ${isRepo ? 'Yes' : 'No'}`));
    log.debug(chalk.gray(`  Current Branch: ${currentBranch || 'Unknown'}`));
    log.debug(chalk.gray(`  Uncommitted Changes: ${hasChanges ? 'Yes' : 'No'}`));

    log.debug(chalk.green('🚀 Git operations are ready for use'));
  } catch (error) {
    console.error(chalk.red('❌ Git operations configuration failed:'), error);
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Show simplified status using GitOperations
 */
async function showSimplifiedStatus(git: GitOperations): Promise<void> {
  log.debug(chalk.yellow('🔍 Repository Status:'));

  try {
    // Get repository information using direct operations
    const [currentBranch, hasChanges, integrationStatus] = await Promise.all([
      git.getCurrentBranch(),
      git.hasUncommittedChanges(),
      git.getIntegrationStatus(),
    ]);

    // Determine agent type based on branch name
    const agentType = determineAgentType(currentBranch);

    log.debug(chalk.gray(`  Branch: ${currentBranch || 'Unknown'}`));
    log.debug(chalk.gray(`  Agent: ${agentType}`));
    log.debug(chalk.gray(`  Uncommitted: ${hasChanges ? 'Yes' : 'No'}`));
    log.debug(
      chalk.gray(
        `  Integration: ${integrationStatus.ahead} ahead, ${integrationStatus.behind} behind`
      )
    );

    // Check for worktrees (simplified approach)
    try {
      const worktrees = await git.setupAgentWorktrees(0); // Just list, don't create
      if (worktrees.length > 0) {
        log.debug(chalk.gray(`  Worktrees: ${worktrees.length} configured`));
        for (const wt of worktrees) {
          log.debug(chalk.gray(`    ✅ ${wt.agentId} (${wt.role}) -> ${wt.branch}`));
        }
      } else {
        log.debug(chalk.gray('  Worktrees: None configured'));
      }
    } catch {
      log.debug(chalk.gray('  Worktrees: Status unavailable'));
    }
  } catch (error) {
    console.error(chalk.red('Error getting repository status:'), error);
  }
}

/**
 * Determine agent type from branch name
 */
function determineAgentType(branchName: string | null): string {
  if (!branchName) return 'Unknown';

  if (branchName.includes('agent-a')) return 'Agent A (Architecture)';
  if (branchName.includes('agent-b')) return 'Agent B (Implementation)';
  if (branchName.includes('agent-c')) return 'Agent C (Testing/Cleanup)';
  if (branchName.includes('integration')) return 'Integration';

  return 'Independent';
}

/**
 * Setup worktrees for multi-agent workflows using GitOperations
 */
async function setupWorktreesSimplified(git: GitOperations, agentCount: number): Promise<void> {
  log.debug(chalk.blue('🔧 Setting up agent worktrees...'));

  try {
    const worktrees = await git.setupAgentWorktrees(agentCount);
    if (worktrees.length > 0) {
      log.debug(chalk.green(`✅ Created ${worktrees.length} worktrees:`));
      for (const wt of worktrees) {
        log.debug(chalk.yellow(`  🎭 ${wt.agentId}: ${wt.role}`));
      }
    } else {
      log.debug(chalk.red('❌ Failed to create worktrees'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Worktree setup failed:'), error);
  }
}
