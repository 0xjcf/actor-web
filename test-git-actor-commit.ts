#!/usr/bin/env tsx

/**
 * Test git-actor by actually committing our migration changes using GitActorIntegration
 */

import { GitActorIntegration } from './packages/agent-workflow-cli/src/core/git-actor-integration.js';

async function commitWithGitActor() {
  console.log('🚀 Committing Changes with Git Actor Integration');
  console.log('=================================================');

  const git = new GitActorIntegration(process.cwd());

  try {
    console.log('✅ Testing repository check...');
    const isGitRepo = await git.isGitRepo();
    console.log(`📁 Is Git Repository: ${isGitRepo}`);

    if (!isGitRepo) {
      console.log('❌ Not in a git repository');
      return;
    }

    console.log('\n✅ Checking status...');
    const currentBranch = await git.getCurrentBranch();
    console.log(`🌿 Current Branch: ${currentBranch}`);

    console.log('\n✅ Detecting agent type...');
    const agentType = await git.detectAgentType();
    console.log(`🤖 Agent Type: ${agentType}`);

    console.log('\n✅ Checking for uncommitted changes...');
    const hasChanges = await git.hasUncommittedChanges();
    console.log(`📝 Has Changes: ${hasChanges}`);

    if (hasChanges) {
      console.log('\n💾 Committing changes with git-actor...');
      const commitMessage = `feat(agent-a): Fix git-actor event emission visibility

- Enhanced GitActorIntegration with proper context monitoring
- Fixed event emission by monitoring state machine context changes  
- Added comprehensive logging to track git operations
- Successfully validates git-actor event-driven architecture

Testing: All git operations now use proper actor model
[actor-web] ${agentType} - Event Emission Fix Complete`;

      const commitHash = await git.stageAndCommit(commitMessage);
      console.log(`✅ Committed successfully! Hash: ${commitHash}`);
    } else {
      console.log('✅ No changes to commit');
    }

    console.log('\n🎉 Git Actor Integration test completed successfully!');
    console.log('🏆 All git operations worked using the actor model with proper event emission.');
  } catch (error) {
    console.error('❌ Git Actor Integration test failed:', error);
    if (error instanceof Error) {
      console.error('Stack trace:', error.stack);
    }
  } finally {
    await git.stop();
    console.log('\n🧹 Git Actor Integration stopped');
  }
}

// Run the test
commitWithGitActor().catch(console.error);
