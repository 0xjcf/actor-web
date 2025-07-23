import chalk from 'chalk';
import { createGitActor, type GitActor } from '../actors/git-actor.js';
import { subscribeToEvent } from '../actors/git-actor-helpers.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Save Command - Pure Actor Model Implementation
 *
 * Quick save workflow using pure message-passing.
 * No state observation or direct access.
 */
export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();

  // Create git actor using the proper factory function
  const gitActor = createGitActor(repoRoot);

  try {
    // Start the actor
    gitActor.start();

    // Create save workflow handler
    const saveWorkflow = new SaveWorkflowHandler(gitActor);
    await saveWorkflow.executeSave(customMessage);

    console.log(chalk.green('✅ Save completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Save failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * Save workflow handler using pure message-passing
 */
class SaveWorkflowHandler {
  constructor(private actor: GitActor) {}

  async executeSave(customMessage?: string): Promise<void> {
    console.log(chalk.blue('📋 Starting save workflow...'));

    try {
      // Step 1: Check repository status
      const status = await this.checkRepoStatus();

      if (!status.isGitRepo) {
        throw new Error('Not a git repository');
      }

      // Step 2: Check for uncommitted changes
      const hasChanges = await this.checkUncommittedChanges();

      if (!hasChanges) {
        console.log(chalk.yellow('⚠️  No changes to save'));
        return;
      }

      // Step 3: Stage all changes
      await this.stageAllChanges();

      // Step 4: Commit with message
      await this.commitChanges(customMessage);
    } catch (error) {
      console.error(chalk.red('Save workflow error:'), error);
      throw error;
    }
  }

  /**
   * Check repository status
   */
  private async checkRepoStatus(): Promise<{ isGitRepo: boolean; currentBranch?: string }> {
    console.log(chalk.blue('🔍 Checking repository...'));

    // Subscribe to repo status change event
    const repoStatusPromise = new Promise<{ isGitRepo: boolean; repoStatus: unknown }>(
      (resolve) => {
        const unsubscribe = subscribeToEvent(this.actor, 'GIT_REPO_STATUS_CHANGED', (event) => {
          unsubscribe();
          resolve({ isGitRepo: event.isGitRepo, repoStatus: event.repoStatus });
        });
      }
    );

    // Send CHECK_REPO message
    this.actor.send({ type: 'CHECK_REPO' });

    // Wait for event
    const { isGitRepo } = await repoStatusPromise;

    // Get additional status info
    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { isGitRepo?: boolean; currentBranch?: string };

    if (isGitRepo) {
      console.log(chalk.green('✅ Git repository confirmed'));
      if (status.currentBranch) {
        console.log(chalk.blue(`📋 Current branch: ${status.currentBranch}`));
      }
    }

    return {
      isGitRepo: isGitRepo,
      currentBranch: status.currentBranch,
    };
  }

  /**
   * Check for uncommitted changes
   */
  private async checkUncommittedChanges(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking for uncommitted changes...'));

    // Subscribe to uncommitted changes event
    const changesPromise = new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeToEvent(
        this.actor,
        'GIT_UNCOMMITTED_CHANGES_DETECTED',
        (event) => {
          unsubscribe();
          resolve(event.hasChanges);
        }
      );
    });

    // Send CHECK_UNCOMMITTED_CHANGES message
    this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

    // Wait for event
    const hasChanges = await changesPromise;

    if (hasChanges) {
      console.log(chalk.yellow('📝 Uncommitted changes detected'));
    }

    return hasChanges;
  }

  /**
   * Stage all changes
   */
  private async stageAllChanges(): Promise<void> {
    console.log(chalk.blue('📦 Staging all changes...'));

    // Subscribe to staging completed event
    const stagingPromise = new Promise<void>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_STAGING_COMPLETED', (_event) => {
        unsubscribe();
        resolve();
      });
    });

    // Send ADD_ALL message
    this.actor.send({ type: 'ADD_ALL' });

    // Wait for event
    await stagingPromise;

    console.log(chalk.green('✅ All changes staged'));
  }

  /**
   * Commit changes with message
   */
  private async commitChanges(customMessage?: string): Promise<void> {
    console.log(chalk.blue('💾 Committing changes...'));

    // Generate commit message
    const commitMessage = customMessage || (await this.generateCommitMessage());

    console.log(chalk.gray(`📝 Commit message: ${commitMessage.split('\n')[0]}`));

    // Subscribe to commit completed event
    const commitPromise = new Promise<{ commitHash: string; message: string }>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_COMMIT_COMPLETED', (event) => {
        unsubscribe();
        resolve({ commitHash: event.commitHash, message: event.message });
      });
    });

    // Send COMMIT_CHANGES message
    this.actor.send({ type: 'COMMIT_CHANGES', payload: { message: commitMessage } });

    // Wait for event
    const { commitHash } = await commitPromise;

    console.log(chalk.green(`✅ Changes saved! Commit: ${commitHash.substring(0, 7)}`));
  }

  /**
   * Generate commit message
   */
  private async generateCommitMessage(): Promise<string> {
    console.log(chalk.blue('🤖 Generating commit message...'));

    // Subscribe to commit message generated event
    const messagePromise = new Promise<string>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_COMMIT_MESSAGE_GENERATED', (event) => {
        unsubscribe();
        resolve(event.message);
      });
    });

    // Send GENERATE_COMMIT_MESSAGE
    this.actor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

    // Wait for event
    const message = await messagePromise;

    return message || 'save: quick save changes';
  }
}
