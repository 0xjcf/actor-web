/**
 * Enhanced Commit Command - Pure Actor Model Implementation
 * 
 * Smart commit message generation using pure message-passing.
 * No state observation or direct access.
 */

import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

export async function commitEnhancedCommand(customMessage?: string) {
  console.log(chalk.blue('🎭 Enhanced Commit'));
  console.log(chalk.blue('========================================='));

  const repoRoot = await findRepoRoot();
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'commit-enhanced-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new CommitEnhancedWorkflowHandler(gitActor);
    await workflow.executeCommit(customMessage);
  } catch (error) {
    console.error(chalk.red('❌ Enhanced commit failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

export async function generateCommitMessageCommand() {
  console.log(chalk.blue('🧠 Generate Commit Message'));
  console.log(chalk.blue('=========================================='));

  const repoRoot = await findRepoRoot();
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'generate-message-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new CommitEnhancedWorkflowHandler(gitActor);
    const message = await workflow.generateMessage();
    
    if (message) {
      console.log(chalk.green('✅ Generated commit message:'));
      console.log();
      console.log(message);
      console.log();
    } else {
      console.log(chalk.red('❌ Failed to generate commit message'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Message generation failed:'), error);
  } finally {
    await gitActor.stop();
  }
}

export async function validateDatesCommand(files?: string[]) {
  console.log(chalk.blue('📅 Validate Dates'));
  console.log(chalk.blue('================================='));

  const repoRoot = await findRepoRoot();
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'validate-dates-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

  try {
    // Start the actor
    gitActor.start();

    // Default to common documentation files if none provided
    const filesToCheck = files ? validateFilesArray(files) : 
      ['docs/README.md', 'docs/agent-updates.md', 'src/**/*.ts'];

    // Create workflow handler
    const workflow = new CommitEnhancedWorkflowHandler(gitActor);
    await workflow.validateDates(filesToCheck);
  } catch (error) {
    console.error(chalk.red('❌ Date validation failed:'), error);
  } finally {
    await gitActor.stop();
  }
}

// ============================================================================
// WORKFLOW HANDLER
// ============================================================================

/**
 * Commit enhanced workflow handler using pure message-passing
 */
class CommitEnhancedWorkflowHandler {
  constructor(private actor: GitActor) {}

  /**
   * Execute commit with optional custom message
   */
  async executeCommit(customMessage?: string): Promise<void> {
    if (customMessage) {
      console.log(chalk.blue('📝 Using provided commit message...'));
      
      // Commit with custom message
      await this.commitWithMessage(customMessage);
      console.log(chalk.green('✅ Committed with custom message:'));
      console.log(chalk.gray(customMessage));
    } else {
      console.log(chalk.blue('🧠 Generating smart commit message...'));
      
      // Generate commit message
      const generatedMessage = await this.generateMessage();
      
      if (generatedMessage) {
        console.log(chalk.yellow('📝 Generated commit message:'));
        console.log(chalk.gray(generatedMessage));
        console.log();

        // Ask for confirmation
        const useMessage = await promptForConfirmation('Use this commit message? (Y/n): ');

        if (!useMessage) {
          console.log(chalk.yellow('❌ Commit cancelled'));
          return;
        }

        // Commit with generated message
        await this.commitWithMessage(generatedMessage);
        console.log(chalk.green('✅ Committed successfully!'));
      } else {
        console.log(chalk.red('❌ Failed to generate commit message'));
      }
    }
  }

  /**
   * Generate commit message
   */
  async generateMessage(): Promise<string | undefined> {
    console.log(chalk.blue('🔍 Analyzing changes...'));

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

    return status.lastCommitMessage;
  }

  /**
   * Commit with message
   */
  private async commitWithMessage(message: string): Promise<void> {
    // First stage all changes
    this.actor.send({ type: 'ADD_ALL' });

    // Wait for staging to complete
    await this.waitForOperation('ADD_ALL', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'lastOperation' in response && 
        response.lastOperation === 'STAGING_COMPLETED';
    });

    // Then commit with message
    this.actor.send({ type: 'COMMIT_CHANGES', message });

    // Wait for commit to complete
    await this.waitForOperation('COMMIT_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_COMMIT_STATUS' });
      return response && typeof response === 'object' && 
        'lastCommitHash' in response && 
        response.lastCommitHash;
    });
  }

  /**
   * Validate dates in files
   */
  async validateDates(filesToCheck: string[]): Promise<void> {
    console.log(chalk.blue(`🔍 Checking ${filesToCheck.length} files for date issues...`));
    
    // Send VALIDATE_DATES message
    this.actor.send({ type: 'VALIDATE_DATES', filePaths: filesToCheck });

    // Wait for validation to complete
    await this.waitForOperation('VALIDATE_DATES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_DATE_VALIDATION' });
      return response && typeof response === 'object' && 
        'dateIssues' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_DATE_VALIDATION' });
    const validation = response as { 
      dateIssues?: Array<{
        file: string;
        line: number;
        date: string;
        issue: string;
        context: string;
      }> 
    };

    const dateIssues = validation.dateIssues || [];

    if (dateIssues.length === 0) {
      console.log(chalk.green('✅ No date issues found!'));
    } else {
      console.log(chalk.yellow(`⚠️  Found ${dateIssues.length} date issues:`));

      for (const issue of dateIssues) {
        console.log(chalk.red(`  ${issue.file}:${issue.line}`));
        console.log(chalk.gray(`    Date: ${issue.date} (${issue.issue})`));
        console.log(chalk.gray(`    Context: ${issue.context}`));
      }
    }
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate that files parameter is a valid array of file path strings
 */
function validateFilesArray(files: unknown): string[] {
  if (!Array.isArray(files)) {
    throw new Error('Files parameter must be an array');
  }

  for (const file of files) {
    if (typeof file !== 'string') {
      throw new Error('All files must be valid file path strings');
    }
    if (file.trim() === '') {
      throw new Error('File paths cannot be empty strings');
    }
  }

  return files as string[];
}

/**
 * Prompt for user confirmation with proper validation
 */
async function promptForConfirmation(prompt: string): Promise<boolean> {
  process.stdout.write(prompt);

  return new Promise((resolve) => {
    const readline = require('node:readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('', (answer: string) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}