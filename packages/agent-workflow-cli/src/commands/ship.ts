import chalk from 'chalk';
import { createGitActor, type GitActor } from '../actors/git-actor.js';
import { subscribeToEvent } from '../actors/git-actor-helpers.js';
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

  // Create git actor using the proper factory function
  const gitActor = createGitActor(repoRoot);

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

    // Subscribe to staging completed event
    const stagingPromise = new Promise<void>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_STAGING_COMPLETED', () => {
        unsubscribe();
        resolve();
      });
    });

    // Send ADD_ALL message
    this.actor.send({ type: 'ADD_ALL' });

    // Wait for event
    await stagingPromise;

    console.log(chalk.green('✅ All changes staged'));
    console.log(chalk.yellow('📝 Committing changes...'));

    // Commit changes
    const commitMessage = this.generateAutoCommitMessage();

    // Subscribe to commit completed event
    const commitPromise = new Promise<void>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_COMMIT_COMPLETED', () => {
        unsubscribe();
        resolve();
      });
    });

    // Send commit message
    this.actor.send({ type: 'COMMIT_CHANGES', payload: { message: commitMessage } });

    // Wait for event
    await commitPromise;

    console.log(chalk.green('✅ Changes committed'));
  }

  /**
   * Check integration status
   */
  private async checkIntegrationStatus(_currentBranch?: string): Promise<void> {
    console.log(chalk.blue('🔍 Checking integration status...'));

    // Subscribe to integration status event
    const integrationStatusPromise = new Promise<{ ahead: number; behind: number }>((resolve) => {
      const unsubscribe = subscribeToEvent(
        this.actor,
        'GIT_INTEGRATION_STATUS_UPDATED',
        (event) => {
          unsubscribe();
          resolve(event.status);
        }
      );
    });

    // Send GET_INTEGRATION_STATUS message
    this.actor.send({ type: 'GET_INTEGRATION_STATUS' });

    // Wait for event
    const integrationStatus = await integrationStatusPromise;

    const { ahead, behind } = integrationStatus;
    console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      console.log(chalk.yellow(`⚠️  Your branch is ${behind} commits behind integration`));
      console.log(chalk.gray('   Consider merging or rebasing before shipping'));
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

    // Subscribe to push completed event
    const pushPromise = new Promise<void>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_PUSH_COMPLETED', () => {
        unsubscribe();
        resolve();
      });
    });

    // Send PUSH_CHANGES message
    this.actor.send({ type: 'PUSH_CHANGES', payload: { branch: currentBranch } });

    // Wait for event
    await pushPromise;

    console.log(chalk.green('✅ Changes pushed successfully'));
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
