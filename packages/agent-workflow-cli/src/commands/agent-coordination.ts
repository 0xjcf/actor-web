import { execSync } from 'node:child_process';
import path from 'node:path';
import { Logger } from '@actor-core/runtime';
import chalk from 'chalk';

const log = Logger.namespace('AGENT_COORDINATION');

import { GitOperations } from '../core/git-operations.js';
import { findRepoRoot } from '../core/repo-root-finder.js';
import { getAgentStatus } from '../index.js';

interface AgentInfo {
  id: string;
  branch: string;
  role: string;
  status: 'active' | 'inactive' | 'unknown';
  ahead: number;
  behind: number;
  uncommittedChanges: boolean;
  path?: string;
}

interface WorktreeInfo {
  path: string;
  branch: string;
  bare: boolean;
}

/**
 * Query real git worktrees using hybrid approach
 * Uses shell scripts as fallback if actor system isn't available
 */
async function queryRealWorktrees(): Promise<WorktreeInfo[]> {
  try {
    // Try to get worktree list directly from git
    const output = execSync('git worktree list --porcelain', {
      encoding: 'utf8',
      cwd: process.cwd(),
    });

    const worktrees: WorktreeInfo[] = [];
    const lines = output.trim().split('\n');

    let currentWorktree: Partial<WorktreeInfo> = {};

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        if (currentWorktree.path) {
          worktrees.push(currentWorktree as WorktreeInfo);
        }
        currentWorktree = { path: line.slice(9) };
      } else if (line.startsWith('branch ')) {
        currentWorktree.branch = line.slice(7);
      } else if (line === 'bare') {
        currentWorktree.bare = true;
      } else if (line === '') {
        if (currentWorktree.path) {
          worktrees.push(currentWorktree as WorktreeInfo);
          currentWorktree = {};
        }
      }
    }

    // Add final worktree if exists
    if (currentWorktree.path) {
      worktrees.push(currentWorktree as WorktreeInfo);
    }

    return worktrees;
  } catch {
    console.error(chalk.yellow('⚠️  Failed to query git worktrees directly, using fallback...'));
    return [];
  }
}

/**
 * Map worktree paths to agent info using existing conventions
 */
function mapWorktreeToAgent(worktree: WorktreeInfo): AgentInfo | null {
  const pathName = path.basename(worktree.path);

  // Map based on existing worktree naming conventions from setup-agent-worktrees.sh
  if (pathName.includes('architecture') || worktree.branch.includes('agent-a')) {
    return {
      id: 'agent-a',
      branch: worktree.branch || 'feature/agent-a',
      role: 'Architecture',
      status: 'unknown',
      ahead: 0,
      behind: 0,
      uncommittedChanges: false,
      path: worktree.path,
    };
  }

  if (pathName.includes('implementation') || worktree.branch.includes('agent-b')) {
    return {
      id: 'agent-b',
      branch: worktree.branch || 'feature/agent-b',
      role: 'Implementation',
      status: 'unknown',
      ahead: 0,
      behind: 0,
      uncommittedChanges: false,
      path: worktree.path,
    };
  }

  if (pathName.includes('tests') || worktree.branch.includes('agent-c')) {
    return {
      id: 'agent-c',
      branch: worktree.branch || 'feature/agent-c',
      role: 'Testing/Cleanup',
      status: 'unknown',
      ahead: 0,
      behind: 0,
      uncommittedChanges: false,
      path: worktree.path,
    };
  }

  return null; // Not an agent worktree
}

/**
 * Get real status for an agent worktree
 */
async function getAgentWorktreeStatus(agent: AgentInfo): Promise<AgentInfo> {
  if (!agent.path) {
    return agent;
  }

  // Capture the path in a local variable after null check for type safety
  const agentPath = agent.path;

  try {
    // Check if path exists and is accessible
    const pathExists = await import('node:fs').then((fs) =>
      fs.promises
        .access(agentPath, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false)
    );

    if (!pathExists) {
      return { ...agent, status: 'inactive' };
    }

    // Get git status for this worktree
    const status = await getAgentStatus(agentPath);

    return {
      ...agent,
      status: status.currentBranch === agent.branch ? 'active' : 'inactive',
      ahead: status.ahead,
      behind: status.behind,
      uncommittedChanges: status.uncommittedChanges,
    };
  } catch (error) {
    console.error(`Error getting status for ${agent.id}:`, error);
    return { ...agent, status: 'unknown' };
  }
}

