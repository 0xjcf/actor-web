import chalk from 'chalk';
import { createGitActor, type GitActor } from '../actors/git-actor.js';
import { subscribeToEvent } from '../actors/git-actor-helpers.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

/**
 * Validate Command - Pure Actor Model Implementation
 *
 * Validates changed files using pure message-passing.
 * No state observation or direct access.
 */
export async function validateCommand() {
  console.log(chalk.blue('🔍 Validation Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();

  // Create git actor using the proper factory function
  const gitActor = createGitActor(repoRoot);

  const validator = new ValidationService();

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new ValidateWorkflowHandler(gitActor, validator);
    await workflow.executeValidation();
  } catch (error) {
    console.error(chalk.red('❌ Validation failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * Validation workflow handler using pure message-passing
 */
class ValidateWorkflowHandler {
  constructor(
    private actor: GitActor,
    private validator: ValidationService
  ) {}

  async executeValidation(): Promise<void> {
    console.log(chalk.blue('📋 Starting validation...'));

    try {
      // Step 1: Check if it's a git repository
      const isGitRepo = await this.checkGitRepository();

      if (!isGitRepo) {
        console.log(chalk.red('❌ Not in a Git repository'));
        return;
      }

      // Step 2: Get changed files
      const changedFiles = await this.getChangedFiles();

      // Step 3: Run validation on changed files
      await this.runValidation(changedFiles);
    } catch (error) {
      console.error(chalk.red('❌ Validation error:'), error);
      throw error;
    }
  }

  /**
   * Check if directory is a git repository
   */
  private async checkGitRepository(): Promise<boolean> {
    console.log(chalk.gray('🔍 Checking repository...'));

    // Subscribe to repo status event
    const repoStatusPromise = new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_REPO_STATUS_CHANGED', (event) => {
        unsubscribe();
        resolve(event.isGitRepo);
      });
    });

    // Send CHECK_REPO message
    this.actor.send({ type: 'CHECK_REPO' });

    // Wait for event
    const isGitRepo = await repoStatusPromise;

    if (isGitRepo) {
      console.log(chalk.green('✅ Git repository detected'));
    }

    return isGitRepo;
  }

  /**
   * Get changed files from git
   */
  private async getChangedFiles(): Promise<string[]> {
    console.log(chalk.gray('🔍 Getting changed files...'));

    // Subscribe to changed files event
    const changedFilesPromise = new Promise<string[]>((resolve) => {
      const unsubscribe = subscribeToEvent(this.actor, 'GIT_CHANGED_FILES_DETECTED', (event) => {
        unsubscribe();
        resolve(event.files);
      });
    });

    // Send GET_CHANGED_FILES message
    this.actor.send({ type: 'GET_CHANGED_FILES' });

    // Wait for event
    const changedFiles = await changedFilesPromise;

    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No changed files to validate'));
    } else {
      console.log(chalk.blue(`📁 Found ${changedFiles.length} changed files`));
    }

    return changedFiles;
  }

  private async runValidation(files: string[]): Promise<void> {
    if (files.length === 0) {
      return;
    }

    try {
      console.log(chalk.blue('🔍 Running validation checks...'));

      // TypeScript validation
      const tsFiles = files.filter((f) => f.match(/\.(ts|tsx)$/));
      if (tsFiles.length > 0) {
        console.log(chalk.blue(`📝 Checking TypeScript (${tsFiles.length} files)...`));
        const tsResult = await this.validator.validateTypeScript(files);

        if (tsResult.success) {
          console.log(chalk.green(`✅ TypeScript: All ${tsFiles.length} files pass`));
        } else {
          console.log(chalk.red(`❌ TypeScript: ${tsResult.errors.length} errors found`));
          for (const error of tsResult.errors.slice(0, 5)) {
            console.log(chalk.red(`   • ${error}`));
          }
          if (tsResult.errors.length > 5) {
            console.log(chalk.red(`   ... and ${tsResult.errors.length - 5} more errors`));
          }
        }
      } else {
        console.log(chalk.green('✅ TypeScript: No TypeScript files to check'));
      }

      // Linting validation
      const lintableFiles = this.validator.filterLintableFiles(files);
      if (lintableFiles.length > 0) {
        console.log(chalk.blue(`🧹 Checking linting (${lintableFiles.length} files)...`));
        const biomeResult = await this.validator.validateBiome(files);

        if (biomeResult.success) {
          console.log(chalk.green(`✅ Linting: All ${lintableFiles.length} files pass`));
        } else {
          console.log(chalk.red(`❌ Linting: Issues found in ${lintableFiles.length} files`));
          for (const error of biomeResult.errors.slice(0, 5)) {
            console.log(chalk.red(`   • ${error}`));
          }
          if (biomeResult.errors.length > 5) {
            console.log(chalk.red(`   ... and ${biomeResult.errors.length - 5} more errors`));
          }
        }
      } else {
        console.log(chalk.green('✅ Linting: No lintable files (docs/configs ignored)'));
      }

      // Tests validation
      const testFiles = files.filter((f) => f.includes('.test.') || f.includes('.spec.'));
      if (testFiles.length > 0) {
        console.log(chalk.blue(`🧪 Found ${testFiles.length} test files`));
        console.log(chalk.blue('💡 Run tests with: pnpm test'));
      }

      // Overall validation result
      const allResults = await this.validator.validateFiles(files);

      if (allResults.overall) {
        console.log(chalk.green('\n✅ All validation checks passed!'));
        console.log(chalk.blue('💡 Your changes are ready to ship'));
      } else {
        console.log(chalk.red('\n❌ Some validation checks failed'));
        console.log(chalk.blue('💡 Fix the issues above before shipping'));
      }
    } catch (error) {
      console.error(chalk.red('❌ Validation error:'), error);
    }
  }
}
