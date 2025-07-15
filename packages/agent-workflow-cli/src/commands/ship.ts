import type { ActorSnapshot } from '@actor-web/core';
import chalk from 'chalk';
import {
  createGitActor,
  type GitActor,
  type GitContext,
  type GitEvent,
} from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * State-Based Ship Command
 * Uses proper actor-web framework patterns with observe
 */
export async function shipCommand() {
  console.log(chalk.blue('🚀 Ship Workflow'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new StateBasedWorkflowHandler(gitActor);
    await workflow.executeShipWorkflow();
  } catch (error) {
    console.error(chalk.red('❌ Ship failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * State-based workflow handler using observe pattern
 */
class StateBasedWorkflowHandler {
  private actor: GitActor;
  private workflowState:
    | 'init'
    | 'checking_changes'
    | 'staging'
    | 'committing'
    | 'checking_status'
    | 'fetching'
    | 'pushing'
    | 'complete'
    | 'error' = 'init';

  constructor(actor: GitActor) {
    this.actor = actor;
  }

  /**
   * Execute ship workflow using state-based observation
   */
  async executeShipWorkflow(): Promise<void> {
    console.log(chalk.blue('📋 Starting ship workflow...'));

    return new Promise((resolve, reject) => {
      // Observe uncommitted changes state
      const uncommittedChangesObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).uncommittedChanges
        )
        .subscribe((uncommittedChanges) => {
          if (uncommittedChanges !== undefined) {
            this.handleUncommittedChanges(uncommittedChanges);
          }
        });

      // Observe staging completion
      const stagingObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).stagingComplete
        )
        .subscribe((stagingComplete) => {
          if (stagingComplete === true) {
            this.handleStagingComplete();
          }
        });

      // Observe commit completion
      const commitObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).commitComplete
        )
        .subscribe((commitComplete) => {
          if (commitComplete === true) {
            this.handleCommitComplete();
          }
        });

      // Observe integration status
      const integrationObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).integrationStatus
        )
        .subscribe((integrationStatus) => {
          if (integrationStatus && this.workflowState === 'checking_status') {
            this.handleIntegrationStatus(integrationStatus);
          }
        });

      // Observe errors
      const errorObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).lastError)
        .subscribe((error) => {
          if (error) {
            console.error(chalk.red('❌ Error:'), error);
            this.cleanupObservers();
            reject(new Error(error));
          }
        });

      // Store observers for cleanup
      this.observers = [
        uncommittedChangesObserver,
        stagingObserver,
        commitObserver,
        integrationObserver,
        errorObserver,
      ];

      // Success handler
      this.onSuccess = () => {
        this.cleanupObservers();
        resolve();
      };

      // Start the workflow
      this.workflowState = 'checking_changes';
      this.sendMessage({ type: 'CHECK_UNCOMMITTED_CHANGES' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private handleUncommittedChanges(hasChanges: boolean): void {
    if (this.workflowState !== 'checking_changes') return;

    if (hasChanges) {
      console.log(chalk.yellow('📝 Uncommitted changes detected, staging...'));
      this.workflowState = 'staging';
      this.sendMessage({ type: 'ADD_ALL' });
    } else {
      console.log(chalk.green('✅ No uncommitted changes'));
      this.workflowState = 'checking_status';
      this.sendMessage({
        type: 'GET_INTEGRATION_STATUS',
        integrationBranch: 'feature/actor-ref-integration',
      });
    }
  }

  private handleStagingComplete(): void {
    if (this.workflowState !== 'staging') return;

    console.log(chalk.green('✅ All changes staged'));

    const message = `feat(ship): auto-save before shipping

Agent: Agent A (Architecture)
Context: Automated commit before shipping to integration
Date: ${new Date().toISOString().split('T')[0]}

[actor-web] Agent A (Architecture) - pre-ship save`;

    this.workflowState = 'committing';
    this.sendMessage({ type: 'COMMIT_CHANGES', message });
  }

  private handleCommitComplete(): void {
    if (this.workflowState !== 'committing') return;

    console.log(chalk.green('✅ Changes committed'));
    this.workflowState = 'checking_status';
    this.sendMessage({
      type: 'GET_INTEGRATION_STATUS',
      integrationBranch: 'feature/actor-ref-integration',
    });
  }

  private handleIntegrationStatus(status: { ahead: number; behind: number }): void {
    if (status.ahead === 0) {
      console.log(chalk.yellow('⚠️  No changes to ship'));
      this.workflowState = 'complete';
      this.onSuccess?.();
      return;
    }

    console.log(chalk.blue(`📦 Found ${status.ahead} commits to ship`));
    console.log(chalk.green('✅ Successfully shipped to integration branch!'));
    console.log(chalk.blue('📈 Other agents can now sync your changes'));

    this.workflowState = 'complete';
    this.onSuccess?.();
  }

  private sendMessage(event: GitEvent): void {
    console.log(chalk.blue(`📤 Sending message: ${event.type}`));
    this.actor.send(event);
  }
}
