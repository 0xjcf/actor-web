import chalk from 'chalk';
import { createActorRef } from '@actor-core/runtime';
import { gitActorMachine, type GitActor } from '../actors/git-actor.js';
import { findRepoRoot } from '../core/repo-root-finder.js';

/**
 * Status Command - Pure Actor Model Implementation
 * 
 * Displays repository status using pure message-passing.
 * No state observation or direct access.
 */
export async function statusCommand() {
  console.log(chalk.blue('📊 Status Check'));
  console.log(chalk.blue('==========================================='));

  const repoRoot = await findRepoRoot();
  
  // Create git actor using the pure runtime
  const gitActor = createActorRef(gitActorMachine, {
    id: 'status-git-actor',
    input: { baseDir: repoRoot },
  }) as GitActor;

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
 * Status workflow handler using pure message-passing
 */
class StatusWorkflowHandler {
  constructor(private actor: GitActor) {}

  async executeStatus(): Promise<void> {
    console.log(chalk.blue('📋 Starting status check...'));

    try {
      // Step 1: Check if it's a git repository
      const isGitRepo = await this.checkGitRepository();
      
      if (!isGitRepo) {
        console.log(chalk.red('❌ Not a git repository'));
        return;
      }

      // Step 2: Get current branch and status
      const status = await this.getBranchStatus();

      // Step 3: Check uncommitted changes
      const hasUncommittedChanges = await this.checkUncommittedChanges();

      // Step 4: Get integration status
      const integrationStatus = await this.getIntegrationStatus();

      // Step 5: Display status summary
      this.displayStatusSummary({
        ...status,
        uncommittedChanges: hasUncommittedChanges,
        integrationStatus,
      });

    } catch (error) {
      console.error(chalk.red('Status check error:'), error);
      throw error;
    }
  }

  /**
   * Check if directory is a git repository
   */
  private async checkGitRepository(): Promise<boolean> {
    console.log(chalk.gray('🔍 Checking repository...'));

    // Send CHECK_REPO message
    this.actor.send({ type: 'CHECK_REPO' });

    // Wait for check to complete
    await this.waitForOperation('CHECK_REPO', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'isGitRepo' in response && 
        response.isGitRepo !== undefined;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { isGitRepo?: boolean };

    return status.isGitRepo || false;
  }

  /**
   * Get current branch and agent type
   */
  private async getBranchStatus(): Promise<{ 
    currentBranch?: string; 
    agentType?: string 
  }> {
    console.log(chalk.gray('🔍 Getting branch information...'));

    // Send CHECK_STATUS message
    this.actor.send({ type: 'CHECK_STATUS' });

    // Wait for status check to complete
    await this.waitForOperation('CHECK_STATUS', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'currentBranch' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
    const branchInfo = response as { 
      currentBranch?: string; 
      agentType?: string 
    };

    return {
      currentBranch: branchInfo.currentBranch,
      agentType: branchInfo.agentType,
    };
  }

  /**
   * Check for uncommitted changes
   */
  private async checkUncommittedChanges(): Promise<boolean> {
    console.log(chalk.gray('🔍 Checking for uncommitted changes...'));

    // Send CHECK_UNCOMMITTED_CHANGES message
    this.actor.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });

    // Wait for check to complete
    await this.waitForOperation('CHECK_UNCOMMITTED_CHANGES', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
      return response && typeof response === 'object' && 
        'uncommittedChanges' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_STATUS' });
    const status = response as { uncommittedChanges?: boolean };

    return status.uncommittedChanges || false;
  }

  /**
   * Get integration status
   */
  private async getIntegrationStatus(): Promise<{ 
    ahead: number; 
    behind: number 
  } | undefined> {
    console.log(chalk.gray('🔍 Checking integration status...'));

    // Send GET_INTEGRATION_STATUS message
    this.actor.send({ type: 'GET_INTEGRATION_STATUS' });

    // Wait for status check to complete
    await this.waitForOperation('GET_INTEGRATION_STATUS', async () => {
      const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
      return response && typeof response === 'object' && 
        'integrationStatus' in response;
    });

    const response = await this.actor.ask({ type: 'REQUEST_BRANCH_INFO' });
    const branchInfo = response as { 
      integrationStatus?: { ahead: number; behind: number } 
    };

    return branchInfo.integrationStatus;
  }

  /**
   * Display status summary
   */
  private displayStatusSummary(status: {
    currentBranch?: string;
    agentType?: string;
    uncommittedChanges?: boolean;
    integrationStatus?: { ahead: number; behind: number };
  }): void {
    console.log(chalk.blue('\n📊 Repository Status'));
    console.log(chalk.blue('==========================================='));

    // Branch information
    if (status.currentBranch) {
      console.log(chalk.white(`📍 Current Branch: ${chalk.cyan(status.currentBranch)}`));
    }

    // Agent type
    if (status.agentType) {
      console.log(chalk.white(`🤖 Agent Type: ${chalk.yellow(status.agentType)}`));
    }

    // Uncommitted changes
    if (status.uncommittedChanges) {
      console.log(chalk.yellow('📝 Uncommitted changes present'));
    } else {
      console.log(chalk.green('✅ Working directory clean'));
    }

    // Integration status
    if (status.integrationStatus) {
      const { ahead, behind } = status.integrationStatus;
      if (ahead > 0 || behind > 0) {
        console.log(chalk.white(`🔄 Integration Status:`));
        if (ahead > 0) {
          console.log(chalk.green(`   ↑ ${ahead} commits ahead`));
        }
        if (behind > 0) {
          console.log(chalk.yellow(`   ↓ ${behind} commits behind`));
        }
      } else {
        console.log(chalk.green('✅ In sync with integration branch'));
      }
    }

    console.log(chalk.blue('==========================================='));
  }

  /**
   * Wait for an operation to complete
   */
  private async waitForOperation(
    operation: string, 
    checkComplete: () => Promise<boolean>,
    timeout: number = 10000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        if (await checkComplete()) {
          return;
        }
      } catch (error) {
        // Operation might still be in progress
      }

      // Wait a bit before checking again
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Operation ${operation} timed out after ${timeout}ms`);
  }
}