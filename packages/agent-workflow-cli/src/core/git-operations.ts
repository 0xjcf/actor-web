import { execSync } from 'node:child_process';
import { Logger } from '@actor-core/runtime';
import { type SimpleGit, simpleGit } from 'simple-git';
import { type AgentWorktreeConfig, loadAgentConfig } from './agent-config.js';

const log = Logger.namespace('GIT_OPERATIONS');

export class GitOperations {
  private git: SimpleGit;

  constructor(baseDir: string = process.cwd()) {
    this.git = simpleGit(baseDir);
  }

  /**
   * Get the underlying git instance for advanced operations
   */
  getGit(): SimpleGit {
    return this.git;
  }

  /**
   * Check if we're in a Git repository
   */
  async isGitRepo(): Promise<boolean> {
    try {
      await this.git.status();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the current branch name
   */
  async getCurrentBranch(): Promise<string | null> {
    try {
      const status = await this.git.status();
      return status.current || null;
    } catch {
      return null;
    }
  }

  /**
   * Check if worktree exists
   */
  async worktreeExists(path: string): Promise<boolean> {
    try {
      const worktrees = execSync('git worktree list --porcelain', { encoding: 'utf8' });
      return worktrees.includes(`worktree ${path}`);
    } catch {
      return false;
    }
  }

  /**
   * Create agent worktrees based on setup-agent-worktrees.sh logic
   */
  async setupAgentWorktrees(
    agentCount = 3,
    configOptions?: {
      configPath?: string;
      agentPaths?: Record<string, string>;
      baseDir?: string;
      integrationBranch?: string;
    }
  ): Promise<AgentWorktreeConfig[]> {
    // Load configuration from multiple sources (file, env, CLI options)
    const agentConfig = await loadAgentConfig(configOptions);
    const configs = agentConfig.agents;

    const results: AgentWorktreeConfig[] = [];

    for (const config of configs.slice(0, agentCount)) {
      try {
        // Check if worktree already exists
        if (await this.worktreeExists(config.path)) {
          log.debug(`⚠️  Worktree ${config.path} already exists, skipping...`);
          results.push(config);
          continue;
        }

        // Try to add worktree with existing remote branch
        try {
          await this.git.raw([
            'show-ref',
            '--verify',
            '--quiet',
            `refs/remotes/origin/${config.branch}`,
          ]);
          // Remote branch exists, create worktree from it
          await this.git.raw([
            'worktree',
            'add',
            '-B',
            config.branch,
            config.path,
            `origin/${config.branch}`,
          ]);
        } catch {
          // Remote branch doesn't exist, create new branch
          await this.git.raw(['worktree', 'add', config.path, '-b', config.branch]);
          log.debug(`   Created new branch: ${config.branch}`);
        }

        log.debug(`   ✅ Created: ${config.path}`);
        results.push(config);
      } catch (error) {
        console.error(`❌ Failed to create worktree for ${config.agentId}:`, error);
      }
    }

    // Configure automatic push tracking
    try {
      await this.git.raw(['config', '--global', 'worktree.guessRemote', 'true']);
      log.debug('   ✅ Enabled automatic push tracking');
    } catch (error) {
      console.error('⚠️  Failed to set worktree.guessRemote:', error);
    }

    return results;
  }

  /**
   * Get changed files compared to integration branch
   */
  async getChangedFiles(integrationBranch = 'feature/actor-ref-integration'): Promise<string[]> {
    try {
      // Fetch integration branch
      await this.git.fetch(['origin', integrationBranch]);

      // Get changed files
      const diff = await this.git.raw(['diff', '--name-only', `origin/${integrationBranch}..HEAD`]);
      return diff
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
    } catch {
      // Fallback to comparing with HEAD~1
      try {
        const diff = await this.git.raw(['diff', '--name-only', 'HEAD~1..HEAD']);
        return diff
          .trim()
          .split('\n')
          .filter((line) => line.length > 0);
      } catch {
        return [];
      }
    }
  }

  /**
   * Detect agent type from current branch
   */
  async detectAgentType(): Promise<string> {
    const currentBranch = await this.getCurrentBranch();

    // Check for integration branch first
    if (
      currentBranch?.includes('integration') ||
      currentBranch === 'feature/actor-ref-integration'
    ) {
      return 'Integration Hub';
    }

    if (currentBranch?.includes('agent-a') || currentBranch?.includes('architecture')) {
      return 'Agent A (Architecture)';
    }
    if (currentBranch?.includes('agent-b') || currentBranch?.includes('implementation')) {
      return 'Agent B (Implementation)';
    }
    if (
      currentBranch?.includes('agent-c') ||
      currentBranch?.includes('test') ||
      currentBranch?.includes('cleanup')
    ) {
      return 'Agent C (Testing/Cleanup)';
    }

    // Check for main branch
    if (currentBranch === 'main' || currentBranch === 'master') {
      return 'Main Branch';
    }

    return 'Unknown Agent';
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    try {
      const status = await this.git.status();
      return status.files.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Stage all changes
   */
  async addAll(): Promise<void> {
    await this.git.add('.');
  }

  /**
   * Commit changes with a message
   */
  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message);
    return result.commit || '';
  }

  /**
   * Get commits ahead/behind integration
   */
  async getIntegrationStatus(
    integrationBranch = 'feature/actor-ref-integration'
  ): Promise<{ ahead: number; behind: number }> {
    try {
      // Fetch the integration branch
      await this.git.fetch(['origin', integrationBranch]);

      // Get ahead count
      const ahead = await this.git.raw([
        'rev-list',
        '--count',
        `origin/${integrationBranch}..HEAD`,
      ]);

      // Get behind count
      const behind = await this.git.raw([
        'rev-list',
        '--count',
        `HEAD..origin/${integrationBranch}`,
      ]);

      return {
        ahead: Number.parseInt(ahead.trim()) || 0,
        behind: Number.parseInt(behind.trim()) || 0,
      };
    } catch {
      return { ahead: 0, behind: 0 };
    }
  }

  /**
   * Push changes to remote branch
   */
  async pushChanges(branch: string): Promise<void> {
    await this.git.push('origin', branch);
  }
}
