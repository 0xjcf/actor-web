import path from 'node:path';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';

export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    // Check if we're in a git repo
    if (!(await git.isGitRepo())) {
      console.log(chalk.red('❌ Not in a Git repository'));
      return;
    }

    // Check for changes
    if (!(await git.hasUncommittedChanges())) {
      console.log(chalk.green('✅ No changes to save'));
      return;
    }

    console.log(chalk.blue('📝 Saving your work...'));

    try {
      // Stage all changes
      await git.getGit().add('.');

      // Generate commit message based on whether custom message is provided
      const currentBranch = await git.getCurrentBranch();
      const agentType = await git.detectAgentType();
      const currentDate = new Date().toISOString().split('T')[0];

      let message: string;

      if (customMessage) {
        // Generate helpful context based on git status and changes
        const changedFiles = await git.getGit().diff(['--name-only', '--cached']);
        const files = changedFiles.trim() ? changedFiles.trim().split('\n') : [];

        // Analyze changed files to provide meaningful context
        const testFiles = files.filter((f) => f.includes('.test.') || f.includes('.spec.')).length;
        const srcFiles = files.filter((f) => f.includes('src/') && !f.includes('.test.')).length;
        const docsFiles = files.filter((f) => f.includes('docs/') || f.endsWith('.md')).length;
        const configFiles = files.filter(
          (f) => f.includes('package.json') || f.includes('tsconfig')
        ).length;

        const contextParts = [];
        if (srcFiles > 0) contextParts.push(`${srcFiles} implementation files`);
        if (testFiles > 0) contextParts.push(`${testFiles} test files`);
        if (docsFiles > 0) contextParts.push(`${docsFiles} documentation files`);
        if (configFiles > 0) contextParts.push(`${configFiles} config files`);

        const contextText =
          contextParts.length > 0 ? contextParts.join(', ') : `${files.length} files modified`;

        // Use descriptive commit format when custom message is provided
        message = `feat(${agentType.toLowerCase()}): ${customMessage}

Agent: ${agentType}
Context: ${contextText}
Date: ${currentDate}
Branch: ${currentBranch}

[actor-web] ${agentType} - ${customMessage}`;
      } else {
        // Fall back to generic message when no custom message provided
        message = `feat(save): quick save work in progress

Agent: ${agentType}
Context: Automated save of work in progress
Date: ${currentDate}

[actor-web] ${agentType} - quick save`;
      }

      await git.getGit().commit(message);

      console.log(chalk.green('✅ Work saved successfully!'));
      console.log(chalk.gray(`   Commit: ${message.split('\n')[0]}`));
      console.log(chalk.blue('💡 Next steps:'));
      console.log('   • Continue working: make more changes');
      console.log(`   • Ship when ready: ${chalk.yellow('pnpm aw:ship')}`);
      console.log(`   • Check status: ${chalk.yellow('pnpm aw:status')}`);
    } catch (error) {
      console.error(chalk.red('❌ Failed to save changes:'), error);
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during save:'), error);
    process.exit(1);
  }
}
