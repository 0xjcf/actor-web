import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

/**
 * Validate Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function validateCommand() {
  console.log(chalk.blue('🔍 Validation Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);
  const validator = new ValidationService();

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    console.log(chalk.gray('🔍 Checking repository...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    console.log(chalk.green('✅ Git repository detected'));

    // ✅ SIMPLIFIED: Get changed files directly
    console.log(chalk.gray('🔍 Getting changed files...'));
    const changedFiles = await git.getChangedFiles();

    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No changed files to validate'));
      return;
    }

    console.log(chalk.blue(`📁 Found ${changedFiles.length} changed files`));

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
    console.log(chalk.blue('🔍 Running validation checks...'));

    // TypeScript validation
    const tsFiles = files.filter((f) => f.match(/\.(ts|tsx)$/));
    if (tsFiles.length > 0) {
      console.log(chalk.blue(`📝 Checking TypeScript (${tsFiles.length} files)...`));
      const tsResult = await validator.validateTypeScript(files);

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
    const lintableFiles = validator.filterLintableFiles(files);
    if (lintableFiles.length > 0) {
      console.log(chalk.blue(`🧹 Checking linting (${lintableFiles.length} files)...`));
      const biomeResult = await validator.validateBiome(files);

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
    const allResults = await validator.validateFiles(files);

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
