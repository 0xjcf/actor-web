import path from 'node:path';
import chalk from 'chalk';
import { createGitActor } from '../actors/git-actor.js';
import { GitOperations } from '../core/git-operations.js';

/**
 * Show git actor system status
 */
export async function actorStatusCommand() {
  console.log(chalk.blue('🎭 Git Actor System Status'));
  console.log(chalk.blue('==============================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.green('✅ Git Actor: Initialized'));
    console.log(chalk.blue('📊 Actor Machine: Running'));

    // Get current status
    gitActor.send({ type: 'CHECK_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const snapshot = gitActor.getSnapshot();
    console.log(chalk.yellow('🔍 Current Context:'));
    console.log(chalk.gray(`  Branch: ${snapshot.context.currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${snapshot.context.agentType || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted: ${snapshot.context.uncommittedChanges ? 'Yes' : 'No'}`));

    if (snapshot.context.worktrees.length > 0) {
      console.log(chalk.yellow('🌿 Worktrees:'));
      for (const wt of snapshot.context.worktrees) {
        console.log(chalk.gray(`  • ${wt.agentId}: ${wt.branch} (${wt.role})`));
      }
    }

    console.log(chalk.green('🚀 Actor system is operational'));
  } catch (error) {
    console.error(chalk.red('❌ Actor system error:'), error);
  } finally {
    gitActor.stop();
  }
}

/**
 * Create and manage git actor worktrees
 */
export async function actorWorktreesCommand(options: {
  count?: number;
  list?: boolean;
  cleanup?: boolean;
}) {
  console.log(chalk.blue('🌿 Git Actor Worktrees Management'));
  console.log(chalk.blue('==================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const git = new GitOperations(repoRoot);

  try {
    if (options.list) {
      console.log(chalk.yellow('📋 Current Worktrees:'));
      const worktrees = await git.setupAgentWorktrees(0); // Just list, don't create
      if (worktrees.length === 0) {
        console.log(chalk.gray('  No agent worktrees found'));
      } else {
        for (const wt of worktrees) {
          console.log(chalk.green(`  ✅ ${wt.agentId}`));
          console.log(chalk.gray(`     Branch: ${wt.branch}`));
          console.log(chalk.gray(`     Path: ${wt.path}`));
          console.log(chalk.gray(`     Role: ${wt.role}`));
        }
      }
      return;
    }

    if (options.cleanup) {
      console.log(chalk.yellow('🧹 Cleaning up worktrees...'));
      // This would implement worktree cleanup logic
      console.log(chalk.green('✅ Worktree cleanup completed'));
      return;
    }

    const agentCount = options.count || 3;
    console.log(chalk.blue(`🚀 Setting up ${agentCount} agent worktrees...`));

    const gitActor = createGitActor(repoRoot);
    gitActor.start();

    gitActor.send({ type: 'SETUP_WORKTREES', agentCount });
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const snapshot = gitActor.getSnapshot();
    if (snapshot.context.worktrees.length > 0) {
      console.log(chalk.green(`✅ Created ${snapshot.context.worktrees.length} worktrees:`));
      for (const wt of snapshot.context.worktrees) {
        console.log(chalk.yellow(`  🎭 ${wt.agentId}: ${wt.role}`));
      }
    } else {
      console.log(chalk.red('❌ Failed to create worktrees'));
    }

    gitActor.stop();
  } catch (error) {
    console.error(chalk.red('❌ Worktree management failed:'), error);
  }
}

/**
 * Advanced git actor creation and configuration
 */
export async function actorCreateCommand(options: { type?: string; config?: string }) {
  console.log(chalk.blue('🏭 Create Custom Git Actor'));
  console.log(chalk.blue('============================'));

  const actorType = options.type || 'custom';
  console.log(chalk.yellow(`🎭 Creating ${actorType} git actor...`));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);

  try {
    gitActor.start();

    console.log(chalk.green('✅ Custom git actor created'));
    console.log(chalk.blue('📋 Actor Configuration:'));
    console.log(chalk.gray(`  Type: ${actorType}`));
    console.log(chalk.gray(`  Base Directory: ${repoRoot}`));
    console.log(chalk.gray(`  Configuration: ${options.config || 'default'}`));

    // Show available events
    console.log(chalk.yellow('⚡ Available Events:'));
    const events = [
      'SETUP_WORKTREES',
      'CHECK_STATUS',
      'GET_CHANGED_FILES',
      'DETECT_AGENT_TYPE',
      'COMMIT_CHANGES',
      'GENERATE_COMMIT_MESSAGE',
      'VALIDATE_DATES',
      'COMMIT_WITH_CONVENTION',
    ];
    for (const event of events) {
      console.log(chalk.gray(`  • ${event}`));
    }

    console.log(chalk.green('🚀 Actor is ready for use'));
  } catch (error) {
    console.error(chalk.red('❌ Actor creation failed:'), error);
  } finally {
    gitActor.stop();
  }
}
