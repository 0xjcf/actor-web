import path from 'node:path';
import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';
import { ValidationService } from '../core/validation.js';

export async function shipCommand() {
  console.log(chalk.blue('🚀 Agent Ship Workflow'));
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

    // Check for uncommitted changes
    if (await git.hasUncommittedChanges()) {
      console.log(chalk.yellow('📝 Uncommitted changes detected, staging and committing...'));

      try {
        // Stage all changes
        await git.addAll();

        // Auto-commit with enhanced conventional commit message
        const _currentBranch = await git.getCurrentBranch();
        const agentType = await git.detectAgentType();
        const currentDate = new Date().toISOString().split('T')[0];

        const message = `feat(ship): auto-save before shipping

Agent: ${agentType}
Context: Automated commit before shipping to integration
Date: ${currentDate}

[actor-web] ${agentType} - pre-ship save`;

        await git.commit(message);
        console.log(chalk.green(`✅ Committed changes: ${message}`));
      } catch (error) {
        console.error(chalk.red('❌ Failed to commit changes:'), error);
        return;
      }
    }

    // Check if we're ahead of integration
    const integrationBranch = 'feature/actor-ref-integration';
    const integrationStatus = await git.getIntegrationStatus(integrationBranch);

    if (integrationStatus.ahead === 0) {
      console.log(chalk.yellow('⚠️  No changes to ship'));
      return;
    }

    console.log(chalk.blue(`📦 Found ${integrationStatus.ahead} commits to ship`));

    // Get changed files for validation from the commits ahead
    const changedFiles = await git.getChangedFiles();

    // Run validation on changed files (if any)
    if (changedFiles.length > 0) {
      console.log(chalk.blue('🔍 Validating changes...'));
      const results = await validator.validateFiles(changedFiles);

      if (!results.overall) {
        console.log(chalk.red('❌ Cannot ship: validation failed'));
        console.log(
          chalk.blue('💡 Fix issues and try again, or use pnpm aw:save for quick commit')
        );
        process.exit(1);
      }
    }

    // Push to integration branch
    console.log(chalk.blue(`🔄 Shipping to ${integrationBranch}...`));

    try {
      // Ensure we have the latest integration branch
      await git.fetch(integrationBranch);

      // Push current branch to integration
      const currentBranch = await git.getCurrentBranch();
      await git.push(`${currentBranch}:${integrationBranch}`);

      console.log(chalk.green('✅ Successfully shipped to integration branch!'));
      console.log(chalk.blue('📈 Other agents can now sync your changes'));

      // Show what was shipped
      console.log(chalk.blue(`📦 Shipped ${integrationStatus.ahead} commits to integration`));
      if (changedFiles.length > 0) {
        console.log(chalk.blue(`📝 Modified ${changedFiles.length} files:`));
        for (const file of changedFiles.slice(0, 5)) {
          console.log(`   - ${file}`);
        }
        if (changedFiles.length > 5) {
          console.log(`   ... and ${changedFiles.length - 5} more`);
        }
      }
    } catch (error) {
      console.error(chalk.red('❌ Failed to push to integration:'), error);
      console.log(chalk.blue('💡 You may need to sync first: pnpm aw:sync'));
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during ship:'), error);
    process.exit(1);
  }
}
