import path from 'node:path';
import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';
import { ValidationService } from '../core/validation.js';

export async function validateCommand() {
  console.log(chalk.blue('🔍 Smart File Validation'));
  console.log(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitActorIntegration(repoRoot);
  const validator = new ValidationService();

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    // Get changed files
    const changedFiles = await git.getChangedFiles();

    if (changedFiles.length === 0) {
      console.log(chalk.green('✅ No files to validate (no changes detected)'));
      return;
    }

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
    process.exit(1);
  }
}
