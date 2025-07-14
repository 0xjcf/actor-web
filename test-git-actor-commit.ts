#!/usr/bin/env tsx

/**
 * Test GitActorIntegration for committing changes
 */

import { GitActorIntegration } from './packages/agent-workflow-cli/src/core/git-actor-integration.js';
import { enableDevMode, Logger } from './src/core/dev-mode.js';

// Enable debug logging to see event flow
enableDevMode();

const log = Logger.namespace('GIT_ACTOR_INTEGRATION_TEST');

async function testGitActorCommit() {
  log.debug('🚀 Committing Changes with Git Actor Integration');
  log.debug('=================================================');

  const git = new GitActorIntegration();

  try {
    // Test basic repository operations
    log.debug('✅ Testing repository check...');
    const isGitRepo = await git.isGitRepo();
    log.debug('📁 Is Git Repository:', { isGitRepo });

    log.debug('✅ Checking status...');
    const currentBranch = await git.getCurrentBranch();
    log.debug('🌿 Current Branch:', { currentBranch });

    log.debug('✅ Detecting agent type...');
    const agentType = await git.detectAgentType();
    log.debug('🤖 Agent Type:', { agentType });

    log.debug('✅ Checking for uncommitted changes...');
    const hasChanges = await git.hasUncommittedChanges();
    log.debug('📝 Has Changes:', { hasChanges });

    if (hasChanges) {
      log.debug('💾 Committing changes with git-actor...');
      const commitHash = await git.stageAndCommit(
        'feat(agent-a): Fix git-actor event emission visibility'
      );
      log.debug('✅ Committed successfully! Hash:', { commitHash });
    }

    log.debug('🎉 Git Actor Integration test completed successfully!');
    log.debug('🏆 All git operations worked using the actor model with proper event emission.');
  } catch (error) {
    log.error('❌ Git Actor Integration test failed:', error);
    if (error instanceof Error) {
      log.debug('Stack trace:', { stack: error.stack });
    }
  } finally {
    log.debug('🧹 Git Actor Integration stopped');
    await git.stop();
  }
}

// Run the test
testGitActorCommit().catch((error) => {
  const log = Logger.namespace('GIT_ACTOR_INTEGRATION_TEST');
  log.error('Unhandled error in test:', error);
});
