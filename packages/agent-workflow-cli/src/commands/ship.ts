import type { ActorSnapshot } from '@actor-core/runtime';
import chalk from 'chalk';
import type { GitActor, GitContext, GitEvent } from '../actors/git-actor.js';
import {
  cleanupCLIActorSystem,
  createGitActorWithSystem,
  initializeCLIActorSystem,
} from '../core/cli-actor-system.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * State-Based Ship Command
 * Uses proper actor-web framework patterns with observe
 */
export async function shipCommand() {
  console.log(chalk.blue('🚀 Ship Workflow'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();

  try {
    // Initialize CLI actor system
    await initializeCLIActorSystem();

    // Create GitActor through the CLI actor system
    const gitActor = await createGitActorWithSystem(repoRoot);

    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new StateBasedWorkflowHandler(gitActor);
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
  private lastHandledState: string | null = null; // Track the last handled state

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

    // Prevent duplicate processing of the same state
    if (this.lastHandledState === stateStr) {
      console.log(chalk.gray(`🔍 DEBUG: Skipping duplicate state: ${stateStr}`));
      return;
    }

    this.lastHandledState = stateStr;
    console.log(chalk.gray(`🔄 State changed to: ${stateStr}`));

    switch (stateStr) {
      case 'statusChecked': {
        // Directly get current branch from context instead of creating an observer
        const currentSnapshot = this.actor.getSnapshot();
        const currentBranch = (currentSnapshot.context as GitContext).currentBranch;

        this.currentBranch = currentBranch;
        if (this.currentBranch) {
          console.log(chalk.blue(`📋 Current branch: ${this.currentBranch}`));
          this.sendMessage({ type: 'CHECK_UNCOMMITTED_CHANGES' });
        } else {
          reject(new Error('Could not determine current branch'));
        }
        break;
      }

      case 'uncommittedChangesChecked': {
        // Directly get uncommitted changes from current context instead of creating an observer
        const currentSnapshot = this.actor.getSnapshot();
        const uncommittedChanges = (currentSnapshot.context as GitContext).uncommittedChanges;

        console.log(chalk.gray('🔍 DEBUG: uncommittedChangesChecked state handler called'));
        console.log(chalk.gray(`🔍 DEBUG: uncommittedChanges = ${uncommittedChanges}`));

        this.handleUncommittedChanges(uncommittedChanges);
        break;
      }

      case 'stagingCompleted':
        this.handleStagingComplete();
        break;

      case 'commitCompleted':
        this.handleCommitComplete();
        break;

      case 'integrationStatusChecked': {
        // Directly get integration status from current context instead of creating an observer
        const currentSnapshot = this.actor.getSnapshot();
        const integrationStatus = (currentSnapshot.context as GitContext).integrationStatus;

        if (!integrationStatus) {
          reject(new Error('No integration status received'));
          return;
        }

        this.handleIntegrationStatus(integrationStatus);
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
        // Directly get error from current context instead of creating an observer
        const currentSnapshot = this.actor.getSnapshot();
        const lastError = (currentSnapshot.context as GitContext).lastError;
        const errorMsg = lastError || `Error in ${stateStr}`;
        console.error(chalk.red('❌ Error:'), errorMsg);
        reject(new Error(errorMsg));
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
    console.log(chalk.gray('🔍 DEBUG: handleCommitComplete() called'));
    this.sendMessage({
      type: 'GET_INTEGRATION_STATUS',
      integrationBranch: 'feature/actor-ref-integration',
    });
  }

  private handleIntegrationStatus(integrationStatus?: { ahead: number; behind: number }): void {
    console.log(chalk.gray('🔍 DEBUG: handleIntegrationStatus() called'));
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
      console.log(chalk.yellow('📤 Pushing current branch to origin...'));
      console.log(chalk.gray(`🔍 DEBUG: About to push branch: ${this.currentBranch || 'HEAD'}`));
      // Push the current branch, not the integration branch
      this.sendMessage({ type: 'PUSH_CHANGES', branch: this.currentBranch || 'HEAD' });
    }
  }

  private handleFetchComplete(): void {
    console.log(chalk.green('✅ Latest changes fetched'));
    console.log(chalk.yellow('📤 Pushing current branch to origin...'));
    // Push the current branch, not the integration branch
    this.sendMessage({ type: 'PUSH_CHANGES', branch: this.currentBranch || 'HEAD' });
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
