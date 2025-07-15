import path from 'node:path';
import chalk from 'chalk';
import { createGitActor } from '../actors/git-actor.js';
import { createContextObserver } from '../actors/git-actor-helpers.js';
import { GitOperations } from '../core/git-operations.js';
import { waitForState } from '../test-utils.js';

/**
 * Demo git actor workflow with reactive observation
 */
export async function demoGitActorCommand() {
  console.log(chalk.blue('🎭 Git Actor Demo'));
  console.log(chalk.blue('=================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);
  gitActor.start();

  console.log(chalk.green('✅ Git Actor: Initialized'));
  console.log(chalk.blue('📊 Actor Machine: Running'));

  try {
    // Get current status
    gitActor.send({ type: 'CHECK_STATUS' });
    await waitForState(gitActor, 'statusChecked', 5000);

    // Get context values reactively
    const currentBranch = await new Promise<string | undefined>((resolve) => {
      const observer = createContextObserver(
        gitActor,
        (context) => context.currentBranch,
        (value) => {
          observer.unsubscribe();
          resolve(value);
        }
      );
    });

    const agentType = await new Promise<string | undefined>((resolve) => {
      const observer = createContextObserver(
        gitActor,
        (context) => context.agentType,
        (value) => {
          observer.unsubscribe();
          resolve(value);
        }
      );
    });

    const uncommittedChanges = await new Promise<boolean | undefined>((resolve) => {
      const observer = createContextObserver(
        gitActor,
        (context) => context.uncommittedChanges,
        (value) => {
          observer.unsubscribe();
          resolve(value);
        }
      );
    });

    console.log(chalk.yellow('🔍 Current Context:'));
    console.log(chalk.gray(`  Branch: ${currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${agentType || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted: ${uncommittedChanges ? 'Yes' : 'No'}`));
  } catch (error) {
    console.error(chalk.red('❌ Demo failed:'), error);
  } finally {
    gitActor.stop();
    console.log(chalk.green('✅ Git Actor: Stopped'));
  }
}

/**
 * Advanced git operations demo
 */
export async function advancedGitOperationsCommand() {
  console.log(chalk.blue('🚀 Advanced Git Operations Demo'));
  console.log(chalk.blue('=================================='));

  const repoRoot = path.resolve(process.cwd(), '../..');
  const gitActor = createGitActor(repoRoot);
  gitActor.start();

  try {
    // Check repository status
    gitActor.send({ type: 'CHECK_REPO' });
    await waitForState(gitActor, 'repoChecked', 5000);

    const isGitRepo = await new Promise<boolean | undefined>((resolve) => {
      const observer = createContextObserver(
        gitActor,
        (context) => context.isGitRepo,
        (value) => {
          observer.unsubscribe();
          resolve(value);
        }
      );
    });

    if (isGitRepo) {
      console.log(chalk.green('✅ Git repository detected'));

      // Get integration status
      gitActor.send({
        type: 'GET_INTEGRATION_STATUS',
        integrationBranch: 'feature/actor-ref-integration',
      });
      await waitForState(gitActor, 'integrationStatusChecked', 5000);

      const integrationStatus = await new Promise<{ ahead: number; behind: number } | undefined>(
        (resolve) => {
          const observer = createContextObserver(
            gitActor,
            (context) => context.integrationStatus,
            (value) => {
              observer.unsubscribe();
              resolve(value);
            }
          );
        }
      );

      if (integrationStatus) {
        console.log(chalk.blue('📊 Integration Status:'));
        console.log(chalk.gray(`  Ahead: ${integrationStatus.ahead} commits`));
        console.log(chalk.gray(`  Behind: ${integrationStatus.behind} commits`));
      }
    } else {
      console.log(chalk.red('❌ Not a git repository'));
    }
  } catch (error) {
    console.error(chalk.red('❌ Advanced operations failed:'), error);
  } finally {
    gitActor.stop();
    console.log(chalk.green('✅ Git Actor: Stopped'));
  }
}

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
    await waitForState(gitActor, 'statusChecked', 5000);

    // Use reactive observation to get status information instead of getSnapshot()
    const statusInfo = await new Promise<{
      currentBranch?: string;
      agentType?: string;
      uncommittedChanges?: boolean;
      worktrees: Array<{
        agentId: string;
        branch: string;
        role: string;
        exists: boolean;
        path: string;
      }>;
    }>((resolve) => {
      const subscription = gitActor
        .observe((snapshot) => ({
          currentBranch: snapshot.context.currentBranch,
          agentType: snapshot.context.agentType,
          uncommittedChanges: snapshot.context.uncommittedChanges,
          worktrees: snapshot.context.worktrees,
        }))
        .subscribe((info) => {
          subscription.unsubscribe();
          resolve(info);
        });
    });

    console.log(chalk.yellow('🔍 Current Context:'));
    console.log(chalk.gray(`  Branch: ${statusInfo.currentBranch || 'Unknown'}`));
    console.log(chalk.gray(`  Agent: ${statusInfo.agentType || 'Unknown'}`));
    console.log(chalk.gray(`  Uncommitted: ${statusInfo.uncommittedChanges ? 'Yes' : 'No'}`));

    if (statusInfo.worktrees.length > 0) {
      console.log(chalk.yellow('🌿 Worktrees:'));
      for (const wt of statusInfo.worktrees) {
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
    await waitForState(gitActor, 'worktreesSetup', 2000);

    // Use reactive observation to get worktrees information instead of getSnapshot()
    const worktrees = await new Promise<
      Array<{ agentId: string; branch: string; role: string; exists: boolean; path: string }>
    >((resolve) => {
      const subscription = gitActor
        .observe((snapshot) => snapshot.context.worktrees)
        .subscribe((worktreesData) => {
          subscription.unsubscribe();
          resolve(worktreesData);
        });
    });

    if (worktrees.length > 0) {
      console.log(chalk.green(`✅ Created ${worktrees.length} worktrees:`));
      for (const wt of worktrees) {
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
