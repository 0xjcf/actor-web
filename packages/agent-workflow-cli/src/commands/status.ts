import type { ActorSnapshot } from '@actor-web/core';
import chalk from 'chalk';
import { createGitActor, type GitActor, type GitContext } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

export async function statusCommand() {
  console.log(chalk.blue('📊 State-Based Status Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  const gitActor = createGitActor(repoRoot);

  try {
    // Start the actor
    gitActor.start();

    // Create status workflow handler
    const statusWorkflow = new StatusWorkflowHandler(gitActor);
    await statusWorkflow.executeStatus();
  } catch (error) {
    console.error(chalk.red('❌ Status check failed:'), error);
    process.exit(1);
  } finally {
    await gitActor.stop();
  }
}

/**
 * State-based status workflow handler
 */
class StatusWorkflowHandler {
  private actor: GitActor;
  private workflowState:
    | 'checking_repo'
    | 'checking_status'
    | 'checking_changes'
    | 'checking_integration'
    | 'complete' = 'checking_repo';
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
    console.log(chalk.blue('📋 Starting state-based status check...'));

    return new Promise((resolve, reject) => {
      // Observe all status-related state changes
      const repoObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).isGitRepo)
        .subscribe((isGitRepo) => {
          if (isGitRepo !== undefined) {
            this.statusData.isGitRepo = isGitRepo;
            this.handleRepoStatus(isGitRepo);
          }
        });

      const branchObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).currentBranch
        )
        .subscribe((currentBranch) => {
          if (currentBranch) {
            this.statusData.currentBranch = currentBranch;
            this.checkNextStep();
          }
        });

      const agentObserver = this.actor
        .observe((snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).agentType)
        .subscribe((agentType) => {
          if (agentType) {
            this.statusData.agentType = agentType;
            this.checkNextStep();
          }
        });

      const changesObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).uncommittedChanges
        )
        .subscribe((uncommittedChanges) => {
          if (uncommittedChanges !== undefined) {
            this.statusData.uncommittedChanges = uncommittedChanges;
            this.checkNextStep();
          }
        });

      const integrationObserver = this.actor
        .observe(
          (snapshot: ActorSnapshot<unknown>) => (snapshot.context as GitContext).integrationStatus
        )
        .subscribe((integrationStatus) => {
          if (integrationStatus) {
            this.statusData.integrationStatus = integrationStatus;
            this.checkNextStep();
          }
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
      this.observers = [
        repoObserver,
        branchObserver,
        agentObserver,
        changesObserver,
        integrationObserver,
        errorObserver,
      ];

      // Success handler
      this.onSuccess = () => {
        this.displayStatus();
        this.cleanupObservers();
        resolve();
      };

      // Start the workflow
      this.workflowState = 'checking_repo';
      this.actor.send({ type: 'CHECK_REPO' });
    });
  }

  private observers: Array<{ unsubscribe(): void }> = [];
  private onSuccess?: () => void;

  private cleanupObservers(): void {
    this.observers.forEach((observer) => observer.unsubscribe());
    this.observers = [];
  }

  private handleRepoStatus(isGitRepo: boolean): void {
    if (this.workflowState !== 'checking_repo') return;

    if (!isGitRepo) {
      console.log(chalk.red('❌ Not in a Git repository'));
      this.workflowState = 'complete';
      this.onSuccess?.();
      return;
    }

    this.workflowState = 'checking_status';
    this.actor.send({ type: 'CHECK_STATUS' });
  }

  private checkNextStep(): void {
    if (
      this.workflowState === 'checking_status' &&
      this.statusData.currentBranch &&
      this.statusData.agentType
    ) {
      this.workflowState = 'checking_changes';
      this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
    } else if (
      this.workflowState === 'checking_changes' &&
      this.statusData.uncommittedChanges !== undefined
    ) {
      this.workflowState = 'checking_integration';
      this.actor.send({
        type: 'GET_INTEGRATION_STATUS',
        integrationBranch: 'feature/actor-ref-integration',
      });
    } else if (this.workflowState === 'checking_integration' && this.statusData.integrationStatus) {
      this.workflowState = 'complete';
      this.onSuccess?.();
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
