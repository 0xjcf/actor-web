import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
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
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'save-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

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

    // Send CHECK_REPO message
    this.actor.send({ type: 'CHECK_REPO' });

    // Wait for repo check to complete
    await this.waitForOperation('CHECK_REPO', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'isGitRepo' in response && 
        response.isGitRepo !== undefined;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { isGitRepo?: boolean; currentBranch?: string };

    if (status.isGitRepo) {
      console.log(chalk.green('✅ Git repository confirmed'));
      if (status.currentBranch) {
        console.log(chalk.blue(`📋 Current branch: ${status.currentBranch}`));
      }
    }

    return { 
      isGitRepo: status.isGitRepo || false,
      currentBranch: status.currentBranch 
    };
  }

  /**
   * Check for uncommitted changes
   */
  private async checkUncommittedChanges(): Promise<boolean> {
    console.log(chalk.blue('🔍 Checking for uncommitted changes...'));

    // Send CHECK_UNCOMMITTED_CHANGES message
    this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

    // Wait for check to complete
    await this.waitForOperation('CHECK_UNCOMMITTED_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'uncommittedChanges' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { uncommittedChanges?: boolean };

    const hasChanges = status.uncommittedChanges || false;
    
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

    // Send ADD_ALL message
    this.actor.send({ type: 'ADD_ALL' });

    // Wait for staging to complete
    await this.waitForOperation('ADD_ALL', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'lastOperation' in response && 
        response.lastOperation === 'STAGING_COMPLETED';
    });

    console.log(chalk.green('✅ All changes staged'));
  }

  /**
   * Commit changes with message
   */
  private async commitChanges(customMessage?: string): Promise<void> {
    console.log(chalk.blue('💾 Committing changes...'));

    // Generate commit message
    const commitMessage = customMessage || await this.generateCommitMessage();
    
    console.log(chalk.gray(`📝 Commit message: ${commitMessage.split('\n')[0]}`));

    // Send COMMIT_CHANGES message
    this.actor.send({ type: 'COMMIT_CHANGES', message: commitMessage });

    // Wait for commit to complete
    await this.waitForOperation('COMMIT_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_COMMIT_STATUS' });
      return response && typeof response === 'object' && 
        'lastCommitHash' in response && 
        response.lastCommitHash;
    });

    const response = await this.actor.ask({ type: 'REQUEST_COMMIT_STATUS' });
    const commitStatus = response as { lastCommitHash?: string };

    if (commitStatus.lastCommitHash) {
      console.log(chalk.green(`✅ Changes saved! Commit: ${commitStatus.lastCommitHash.substring(0, 7)}`));
    }
  }

  /**
   * Generate commit message
   */
  private async generateCommitMessage(): Promise<string> {
    console.log(chalk.blue('🤖 Generating commit message...'));

    // Send GENERATE_COMMIT_MESSAGE
    this.actor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

    // Wait for generation to complete
    await this.waitForOperation('GENERATE_COMMIT_MESSAGE', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'lastCommitMessage' in response && 
        response.lastCommitMessage;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { lastCommitMessage?: string };

    return status.lastCommitMessage || 'save: quick save changes';
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
}