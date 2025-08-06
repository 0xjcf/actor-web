import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

const log = Logger.namespace('VALIDATE_COMMAND');

/**
 * Validate Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function validateCommand() {
  log.debug(chalk.blue('🔍 Validation Check'));
  log.debug(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);
  const validator = new ValidationService();

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    log.debug(chalk.gray('🔍 Checking repository...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      log.debug(chalk.red('❌ Not in a Git repository'));
      return;
    }

    log.debug(chalk.green('✅ Git repository detected'));

    // ✅ SIMPLIFIED: Get changed files directly
    log.debug(chalk.gray('🔍 Getting changed files...'));
    const changedFiles = await git.getChangedFiles();

    if (changedFiles.length === 0) {
      log.debug(chalk.green('✅ No changed files to validate'));
      return;
    }

    log.debug(chalk.blue(`📁 Found ${changedFiles.length} changed files`));

    // ✅ SIMPLIFIED: Run validation on changed files
    await runValidation(validator, changedFiles);
  } catch (error) {
    console.error(chalk.red('❌ Validation failed:'), error);
    process.exit(1);
  }
}

/**
 * Run validation on files
 */
async function runValidation(validator: ValidationService, files: string[]): Promise<void> {
  try {
    log.debug(chalk.blue('🔍 Running validation checks...'));

    // TypeScript validation
    const tsFiles = files.filter((f) => f.match(/\.(ts|tsx)$/));
    if (tsFiles.length > 0) {
      log.debug(chalk.blue(`📝 Checking TypeScript (${tsFiles.length} files)...`));
      const tsResult = await validator.validateTypeScript(files);

      if (tsResult.success) {
        log.debug(chalk.green(`✅ TypeScript: All ${tsFiles.length} files pass`));
      } else {
        log.debug(chalk.red(`❌ TypeScript: ${tsResult.errors.length} errors found`));
        for (const error of tsResult.errors.slice(0, 5)) {
          log.debug(chalk.red(`   • ${error}`));
        }
        if (tsResult.errors.length > 5) {
          log.debug(chalk.red(`   ... and ${tsResult.errors.length - 5} more errors`));
        }
      }
    } else {
      log.debug(chalk.green('✅ TypeScript: No TypeScript files to check'));
    }

    // Linting validation
    const lintableFiles = validator.filterLintableFiles(files);
    if (lintableFiles.length > 0) {
      log.debug(chalk.blue(`🧹 Checking linting (${lintableFiles.length} files)...`));
      const biomeResult = await validator.validateBiome(files);

      if (biomeResult.success) {
        log.debug(chalk.green(`✅ Linting: All ${lintableFiles.length} files pass`));
      } else {
        log.debug(chalk.red(`❌ Linting: Issues found in ${lintableFiles.length} files`));
        for (const error of biomeResult.errors.slice(0, 5)) {
          log.debug(chalk.red(`   • ${error}`));
        }
        if (biomeResult.errors.length > 5) {
          log.debug(chalk.red(`   ... and ${biomeResult.errors.length - 5} more errors`));
        }
      }
    } else {
      log.debug(chalk.green('✅ Linting: No lintable files (docs/configs ignored)'));
    }

    // Tests validation
    const testFiles = files.filter((f) => f.includes('.test.') || f.includes('.spec.'));
    if (testFiles.length > 0) {
      log.debug(chalk.blue(`🧪 Found ${testFiles.length} test files`));
      log.debug(chalk.blue('💡 Run tests with: pnpm test'));
    }

    // Overall validation result
    const allResults = await validator.validateFiles(files);

    if (allResults.overall) {
      log.debug(chalk.green('\n✅ All validation checks passed!'));
      log.debug(chalk.blue('💡 Your changes are ready to ship'));
    } else {
      log.debug(chalk.red('\n❌ Some validation checks failed'));
      log.debug(chalk.blue('💡 Fix the issues above before shipping'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Validation error:'), error);
  }
}
