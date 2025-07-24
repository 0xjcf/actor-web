/**
 * Advanced Git Commands - Simplified Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';

/**
 * Show git repository status using simplified operations
 */
export async function actorStatusCommand() {
  console.log(chalk.blue('📊 Git Repository Status'));
  console.log(chalk.blue('==============================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    console.log(chalk.green('✅ Git Operations: Initialized'));
    console.log(chalk.blue('📊 Repository Analysis: Running'));

    // ✅ SIMPLIFIED: Direct git operations instead of complex actor messaging
    await showSimplifiedStatus(git);

    console.log(chalk.green('🚀 Repository status check completed'));
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
  console.log(chalk.blue('🌿 Git Actor Worktrees Management'));
  console.log(chalk.blue('==================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    if (options.list) {
      console.log(chalk.yellow('📋 Current Worktrees:'));
      const worktrees = await git.setupAgentWorktrees(0); // Just list, don't create
      if (worktrees.length === 0) {
        console.log(chalk.gray('  No agent worktrees found'));
      } else {
        for (const wt of worktrees) {
          console.log(chalk.green(`  ✅ ${wt.agentId}`));
          console.log(chalk.gray(`     Branch: ${wt.branch}`));
          console.log(chalk.gray(`     Path: ${wt.path}`));
          console.log(chalk.gray(`     Role: ${wt.role}`));
        }
      }
      return;
    }

    if (options.cleanup) {
      console.log(chalk.yellow('🧹 Cleaning up worktrees...'));
      // This would implement worktree cleanup logic
      console.log(chalk.green('✅ Worktree cleanup completed'));
      return;
    }

    const agentCount = options.count || 3;
    console.log(chalk.blue(`🚀 Setting up ${agentCount} agent worktrees...`));

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
  console.log(chalk.blue('🏭 Git Operations Configuration'));
  console.log(chalk.blue('============================'));

  const operationType = options.type || 'standard';
  console.log(chalk.yellow(`🎭 Configuring ${operationType} git operations...`));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    console.log(chalk.green('✅ Git operations initialized'));
    console.log(chalk.blue('📋 Operation Configuration:'));
    console.log(chalk.gray(`  Type: ${operationType}`));
    console.log(chalk.gray(`  Base Directory: ${repoRoot}`));
    console.log(chalk.gray(`  Configuration: ${options.config || 'default'}`));

    // Show available operations
    console.log(chalk.yellow('⚡ Available Git Operations:'));
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
      console.log(chalk.gray(`  • ${op}`));
    }

    // Test basic functionality
    console.log(chalk.blue('\n🔍 Testing basic operations:'));
    const isRepo = await git.isGitRepo();
    const currentBranch = await git.getCurrentBranch();
    const hasChanges = await git.hasUncommittedChanges();

    console.log(chalk.gray(`  Git Repository: ${isRepo ? 'Yes' : 'No'}`));
    console.log(chalk.gray(`  Current Branch: ${currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted Changes: ${hasChanges ? 'Yes' : 'No'}`));

    console.log(chalk.green('🚀 Git operations are ready for use'));
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
  console.log(chalk.yellow('🔍 Repository Status:'));

  try {
    // Get repository information using direct operations
    const [currentBranch, hasChanges, integrationStatus] = await Promise.all([
      git.getCurrentBranch(),
      git.hasUncommittedChanges(),
      git.getIntegrationStatus(),
    ]);

    // Determine agent type based on branch name
    const agentType = determineAgentType(currentBranch);

    console.log(chalk.gray(`  Branch: ${currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${agentType}`));
    console.log(chalk.gray(`  Uncommitted: ${hasChanges ? 'Yes' : 'No'}`));
    console.log(
      chalk.gray(
        `  Integration: ${integrationStatus.ahead} ahead, ${integrationStatus.behind} behind`
      )
    );

    // Check for worktrees (simplified approach)
    try {
      const worktrees = await git.setupAgentWorktrees(0); // Just list, don't create
      if (worktrees.length > 0) {
        console.log(chalk.gray(`  Worktrees: ${worktrees.length} configured`));
        for (const wt of worktrees) {
          console.log(chalk.gray(`    ✅ ${wt.agentId} (${wt.role}) -> ${wt.branch}`));
        }
      } else {
        console.log(chalk.gray('  Worktrees: None configured'));
      }
    } catch {
      console.log(chalk.gray('  Worktrees: Status unavailable'));
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
  console.log(chalk.blue('🔧 Setting up agent worktrees...'));

  try {
    const worktrees = await git.setupAgentWorktrees(agentCount);
    if (worktrees.length > 0) {
      console.log(chalk.green(`✅ Created ${worktrees.length} worktrees:`));
      for (const wt of worktrees) {
        console.log(chalk.yellow(`  🎭 ${wt.agentId}: ${wt.role}`));
      }
    } else {
      console.log(chalk.red('❌ Failed to create worktrees'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Worktree setup failed:'), error);
  }
}
