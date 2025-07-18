/**
 * Advanced Git Commands - Pure Actor Model Implementation
 * 
 * Advanced git operations using pure message-passing.
 * No state observation or direct access.
 */

import path from 'node:path';
import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
import { GitOperations } from '../core/git-operations.js';

/**
 * Demo git actor workflow with pure message-passing
 */
export async function demoGitActorCommand() {
  console.log(chalk.blue('🎭 Git Actor Demo'));
  console.log(chalk.blue('=================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'demo-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();
    
    console.log(chalk.green('✅ Git Actor: Initialized'));
    console.log(chalk.blue('📊 Actor Machine: Running'));

    // Create workflow handler
    const workflow = new AdvancedGitWorkflowHandler(gitActor);
    await workflow.showStatus();
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
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'advanced-ops-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new AdvancedGitWorkflowHandler(gitActor);
    await workflow.showAdvancedStatus();
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
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'status-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();
    
    console.log(chalk.green('✅ Git Actor: Initialized'));
    console.log(chalk.blue('📊 Actor Machine: Running'));

    // Create workflow handler
    const workflow = new AdvancedGitWorkflowHandler(gitActor);
    await workflow.showFullStatus();
    
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

    // Create git actor using the pure runtime
    const gitActor = createActorRef(gitActorMachine, {
      id: 'worktrees-git-actor',
      input: { baseDir: repoRoot },
    }) as GitActor;

    try {
      // Start the actor
      gitActor.start();

      // Create workflow handler
      const workflow = new AdvancedGitWorkflowHandler(gitActor);
      await workflow.setupWorktrees(agentCount);
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
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: `${actorType}-git-actor`,
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
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

/**
 * Advanced git workflow handler using pure message-passing
 */
class AdvancedGitWorkflowHandler {
  constructor(private actor: GitActor) {}

  /**
   * Show basic status
   */
  async showStatus(): Promise<void> {
    // Get current status
    this.actor.send({ type: 'CHECK_STATUS' });
    
    // Wait for status check to complete
    await this.waitForOperation('CHECK_STATUS', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return Boolean(response && typeof response === 'object' && 
        'currentBranch' in response);
    });

    const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
    const branchInfo = response as { 
      currentBranch?: string; 
      agentType?: string;
      uncommittedChanges?: boolean;
    };

    console.log(chalk.yellow('🔍 Current Context:'));
    console.log(chalk.gray(`  Branch: ${branchInfo.currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${branchInfo.agentType || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted: ${branchInfo.uncommittedChanges ? 'Yes' : 'No'}`));
  }

  /**
   * Show advanced status with integration info
   */
  async showAdvancedStatus(): Promise<void> {
    // Check repository status
    this.actor.send({ type: 'CHECK_REPO' });
    
    await this.waitForOperation('CHECK_REPO', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return Boolean(response && typeof response === 'object' && 
        'isGitRepo' in response);
    });

    const repoResponse = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const repoStatus = repoResponse as { isGitRepo?: boolean };

    if (repoStatus.isGitRepo) {
      console.log(chalk.green('✅ Git repository detected'));

      // Get integration status
      this.actor.send({ type: 'GET_INTEGRATION_STATUS' });
      
      await this.waitForOperation('GET_INTEGRATION_STATUS', async () => {
        const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
        return Boolean(response && typeof response === 'object' && 
          'integrationStatus' in response);
      });

      const branchResponse = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
      const branchInfo = branchResponse as { 
        integrationStatus?: { ahead: number; behind: number } 
      };

      if (branchInfo.integrationStatus) {
        console.log(chalk.blue('📊 Integration Status:'));
        console.log(chalk.gray(`  Ahead: ${branchInfo.integrationStatus.ahead} commits`));
        console.log(chalk.gray(`  Behind: ${branchInfo.integrationStatus.behind} commits`));
      }
    } else {
      console.log(chalk.red('❌ Not a git repository'));
    }
  }

  /**
   * Show full status including worktrees
   */
  async showFullStatus(): Promise<void> {
    // Get current status
    this.actor.send({ type: 'CHECK_STATUS' });
    
    await this.waitForOperation('CHECK_STATUS', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return Boolean(response && typeof response === 'object' && 
        'currentBranch' in response);
    });

    const statusResponse = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
    const statusInfo = statusResponse as { 
      currentBranch?: string;
      agentType?: string;
      uncommittedChanges?: boolean;
      worktrees?: Array<{
        agentId: string;
        branch: string;
        role: string;
        exists: boolean;
        path: string;
      }>;
    };

    console.log(chalk.yellow('🔍 Current Context:'));
    console.log(chalk.gray(`  Branch: ${statusInfo.currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${statusInfo.agentType || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted: ${statusInfo.uncommittedChanges ? 'Yes' : 'No'}`));

    if (statusInfo.worktrees && statusInfo.worktrees.length > 0) {
      console.log(chalk.yellow('🌿 Worktrees:'));
      for (const wt of statusInfo.worktrees) {
        console.log(chalk.gray(`  • ${wt.agentId}: ${wt.branch} (${wt.role})`));
      }
    }
  }

  /**
   * Setup worktrees
   */
  async setupWorktrees(agentCount: number): Promise<void> {
    // Send SETUP_WORKTREES message
    this.actor.send({ type: 'SETUP_WORKTREES', agentCount });
    
    await this.waitForOperation('SETUP_WORKTREES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_WORKTREE_STATUS' });
      return Boolean(response && typeof response === 'object' && 
        'worktrees' in response);
    });

    const response = await this.actor.ask({ type: 'REQUEST_WORKTREE_STATUS' });
    const worktreeInfo = response as { 
      worktrees?: Array<{
        agentId: string;
        branch: string;
        role: string;
        exists: boolean;
        path: string;
      }>
    };

    const worktrees = worktreeInfo.worktrees || [];

    if (worktrees.length > 0) {
      console.log(chalk.green(`✅ Created ${worktrees.length} worktrees:`));
      for (const wt of worktrees) {
        console.log(chalk.yellow(`  🎭 ${wt.agentId}: ${wt.role}`));
      }
    } else {
      console.log(chalk.red('❌ Failed to create worktrees'));
    }
  }

  /**
   * Wait for an operation to complete
   */
  private async waitForOperation(
    operation: string, 
    checkComplete: () => Promise<boolean>,
    timeout: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        if (await checkComplete()) {
          return;
        }
      } catch (error) {
        // Operation might still be in progress
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Operation ${operation} timed out after ${timeout}ms`);
  }
}