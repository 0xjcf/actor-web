import type { ActorSnapshot } from '@actor-core/runtime';
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
  private currentBranch?: string;

  constructor(actor: GitActor) {
    this.actor = actor;
  }

  /**
   * Execute ship workflow using completion state observation
   */
  async executeShipWorkflow(): Promise<void> {
    console.log(chalk.blue('📋 Starting ship workflow...'));

    return new Promise((resolve, reject) => {
      // Observe all state changes and handle workflow progression
      const stateObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot as ActorSnapshot<GitContext>).value
        )
        .subscribe((state) => {
          this.handleStateChange(state, resolve, reject);
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
      this.observers = [stateObserver, errorObserver];

      // Success handler
      this.onSuccess = () => {
        this.cleanupObservers();
        resolve();
      };

      // Start the workflow
      this.actor.send({ type: 'CHECK_STATUS' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private sendMessage(message: GitEvent): void {
    console.log(chalk.blue(`📤 Sending message: ${message.type}`));
    this.actor.send(message);
  }

  private handleStateChange(
    state: unknown,
    _resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const stateStr = state as string;

    switch (stateStr) {
      case 'statusChecked': {
        // Use observe to reactively get current branch
        const statusObserver = this.actor
          .observe((snapshot) => snapshot.context.currentBranch)
          .subscribe((currentBranch) => {
            this.currentBranch = currentBranch;
            if (this.currentBranch) {
              console.log(chalk.blue(`📋 Current branch: ${this.currentBranch}`));
              this.sendMessage({ type: 'CHECK_UNCOMMITTED_CHANGES' });
            } else {
              reject(new Error('Could not determine current branch'));
            }
            statusObserver.unsubscribe();
          });
        break;
      }

      case 'uncommittedChangesChecked': {
        // Use observe to reactively get uncommitted changes
        const changesObserver = this.actor
          .observe((snapshot) => snapshot.context.uncommittedChanges)
          .subscribe((uncommittedChanges) => {
            this.handleUncommittedChanges(uncommittedChanges);
            changesObserver.unsubscribe();
          });
        break;
      }

      case 'stagingCompleted':
        this.handleStagingComplete();
        break;

      case 'commitCompleted':
        this.handleCommitComplete();
        break;

      case 'integrationStatusChecked': {
        // Use observe to reactively get integration status
        const integrationObserver = this.actor
          .observe((snapshot) => snapshot.context.integrationStatus)
          .subscribe((integrationStatus) => {
            if (!integrationStatus) {
              reject(new Error('No integration status received'));
              return;
            }
            this.handleIntegrationStatus(integrationStatus);
            integrationObserver.unsubscribe();
          });
        break;
      }

      case 'fetchCompleted':
        this.handleFetchComplete();
        break;

      case 'pushCompleted':
        this.handlePushComplete();
        break;

      // Error states
      case 'statusError':
      case 'uncommittedChangesError':
      case 'stagingError':
      case 'commitError':
      case 'integrationStatusError':
      case 'fetchError':
      case 'pushError': {
        // Use observe to reactively get error message
        const errorObserver = this.actor
          .observe((snapshot) => snapshot.context.lastError)
          .subscribe((lastError) => {
            const errorMsg = lastError || `Error in ${stateStr}`;
            console.error(chalk.red('❌ Error:'), errorMsg);
            reject(new Error(errorMsg));
            errorObserver.unsubscribe();
          });
        break;
      }

      // Timeout states
      case 'statusTimeout':
      case 'uncommittedChangesTimeout':
      case 'stagingTimeout':
      case 'commitTimeout':
      case 'integrationStatusTimeout':
      case 'fetchTimeout':
      case 'pushTimeout': {
        const timeoutMsg = `Operation timed out in ${stateStr}`;
        console.error(chalk.red('⏱️ Timeout:'), timeoutMsg);
        reject(new Error(timeoutMsg));
        break;
      }
    }
  }

  private handleUncommittedChanges(uncommittedChanges?: boolean): void {
    if (uncommittedChanges) {
      console.log(chalk.yellow('📝 Uncommitted changes detected, staging...'));
      this.sendMessage({ type: 'ADD_ALL' });
    } else {
      console.log(chalk.green('✅ No uncommitted changes'));
      this.sendMessage({
        type: 'GET_INTEGRATION_STATUS',
        integrationBranch: 'feature/actor-ref-integration',
      });
    }
  }

  private handleStagingComplete(): void {
    console.log(chalk.green('✅ All changes staged'));
    console.log(chalk.yellow('📝 Committing changes...'));

    const commitMessage = this.generateAutoCommitMessage();
    this.sendMessage({ type: 'COMMIT_CHANGES', message: commitMessage });
  }

  private handleCommitComplete(): void {
    console.log(chalk.green('✅ Changes committed'));
    console.log(chalk.blue('📊 Checking integration status...'));
    this.sendMessage({
      type: 'GET_INTEGRATION_STATUS',
      integrationBranch: 'feature/actor-ref-integration',
    });
  }

  private handleIntegrationStatus(integrationStatus?: { ahead: number; behind: number }): void {
    if (!integrationStatus) {
      console.error(chalk.red('❌ No integration status received'));
      return;
    }

    const { ahead, behind } = integrationStatus;
    console.log(chalk.blue(`📊 Integration status: ${ahead} ahead, ${behind} behind`));

    if (behind > 0) {
      console.log(chalk.yellow('📥 Fetching latest integration changes...'));
      this.sendMessage({ type: 'FETCH_REMOTE', branch: 'feature/actor-ref-integration' });
    } else {
      console.log(chalk.yellow('📤 Pushing to integration branch...'));
      this.sendMessage({ type: 'PUSH_CHANGES', branch: 'feature/actor-ref-integration' });
    }
  }

  private handleFetchComplete(): void {
    console.log(chalk.green('✅ Latest changes fetched'));
    console.log(chalk.yellow('📤 Pushing to integration branch...'));
    this.sendMessage({ type: 'PUSH_CHANGES', branch: 'feature/actor-ref-integration' });
  }

  private handlePushComplete(): void {
    console.log(chalk.green('✅ Successfully pushed to integration branch'));
    console.log(chalk.blue('🚀 Ship workflow completed successfully!'));
    console.log(chalk.gray('💡 Your changes are now in the integration environment'));

    // Send CONTINUE event to properly transition actor back to idle state
    this.sendMessage({ type: 'CONTINUE' });

    this.onSuccess?.();
  }

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
