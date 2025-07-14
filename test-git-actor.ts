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

  // Cast to any for debugging
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gitAny = git as any;

  try {
    console.log('\n📁 Testing basic git actor...');

    // Debug: Check if methods are on the underlying actor
    if (gitAny.actor) {
      console.log('🔍 Methods on underlying actor:');
      console.log(Object.getOwnPropertyNames(gitAny.actor));

      if (typeof gitAny.actor.start === 'function') {
        console.log('✅ actor.start() method exists, calling it...');
        gitAny.actor.start();
      }
    }

    // Debug: Check if methods are on the eventBus
    if (gitAny.eventBus) {
      console.log('🔍 Methods on eventBus:');
      console.log(Object.getOwnPropertyNames(gitAny.eventBus));
    }

    // Try to use the methods we expect
    if (typeof git.start === 'function') {
      console.log('✅ start() method exists, calling it...');
      git.start();
    } else {
      console.log('❌ start() method not found');
    }

    if (typeof git.send === 'function') {
      console.log('✅ send() method exists');
    } else if (gitAny.actor && typeof gitAny.actor.send === 'function') {
      console.log('✅ actor.send() method exists');
    } else {
      console.log('❌ send() method not found');
    }

    if (typeof git.subscribe === 'function') {
      console.log('✅ subscribe() method exists');
    } else if (gitAny.eventBus && typeof gitAny.eventBus.subscribe === 'function') {
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
    if (gitAny.eventBus && typeof gitAny.eventBus.subscribe === 'function') {
      console.log('\n📡 Setting up event subscription via eventBus...');
      gitAny.eventBus.subscribe((response: any) => {
        console.log(`📡 Received event: ${response.type}`, response);
      });
    }

    // Try to send an event using underlying actor
    if (gitAny.actor && typeof gitAny.actor.send === 'function') {
      console.log('\n✅ Sending CHECK_REPO event via actor...');
      gitAny.actor.send({ type: 'CHECK_REPO' });

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
    // Try to clean up if possible
    if (typeof git.stop === 'function') {
      await git.stop();
      console.log('\n🧹 Git Actor stopped');
    } else {
      console.log('\n🤷 No stop() method found');
    }
  }
}

// Run the test
testGitActor().catch(console.error);
