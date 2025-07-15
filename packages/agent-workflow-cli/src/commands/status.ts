import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';
import { findRepoRootWithOptions } from '../core/repo-root-finder.js';
import { ValidationService } from '../core/validation.js';

interface StatusOptions {
  root?: string;
  cwd?: string;
}

export async function statusCommand(options: StatusOptions = {}) {
  console.log(chalk.blue('📊 Agent Status Dashboard'));
  console.log(chalk.blue('==========================================='));

  try {
    // Dynamically find repository root using multiple strategies
    const repoRoot = await findRepoRootWithOptions({
      root: options.root,
      cwd: options.cwd || process.cwd(),
    });

    console.log(chalk.gray(`📂 Repository root: ${repoRoot}`));

    const git = new GitActorIntegration(repoRoot);
    const validator = new ValidationService();

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

    // Cache integration status to avoid redundant API calls
    let integrationStatus: { ahead: number; behind: number } | null = null;

    // Integration status
    try {
      integrationStatus = await git.getIntegrationStatus();

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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(chalk.yellow('⚠️  Could not check integration status'));
      console.log(chalk.gray(`   Error: ${errorMessage}`));
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
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(chalk.yellow('  ⚠️  Could not check TypeScript'));
            console.log(chalk.gray(`     Error: ${errorMessage}`));
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
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.log(chalk.yellow('  ⚠️  Could not check linting'));
            console.log(chalk.gray(`     Error: ${errorMessage}`));
          }
        } else {
          console.log(chalk.green('  ✅ No lintable files (docs/configs ignored)'));
        }
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log(chalk.yellow('  ⚠️  Could not analyze changed files'));
      console.log(chalk.gray(`     Error: ${errorMessage}`));
    }

    // Suggested next actions
    console.log(chalk.blue('💡 Suggested next actions:'));

    if (hasChanges) {
      console.log(`  • ${chalk.yellow('pnpm aw:save')} - Quick save your work`);
      console.log(`  • ${chalk.yellow('pnpm aw:ship')} - Full workflow to integration`);
    } else {
      // Use cached integration status to avoid redundant API call
      if (integrationStatus) {
        if (integrationStatus.ahead > 0) {
          console.log(`  • ${chalk.yellow('pnpm aw:ship')} - Share your work with other agents`);
        } else if (integrationStatus.behind > 0) {
          console.log(`  • ${chalk.yellow('pnpm aw:sync')} - Get latest changes from other agents`);
        } else {
          console.log(`  • ${chalk.green('All caught up!')} Ready for new work`);
        }
      } else {
        console.log(`  • ${chalk.yellow('pnpm aw:sync')} - Get latest changes from other agents`);
        console.log(`  • ${chalk.yellow('pnpm aw:ship')} - Share your work with other agents`);
      }
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error(chalk.red('❌ Error running status check:'), errorMessage);
    if (errorStack) {
      console.error(chalk.gray('Stack trace:'), errorStack);
    }

    // Provide helpful guidance based on error type
    if (errorMessage.includes('not found') || errorMessage.includes('ENOENT')) {
      console.log(chalk.blue('💡 Try specifying repository root explicitly:'));
      console.log(chalk.yellow('   pnpm aw:status --root /path/to/repo'));
    } else if (errorMessage.includes('permission') || errorMessage.includes('EACCES')) {
      console.log(chalk.blue('💡 Check file permissions and try again'));
    } else if (errorMessage.includes('git')) {
      console.log(chalk.blue('💡 Ensure you are in a valid git repository'));
    }

    process.exit(1);
  }
}
