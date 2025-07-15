import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';
import { findRepoRootWithOptions } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

interface ValidateOptions {
  root?: string;
  cwd?: string;
}

export async function validateCommand(options: ValidateOptions = {}) {
  console.log(chalk.blue('🔍 Smart File Validation'));
  console.log(chalk.blue('==========================================='));

  try {
    // Dynamically find repository root using multiple strategies
    const repoRoot = await findRepoRootWithOptions({
      root: options.root,
      cwd: options.cwd || process.cwd(),
    });

    console.log(chalk.gray(`📁 Repository root: ${repoRoot}`));

    const git = new GitActorIntegration(repoRoot);
    const validator = new ValidationService();

    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      console.log(chalk.yellow('💡 Make sure you are in a git repository or specify --root'));
      return;
    }

    // Get changed files
    const changedFiles = await git.getChangedFiles();

    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No files to validate (no changes detected)'));
      return;
    }

    console.log(chalk.gray(`🔍 Validating ${changedFiles.length} changed files...`));

    // Run validation
    const results = await validator.validateFiles(changedFiles);

    // Exit with appropriate code
    if (results.overall) {
      console.log(chalk.green('🎉 Validation passed! Your changes are ready to ship.'));
      process.exit(0);
    } else {
      console.log(chalk.red('❌ Validation failed. Please fix the issues above.'));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during validation:'), error);
    console.log(chalk.yellow('💡 Try specifying the repository root with --root <path>'));
    process.exit(1);
  }
}
