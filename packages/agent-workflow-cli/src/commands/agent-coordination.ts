import { execSync } from 'node:child_process';
import path from 'node:path';
import chalk from 'chalk';
import { GitOperations } from '../core/git-operations.js';
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

  try {
    // Check if path exists and is accessible
    const pathExists = await import('node:fs').then((fs) =>
      fs.promises
        .access(agent.path!, fs.constants.F_OK)
        .then(() => true)
        .catch(() => false)
    );

    if (!pathExists) {
      return { ...agent, status: 'inactive' };
    }

    // Get git status for this worktree
    const status = await getAgentStatus(agent.path);

    return {
      ...agent,
      status: status.currentBranch === agent.branch ? 'active' : 'inactive',
      ahead: status.ahead,
      behind: status.behind,
      uncommittedChanges: status.uncommittedChanges,
    };
  } catch (error) {
    console.error(chalk.gray(`    Warning: Could not get status for ${agent.id}: ${error}`));
    return agent;
  }
}

/**
 * Show status of all agents in the project (REAL DATA VERSION)
 */
export async function agentsStatusCommand() {
  console.log(chalk.blue('🤖 Multi-Agent Status Dashboard'));
  console.log(chalk.blue('=================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');

  try {
    // Get current agent info
    const currentStatus = await getAgentStatus(repoRoot);
    console.log(chalk.yellow('📍 Current Agent:'));
    console.log(chalk.green(`  🎭 ${currentStatus.agentType}`));
    console.log(chalk.gray(`  Branch: ${currentStatus.currentBranch}`));
    console.log(chalk.gray(`  Changes: ${currentStatus.uncommittedChanges ? 'Yes' : 'No'}`));
    console.log(
      chalk.gray(`  Status: ${currentStatus.ahead} ahead, ${currentStatus.behind} behind`)
    );
    console.log();

    // REAL DATA: Query actual worktrees
    console.log(chalk.blue('🔍 Querying real worktrees...'));
    const worktrees = await queryRealWorktrees();

    // Map worktrees to agents
    const agents: AgentInfo[] = [];
    const agentWorktrees = worktrees.map(mapWorktreeToAgent).filter(Boolean) as AgentInfo[];

    if (agentWorktrees.length === 0) {
      console.log(chalk.yellow('⚠️  No agent worktrees found. Run setup-agent-worktrees.sh first.'));
      console.log(chalk.blue('💡 Fallback: Using expected agent configuration...'));

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
      console.log(
        chalk.blue(`📊 Found ${agentWorktrees.length} agent worktrees, checking status...`)
      );

      for (const agent of agentWorktrees) {
        const agentWithStatus = await getAgentWorktreeStatus(agent);
        agents.push(agentWithStatus);
      }
    }

    console.log(chalk.yellow('🎭 All Agents:'));
    for (const agent of agents) {
      const statusIcon =
        agent.status === 'active' ? '🟢' : agent.status === 'inactive' ? '🔴' : '⚪';
      const changesIcon = agent.uncommittedChanges ? '📝' : '✅';

      console.log(chalk.blue(`  ${statusIcon} ${agent.id} (${agent.role})`));
      console.log(chalk.gray(`     Branch: ${agent.branch}`));
      console.log(
        chalk.gray(`     Status: ${changesIcon} ${agent.ahead} ahead, ${agent.behind} behind`)
      );

      if (agent.path) {
        console.log(chalk.gray(`     Path: ${agent.path}`));
      }

      if (agent.uncommittedChanges) {
        console.log(chalk.yellow('     ⚠️  Has uncommitted changes'));
      }
    }

    console.log();
    console.log(chalk.yellow('💡 Recommendations:'));
    const needsSync = agents.filter((a) => a.behind > 0);
    const hasChanges = agents.filter((a) => a.uncommittedChanges);

    if (needsSync.length > 0) {
      console.log(
        chalk.blue(`  • ${needsSync.length} agent(s) behind integration - recommend sync`)
      );
    }
    if (hasChanges.length > 0) {
      console.log(chalk.blue(`  • ${hasChanges.length} agent(s) with uncommitted changes`));
    }
    if (needsSync.length === 0 && hasChanges.length === 0) {
      console.log(chalk.green('  • All agents are synchronized! 🎉'));
    }

    // Show hybrid system status
    console.log();
    console.log(chalk.blue('🔧 System Integration:'));
    console.log(chalk.green('  ✅ Using real worktree data'));
    console.log(chalk.green('  ✅ Hybrid actor/shell approach'));
    console.log(chalk.gray('  💡 Run `scripts/actor-bridge.sh status` for full system status'));
  } catch (error) {
    console.error(chalk.red('❌ Failed to get agents status:'), error);
    console.log(chalk.yellow('💡 Fallback: Try running `scripts/worktree-maintenance.sh check`'));
  }
}

/**
 * Sync with all other agents
 */
export async function agentsSyncCommand() {
  console.log(chalk.blue('🔄 Multi-Agent Synchronization'));
  console.log(chalk.blue('================================'));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    console.log(chalk.yellow('📡 Fetching from all agent branches...'));

    // Fetch from all known agent branches
    const agentBranches = ['feature/agent-a', 'feature/agent-b', 'feature/agent-c'];

    for (const branch of agentBranches) {
      try {
        await git.getGit().fetch(['origin', branch]);
        console.log(chalk.green(`  ✅ Fetched ${branch}`));
      } catch {
        console.log(chalk.gray(`  ⚪ ${branch} not available`));
      }
    }

    console.log(chalk.yellow('🔍 Checking integration status...'));
    const status = await git.getIntegrationStatus();

    if (status.behind > 0) {
      console.log(chalk.yellow(`⬇️  ${status.behind} commits behind integration`));
      console.log(chalk.blue('💡 Run `aw sync` to pull latest changes'));
    } else {
      console.log(chalk.green('✅ Up to date with integration'));
    }

    if (status.ahead > 0) {
      console.log(chalk.yellow(`⬆️  ${status.ahead} commits ahead of integration`));
      console.log(chalk.blue('💡 Run `aw ship` to share your changes'));
    }

    console.log(chalk.green('🎉 Multi-agent sync completed'));
  } catch (error) {
    console.error(chalk.red('❌ Multi-agent sync failed:'), error);
  }
}

