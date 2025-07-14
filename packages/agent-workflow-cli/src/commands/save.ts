import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { GitActorIntegration } from '../core/git-actor-integration.js';

// Context analysis configuration interface
interface ContextConfig {
  patterns: {
    [category: string]: {
      filePatterns: string[];
      displayName: string;
      priority: number;
    };
  };
  analysis: {
    maxModules: number;
    separator: string;
    fallbackMessage: string;
  };
}

// Default configuration for projects without custom config
const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  patterns: {
    tests: {
      filePatterns: ['**/*.test.*', '**/*.spec.*', '**/test/**', '**/tests/**'],
      displayName: 'Tests',
      priority: 1,
    },
    components: {
      filePatterns: ['**/components/**', '**/src/components/**'],
      displayName: 'Components',
      priority: 2,
    },
    core: {
      filePatterns: ['**/core/**', '**/src/core/**'],
      displayName: 'Core',
      priority: 3,
    },
    utils: {
      filePatterns: ['**/utils/**', '**/utilities/**', '**/helpers/**'],
      displayName: 'Utilities',
      priority: 4,
    },
    docs: {
      filePatterns: ['**/*.md', '**/docs/**', '**/documentation/**'],
      displayName: 'Documentation',
      priority: 5,
    },
    config: {
      filePatterns: ['**/package.json', '**/tsconfig*', '**/.env*', '**/config/**'],
      displayName: 'Configuration',
      priority: 6,
    },
  },
  analysis: {
    maxModules: 3,
    separator: ' | ',
    fallbackMessage: 'files modified across codebase',
  },
};

// Load context configuration from project
function loadContextConfig(repoRoot: string): ContextConfig {
  const configPath = path.join(repoRoot, '.aw-context.json');

  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const userConfig = JSON.parse(configContent) as Partial<ContextConfig>;

      // Merge with defaults
      return {
        patterns: { ...DEFAULT_CONTEXT_CONFIG.patterns, ...userConfig.patterns },
        analysis: { ...DEFAULT_CONTEXT_CONFIG.analysis, ...userConfig.analysis },
      };
    }
  } catch (_error) {
    console.log(chalk.yellow('⚠️  Failed to load .aw-context.json, using defaults'));
  }

  return DEFAULT_CONTEXT_CONFIG;
}

