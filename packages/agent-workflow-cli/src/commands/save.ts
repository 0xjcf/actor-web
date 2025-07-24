import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Save Command - Simplified Local Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ NO complex actor system needed for simple CLI commands
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    console.log(chalk.blue('🔍 Checking repository...'));
    const isGitRepo = await git.isGitRepo();

    if (!isGitRepo) {
      throw new Error('Not a git repository');
    }

    console.log(chalk.green('✅ Git repository confirmed'));

    // Get current branch for display
    const currentBranch = await git.getCurrentBranch();
    if (currentBranch) {
      console.log(chalk.blue(`📋 Current branch: ${currentBranch}`));
    }

    // ✅ SIMPLIFIED: Direct uncommitted changes check
    console.log(chalk.blue('🔍 Checking for uncommitted changes...'));
    const hasChanges = await git.hasUncommittedChanges();

    if (!hasChanges) {
      console.log(chalk.yellow('⚠️  No changes to save'));
      return;
    }

    console.log(chalk.yellow('📝 Uncommitted changes detected'));

    // ✅ SIMPLIFIED: Direct staging operation
    console.log(chalk.blue('📦 Staging all changes...'));
    await git.addAll();
    console.log(chalk.green('✅ All changes staged'));

    // ✅ ENHANCED: Intelligent commit message generation
    let commitMessage = customMessage;
    if (!commitMessage) {
      console.log(chalk.blue('🤖 Generating commit message...'));
      commitMessage = await generateIntelligentCommitMessage(git, currentBranch);
    }

    console.log(chalk.gray(`📝 Commit message: ${commitMessage.split('\n')[0]}`));

    // ✅ SIMPLIFIED: Direct commit operation
    console.log(chalk.blue('💾 Committing changes...'));
    const commitHash = await git.commit(commitMessage);

    console.log(chalk.green(`✅ Changes saved! Commit: ${commitHash.substring(0, 7)}`));
    console.log(chalk.green('✅ Save completed successfully!'));
  } catch (error) {
    console.error(chalk.red('❌ Save failed:'), error);
    process.exit(1);
  }
}

/**
 * Generate intelligent commit message based on changed files and context
 */
async function generateIntelligentCommitMessage(
  git: GitOperations,
  branchName?: string | null
): Promise<string> {
  try {
    // Get changed files to analyze what was modified
    const changedFiles = await git.getChangedFiles();
    const currentDate = new Date().toISOString();

    // Analyze file patterns to generate meaningful message
    const messagePrefix = generateCommitPrefix(changedFiles);
    const messageDetails = generateCommitDetails(changedFiles, branchName);

    return `${messagePrefix}: ${messageDetails}

Files changed: ${changedFiles.length}
Branch: ${branchName || 'unknown'}
Date: ${currentDate}

[actor-web] Quick save - preserving work in progress`;
  } catch {
    // Fallback to simple message if analysis fails
    return generateFallbackCommitMessage(branchName);
  }
}

/**
 * Generate commit prefix based on file patterns
 */
function generateCommitPrefix(changedFiles: string[]): string {
  const patterns = {
    feat: /\.(ts|js|tsx|jsx)$/,
    docs: /\.(md|txt|rst)$/,
    test: /\.(test|spec)\.(ts|js)$/,
    style: /\.(css|scss|less)$/,
    config: /\.(json|yaml|yml|toml|config)$/,
    build: /(package\.json|package-lock\.json|pnpm-lock\.yaml|tsconfig\.json)$/,
  };

  // Count files by type
  const typeCounts = Object.entries(patterns).reduce(
    (acc, [type, pattern]) => {
      acc[type] = changedFiles.filter((file) => pattern.test(file)).length;
      return acc;
    },
    {} as Record<string, number>
  );

  // Find the most common file type
  const primaryType = Object.entries(typeCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a)[0];

  return primaryType ? primaryType[0] : 'save';
}

/**
 * Generate commit details based on files and context
 */
function generateCommitDetails(changedFiles: string[], branchName?: string | null): string {
  // Analyze specific file patterns for more context
  const hasTests = changedFiles.some((f) => f.includes('.test.') || f.includes('.spec.'));
  const hasDocs = changedFiles.some((f) => f.endsWith('.md'));
  const hasConfig = changedFiles.some((f) => f.includes('config') || f.includes('package.json'));
  const hasSource = changedFiles.some((f) => /\.(ts|js|tsx|jsx)$/.test(f));

  // Generate context-aware description
  if (hasTests && hasSource) {
    return 'update implementation and tests';
  }
  if (hasTests) {
    return 'update test suite';
  }
  if (hasDocs) {
    return 'update documentation';
  }
  if (hasConfig) {
    return 'update configuration';
  }
  if (hasSource) {
    return 'update implementation';
  }
  if (branchName?.includes('fix')) {
    return 'fix implementation';
  }
  if (branchName?.includes('feature')) {
    return 'add new functionality';
  }
  return 'update project files';
}

/**
 * Generate fallback commit message when analysis fails
 */
function generateFallbackCommitMessage(branchName?: string | null): string {
  const currentDate = new Date().toISOString();

  return `save: quick save changes

Branch: ${branchName || 'unknown'}
Date: ${currentDate}
Context: Quick save via CLI

[actor-web] Auto-save - preserving work in progress`;
}