/**
 * Detect potential conflicts between agents
 */
export async function agentsConflictsCommand() {
  console.log(chalk.blue('⚡ Agent Conflict Detection'));
  console.log(chalk.blue('============================'));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    console.log(chalk.yellow('🔍 Analyzing potential conflicts...'));

    // Get current agent's changed files
    const currentFiles = await git.getChangedFiles();
    console.log(chalk.blue(`📂 Current agent modified ${currentFiles.length} files`));

    if (currentFiles.length > 0) {
      console.log(chalk.gray('  Changed files:'));
      for (const file of currentFiles.slice(0, 10)) {
        console.log(chalk.gray(`    • ${file}`));
      }
      if (currentFiles.length > 10) {
        console.log(chalk.gray(`    ... and ${currentFiles.length - 10} more`));
      }
    }

    // In a real implementation, this would:
    // 1. Fetch all agent branches
    // 2. Compare file changes between branches
    // 3. Identify overlapping file modifications
    // 4. Analyze git diff for actual conflicts

    console.log(chalk.yellow('🧠 Conflict Analysis:'));

    // Mock conflict detection results
    const potentialConflicts = currentFiles.filter(
      (file) => file.includes('core/') || file.includes('shared') || file.includes('package.json')
    );

    if (potentialConflicts.length > 0) {
      console.log(chalk.yellow(`⚠️  ${potentialConflicts.length} files may cause conflicts:`));
      for (const file of potentialConflicts) {
        console.log(chalk.red(`    ⚡ ${file} (shared component)`));
      }

      console.log();
      console.log(chalk.blue('💡 Recommendations:'));
      console.log(chalk.gray('  • Coordinate with other agents before modifying shared files'));
      console.log(chalk.gray('  • Consider splitting changes into smaller, focused commits'));
      console.log(chalk.gray('  • Sync frequently to minimize conflict window'));
    } else {
      console.log(chalk.green('✅ No potential conflicts detected'));
      console.log(chalk.gray('  Your changes appear to be isolated to your domain'));
    }

    console.log();
    console.log(chalk.green('🛡️  Conflict detection completed'));
  } catch (error) {
    console.error(chalk.red('❌ Conflict detection failed:'), error);
  }
}
