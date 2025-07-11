import path from 'node:path';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { ValidationService } from '../core/validation.js';

export async function statusCommand() {
  console.log(chalk.blue('📊 Agent Status Dashboard'));
  console.log(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);
  const validator = new ValidationService();

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    // Current branch and agent type
    const currentBranch = await git.getCurrentBranch();
    const agentType = await git.detectAgentType();

    console.log(`${chalk.green('📍 Current branch:')} ${currentBranch}`);
    console.log(`${chalk.green('👤 Agent type:')} ${agentType}`);

    // Uncommitted changes
    const hasChanges = await git.hasUncommittedChanges();
    if (hasChanges) {
      console.log(`${chalk.yellow('📝 Uncommitted changes:')} Yes`);
      console.log(`${chalk.blue('💡 Quick fix:')}${chalk.yellow(' pnpm aw:save')}`);
    } else {
      console.log(`${chalk.green('📝 Uncommitted changes:')} None`);
    }

    // Integration status
    try {
      const integrationStatus = await git.getIntegrationStatus();

      if (integrationStatus.behind > 0) {
        console.log(
          `${chalk.yellow('⬇️  Behind integration:')} ${integrationStatus.behind} commits`
        );
        console.log(chalk.blue('💡 Run:') + chalk.yellow(' pnpm aw:sync'));
      } else {
        console.log(`${chalk.green('⬇️  Behind integration:')} 0 commits`);
      }

      if (integrationStatus.ahead > 0) {
        console.log(
          `${chalk.yellow('⬆️  Ahead of integration:')} ${integrationStatus.ahead} commits`
        );
        console.log(chalk.blue('💡 Run:') + chalk.yellow(' pnpm aw:ship'));
      } else {
        console.log(`${chalk.green('⬆️  Ahead of integration:')} 0 commits`);
      }
    } catch (_error) {
      console.log(chalk.yellow('⚠️  Could not check integration status'));
    }

    // Quick validation status
    console.log(chalk.blue('🔍 Quick validation (your files only):'));

    try {
      const changedFiles = await git.getChangedFiles();

      if (changedFiles.length === 0) {
        console.log(chalk.green('  ✅ No files to validate'));
      } else {
        console.log(chalk.blue(`  📁 ${changedFiles.length} files changed by your branch`));

        // Quick TypeScript check
        const tsFiles = changedFiles.filter((f) => f.match(/\.(ts|tsx)$/));
        if (tsFiles.length > 0) {
          try {
            const tsResult = await validator.validateTypeScript(changedFiles);
            if (tsResult.success) {
              console.log(chalk.green(`  ✅ TypeScript OK (${tsFiles.length} files)`));
            } else {
              console.log(chalk.red(`  ❌ TypeScript errors (${tsResult.errors.length} issues)`));
            }
          } catch {
            console.log(chalk.yellow('  ⚠️  Could not check TypeScript'));
          }
        } else {
          console.log(chalk.green('  ✅ No TypeScript files to check'));
        }

        // Quick linting check
        const lintableFiles = validator.filterLintableFiles(changedFiles);
        if (lintableFiles.length > 0) {
          try {
            const biomeResult = await validator.validateBiome(changedFiles);
            if (biomeResult.success) {
              console.log(chalk.green('  ✅ Linting OK (your files)'));
            } else {
              console.log(chalk.red('  ❌ Linting errors (your files)'));
            }
          } catch {
            console.log(chalk.yellow('  ⚠️  Could not check linting'));
          }
        } else {
          console.log(chalk.green('  ✅ No lintable files (docs/configs ignored)'));
        }
      }
    } catch (_error) {
      console.log(chalk.yellow('  ⚠️  Could not analyze changed files'));
    }

    // Suggested next actions
    console.log(chalk.blue('💡 Suggested next actions:'));

    if (hasChanges) {
      console.log(`  • ${chalk.yellow('pnpm aw:save')} - Quick save your work`);
      console.log(`  • ${chalk.yellow('pnpm aw:ship')} - Full workflow to integration`);
    } else {
      const integrationStatus = await git.getIntegrationStatus();
      if (integrationStatus.ahead > 0) {
        console.log(`  • ${chalk.yellow('pnpm aw:ship')} - Share your work with other agents`);
      } else if (integrationStatus.behind > 0) {
        console.log(`  • ${chalk.yellow('pnpm aw:sync')} - Get latest changes from other agents`);
      } else {
        console.log(`  • ${chalk.green('All caught up!')} Ready for new work`);
      }
    }
  } catch (error) {
    console.error(chalk.red('❌ Error running status check:'), error);
    process.exit(1);
  }
}
