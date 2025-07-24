/**
 * Type Safety Demonstration for GitActor
 *
 * This file demonstrates the improved type safety with our new GitActor implementation.
 * The IDE should show errors for invalid usage.
 */

import { createGitActor } from './actors/git-actor.js';

export async function demonstrateTypeSafety() {
  const gitActor = createGitActor('.');

  // ✅ VALID: Correct message type with automatic type inference
  const statusResult = await gitActor.ask({
    type: 'REQUEST_STATUS',
  });

  // TypeScript automatically knows statusResult has these properties:
  console.log('Is Git Repo:', statusResult.isGitRepo);
  console.log('Current Branch:', statusResult.currentBranch);
  console.log('Agent Type:', statusResult.agentType);
  console.log('Uncommitted Changes:', statusResult.uncommittedChanges);

  // ✅ VALID: Message with required payload
  const commitResult = await gitActor.ask({
    type: 'COMMIT_CHANGES',
    payload: { message: 'feat: add new feature' },
  });

  // TypeScript knows commitResult has commitHash and message
  console.log('Commit Hash:', commitResult.commitHash);
  console.log('Commit Message:', commitResult.message);

  // ❌ INVALID: These will show IDE errors

  // Error: 'INVALID_MESSAGE_TYPE' is not assignable to type 'REQUEST_STATUS' | 'CHECK_UNCOMMITTED_CHANGES' | ...
  // const invalidResult = await gitActor.ask({
  //   type: 'INVALID_MESSAGE_TYPE',
  // });

  // Error: Property 'invalidProperty' does not exist on type '{ isGitRepo: boolean; currentBranch?: string; ... }'
  // console.log(statusResult.invalidProperty);

  // Error: Property 'payload' is missing in type '{ type: "COMMIT_CHANGES"; }' but required in type '{ type: "COMMIT_CHANGES"; payload: { message: string; }; }'
  // const missingPayload = await gitActor.ask({
  //   type: 'COMMIT_CHANGES',
  // });

  // Error: Type 'number' is not assignable to type 'string'
  // const wrongPayloadType = await gitActor.ask({
  //   type: 'COMMIT_CHANGES',
  //   payload: { message: 123 },
  // });

  // ✅ VALID: Payload-less messages
  const changesResult = await gitActor.ask({
    type: 'CHECK_UNCOMMITTED_CHANGES',
  });

  // TypeScript knows changesResult.uncommittedChanges is boolean
  console.log('Has Changes:', changesResult.uncommittedChanges);
}

// This demonstrates that:
// 1. Message types are constrained to valid GitActor message types
// 2. Response types are automatically inferred based on message type
// 3. Payload structure is enforced when required
// 4. IDE will show errors for invalid usage
// 5. No more manual generic type annotations needed
