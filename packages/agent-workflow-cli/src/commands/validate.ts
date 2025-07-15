import type { ActorSnapshot } from '@actor-core/runtime';
import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

export async function validateCommand() {
  console.log(chalk.blue('🔍 Validation Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
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
 * Validation workflow handler using completion state architecture
 */
class ValidateWorkflowHandler {
  private actor: GitActor;
  private validator: ValidationService;
  private changedFiles: string[] = [];

  constructor(actor: GitActor, validator: ValidationService) {
    this.actor = actor;
    this.validator = validator;
  }

  async executeValidation(): Promise<void> {
    console.log(chalk.blue('📋 Starting validation...'));

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
              resolve();
              return;
            }
            console.log(chalk.green('✅ Git repository detected'));
            this.actor.send({ type: 'GET_CHANGED_FILES' });
            repoObserver.unsubscribe();
          });
        break;
      }

      case 'changedFilesChecked': {
        // Use observe to reactively get changed files
        const filesObserver = this.actor
          .observe((snapshot) => snapshot.context.changedFiles)
          .subscribe((changedFiles) => {
            this.changedFiles = changedFiles || [];
            this.handleChangedFiles(this.changedFiles);
            filesObserver.unsubscribe();
          });
        break;
      }

      // Error states
      case 'repoError':
      case 'changedFilesError': {
        // Use observe to reactively get error message
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

      // Timeout states
      case 'repoTimeout':
      case 'changedFilesTimeout': {
        const timeoutMsg = `Operation timed out in ${stateStr}`;
        console.error(chalk.red('⏱️ Timeout:'), timeoutMsg);
        reject(new Error(timeoutMsg));
        break;
      }
    }
  }

  private async handleChangedFiles(files: string[]): Promise<void> {
    if (files.length === 0) {
      console.log(chalk.green('✅ No changed files to validate'));
      this.onSuccess?.();
      return;
    }

    console.log(chalk.blue(`📁 Found ${files.length} changed files`));

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

      this.onSuccess?.();
    } catch (error) {
      console.error(chalk.red('❌ Validation error:'), error);
      this.onSuccess?.();
    }
  }
}