// Simple glob pattern matching
function matchesPattern(filePath: string, pattern: string): boolean {
  // Handle negation patterns (starting with !)
  if (pattern.startsWith('!')) {
    return !matchesPattern(filePath, pattern.slice(1));
  }

  // Convert glob pattern to regex (improved)
  const regexPattern = pattern
    .replace(/\*\*/g, '.*') // ** matches any number of directories
    .replace(/\*/g, '[^/]*') // * matches anything except /
    .replace(/\./g, '\\.') // Escape dots
    .replace(/\?/g, '[^/]'); // ? matches single character except /

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

// Analyze files using configuration
function analyzeChangedFiles(files: string[], config: ContextConfig): string {
  const categorizedFiles = new Map<string, string[]>();

  console.log(chalk.gray(`🔍 Debug: Analyzing ${files.length} files with patterns`));

  // Categorize files based on patterns
  for (const file of files) {
    let categorized = false;
    console.log(chalk.gray(`  📁 Analyzing: ${file}`));

    for (const [category, categoryConfig] of Object.entries(config.patterns)) {
      // Separate positive and negative patterns
      const positivePatterns = categoryConfig.filePatterns.filter((p) => !p.startsWith('!'));
      const negativePatterns = categoryConfig.filePatterns.filter((p) => p.startsWith('!'));

      // First check if file matches any positive patterns
      let matchesPositive = false;
      for (const pattern of positivePatterns) {
        if (matchesPattern(file, pattern)) {
          console.log(chalk.gray(`    ✅ Positive match "${pattern}"`));
          matchesPositive = true;
          break;
        }
        console.log(chalk.gray(`    ❌ No match "${pattern}"`));
      }

      // If it matches positive patterns, check negative patterns for exclusions
      if (matchesPositive) {
        let excludedByNegative = false;
        for (const negPattern of negativePatterns) {
          const pattern = negPattern.slice(1); // Remove the '!' prefix
          if (matchesPattern(file, pattern)) {
            console.log(chalk.gray(`    ❌ Excluded by "${negPattern}"`));
            excludedByNegative = true;
            break;
          }
        }

        // Only categorize if positive match and not excluded
        if (!excludedByNegative) {
          console.log(chalk.gray(`    ✅ Final match → ${category}`));
          if (!categorizedFiles.has(category)) {
            categorizedFiles.set(category, []);
          }
          categorizedFiles.get(category)?.push(file);
          categorized = true;
          break;
        }
        console.log(chalk.gray(`    ❌ Excluded from ${category}`));
      }
    }

    if (!categorized) {
      console.log(chalk.gray(`    ⚠️  No category matched for: ${file}`));
    }
  }

  console.log(chalk.gray('🎯 Categories found:'), categorizedFiles);
  // Build context based on categories found
  const contextParts: string[] = [];

  // Sort categories by priority
  const sortedCategories = Array.from(categorizedFiles.entries())
    .sort(([a], [b]) => {
      const priorityA = config.patterns[a]?.priority ?? 999;
      const priorityB = config.patterns[b]?.priority ?? 999;
      return priorityA - priorityB;
    })
    .slice(0, config.analysis.maxModules);

  for (const [category, categoryFiles] of sortedCategories) {
    const categoryConfig = config.patterns[category];
    if (categoryConfig) {
      const count = categoryFiles.length;
      const plural = count > 1 ? 's' : '';
      contextParts.push(`${categoryConfig.displayName}: ${count} file${plural}`);
    }
  }

  const result =
    contextParts.length > 0
      ? contextParts.join(config.analysis.separator)
      : `${files.length} ${config.analysis.fallbackMessage}`;

  console.log(chalk.gray(`📋 Final context: "${result}"`));
  return result;
}

export async function saveCommand(customMessage?: string) {
  console.log(chalk.blue('💾 Quick Save'));
  console.log(chalk.blue('==========================================='));

  // Navigate to repository root (two levels up from CLI package)
  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitActorIntegration(repoRoot);

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
      // Generate commit message based on whether custom message is provided
      const currentBranch = await git.getCurrentBranch();
      const agentType = await git.detectAgentType();
      const currentDate = new Date().toISOString().split('T')[0];

      let message: string;

      if (customMessage) {
        // Load context configuration
        const _contextConfig = loadContextConfig(repoRoot);

        // [actor-web] TODO: Get actual changed files from git-actor
        // For now, using placeholder context
        const contextText = 'CLI migration: Updated save command to use git-actor pattern';

        // Use descriptive commit format when custom message is provided
        message = `feat(${agentType.toLowerCase()}): ${customMessage}

Agent: ${agentType}
Context: ${contextText}
Date: ${currentDate}
Branch: ${currentBranch}

[actor-web] ${agentType} - ${customMessage}`;
      } else {
        // Generate intelligent message when no custom message provided
        const contextConfig = loadContextConfig(repoRoot);

        // [actor-web] TODO: Get actual changed files from git-actor
        // For now, using placeholder
        const files = ['src/commands/save.ts', 'src/core/git-actor-integration.ts'];
        const contextText = analyzeChangedFiles(files, contextConfig);

        message = `feat(${agentType.toLowerCase()}): Auto-save with ${files.length} file${files.length !== 1 ? 's' : ''} updated

Agent: ${agentType}
Context: ${contextText}
Date: ${currentDate}
Branch: ${currentBranch}

[actor-web] ${agentType} - Auto-save with ${files.length} file${files.length !== 1 ? 's' : ''} updated`;
      }

      // Use git-actor to stage and commit
      await git.stageAndCommit(message);

      console.log(chalk.green('✅ Work saved successfully!'));
      console.log(chalk.gray(`   Commit: ${message.split('\n')[0]}`));
      console.log(chalk.blue('💡 Next steps:'));
      console.log('   • Continue working: make more changes');
      console.log(`   • Ship when ready: ${chalk.yellow('pnpm aw:ship')}`);
      console.log(`   • Check status: ${chalk.yellow('pnpm aw:status')}`);
    } catch (error) {
      console.error(chalk.red('❌ Failed to save changes:'), error);
      process.exit(1);
    } finally {
      // Clean up git-actor resources
      await git.stop();
    }
  } catch (error) {
    console.error(chalk.red('❌ Error during save:'), error);
    process.exit(1);
  }
}
