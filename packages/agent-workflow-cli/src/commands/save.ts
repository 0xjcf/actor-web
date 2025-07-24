import { createInterface } from 'node:readline';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Save Command - Unified Implementation
 *
 * ✅ SIMPLIFIED APPROACH: Uses direct GitOperations for local CLI operations
 * ✅ DUAL MODE: Quick save (default) or Interactive enhanced commit (--interactive)
 * ✅ FOLLOWS event-broker-dx-improvement plan for local operations
 */
export async function saveCommand(
  customMessage?: string,
  command?: { dryRun?: boolean; interactive?: boolean }
) {
  const isDryRun = command?.dryRun || false;
  const isInteractive = command?.interactive || false;

  // Dynamic title based on mode
  const title = isInteractive ? '🎭 Enhanced Save' : '💾 Quick Save';
  console.log(chalk.blue(title));
  if (isDryRun) {
    console.log(chalk.yellow('🔍 DRY RUN MODE - No changes will be made'));
  }
  if (isInteractive) {
    console.log(chalk.cyan('🤖 Interactive mode - Enhanced analysis with confirmation'));
  }
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    // ✅ SIMPLIFIED: Direct git operations instead of actor messaging
    console.log(chalk.gray('🔍 Checking repository status...'));

    const isGitRepo = await git.isGitRepo();
    if (!isGitRepo) {
      console.log(chalk.red('❌ Not a git repository'));
      return;
    }

    const currentBranch = await git.getCurrentBranch();
    if (!currentBranch) {
      console.log(chalk.red('❌ Could not determine current branch'));
      return;
    }

    console.log(chalk.blue(`📋 Current branch: ${currentBranch}`));

    // Check for uncommitted changes
    const hasChanges = await git.hasUncommittedChanges();
    if (!hasChanges) {
      console.log(chalk.green('✅ No uncommitted changes'));
      return;
    }

    console.log(chalk.yellow('📝 Uncommitted changes detected'));

    // Handle message generation based on mode
    let commitMessage: string;

    if (customMessage) {
      commitMessage = customMessage;
      console.log(chalk.blue('📝 Using provided commit message...'));
    } else {
      const messageType = isInteractive ? 'Enhanced' : 'Quick';
      console.log(chalk.blue(`🤖 Generating ${messageType.toLowerCase()} commit message...`));

      if (isInteractive) {
        commitMessage = await generateEnhancedCommitMessage(git, currentBranch);
      } else {
        commitMessage = await generateQuickCommitMessage(git, currentBranch);
      }
    }

    // Interactive mode: Show message and ask for confirmation
    if (isInteractive) {
      console.log(chalk.yellow('📝 Commit message to be used:'));
      console.log(chalk.gray(commitMessage));
      console.log();

      if (customMessage) {
        console.log(chalk.blue('💡 Using your custom message with interactive confirmation'));
      } else {
        console.log(chalk.blue('💡 Generated using enhanced analysis'));
      }
      console.log();

      // Always ask for confirmation in interactive mode (even in dry-run)
      if (!isDryRun) {
        const useMessage = await promptForConfirmation('Proceed with this commit? (Y/n): ');
        if (!useMessage) {
          console.log(chalk.yellow('❌ Save cancelled'));
          return;
        }
      } else {
        console.log(
          chalk.cyan(
            '🔍 [DRY RUN] In real mode, you would be asked: "Proceed with this commit? (Y/n)"'
          )
        );
        console.log(chalk.cyan('🔍 [DRY RUN] Assuming "Yes" for demonstration'));
      }
    }

    // Execute or preview the commit
    if (isDryRun) {
      console.log(chalk.cyan('📝 [DRY RUN] Would commit changes with message:'));
      console.log(chalk.gray(`   "${commitMessage.split('\n')[0]}"`));
      const modeText = isInteractive ? 'Enhanced save' : 'Quick save';
      console.log(chalk.cyan(`✅ [DRY RUN] ${modeText} workflow would complete successfully!`));
      console.log(chalk.gray('💡 [DRY RUN] Changes would be committed to current branch'));
    } else {
      // ✅ SIMPLIFIED: Commit changes
      console.log(chalk.gray('📝 Committing changes...'));
      await git.addAll();
      const commitHash = await git.commit(commitMessage);

      const modeText = isInteractive ? 'Enhanced save' : 'Quick save';
      console.log(chalk.green(`✅ Changes saved! Commit: ${commitHash.substring(0, 7)}`));
      console.log(chalk.green(`💾 ${modeText} completed successfully!`));
    }
  } catch (error) {
    console.error(chalk.red('❌ Save failed:'), error);
    process.exit(1);
  }
}

/**
 * Generate quick commit message (original save behavior)
 */
async function generateQuickCommitMessage(
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
 * Generate enhanced commit message (original commit-enhanced behavior)
 */
async function generateEnhancedCommitMessage(
  git: GitOperations,
  branchName: string | null
): Promise<string> {
  try {
    // Get changed files to analyze
    const changedFiles = await git.getChangedFiles();
    if (changedFiles.length === 0) {
      return 'chore: no changes detected';
    }

    // Enhanced analysis with more sophisticated logic
    return await generateIntelligentCommitMessage(changedFiles, branchName);
  } catch (error) {
    console.error(chalk.red('Error generating enhanced message:'), error);
    return generateFallbackCommitMessage(branchName);
  }
}

/**
 * Generate intelligent commit message based on changed files and context (enhanced version)
 */
async function generateIntelligentCommitMessage(
  changedFiles: string[],
  branchName: string | null
): Promise<string> {
  // Analyze file patterns to determine change type
  const hasTests = changedFiles.some((f) => f.includes('.test.') || f.includes('.spec.'));
  const hasDocs = changedFiles.some((f) => f.endsWith('.md'));
  const hasConfig = changedFiles.some((f) => f.includes('config') || f.includes('package.json'));
  const hasSource = changedFiles.some((f) => /\.(ts|js|tsx|jsx)$/.test(f));
  const hasStyles = changedFiles.some((f) => /\.(css|scss|sass)$/.test(f));

  // Determine commit type prefix
  let prefix = 'chore';
  if (hasSource && hasTests) prefix = 'feat';
  else if (hasTests) prefix = 'test';
  else if (hasSource) prefix = 'feat';
  else if (hasDocs) prefix = 'docs';
  else if (hasConfig) prefix = 'chore';
  else if (hasStyles) prefix = 'style';

  // Generate description based on patterns
  let description = 'update codebase';
  if (hasSource && hasTests) description = 'implement feature with tests';
  else if (hasSource) description = 'implement new functionality';
  else if (hasTests) description = 'update test suite';
  else if (hasDocs) description = 'update documentation';
  else if (hasConfig) description = 'update configuration';
  else if (hasStyles) description = 'update styling';

  // Add branch context if available
  const branchContext = branchName ? `\n\nBranch: ${branchName}` : '';
  const fileCount = changedFiles.length;

  return `${prefix}: ${description}

Files changed: ${fileCount}${branchContext}
Date: ${new Date().toISOString()}

[actor-web] Enhanced save - intelligent commit message`;
}

/**
 * Helper to prompt for user confirmation
 */
async function promptForConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans);
    });
  });

  const normalized = answer.trim().toLowerCase();
  return normalized === '' || normalized === 'y' || normalized === 'yes';
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
  const branchContext = branchName ? `\nBranch: ${branchName}` : '';

  return `save: preserve current work

Auto-generated fallback message${branchContext}
Date: ${currentDate}

[actor-web] Auto-save - preserving work in progress`;
}
