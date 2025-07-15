import type { ActorSnapshot } from '@actor-web/core';
import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

export async function statusCommand() {
  console.log(chalk.blue('📊 Status Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    // Start the actor
    gitActor.start();

    // Create workflow handler
    const workflow = new StatusWorkflowHandler(gitActor);
    await workflow.executeStatus();
  } catch (error) {
    console.error(chalk.red('❌ Status check failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * Status workflow handler using completion state architecture
 */
class StatusWorkflowHandler {
  private actor: GitActor;
  private statusData: {
    isGitRepo?: boolean;
    currentBranch?: string;
    agentType?: string;
    uncommittedChanges?: boolean;
    integrationStatus?: { ahead: number; behind: number };
  } = {};

  constructor(actor: GitActor) {
    this.actor = actor;
  }

  async executeStatus(): Promise<void> {
    console.log(chalk.blue('📋 Starting status check...'));

    return new Promise((resolve, reject) => {
      // Observe all state changes and handle workflow progression
      const stateObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot as ActorSnapshot<GitContext>).value
        )
        .subscribe((state) => {
          this.handleStateChange(state, resolve, reject);
        });

      // Observe errors
      const errorObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).lastError)
        .subscribe((error) => {
          if (error) {
            console.error(chalk.red('❌ Error:'), error);
            this.cleanupObservers();
            reject(new Error(error));
          }
        });

      // Store observers for cleanup
      this.observers = [stateObserver, errorObserver];

      // Success handler
      this.onSuccess = () => {
        this.cleanupObservers();
        resolve();
      };

      // Start the workflow
      this.actor.send({ type: 'CHECK_REPO' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private handleStateChange(
    state: unknown,
    _resolve: () => void,
    reject: (error: Error) => void
  ): void {
    const snapshot = this.actor.getSnapshot();
    const context = snapshot.context as GitContext;
    const stateStr = state as string;

    switch (stateStr) {
      case 'repoChecked':
        this.statusData.isGitRepo = context.isGitRepo;
        if (!context.isGitRepo) {
          console.log(chalk.red('❌ Not in a Git repository'));
          this.displayStatus();
          this.onSuccess?.();
          return;
        }
        this.actor.send({ type: 'CHECK_STATUS' });
        break;

      case 'statusChecked':
        this.statusData.currentBranch = context.currentBranch;
        this.statusData.agentType = context.agentType;
        this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
        break;

      case 'uncommittedChangesChecked':
        this.statusData.uncommittedChanges = context.uncommittedChanges;
        this.actor.send({
          type: 'GET_INTEGRATION_STATUS',
          integrationBranch: 'integration',
        });
        break;

      case 'integrationStatusChecked':
        this.statusData.integrationStatus = context.integrationStatus;
        this.displayStatus();
        this.onSuccess?.();
        break;

      // Error states
      case 'repoError':
      case 'statusError':
      case 'uncommittedChangesError':
      case 'integrationStatusError': {
        const errorMsg = context.lastError || `Error in ${stateStr}`;
        console.error(chalk.red('❌ Error:'), errorMsg);
        reject(new Error(errorMsg));
        break;
      }

      // Timeout states
      case 'repoTimeout':
      case 'statusTimeout':
      case 'uncommittedChangesTimeout':
      case 'integrationStatusTimeout': {
        const timeoutMsg = `Operation timed out in ${stateStr}`;
        console.error(chalk.red('⏱️ Timeout:'), timeoutMsg);
        reject(new Error(timeoutMsg));
        break;
      }
    }
  }

  private displayStatus(): void {
    console.log(chalk.green('\n✅ Repository Status:'));
    console.log(
      `   📁 Repository: ${this.statusData.isGitRepo ? 'Valid Git repo' : 'Not a Git repo'}`
    );
    console.log(`   🌿 Branch: ${this.statusData.currentBranch || 'unknown'}`);
    console.log(`   🤖 Agent: ${this.statusData.agentType || 'unknown'}`);
    console.log(
      `   📝 Changes: ${this.statusData.uncommittedChanges ? 'Uncommitted changes present' : 'Working tree clean'}`
    );

    if (this.statusData.integrationStatus) {
      const { ahead, behind } = this.statusData.integrationStatus;
      console.log(`   📈 Integration: ${ahead} ahead, ${behind} behind`);

      if (ahead > 0) {
        console.log(chalk.yellow(`   💡 ${ahead} commits ready to ship`));
      }
      if (behind > 0) {
        console.log(chalk.blue(`   ⬇️  ${behind} commits behind integration`));
      }
    }

    console.log(chalk.blue('\n💡 Next steps:'));
    if (this.statusData.uncommittedChanges) {
      console.log(`   • Save changes: ${chalk.yellow('pnpm aw:save')}`);
    }
    if (this.statusData.integrationStatus?.ahead && this.statusData.integrationStatus.ahead > 0) {
      console.log(`   • Ship to integration: ${chalk.yellow('pnpm aw:ship')}`);
    }
    console.log(`   • Sync with integration: ${chalk.yellow('pnpm aw:sync')}`);
  }
}
