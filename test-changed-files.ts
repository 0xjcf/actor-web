/**
 * Test GET_CHANGED_FILES functionality
 */

import { createGitActor } from './packages/agent-workflow-cli/src/actors/git-actor.js';
import { enableDevMode, Logger } from './src/core/dev-mode.js';

// Enable debug logging
enableDevMode();

const log = Logger.namespace('CHANGED_FILES_TEST');

async function testChangedFiles() {
  log.debug('🔍 Testing GET_CHANGED_FILES event');
  log.debug('====================================');

  const gitActor = createGitActor();

  try {
    // Subscribe to responses
    const unsubscribe = gitActor.subscribe((response) => {
      log.debug('📨 Received git actor response:', response);
    });

    // Check initial state
    const initialSnapshot = gitActor.getSnapshot();
    log.debug('🔍 Initial state:', {
      value: initialSnapshot.value,
      status: initialSnapshot.status,
      hasEmitInContext: !!initialSnapshot.context?.emit,
    });

    // Send GET_CHANGED_FILES event
    log.debug('📤 Sending GET_CHANGED_FILES event...');
    gitActor.send({ type: 'GET_CHANGED_FILES' });

    // Check state after sending
    const afterSnapshot = gitActor.getSnapshot();
    log.debug('🔍 State after sending:', {
      value: afterSnapshot.value,
      status: afterSnapshot.status,
    });

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check final state
    const finalSnapshot = gitActor.getSnapshot();
    log.debug('🔍 Final state:', {
      value: finalSnapshot.value,
      status: finalSnapshot.status,
      context: finalSnapshot.context,
    });

    unsubscribe();
    await gitActor.stop();
    log.debug('✅ Test completed');
  } catch (error) {
    log.error('❌ Test failed:', error);
    await gitActor.stop();
  }
}

testChangedFiles().catch((error) => {
  const log = Logger.namespace('CHANGED_FILES_TEST');
  log.error('Unhandled error:', error);
});
