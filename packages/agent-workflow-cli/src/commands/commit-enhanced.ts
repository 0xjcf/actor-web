/**
 * Enhanced Commit Command - Pure Actor Model Implementation
 *
 * ✅ PURE ACTOR MODEL: Uses only ask/tell patterns
 * ❌ NO subscriptions, handlers, or classes
 */

import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { createGitActor, type GitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

export async function commitEnhancedCommand(customMessage?: string) {
  console.log(chalk.blue('🎭 Enhanced Commit'));
  console.log(chalk.blue('========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    if (customMessage) {
      console.log(chalk.blue('📝 Using provided commit message...'));

      // ✅ PURE ACTOR MODEL: Commit with custom message using ask patterns
      await commitWithMessage(gitActor, customMessage);
      console.log(chalk.green('✅ Committed with custom message:'));
      console.log(chalk.gray(customMessage));
    } else {
      console.log(chalk.blue('🧠 Generating smart commit message...'));

      // ✅ PURE ACTOR MODEL: Generate commit message using ask pattern
      const generatedMessage = await generateMessage(gitActor);

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
        await commitWithMessage(gitActor, generatedMessage);
        console.log(chalk.green('✅ Committed successfully!'));
      } else {
        console.log(chalk.red('❌ Failed to generate commit message'));
      }
    }
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
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // ✅ PURE ACTOR MODEL: Generate message using ask pattern
    const message = await generateMessage(gitActor);

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
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    // Default to common documentation files if none provided
    const filesToCheck = files
      ? validateFilesArray(files)
      : ['docs/README.md', 'docs/agent-updates.md', 'src/**/*.ts'];

    // ✅ PURE ACTOR MODEL: Validate dates using ask pattern
    await validateDates(gitActor, filesToCheck);
  } catch (error) {
    console.error(chalk.red('❌ Date validation failed:'), error);
  } finally {
    await gitActor.stop();
  }
}

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Generate commit message using ask pattern
 */
async function generateMessage(gitActor: GitActor): Promise<string | undefined> {
  console.log(chalk.blue('🔍 Analyzing changes...'));

  const response = await gitActor.ask({
    type: 'GENERATE_COMMIT_MESSAGE',
  });

  return response.message;
}
//

/**
 * Commit with message using ask patterns
 */
async function commitWithMessage(gitActor: GitActor, message: string): Promise<void> {
  // Stage all changes using ask pattern
  await gitActor.ask({ type: 'ADD_ALL' });

  // Commit with message using ask pattern
  await gitActor.ask({
    type: 'COMMIT_CHANGES',
    payload: { message },
  });
}

/**
 * Validate dates in files using ask pattern
 */
async function validateDates(gitActor: GitActor, filesToCheck: string[]): Promise<void> {
  console.log(chalk.blue(`🔍 Checking ${filesToCheck.length} files for date issues...`));

  const response = await gitActor.ask({
    type: 'VALIDATE_DATES',
    payload: { filePaths: filesToCheck },
  });

  const dateIssues = response.issues;

  if (dateIssues.length === 0) {
    console.log(chalk.green('✅ No date issues found'));
  } else {
    console.log(chalk.yellow(`⚠️  Found ${dateIssues.length} date issues:`));

    for (const issue of dateIssues) {
      console.log(chalk.red(`  ❌ ${issue.file}:${issue.line} - ${issue.date} (${issue.issue})`));
      console.log(chalk.gray(`     Context: ${issue.context}`));
    }
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
    const rl = createInterface({
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
