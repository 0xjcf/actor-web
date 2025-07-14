/**
 * Simple Git Actor Test - Debug Basic Functionality
 */

import { createGitActor } from './packages/agent-workflow-cli/src/actors/git-actor.js';
import { enableDevMode, Logger } from './src/core/dev-mode.js';

// Enable debug logging
console.log('🔧 Enabling dev mode...');
enableDevMode();
console.log('🔧 Dev mode enabled');

const log = Logger.namespace('SIMPLE_GIT_TEST');

async function testBasicGitActor() {
  console.log('🚀 Starting simple git actor test...');
  log.debug('🚀 Starting simple git actor test');

  try {
    // Create git actor
    console.log('📦 Creating git actor...');
    const gitActor = createGitActor();
    console.log('📦 Git actor created:', {
      id: gitActor.id,
      status: gitActor.status,
    });

    log.debug('Git actor created', {
      id: gitActor.id,
      status: gitActor.status,
    });

    // Check initial state
    const initialSnapshot = gitActor.getSnapshot();
    console.log('🔍 Initial actor state:', {
      value: initialSnapshot.value,
      status: initialSnapshot.status,
    });

    log.debug('Initial actor state', {
      value: initialSnapshot.value,
      status: initialSnapshot.status,
      context: initialSnapshot.context,
    });

    // Subscribe to events
    const unsubscribe = gitActor.subscribe((response) => {
      console.log('📨 Received git actor response:', response);
      log.debug('Received git actor response', response);
    });

    // Send a simple event
    console.log('📤 Sending DETECT_AGENT_TYPE event...');
    log.debug('Sending DETECT_AGENT_TYPE event');
    gitActor.send({ type: 'DETECT_AGENT_TYPE' });

    // Check state after sending event
    const afterEventSnapshot = gitActor.getSnapshot();
    console.log('🔍 State after sending event:', {
      value: afterEventSnapshot.value,
      status: afterEventSnapshot.status,
    });

    log.debug('State after sending event', {
      value: afterEventSnapshot.value,
      status: afterEventSnapshot.status,
    });

    // Wait a bit for processing
    console.log('⏳ Waiting for processing...');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check final state
    const finalSnapshot = gitActor.getSnapshot();
    console.log('🔍 Final actor state:', {
      value: finalSnapshot.value,
      status: finalSnapshot.status,
    });

    log.debug('Final actor state', {
      value: finalSnapshot.value,
      status: finalSnapshot.status,
      context: finalSnapshot.context,
    });

    // Clean up
    unsubscribe();
    await gitActor.stop();
    console.log('✅ Test completed successfully');
    log.debug('✅ Test completed successfully');
  } catch (error) {
    console.error('❌ Test failed:', error);
    log.error('❌ Test failed', { error });
  }
}

testBasicGitActor();
