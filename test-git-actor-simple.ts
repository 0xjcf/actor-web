/**
 * Simple Git Actor Test - Debug Framework Logging
 */

import { createGitActor } from './packages/agent-workflow-cli/src/actors/git-actor.js';
import { enableDevMode, Logger } from './src/core/dev-mode.js';

// Enable debug logging
console.log('🔧 Enabling dev mode...');
enableDevMode();
console.log('🔧 Dev mode enabled');

const log = Logger.namespace('SIMPLE_GIT_TEST');

async function testBasicGitActor() {
  log.debug('🚀 Starting simple git actor test');

  try {
    // Create git actor
    const gitActor = createGitActor();
    log.debug('Git actor created', {
      id: gitActor.id,
      status: gitActor.status,
    });

    // Check initial state
    const initialSnapshot = gitActor.getSnapshot();
    log.debug('Initial actor state', {
      value: initialSnapshot.value,
      status: initialSnapshot.status,
      context: initialSnapshot.context,
    });

    // Subscribe to events
    const unsubscribe = gitActor.subscribe((response) => {
      log.debug('Received git actor response', response);
    });

    // Send a simple event
    log.debug('Sending DETECT_AGENT_TYPE event');
    gitActor.send({ type: 'DETECT_AGENT_TYPE' });

    // Check state after sending event
    const afterEventSnapshot = gitActor.getSnapshot();
    log.debug('State after sending event', {
      value: afterEventSnapshot.value,
      status: afterEventSnapshot.status,
    });

    // Wait a bit for processing
    log.debug('Waiting for processing...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check final state
    const finalSnapshot = gitActor.getSnapshot();
    log.debug('Final actor state', {
      value: finalSnapshot.value,
      status: finalSnapshot.status,
      context: finalSnapshot.context,
    });

    // Clean up
    unsubscribe();
    await gitActor.stop();
    log.debug('✅ Test completed successfully');
  } catch (error) {
    log.error('❌ Test failed', { error });
  }
}

testBasicGitActor();
