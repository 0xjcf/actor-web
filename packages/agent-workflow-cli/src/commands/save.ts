import type { ActorSnapshot } from '@actor-core/runtime';
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

  constructor(actor: GitActor) {
    this.actor = actor;
  }

  async executeSave(customMessage?: string): Promise<void> {
    this.customMessage = customMessage;
    console.log(chalk.blue('📋 Starting save workflow...'));

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
      this.actor.send({ type: 'CHECK_REPO' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private handleStateChange(
    state: unknown,
    resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const stateStr = state as string;

    switch (stateStr) {
      case 'repoChecked': {
        // Use observe to reactively check if it's a git repo
        const repoObserver = this.actor
          .observe((snapshot) => snapshot.context.isGitRepo)
          .subscribe((isGitRepo) => {
            if (!isGitRepo) {
              console.log(chalk.red('❌ Not in a Git repository'));
              reject(new Error('Not in a Git repository'));
              return;
            }
            console.log(chalk.green('✅ Git repository detected'));
            this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
            repoObserver.unsubscribe();
          });
        break;
      }

      case 'uncommittedChangesChecked': {
        // Use observe to reactively check for uncommitted changes
        const changesObserver = this.actor
          .observe((snapshot) => snapshot.context.uncommittedChanges)
          .subscribe((uncommittedChanges) => {
            if (!uncommittedChanges) {
              console.log(chalk.yellow('⚠️  No changes to save'));
              resolve();
              return;
            }
            console.log(chalk.yellow('📝 Changes detected, staging...'));
            this.actor.send({ type: 'ADD_ALL' });
            changesObserver.unsubscribe();
          });
        break;
      }

      case 'stagingCompleted': {
        console.log(chalk.green('✅ All changes staged'));
        const commitMessage = this.customMessage || this.generateDefaultCommitMessage();
        this.actor.send({ type: 'COMMIT_CHANGES', message: commitMessage });
        break;
      }

      case 'commitCompleted':
        console.log(chalk.green('✅ Changes committed successfully'));
        console.log(chalk.blue('💡 Use pnpm aw:ship to push to integration branch'));
        this.onSuccess?.();
        break;

      case 'repoError':
      case 'statusError':
      case 'uncommittedChangesError':
      case 'stagingError':
      case 'commitError': {
        // Use observe to reactively get the error message
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
    }
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
