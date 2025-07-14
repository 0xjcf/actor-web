/**
 * Test Commit Convention Integration
 */

import { GitActorIntegration } from './packages/agent-workflow-cli/src/core/git-actor-integration.js';
import { enableDevMode, Logger } from './src/core/dev-mode.js';

// Enable debug logging
enableDevMode();

const log = Logger.namespace('COMMIT_CONVENTION_TEST');

async function testCommitConvention() {
  log.debug('🎯 Testing Commit Convention Integration');
  log.debug('=======================================');

  const git = new GitActorIntegration();

  try {
    // Check if we have uncommitted changes to work with
    log.debug('✅ Checking for uncommitted changes...');
    const hasChanges = await git.hasUncommittedChanges();
    log.debug('📝 Has Changes:', { hasChanges });

    if (!hasChanges) {
      log.debug('ℹ️ No changes to commit - test will show message generation only');
      return;
    }

    // Test conventional commit generation directly
    log.debug('🎨 Testing conventional commit with custom description...');
    try {
      const commitHash = await git.commitWithConvention(
        'fix debug logging infrastructure for CLI environments'
      );
      log.debug('✅ Conventional commit completed!', { commitHash });
    } catch (error) {
      log.error('❌ Conventional commit failed:', error);
    }

    log.debug('🎉 Commit convention test completed!');
  } catch (error) {
    log.error('❌ Commit convention test failed:', error);
  } finally {
    log.debug('🧹 Cleaning up git actor integration');
    await git.stop();
  }
}

// Run the test
testCommitConvention().catch((error) => {
  const log = Logger.namespace('COMMIT_CONVENTION_TEST');
  log.error('Unhandled error in test:', error);
});
