import chalk from 'chalk';
import { createGitMessage, type PureGitActor } from '../actors/pure-git-actor.js';
import {
  cleanupCLIActorSystem,
  createGitActorWithSystem,
  initializeCLIActorSystem,
} from '../core/cli-actor-system.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Pure Message-Passing Ship Command
 * Uses the new PureGitActor with message-passing patterns
 */
export async function shipCommand() {
  console.log(chalk.blue('🚀 Ship Workflow'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();

  try {
    // Initialize CLI actor system
    await initializeCLIActorSystem();

    // Create PureGitActor through the CLI actor system
    const gitActor = await createGitActorWithSystem(repoRoot);

    // Create workflow handler
    const workflow = new PureActorWorkflowHandler(gitActor);
    await workflow.executeShipWorkflow();

    // Stop the actor
    await gitActor.stop();
  } catch (error) {
    console.error(chalk.red('❌ Ship failed:'), error);
    process.exit(1);
  } finally {
    // Cleanup CLI actor system
    await cleanupCLIActorSystem();
  }
}

/**
 * Pure actor workflow handler using message-passing
 */
class PureActorWorkflowHandler {
  private actor: PureGitActor;
  private currentBranch?: string;

  constructor(actor: PureGitActor) {
    this.actor = actor;
  }

  /**
   * Execute ship workflow using message-passing
   */
  async executeShipWorkflow(): Promise<void> {
    console.log(chalk.blue('📋 Starting ship workflow...'));

    try {
      // Step 1: Check git status
      await this.checkStatus();

      // Step 2: Handle uncommitted changes
      await this.handleUncommittedChanges();

      // Step 3: Check integration status
      await this.checkIntegrationStatus();

      // Step 4: Push changes
      await this.pushChanges();

      console.log(chalk.green('🚀 Ship workflow completed successfully!'));
      console.log(chalk.gray('💡 Your changes are now in the integration environment'));
    } catch (error) {
      console.error(chalk.red('❌ Ship workflow failed:'), error);
      throw error;
    }
  }

  /**
   * Check git status and get current branch
   */
  private async checkStatus(): Promise<void> {
    console.log(chalk.blue('🔍 Checking repository status...'));

    // Send CHECK_STATUS message
    await this.actor.send(createGitMessage('CHECK_STATUS'));

    // Get the result
    const state = this.actor.getState();

    if (state.lastError) {
      throw new Error(`Status check failed: ${state.lastError}`);
    }

    this.currentBranch = state.currentBranch;

    if (this.currentBranch) {
      console.log(chalk.blue(`📋 Current branch: ${this.currentBranch}`));
    } else {
      throw new Error('Could not determine current branch');
    }
  }

  /**
   * Handle uncommitted changes
   */
  private async handleUncommittedChanges(): Promise<void> {
    console.log(chalk.blue('🔍 Checking for uncommitted changes...'));

    // Send CHECK_UNCOMMITTED_CHANGES message
    await this.actor.send(createGitMessage('CHECK_UNCOMMITTED_CHANGES'));

    // Get the result
    let state = this.actor.getState();

    if (state.lastError) {
      throw new Error(`Uncommitted changes check failed: ${state.lastError}`);
    }

    if (state.uncommittedChanges) {
      console.log(chalk.yellow('📝 Uncommitted changes detected, staging...'));

      // Stage all changes
      await this.actor.send(createGitMessage('ADD_ALL'));
      state = this.actor.getState();

      if (state.lastError) {
        throw new Error(`Staging failed: ${state.lastError}`);
      }

      console.log(chalk.green('✅ All changes staged'));
      console.log(chalk.yellow('📝 Committing changes...'));

      // Commit changes
      const commitMessage = this.generateAutoCommitMessage();
      await this.actor.send(createGitMessage('COMMIT_CHANGES', { message: commitMessage }));
      state = this.actor.getState();

      if (state.lastError) {
        throw new Error(`Commit failed: ${state.lastError}`);
      }

      console.log(chalk.green('✅ Changes committed'));
    } else {
      console.log(chalk.green('✅ No uncommitted changes'));
    }
  }

  /**
   * Check integration status
   */
  private async checkIntegrationStatus(): Promise<void> {
    console.log(chalk.blue('📊 Checking integration status...'));

    // Send GET_INTEGRATION_STATUS message
    await this.actor.send(
      createGitMessage('GET_INTEGRATION_STATUS', {
        integrationBranch: 'feature/actor-ref-integration',
      })
    );

    // Get the result
    const state = this.actor.getState();

    if (state.lastError) {
      throw new Error(`Integration status check failed: ${state.lastError}`);
    }

    if (!state.integrationStatus) {
      throw new Error('No integration status received');
    }

    const { ahead, behind } = state.integrationStatus;
    console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      console.log(chalk.yellow('📥 Fetching latest integration changes...'));

      // Fetch remote changes
      await this.actor.send(
        createGitMessage('FETCH_REMOTE', {
          branch: 'feature/actor-ref-integration',
        })
      );

      const fetchState = this.actor.getState();

      if (fetchState.lastError) {
        throw new Error(`Fetch failed: ${fetchState.lastError}`);
      }

      console.log(chalk.green('✅ Latest changes fetched'));
    }
  }

  /**
   * Push changes to remote
   */
  private async pushChanges(): Promise<void> {
    console.log(chalk.yellow('📤 Pushing current branch to origin...'));
    console.log(chalk.gray(`🔍 DEBUG: About to push branch: ${this.currentBranch || 'HEAD'}`));

    // Send PUSH_CHANGES message
    await this.actor.send(
      createGitMessage('PUSH_CHANGES', {
        branch: this.currentBranch || 'HEAD',
      })
    );

    // Get the result
    const state = this.actor.getState();

    if (state.lastError) {
      throw new Error(`Push failed: ${state.lastError}`);
    }

    console.log(chalk.green('✅ Successfully pushed to remote repository'));
  }

  /**
   * Generate auto-commit message
   */
  private generateAutoCommitMessage(): string {
    const currentDate = new Date().toISOString().split('T')[0];
    const branch = this.currentBranch || 'unknown';

    return `ship: auto-commit for integration deployment

Branch: ${branch}
Date: ${currentDate}
Context: Automatic commit created by ship workflow

[actor-web] Ship workflow - auto-commit for integration`;
  }
}
