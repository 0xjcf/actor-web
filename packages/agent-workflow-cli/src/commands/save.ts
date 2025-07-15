import type { ActorSnapshot } from '@actor-web/core';
import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    // Start the actor
    gitActor.start();

    // Create save workflow handler
    const saveWorkflow = new SaveWorkflowHandler(gitActor);
    await saveWorkflow.executeSave(customMessage);
  } catch (error) {
    console.error(chalk.red('❌ Save failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * State-based save workflow handler
 */
class SaveWorkflowHandler {
  private actor: GitActor;
  private customMessage?: string;
  private workflowState:
    | 'checking_repo'
    | 'checking_changes'
    | 'staging'
    | 'committing'
    | 'complete'
    | 'error' = 'checking_repo';

  constructor(actor: GitActor) {
    this.actor = actor;
  }

  async executeSave(customMessage?: string): Promise<void> {
    this.customMessage = customMessage;
    console.log(chalk.blue('📋 Starting save workflow...'));

    return new Promise((resolve, reject) => {
      // Observe repo status
      const repoObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).isGitRepo)
        .subscribe((isGitRepo) => {
          if (isGitRepo !== undefined) {
            this.handleRepoStatus(isGitRepo);
          }
        });

      // Observe uncommitted changes
      const changesObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).uncommittedChanges
        )
        .subscribe((hasChanges) => {
          if (hasChanges !== undefined) {
            this.handleUncommittedChanges(hasChanges);
          }
        });

      // Observe staging completion
      const stagingObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).lastOperation
        )
        .subscribe((lastOperation) => {
          if (lastOperation === 'STAGING_ALL_DONE' && this.workflowState === 'staging') {
            this.handleStagingComplete();
          }
        });

      // Observe commit completion
      const commitObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).lastOperation
        )
        .subscribe((lastOperation) => {
          if (lastOperation === 'COMMIT_CHANGES_DONE' && this.workflowState === 'committing') {
            this.handleCommitComplete();
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
        repoObserver,
        changesObserver,
        stagingObserver,
        commitObserver,
        errorObserver,
      ];

      // Success handler
      this.onSuccess = () => {
        this.cleanupObservers();
        resolve();
      };

      // Start the workflow
      this.workflowState = 'checking_repo';
      this.actor.send({ type: 'CHECK_REPO' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private handleRepoStatus(isGitRepo: boolean): void {
    if (this.workflowState !== 'checking_repo') return;

    if (!isGitRepo) {
      console.log(chalk.red('❌ Not in a Git repository'));
      this.workflowState = 'error';
      this.onSuccess?.(); // End workflow
      return;
    }

    console.log(chalk.green('✅ Git repository detected'));
    this.workflowState = 'checking_changes';
    this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
  }

  private handleUncommittedChanges(hasChanges: boolean): void {
    if (this.workflowState !== 'checking_changes') return;

    if (!hasChanges) {
      console.log(chalk.yellow('⚠️  No changes to save'));
      this.workflowState = 'complete';
      this.onSuccess?.();
      return;
    }

    console.log(chalk.yellow('📝 Changes detected, staging...'));
    this.workflowState = 'staging';
    this.actor.send({ type: 'ADD_ALL' });
  }

  private handleStagingComplete(): void {
    if (this.workflowState !== 'staging') return;

    console.log(chalk.green('✅ All changes staged'));

    // Generate commit message
    const commitMessage = this.customMessage || this.generateDefaultCommitMessage();

    this.workflowState = 'committing';
    this.actor.send({ type: 'COMMIT_CHANGES', message: commitMessage });
  }

  private handleCommitComplete(): void {
    if (this.workflowState !== 'committing') return;

    console.log(chalk.green('✅ Changes committed successfully'));
    console.log(chalk.blue('💡 Use pnpm aw:ship to push to integration branch'));

    this.workflowState = 'complete';
    this.onSuccess?.();
  }

  private generateDefaultCommitMessage(): string {
    const currentDate = new Date().toISOString().split('T')[0];
    return `feat(save): quick save changes

Agent: Agent A (Architecture)
Context: Quick save of current work progress
Date: ${currentDate}

[actor-web] Agent A (Architecture) - quick save`;
  }
}
