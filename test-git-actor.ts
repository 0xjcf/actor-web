#!/usr/bin/env tsx

/**
 * Test script for git-actor implementation
 * Uses our new git-actor to commit the migration changes
 */

import { createGitActor } from './packages/agent-workflow-cli/src/actors/git-actor.js';

async function testGitActor() {
  console.log('🚀 Testing Git Actor Implementation');
  console.log('=====================================');

  const git = createGitActor(process.cwd());

  // Debug: Let's see what methods are available
  console.log('🔍 Available methods on git-actor:');
  console.log(Object.getOwnPropertyNames(git));
  console.log('🔍 All properties (including inherited):');
  console.log(Object.getOwnPropertyNames(Object.getPrototypeOf(git)));

  // Cast to unknown for debugging with type guards
  const gitUnknown = git as unknown;

  try {
    console.log('\n📁 Testing basic git actor...');

    // Debug: Check if methods are on the underlying actor
    if (gitUnknown && typeof gitUnknown === 'object' && 'actor' in gitUnknown && gitUnknown.actor) {
      console.log('🔍 Methods on underlying actor:');
      console.log(Object.getOwnPropertyNames(gitUnknown.actor));

      if (
        typeof gitUnknown.actor === 'object' &&
        gitUnknown.actor &&
        'start' in gitUnknown.actor &&
        typeof gitUnknown.actor.start === 'function'
      ) {
        console.log('✅ actor.start() method exists, calling it...');
        gitUnknown.actor.start();
      }
    }

    // Debug: Check if methods are on the eventBus
    if (
      gitUnknown &&
      typeof gitUnknown === 'object' &&
      'eventBus' in gitUnknown &&
      gitUnknown.eventBus
    ) {
      console.log('🔍 Methods on eventBus:');
      console.log(Object.getOwnPropertyNames(gitUnknown.eventBus));
    }

    // Try to use the methods we expect (proper actor pattern)
    if (typeof git.send === 'function') {
      console.log('✅ send() method exists');
      console.log('✅ Starting actor with START event...');
      git.send({ type: 'START' });
    } else {
      console.log('❌ send() method not found');
    }

    if (typeof git.subscribe === 'function') {
      console.log('✅ subscribe() method exists');
    } else if (
      gitUnknown &&
      typeof gitUnknown === 'object' &&
      'eventBus' in gitUnknown &&
      gitUnknown.eventBus &&
      typeof gitUnknown.eventBus === 'object' &&
      'subscribe' in gitUnknown.eventBus &&
      typeof gitUnknown.eventBus.subscribe === 'function'
    ) {
      console.log('✅ eventBus.subscribe() method exists');
    } else {
      console.log('❌ subscribe() method not found');
    }

    if (typeof git.getSnapshot === 'function') {
      console.log('✅ getSnapshot() method exists');
      const snapshot = git.getSnapshot();
      console.log('📊 Snapshot status:', snapshot.status);
    } else {
      console.log('❌ getSnapshot() method not found');
    }

    // Try to subscribe to events using eventBus
    if (
      gitUnknown &&
      typeof gitUnknown === 'object' &&
      'eventBus' in gitUnknown &&
      gitUnknown.eventBus &&
      typeof gitUnknown.eventBus === 'object' &&
      'subscribe' in gitUnknown.eventBus &&
      typeof gitUnknown.eventBus.subscribe === 'function'
    ) {
      console.log('\n📡 Setting up event subscription via eventBus...');
      gitUnknown.eventBus.subscribe((response: unknown) => {
        if (response && typeof response === 'object' && 'type' in response) {
          console.log(`📡 Received event: ${response.type}`, response);
        } else {
          console.log('📡 Received unknown event:', response);
        }
      });
    }

    // Try to send an event using underlying actor
    if (
      gitUnknown &&
      typeof gitUnknown === 'object' &&
      'actor' in gitUnknown &&
      gitUnknown.actor &&
      typeof gitUnknown.actor === 'object' &&
      'send' in gitUnknown.actor &&
      typeof gitUnknown.actor.send === 'function'
    ) {
      console.log('\n✅ Sending CHECK_REPO event via actor...');
      gitUnknown.actor.send({ type: 'CHECK_REPO' });

      // Wait a bit for the response
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    console.log('\n🎉 Git Actor basic test completed!');
  } catch (error) {
    console.error('❌ Git Actor test failed:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    // Try to clean up if possible (proper actor pattern)
    if (typeof git.send === 'function') {
      git.send({ type: 'STOP' });
      console.log('\n🧹 Git Actor stopped via STOP event');
    } else {
      console.log('\n🤷 No send() method found');
    }
  }
}

// Run the test
testGitActor().catch(console.error);
