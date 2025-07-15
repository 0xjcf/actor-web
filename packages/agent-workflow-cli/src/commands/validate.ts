import type { ActorSnapshot } from '@actor-web/core';
import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

export async function validateCommand() {
  console.log(chalk.blue('🔍 Validation'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);
  const validator = new ValidationService();

  try {
    // Start the actor
    gitActor.start();

    // Create validation workflow handler
    const validateWorkflow = new ValidateWorkflowHandler(gitActor, validator);
    await validateWorkflow.executeValidation();
  } catch (error) {
    console.error(chalk.red('❌ Validation failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * State-based validation workflow handler
 */
class ValidateWorkflowHandler {
  private actor: GitActor;
  private validator: ValidationService;
  private workflowState: 'checking_repo' | 'getting_files' | 'validating' | 'complete' =
    'checking_repo';
  private changedFiles: string[] = [];

  constructor(actor: GitActor, validator: ValidationService) {
    this.actor = actor;
    this.validator = validator;
  }

  async executeValidation(): Promise<void> {
    console.log(chalk.blue('📋 Starting validation...'));

    return new Promise((resolve, reject) => {
      // Observe repo status
      const repoObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).isGitRepo)
        .subscribe((isGitRepo) => {
          if (isGitRepo !== undefined) {
            this.handleRepoStatus(isGitRepo);
          }
        });

      // Observe changed files
      const filesObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).changedFiles
        )
        .subscribe((files) => {
          if (files) {
            this.changedFiles = files;
            this.handleChangedFiles(files);
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
      this.observers = [repoObserver, filesObserver, errorObserver];

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
      this.workflowState = 'complete';
      this.onSuccess?.();
      return;
    }

    console.log(chalk.green('✅ Git repository detected'));
    this.workflowState = 'getting_files';
    this.actor.send({ type: 'GET_CHANGED_FILES' });
  }

  private async handleChangedFiles(files: string[]): Promise<void> {
    if (this.workflowState !== 'getting_files') return;

    if (files.length === 0) {
      console.log(chalk.green('✅ No changed files to validate'));
      this.workflowState = 'complete';
      this.onSuccess?.();
      return;
    }

    console.log(chalk.blue(`📁 Found ${files.length} changed files`));
    this.workflowState = 'validating';

    // Run validation asynchronously
    await this.runValidation(files);
  }

  private async runValidation(files: string[]): Promise<void> {
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

      this.workflowState = 'complete';
      this.onSuccess?.();
    } catch (error) {
      console.error(chalk.red('❌ Validation error:'), error);
      this.workflowState = 'complete';
      this.onSuccess?.();
    }
  }
}
