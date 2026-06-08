/**
 * Enhanced Commit Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */

import { createInterface } from 'node:readline';
import { Logger } from '@actor-web/runtime';
import chalk from 'chalk';

const log = Logger.namespace('COMMIT_ENHANCED');

import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

// ============================================================================
// COMMAND IMPLEMENTATIONS
// ============================================================================

/**
 * Enhanced Commit Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */

export async function commitEnhancedCommand(command?: {
  message?: string;
  dryRun?: boolean;
  noVerify?: boolean;
}) {
  const isDryRun = command?.dryRun || false;
  const customMessage = command?.message;

  log.debug(chalk.blue('🎭 Enhanced Commit'));
  if (isDryRun) {
    log.debug(chalk.yellow('🔍 DRY RUN MODE - No changes will be made'));
  }
  log.debug(chalk.blue('========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    if (customMessage) {
      log.debug(chalk.blue('📝 Using provided commit message...'));

      if (isDryRun) {
        log.debug(chalk.cyan('📝 [DRY RUN] Would commit changes with message:'));
        log.debug(chalk.gray(`   "${customMessage}"`));
        log.debug(chalk.cyan('✅ [DRY RUN] Enhanced commit would complete successfully!'));
      } else {
        // ✅ SIMPLIFIED: Commit with custom message using direct operations
        await commitWithMessage(git, customMessage);
        log.debug(chalk.green('✅ Committed with custom message:'));
        log.debug(chalk.gray(customMessage));
      }
    } else {
      log.debug(chalk.blue('🧠 Generating smart commit message...'));

      // ✅ SIMPLIFIED: Generate commit message using direct operations
      const generatedMessage = await generateMessage(git);

      if (generatedMessage) {
        log.debug(chalk.yellow('📝 Generated commit message:'));
        log.debug(chalk.gray(generatedMessage));

        if (isDryRun) {
          log.debug(chalk.cyan('📝 [DRY RUN] Would commit changes with generated message'));
          log.debug(chalk.cyan('✅ [DRY RUN] Enhanced commit would complete successfully!'));
        } else {
          // Ask for confirmation
          const useMessage = await promptForConfirmation('Use this commit message? (Y/n): ');

          if (!useMessage) {
            log.debug(chalk.yellow('❌ Commit cancelled'));
            return;
          }

          // Commit with generated message
          await commitWithMessage(git, generatedMessage);
          log.debug(chalk.green('✅ Committed successfully!'));
        }
      } else {
        log.debug(chalk.red('❌ Failed to generate commit message'));
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Enhanced commit failed:'), error);
    process.exit(1);
  }
}

export async function generateCommitMessageCommand() {
  log.debug(chalk.blue('🧠 Generate Commit Message'));
  log.debug(chalk.blue('=========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Generate message using direct operations
    const message = await generateMessage(git);

    if (message) {
      log.debug(chalk.green('✅ Generated commit message:'));

      log.debug(message);
    } else {
      log.debug(chalk.red('❌ Failed to generate commit message'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Message generation failed:'), error);
  }
}

export async function validateDatesCommand(files?: string[]) {
  log.debug(chalk.blue('📅 Validate Dates'));
  log.debug(chalk.blue('================================='));

  try {
    // Default to common documentation files if none provided
    const filesToCheck = files
      ? validateFilesArray(files)
      : ['docs/README.md', 'docs/agent-updates.md', 'src/**/*.ts'];

    // ✅ SIMPLIFIED: Validate dates using direct operations
    await validateDates(filesToCheck);
  } catch (error) {
    console.error(chalk.red('❌ Date validation failed:'), error);
  }
}

// ============================================================================
// PURE FUNCTIONS
// ============================================================================

/**
 * Generate commit message using GitOperations
 */
async function generateMessage(git: GitOperations): Promise<string | undefined> {
  log.debug(chalk.blue('🔍 Analyzing changes...'));

  try {
    // Get changed files to analyze
    const changedFiles = await git.getChangedFiles();
    if (changedFiles.length === 0) {
      return 'chore: no changes detected';
    }

    // Generate intelligent commit message based on changed files
    const currentBranch = await git.getCurrentBranch();
    return await generateIntelligentCommitMessage(changedFiles, currentBranch);
  } catch (error) {
    console.error(chalk.red('Error generating message:'), error);
    return undefined;
  }
}

/**
 * Generate intelligent commit message based on changed files and context
 */
async function generateIntelligentCommitMessage(
  changedFiles: string[],
  branchName: string | null
): Promise<string> {
  // Analyze file patterns to determine change type
  const hasTests = changedFiles.some((f) => f.includes('.test.') || f.includes('.spec.'));
  const hasDocs = changedFiles.some((f) => f.endsWith('.md'));
  const hasConfig = changedFiles.some((f) => f.includes('config') || f.includes('package.json'));
  const hasSource = changedFiles.some((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  const hasStyles = changedFiles.some((f) => /\.(css|scss|sass)$/.test(f));

  // Determine commit type prefix
  let prefix = 'chore';
  if (hasSource && hasTests) prefix = 'feat';
  else if (hasTests) prefix = 'test';
  else if (hasSource) prefix = 'feat';
  else if (hasDocs) prefix = 'docs';
  else if (hasConfig) prefix = 'chore';
  else if (hasStyles) prefix = 'style';

  // Generate description based on patterns
  let description = 'update codebase';
  if (hasSource && hasTests) description = 'implement feature with tests';
  else if (hasSource) description = 'implement new functionality';
  else if (hasTests) description = 'update test suite';
  else if (hasDocs) description = 'update documentation';
  else if (hasConfig) description = 'update configuration';
  else if (hasStyles) description = 'update styling';

  // Add branch context if available
  const branchContext = branchName ? `\n\nBranch: ${branchName}` : '';
  const fileCount = changedFiles.length;

  return `${prefix}: ${description}

Files changed: ${fileCount}${branchContext}
Date: ${new Date().toISOString()}

[actor-web] Enhanced commit - auto-generated message`;
}

/**
 * Commit with message using GitOperations
 */
async function commitWithMessage(git: GitOperations, message: string): Promise<void> {
  // Stage all changes
  await git.addAll();

  // Commit with message
  await git.commit(message);
}

/**
 * Validate dates in files using GitOperations
 */
async function validateDates(filesToCheck: string[]): Promise<void> {
  log.debug(chalk.blue(`🔍 Checking ${filesToCheck.length} files for date issues...`));

  // For now, this is a simplified implementation
  // In a full implementation, you would read each file and check for date patterns
  log.debug(chalk.yellow('⚠️  Date validation not fully implemented yet'));
  log.debug(chalk.gray('   This would check files for outdated dates and inconsistencies'));

  // Show what files would be checked
  for (const file of filesToCheck.slice(0, 3)) {
    log.debug(chalk.gray(`   • Would check: ${file}`));
  }
  if (filesToCheck.length > 3) {
    log.debug(chalk.gray(`   • ... and ${filesToCheck.length - 3} more files`));
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
