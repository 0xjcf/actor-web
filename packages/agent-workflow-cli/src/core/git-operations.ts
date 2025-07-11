import { execSync } from 'node:child_process';
import { type SimpleGit, simpleGit } from 'simple-git';

export interface AgentWorktreeConfig {
  agentId: string;
  branch: string;
  path: string;
  role: string;
}

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
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string> {
    const status = await this.git.status();
    return status.current || 'unknown';
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
  async setupAgentWorktrees(agentCount = 3): Promise<AgentWorktreeConfig[]> {
    const configs = [
      {
        agentId: 'agent-a',
        branch: 'feature/agent-a',
        path: '../actor-web-architecture',
        role: 'Architecture',
      },
      {
        agentId: 'agent-b',
        branch: 'feature/agent-b',
        path: '../actor-web-implementation',
        role: 'Implementation',
      },
      {
        agentId: 'agent-c',
        branch: 'feature/agent-c',
        path: '../actor-web-tests',
        role: 'Testing',
      },
    ] satisfies AgentWorktreeConfig[];

    const results: AgentWorktreeConfig[] = [];

    for (const config of configs.slice(0, agentCount)) {
      try {
        // Check if worktree already exists
        if (await this.worktreeExists(config.path)) {
          console.log(`⚠️  Worktree ${config.path} already exists, skipping...`);
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
          console.log(`   Created new branch: ${config.branch}`);
        }

        console.log(`   ✅ Created: ${config.path}`);
        results.push(config);
      } catch (error) {
        console.error(`❌ Failed to create worktree for ${config.agentId}:`, error);
      }
    }

    // Configure automatic push tracking
    try {
      await this.git.raw(['config', '--global', 'worktree.guessRemote', 'true']);
      console.log('   ✅ Enabled automatic push tracking');
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

    if (currentBranch.includes('agent-a') || currentBranch.includes('architecture')) {
      return 'Agent A (Architecture)';
    }
    if (currentBranch.includes('agent-b') || currentBranch.includes('implementation')) {
      return 'Agent B (Implementation)';
    }
    if (
      currentBranch.includes('agent-c') ||
      currentBranch.includes('test') ||
      currentBranch.includes('cleanup')
    ) {
      return 'Agent C (Testing/Cleanup)';
    }
    return 'Unknown Agent';
  }

  /**
   * Check if there are uncommitted changes
   */
  async hasUncommittedChanges(): Promise<boolean> {
    const status = await this.git.status();
    return status.files.length > 0;
  }

  /**
   * Get commits ahead/behind integration
   */
  async getIntegrationStatus(
    integrationBranch = 'feature/actor-ref-integration'
  ): Promise<{ ahead: number; behind: number }> {
    try {
      await this.git.fetch(['origin', integrationBranch]);

      const ahead = await this.git.raw([
        'rev-list',
        '--count',
        `origin/${integrationBranch}..HEAD`,
      ]);
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
}