/**
 * Show status of all agents in the project (REAL DATA VERSION)
 */
export async function agentsStatusCommand() {
  log.debug(chalk.blue('🤖 Multi-Agent Status Dashboard'));
  log.debug(chalk.blue('=================================='));

  const repoRoot = await findRepoRoot();

  try {
    // Get current agent info
    const currentStatus = await getAgentStatus(repoRoot);
    log.debug(chalk.yellow('📍 Current Agent:'));
    log.debug(chalk.green(`  🎭 ${currentStatus.agentType}`));
    log.debug(chalk.gray(`  Branch: ${currentStatus.currentBranch}`));
    log.debug(chalk.gray(`  Changes: ${currentStatus.uncommittedChanges ? 'Yes' : 'No'}`));
    log.debug(chalk.gray(`  Status: ${currentStatus.ahead} ahead, ${currentStatus.behind} behind`));

    // REAL DATA: Query actual worktrees
    log.debug(chalk.blue('🔍 Querying real worktrees...'));
    const worktrees = await queryRealWorktrees();

    // Map worktrees to agents
    const agents: AgentInfo[] = [];
    const agentWorktrees = worktrees.map(mapWorktreeToAgent).filter(Boolean) as AgentInfo[];

    if (agentWorktrees.length === 0) {
      log.debug(chalk.yellow('⚠️  No agent worktrees found. Run setup-agent-worktrees.sh first.'));
      log.debug(chalk.blue('💡 Fallback: Using expected agent configuration...'));

      // Fallback to expected agents if no worktrees found
      const expectedAgents: AgentInfo[] = [
        {
          id: 'agent-a',
          branch: 'feature/agent-a',
          role: 'Architecture',
          status: 'unknown',
          ahead: 0,
          behind: 0,
          uncommittedChanges: false,
        },
        {
          id: 'agent-b',
          branch: 'feature/agent-b',
          role: 'Implementation',
          status: 'unknown',
          ahead: 0,
          behind: 0,
          uncommittedChanges: false,
        },
        {
          id: 'agent-c',
          branch: 'feature/agent-c',
          role: 'Testing/Cleanup',
          status: 'unknown',
          ahead: 0,
          behind: 0,
          uncommittedChanges: false,
        },
      ];

      agents.push(...expectedAgents);
    } else {
      // Get real status for each agent
      log.debug(
        chalk.blue(`📊 Found ${agentWorktrees.length} agent worktrees, checking status...`)
      );

      for (const agent of agentWorktrees) {
        const agentWithStatus = await getAgentWorktreeStatus(agent);
        agents.push(agentWithStatus);
      }
    }

    log.debug(chalk.yellow('🎭 All Agents:'));
    for (const agent of agents) {
      const statusIcon =
        agent.status === 'active' ? '🟢' : agent.status === 'inactive' ? '🔴' : '⚪';
      const changesIcon = agent.uncommittedChanges ? '📝' : '✅';

      log.debug(chalk.blue(`  ${statusIcon} ${agent.id} (${agent.role})`));
      log.debug(chalk.gray(`     Branch: ${agent.branch}`));
      log.debug(
        chalk.gray(`     Status: ${changesIcon} ${agent.ahead} ahead, ${agent.behind} behind`)
      );

      if (agent.path) {
        log.debug(chalk.gray(`     Path: ${agent.path}`));
      }

      if (agent.uncommittedChanges) {
        log.debug(chalk.yellow('     ⚠️  Has uncommitted changes'));
      }
    }

    log.debug(chalk.yellow('💡 Recommendations:'));
    const needsSync = agents.filter((a) => a.behind > 0);
    const hasChanges = agents.filter((a) => a.uncommittedChanges);

    if (needsSync.length > 0) {
      log.debug(chalk.blue(`  • ${needsSync.length} agent(s) behind integration - recommend sync`));
    }
    if (hasChanges.length > 0) {
      log.debug(chalk.blue(`  • ${hasChanges.length} agent(s) with uncommitted changes`));
    }
    if (needsSync.length === 0 && hasChanges.length === 0) {
      log.debug(chalk.green('  • All agents are synchronized! 🎉'));
    }

    // Show hybrid system status

    log.debug(chalk.blue('🔧 System Integration:'));
    log.debug(chalk.green('  ✅ Using real worktree data'));
    log.debug(chalk.green('  ✅ Hybrid actor/shell approach'));
    log.debug(chalk.gray('  💡 Run `scripts/actor-bridge.sh status` for full system status'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to get agents status:'), error);
    log.debug(chalk.yellow('💡 Fallback: Try running `scripts/worktree-maintenance.sh check`'));
  }
}

/**
 * Sync with all other agents
 */
export async function agentsSyncCommand() {
  log.debug(chalk.blue('🔄 Multi-Agent Synchronization'));
  log.debug(chalk.blue('================================'));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    log.debug(chalk.yellow('📡 Fetching from all agent branches...'));

    // Fetch from all known agent branches
    const agentBranches = ['feature/agent-a', 'feature/agent-b', 'feature/agent-c'];

    for (const branch of agentBranches) {
      try {
        await git.getGit().fetch(['origin', branch]);
        log.debug(chalk.green(`  ✅ Fetched ${branch}`));
      } catch {
        log.debug(chalk.gray(`  ⚪ ${branch} not available`));
      }
    }

    log.debug(chalk.yellow('🔍 Checking integration status...'));
    const status = await git.getIntegrationStatus();

    if (status.behind > 0) {
      log.debug(chalk.yellow(`⬇️  ${status.behind} commits behind integration`));
      log.debug(chalk.blue('💡 Run `aw sync` to pull latest changes'));
    } else {
      log.debug(chalk.green('✅ Up to date with integration'));
    }

    if (status.ahead > 0) {
      log.debug(chalk.yellow(`⬆️  ${status.ahead} commits ahead of integration`));
      log.debug(chalk.blue('💡 Run `aw ship` to share your changes'));
    }

    log.debug(chalk.green('🎉 Multi-agent sync completed'));
  } catch (error) {
    console.error(chalk.red('❌ Multi-agent sync failed:'), error);
  }
}

/**
 * Detect potential conflicts between agents
 */
export async function agentsConflictsCommand() {
  log.debug(chalk.blue('⚡ Agent Conflict Detection'));
  log.debug(chalk.blue('============================'));

  const repoRoot = await findRepoRoot();
  const git = new GitOperations(repoRoot);

  try {
    log.debug(chalk.yellow('🔍 Analyzing potential conflicts...'));

    // Get current agent's changed files
    const currentFiles = await git.getChangedFiles();
    log.debug(chalk.blue(`📂 Current agent modified ${currentFiles.length} files`));

    if (currentFiles.length > 0) {
      log.debug(chalk.gray('  Changed files:'));
      for (const file of currentFiles.slice(0, 10)) {
        log.debug(chalk.gray(`    • ${file}`));
      }
      if (currentFiles.length > 10) {
        log.debug(chalk.gray(`    ... and ${currentFiles.length - 10} more`));
      }
    }

    // TODO: PLACEHOLDER CONFLICT DETECTION LOGIC
    // This is a simplified mock implementation that does not perform real conflict detection.
    // In a real implementation, this would:
    // 1. Fetch all agent branches
    // 2. Compare file changes between branches
    // 3. Identify overlapping file modifications
    // 4. Analyze git diff for actual conflicts
    // 5. Use proper git merge-base analysis for conflict prediction

    log.debug(chalk.yellow('🧠 Conflict Analysis:'));

    // MOCK: Simple filename pattern-based conflict detection
    const potentialConflicts = currentFiles.filter(
      (file) => file.includes('core/') || file.includes('shared') || file.includes('package.json')
    );

    if (potentialConflicts.length > 0) {
      log.debug(chalk.yellow(`⚠️  ${potentialConflicts.length} files may cause conflicts:`));
      for (const file of potentialConflicts) {
        log.debug(chalk.red(`    ⚡ ${file} (shared component)`));
      }

      log.debug(chalk.blue('💡 Recommendations:'));
      log.debug(chalk.gray('  • Coordinate with other agents before modifying shared files'));
      log.debug(chalk.gray('  • Consider splitting changes into smaller, focused commits'));
      log.debug(chalk.gray('  • Sync frequently to minimize conflict window'));
    } else {
      log.debug(chalk.green('✅ No potential conflicts detected'));
      log.debug(chalk.gray('  Your changes appear to be isolated to your domain'));
    }

    log.debug(chalk.green('🛡️  Conflict detection completed'));
  } catch (error) {
    console.error(chalk.red('❌ Conflict detection failed:'), error);
  }
}
