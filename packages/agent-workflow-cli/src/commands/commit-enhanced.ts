/**
 * Enhanced commit command with smart commit message generation
 */

import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import {
  createContextObserver,
  createErrorObserver,
  createStateObserver,
} from '../actors/git-actor-helpers.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// ============================================================================
// REACTIVE UTILITIES
// ============================================================================

/**
 * Wait for a specific state using proper reactive observation
 */
async function waitForState(
  gitActor: GitActor,
  targetStates: string[],
  errorStates: string[] = [],
  timeoutStates: string[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stateObserver = createStateObserver(
      gitActor,
      (snapshot) => snapshot.value,
      (state) => {
        if (targetStates.includes(state as string)) {
          cleanup();
          resolve();
        } else if (errorStates.includes(state as string)) {
          cleanup();
          reject(new Error('Operation failed'));
        } else if (timeoutStates.includes(state as string)) {
          cleanup();
          reject(new Error('Operation timed out'));
        }
      }
    );

    const errorObserver = createErrorObserver(gitActor, (error) => {
      cleanup();
      reject(new Error(error));
    });

    const cleanup = () => {
      stateObserver.unsubscribe();
      errorObserver.unsubscribe();
    };
  });
}

/**
 * Get context value reactively after state completion
 */
async function getContextValue<T>(
  gitActor: GitActor,
  selector: (context: GitContext) => T
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const contextObserver = createContextObserver(gitActor, selector, (value) => {
      contextObserver.unsubscribe();
      resolve(value);
    });
  });
}

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

export async function commitEnhancedCommand(customMessage?: string) {
  console.log(chalk.blue('🎭 Enhanced Commit (Actor-Based)'));
  console.log(chalk.blue('========================================='));

  // Dynamically find repository root
  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    if (customMessage) {
      console.log(chalk.blue('📝 Using provided commit message...'));

      // Use custom message with conventional format
      gitActor.send({ type: 'COMMIT_WITH_CONVENTION', customMessage });

      // Wait for completion with proper async waiting
      await waitForState(gitActor, ['commitCompleted'], ['commitError'], ['commitTimeout']);

      // Get result reactively
      const lastCommitMessage = await getContextValue(
        gitActor,
        (context) => context.lastCommitMessage
      );
      if (lastCommitMessage) {
        console.log(chalk.green('✅ Committed with custom message:'));
        console.log(chalk.gray(lastCommitMessage));
      }
    } else {
      console.log(chalk.blue('🧠 Generating smart commit message...'));

      // Generate commit message first
      gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

      // Wait for generation with proper async waiting
      await waitForState(
        gitActor,
        ['commitMessageGenerated'],
        ['commitMessageError'],
        ['commitMessageTimeout']
      );

      // Get generated message reactively
      const lastCommitMessage = await getContextValue(
        gitActor,
        (context) => context.lastCommitMessage
      );
      if (lastCommitMessage) {
        console.log(chalk.yellow('📝 Generated commit message:'));
        console.log(chalk.gray(lastCommitMessage));
        console.log();

        // Ask for confirmation with proper validation
        const useMessage = await promptForConfirmation('Use this commit message? (Y/n): ');

        if (!useMessage) {
          console.log(chalk.yellow('❌ Commit cancelled'));
          return;
        }

        // Commit with generated message
        gitActor.send({ type: 'COMMIT_WITH_CONVENTION' });

        // Wait for completion with proper async waiting
        await waitForState(gitActor, ['commitCompleted'], ['commitError'], ['commitTimeout']);

        console.log(chalk.green('✅ Committed successfully!'));
      } else {
        console.log(chalk.red('❌ Failed to generate commit message'));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Enhanced commit failed:'), error);
    process.exit(1);
  } finally {
    gitActor.stop();
  }
}

export async function generateCommitMessageCommand() {
  console.log(chalk.blue('🧠 Generate Commit Message (Actor-Based)'));
  console.log(chalk.blue('=========================================='));

  // Dynamically find repository root
  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.blue('🔍 Analyzing changes...'));
    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

    // Wait for generation with proper async waiting
    await waitForState(
      gitActor,
      ['commitMessageGenerated'],
      ['commitMessageError'],
      ['commitMessageTimeout']
    );

    // Get results reactively
    const lastCommitMessage = await getContextValue(
      gitActor,
      (context) => context.lastCommitMessage
    );
    const commitConfig = await getContextValue(gitActor, (context) => context.commitConfig);

    if (lastCommitMessage) {
      console.log(chalk.green('✅ Generated commit message:'));
      console.log();
      console.log(lastCommitMessage);
      console.log();

      if (commitConfig) {
        console.log(chalk.blue('📊 Analysis:'));
        console.log(chalk.gray(`  Type: ${commitConfig.type}`));
        console.log(chalk.gray(`  Scope: ${commitConfig.scope}`));
        console.log(chalk.gray(`  Category: ${commitConfig.workCategory}`));
      }
    } else {
      console.log(chalk.red('❌ Failed to generate commit message'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Message generation failed:'), error);
  } finally {
    gitActor.stop();
  }
}

export async function validateDatesCommand(files?: string[]) {
  console.log(chalk.blue('📅 Validate Dates (Actor-Based)'));
  console.log(chalk.blue('================================='));

  // Dynamically find repository root
  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // Default to common documentation files if none provided, with input validation
    let filesToCheck: string[];
    if (files) {
      filesToCheck = validateFilesArray(files);
    } else {
      filesToCheck = ['docs/README.md', 'docs/agent-updates.md', 'src/**/*.ts'];
    }

    console.log(chalk.blue(`🔍 Checking ${filesToCheck.length} files for date issues...`));
    gitActor.send({ type: 'VALIDATE_DATES', filePaths: filesToCheck });

    // Wait for validation with proper async waiting
    await waitForState(
      gitActor,
      ['datesValidated'],
      ['datesValidationError'],
      ['datesValidationTimeout']
    );

    // Use reactive observation to get date issues instead of getSnapshot()
    const dateIssues = await new Promise<Array<{
      file: string;
      line: number;
      date: string;
      issue: string;
      context: string;
    }> | null>((resolve) => {
      const subscription = gitActor
        .observe((snapshot) => snapshot.context.dateIssues)
        .subscribe((issues) => {
          subscription.unsubscribe();
          resolve(issues || null);
        });
    });

    if (dateIssues) {
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
    } else {
      console.log(chalk.red('❌ Date validation failed'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Date validation failed:'), error);
  } finally {
    gitActor.stop();
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

// Re-export for backward compatibility
export { waitForState };
