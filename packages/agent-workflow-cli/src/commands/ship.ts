import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Ship Command - Pure Actor Model Implementation
 * 
 * Uses the pure actor model with message-passing only.
 * No direct state access - all communication through ask/tell patterns.
 */
export async function shipCommand() {
  console.log(chalk.blue('🚀 Ship Workflow'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'ship-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new ShipWorkflowHandler(gitActor);
    await workflow.executeShipWorkflow();

    console.log(chalk.green('🚀 Ship workflow completed successfully!'));
    console.log(chalk.gray('💡 Your changes are now in the integration environment'));
  } catch (error) {
    console.error(chalk.red('❌ Ship failed:'), error);
    process.exit(1);
  } finally {
    // Stop the actor
    await gitActor.stop();
  }
}

/**
 * Ship workflow handler using pure message-passing
 */
class ShipWorkflowHandler {
  constructor(private actor: GitActor) {}

  /**
   * Execute ship workflow using ask pattern
   */
  async executeShipWorkflow(): Promise<void> {
    console.log(chalk.blue('📋 Starting ship workflow...'));

    try {
      // Step 1: Check git status
      const status = await this.checkStatus();

      // Step 2: Handle uncommitted changes
      await this.handleUncommittedChanges(status);

      // Step 3: Check integration status
      await this.checkIntegrationStatus(status.currentBranch);

      // Step 4: Push changes
      await this.pushChanges(status.currentBranch);
    } catch (error) {
      console.error(chalk.red('❌ Ship workflow failed:'), error);
      throw error;
    }
  }

  /**
   * Check git status using ask pattern
   */
  private async checkStatus(): Promise<{ currentBranch?: string; uncommittedChanges?: boolean }> {
    console.log(chalk.blue('🔍 Checking repository status...'));

    // Use ask pattern to get status
    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid status response');
    }

    const status = response as { 
      currentBranch?: string; 
      uncommittedChanges?: boolean;
      isGitRepo?: boolean;
    };

    if (!status.isGitRepo) {
      throw new Error('Not a git repository');
    }

    if (status.currentBranch) {
      console.log(chalk.blue(`📋 Current branch: ${status.currentBranch}`));
    } else {
      throw new Error('Could not determine current branch');
    }

    return status;
  }

  /**
   * Handle uncommitted changes using message passing
   */
  private async handleUncommittedChanges(status: { uncommittedChanges?: boolean }): Promise<void> {
    if (!status.uncommittedChanges) {
      console.log(chalk.green('✅ No uncommitted changes'));
      return;
    }

    console.log(chalk.yellow('📝 Uncommitted changes detected, staging...'));

    // Send ADD_ALL message
    this.actor.send({ type: 'ADD_ALL' });

    // Wait for staging to complete by checking status again
    await this.waitForOperation('ADD_ALL', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'lastOperation' in response && 
        response.lastOperation === 'STAGING_COMPLETED';
    });

    console.log(chalk.green('✅ All changes staged'));
    console.log(chalk.yellow('📝 Committing changes...'));

    // Commit changes
    const commitMessage = this.generateAutoCommitMessage();
    this.actor.send({ type: 'COMMIT_CHANGES', message: commitMessage });

    // Wait for commit to complete
    await this.waitForOperation('COMMIT_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_COMMIT_STATUS' });
      return response && typeof response === 'object' && 
        'lastCommitHash' in response && 
        response.lastCommitHash;
    });

    console.log(chalk.green('✅ Changes committed'));
  }

  /**
   * Check integration status
   */
  private async checkIntegrationStatus(currentBranch?: string): Promise<void> {
    console.log(chalk.blue('🔍 Checking integration status...'));

    // Send GET_INTEGRATION_STATUS message
    this.actor.send({ type: 'GET_INTEGRATION_STATUS' });

    // Wait for status check to complete
    await this.waitForOperation('GET_INTEGRATION_STATUS', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
      return response && typeof response === 'object' && 
        'integrationStatus' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
    const branchInfo = response as { integrationStatus?: { ahead: number; behind: number } };

    if (branchInfo.integrationStatus) {
      const { ahead, behind } = branchInfo.integrationStatus;
      console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

      if (behind > 0) {
        console.log(chalk.yellow(`⚠️  Your branch is ${behind} commits behind integration`));
        console.log(chalk.gray('   Consider merging or rebasing before shipping'));
      }
    }
  }

  /**
   * Push changes to remote
   */
  private async pushChanges(currentBranch?: string): Promise<void> {
    if (!currentBranch) {
      throw new Error('Cannot push: current branch unknown');
    }

    console.log(chalk.blue(`🚀 Pushing changes to ${currentBranch}...`));

    // Send PUSH_CHANGES message
    this.actor.send({ type: 'PUSH_CHANGES', branch: currentBranch });

    // Wait for push to complete
    await this.waitForOperation('PUSH_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'lastOperation' in response && 
        response.lastOperation === 'PUSH_COMPLETED';
    });

    console.log(chalk.green('✅ Changes pushed successfully'));
  }

  /**
   * Wait for an operation to complete
   */
  private async waitForOperation(
    operation: string, 
    checkComplete: () => Promise<boolean>,
    timeout: number = 30000
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

  /**
   * Generate auto-commit message
   */
  private generateAutoCommitMessage(): string {
    const currentDate = new Date().toISOString();
    const branchName = 'current'; // Will be filled by git actor

    return `ship: auto-commit for integration deployment

Branch: ${branchName}
Date: ${currentDate}
Context: Automatic commit created by ship workflow

[actor-web] Ship workflow - auto-commit for integration`;
  }
}