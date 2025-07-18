import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
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
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'validate-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;
  
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
  constructor(private actor: GitActor, private validator: ValidationService) {}

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

    // Send CHECK_REPO message
    this.actor.send({ type: 'CHECK_REPO' });

    // Wait for check to complete
    await this.waitForOperation('CHECK_REPO', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'isGitRepo' in response && 
        response.isGitRepo !== undefined;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { isGitRepo?: boolean };

    if (status.isGitRepo) {
      console.log(chalk.green('✅ Git repository detected'));
    }

    return status.isGitRepo || false;
  }

  /**
   * Get changed files from git
   */
  private async getChangedFiles(): Promise<string[]> {
    console.log(chalk.gray('🔍 Getting changed files...'));

    // Send GET_CHANGED_FILES message
    this.actor.send({ type: 'GET_CHANGED_FILES' });

    // Wait for operation to complete
    await this.waitForOperation('GET_CHANGED_FILES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_CHANGED_FILES' });
      return response && typeof response === 'object' && 
        'changedFiles' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_CHANGED_FILES' });
    const filesInfo = response as { changedFiles?: string[] };

    const changedFiles = filesInfo.changedFiles || [];
    
    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No changed files to validate'));
    } else {
      console.log(chalk.blue(`📁 Found ${changedFiles.length} changed files`));
    }

    return changedFiles;
  }

  /**
   * Wait for an operation to complete
   */
  private async waitForOperation(
    operation: string, 
    checkComplete: () => Promise<boolean>,
    timeout: number = 10000
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