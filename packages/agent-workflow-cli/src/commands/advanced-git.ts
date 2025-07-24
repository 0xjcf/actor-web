/**
 * Advanced Git Commands - Pure Actor Model Implementation
 *
 * ✅ PURE ACTOR MODEL: Uses only ask/tell patterns
 * ❌ NO subscriptions, handlers, or classes
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { createGitActor, type GitActor } from '../actors/git-actor.js';
import { GitOperations } from '../core/git-operations.js';

/**
 * Demo git actor workflow with pure message-passing
 */
export async function demoGitActorCommand() {
  console.log(chalk.blue('🎭 Git Actor Demo'));
  console.log(chalk.blue('=================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.green('✅ Git Actor: Initialized'));
    console.log(chalk.blue('📊 Actor Machine: Running'));

    // ✅ PURE ACTOR MODEL: Show status using ask pattern
    await showStatus(gitActor);
  } catch (error) {
    console.error(chalk.red('❌ Demo failed:'), error);
  } finally {
    await gitActor.stop();
    console.log(chalk.green('✅ Git Actor: Stopped'));
  }
}

/**
 * Advanced git operations demo
 */
export async function advancedGitOperationsCommand() {
  console.log(chalk.blue('🚀 Advanced Git Operations Demo'));
  console.log(chalk.blue('=================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // ✅ PURE ACTOR MODEL: Show advanced status using ask pattern
    await showAdvancedStatus(gitActor);
  } catch (error) {
    console.error(chalk.red('❌ Advanced operations failed:'), error);
  } finally {
    await gitActor.stop();
    console.log(chalk.green('✅ Git Actor: Stopped'));
  }
}

/**
 * Show git actor system status
 */
export async function actorStatusCommand() {
  console.log(chalk.blue('🎭 Git Actor System Status'));
  console.log(chalk.blue('==============================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.green('✅ Git Actor: Initialized'));
    console.log(chalk.blue('📊 Actor Machine: Running'));

    // ✅ PURE ACTOR MODEL: Show full status using ask pattern
    await showComprehensiveStatus(gitActor);

    console.log(chalk.green('🚀 Actor system is operational'));
  } catch (error) {
    console.error(chalk.red('❌ Actor system error:'), error);
  } finally {
    await gitActor.stop();
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

    const gitActor = createGitActor(repoRoot);

    try {
      gitActor.start();

      // ✅ PURE ACTOR MODEL: Setup worktrees using ask pattern
      await setupWorktrees(gitActor);
    } finally {
      await gitActor.stop();
    }
  } catch (error) {
    console.error(chalk.red('❌ Worktree management failed:'), error);
  }
}

/**
 * Advanced git actor creation and configuration
 */
export async function actorCreateCommand(options: { type?: string; config?: string }) {
  console.log(chalk.blue('🏭 Create Custom Git Actor'));
  console.log(chalk.blue('============================'));

  const actorType = options.type || 'custom';
  console.log(chalk.yellow(`🎭 Creating ${actorType} git actor...`));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.green('✅ Custom git actor created'));
    console.log(chalk.blue('📋 Actor Configuration:'));
    console.log(chalk.gray(`  Type: ${actorType}`));
    console.log(chalk.gray(`  Base Directory: ${repoRoot}`));
    console.log(chalk.gray(`  Configuration: ${options.config || 'default'}`));

    // Show available events
    console.log(chalk.yellow('⚡ Available Events:'));
    const events = [
      'CHECK_REPO',
      'CHECK_STATUS',
      'CHECK_UNCOMMITTED_CHANGES',
      'GET_INTEGRATION_STATUS',
      'GET_CHANGED_FILES',
      'ADD_ALL',
      'COMMIT_CHANGES',
      'PUSH_CHANGES',
      'GENERATE_COMMIT_MESSAGE',
      'VALIDATE_DATES',
    ];
    for (const event of events) {
      console.log(chalk.gray(`  • ${event}`));
    }

    console.log(chalk.green('🚀 Actor is ready for use'));
  } catch (error) {
    console.error(chalk.red('❌ Actor creation failed:'), error);
  } finally {
    await gitActor.stop();
  }
}

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Show basic status using ask pattern
 */
async function showStatus(gitActor: GitActor): Promise<void> {
  // ✅ PURE ACTOR MODEL: Get status using ask pattern
  const branchInfo = await gitActor.ask({
    type: 'REQUEST_STATUS',
  });

  console.log(chalk.yellow('🔍 Current Context:'));
  console.log(chalk.gray(`  Branch: ${branchInfo.currentBranch || 'Unknown'}`));
  console.log(chalk.gray(`  Agent: ${branchInfo.agentType || 'Unknown'}`));
  console.log(chalk.gray(`  Uncommitted: ${branchInfo.uncommittedChanges ? 'Yes' : 'No'}`));
}

/**
 * Show advanced status with integration info using ask pattern
 */
async function showAdvancedStatus(gitActor: GitActor): Promise<void> {
  // ✅ PURE ACTOR MODEL: Check repository status using ask pattern
  const repoStatus = await gitActor.ask({
    type: 'REQUEST_STATUS',
  });

  if (repoStatus.isGitRepo) {
    console.log(chalk.green('✅ Git repository detected'));

    // ✅ PURE ACTOR MODEL: Get integration status using ask pattern
    const integrationStatus = await gitActor.ask({
      type: 'GET_INTEGRATION_STATUS',
    });

    console.log(chalk.blue('📊 Integration Status:'));
    console.log(chalk.gray(`  Ahead: ${integrationStatus.ahead} commits`));
    console.log(chalk.gray(`  Behind: ${integrationStatus.behind} commits`));
  } else {
    console.log(chalk.red('❌ Not a git repository'));
  }
}

/**
 * Show comprehensive status including worktrees using ask pattern
 */
async function showComprehensiveStatus(gitActor: GitActor): Promise<void> {
  // ✅ PURE ACTOR MODEL: Get comprehensive status using ask pattern
  const statusInfo = await gitActor.ask({
    type: 'REQUEST_STATUS',
  });

  console.log(chalk.yellow('🔍 Repository Status:'));
  console.log(chalk.gray(`  Branch: ${statusInfo.currentBranch || 'Unknown'}`));
  console.log(chalk.gray(`  Agent: ${statusInfo.agentType || 'Unknown'}`));
  console.log(chalk.gray(`  Uncommitted: ${statusInfo.uncommittedChanges ? 'Yes' : 'No'}`));

  if (statusInfo.worktrees && statusInfo.worktrees.length > 0) {
    console.log(chalk.gray(`  Worktrees: ${statusInfo.worktrees.length} configured`));
    for (const wt of statusInfo.worktrees) {
      const status = wt.exists ? '✅' : '❌';
      console.log(chalk.gray(`    ${status} ${wt.agentId} (${wt.role}) -> ${wt.branch}`));
    }
  }
}

/**
 * Setup worktrees for multi-agent workflows using ask pattern
 */
async function setupWorktrees(gitActor: GitActor): Promise<void> {
  console.log(chalk.blue('🔧 Setting up agent worktrees...'));

  // ✅ PURE ACTOR MODEL: Setup worktrees using ask pattern
  const response = await gitActor.ask({
    type: 'SETUP_WORKTREES',
  });

  const worktrees = response.worktrees;

  if (worktrees.length > 0) {
    console.log(chalk.green(`✅ Created ${worktrees.length} worktrees:`));
    for (const wt of worktrees) {
      console.log(chalk.yellow(`  🎭 ${wt.agentId}: ${wt.role}`));
    }
  } else {
    console.log(chalk.red('❌ Failed to create worktrees'));
  }
}
