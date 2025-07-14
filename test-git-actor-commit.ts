#!/usr/bin/env tsx

/**
 * Test git-actor by actually committing our migration changes
 */

import { createGitActor } from './packages/agent-workflow-cli/src/actors/git-actor.js';

async function commitWithGitActor() {
  console.log('🚀 Committing Changes with Git Actor');
  console.log('=====================================');

  const git = createGitActor(process.cwd());

  try {
    console.log('📡 Setting up event subscription...');
    git.subscribe((response) => {
      console.log(`📡 EVENT: ${response.type}`, response);
    });

    console.log('\n✅ Git Actor Status:', git.getSnapshot().status);

    console.log('\n📁 Testing repository check...');
    git.send({ type: 'CHECK_REPO' });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\n🌿 Checking status...');
    git.send({ type: 'CHECK_STATUS' });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\n📝 Checking for uncommitted changes...');
    git.send({ type: 'CHECK_UNCOMMITTED_CHANGES' });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\n🤖 Detecting agent type...');
    git.send({ type: 'DETECT_AGENT_TYPE' });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    console.log('\n💾 Attempting to commit with convention...');
    const commitMessage = 'feat(agent-a): Complete git-actor migration with proper event emission';
    git.send({
      type: 'COMMIT_WITH_CONVENTION',
      customMessage: commitMessage,
    });
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log('\n🎉 Git Actor commit test completed!');
    console.log('Check the events above to see if git operations worked.');
  } catch (error) {
    console.error('❌ Git Actor commit test failed:', error);
  } finally {
    await git.stop();
    console.log('\n🧹 Git Actor stopped');
  }
}

// Run the test
commitWithGitActor().catch(console.error);
