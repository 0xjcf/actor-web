/**
 * @module actor-core/runtime/tests/discriminated-messages.test
 * @description Tests for discriminated union message handling
 *
 * These tests verify that discriminated unions provide type-safe message
 * handling with exhaustive pattern matching. This is critical for ensuring
 * all message types are properly handled at compile time.
 *
 * @author Agent A (Tech Lead) - 2025-07-17
 */

import { describe, expect, it } from 'vitest';
import {
  AIAgentHandler,
  type AIAgentMessage,
  GitHandler,
  type GitMessage,
  isAIAgentMessage,
  isGitMessage,
  isWorkflowMessage,
  MessageRouter,
  WorkflowHandler,
  type WorkflowMessage,
} from '../discriminated-messages.js';

describe('Discriminated Message Handling', () => {
  describe('AIAgentHandler', () => {
    const handler = new AIAgentHandler();

    it('should handle think messages', async () => {
      const message: AIAgentMessage = { type: 'think', prompt: 'Hello world' };
      const result = await handler.handle(message);
      expect(result).toBe('Thinking about: Hello world with context: undefined');
    });

    it('should handle think messages with context', async () => {
      const message: AIAgentMessage = {
        type: 'think',
        prompt: 'Analyze this',
        context: { user: 'alice' },
      };
      const result = await handler.handle(message);
      expect(result).toBe('Thinking about: Analyze this with context: {"user":"alice"}');
    });

    it('should handle act messages', async () => {
      const message: AIAgentMessage = {
        type: 'act',
        action: 'move',
        params: { x: 10, y: 20 },
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ action: 'move', params: { x: 10, y: 20 }, executed: true });
    });

    it('should handle observe messages', async () => {
      const message: AIAgentMessage = {
        type: 'observe',
        data: { temperature: 25 },
        source: 'sensor',
      };
      const result = await handler.handle(message);
      expect(result).toBeUndefined(); // observe returns void
    });

    it('should handle learn messages', async () => {
      const message: AIAgentMessage = {
        type: 'learn',
        experience: { success: true },
        weight: 0.8,
      };
      const result = await handler.handle(message);
      expect(result).toBeUndefined(); // learn returns void
    });

    it('should handle reset messages', async () => {
      const message: AIAgentMessage = {
        type: 'reset',
        preserveMemory: true,
      };
      const result = await handler.handle(message);
      expect(result).toBeUndefined(); // reset returns void
    });
  });

  describe('GitHandler', () => {
    const handler = new GitHandler();

    it('should handle REQUEST_STATUS messages', async () => {
      const message: GitMessage = { type: 'REQUEST_STATUS', requestId: 'req-123' };
      const result = await handler.handle(message);
      expect(result).toEqual({ status: 'clean', requestId: 'req-123' });
    });

    it('should handle COMMIT messages', async () => {
      const message: GitMessage = {
        type: 'COMMIT',
        message: 'Fix bug',
        files: ['src/index.ts'],
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ hash: 'abc123' });
    });

    it('should handle PUSH messages', async () => {
      const message: GitMessage = {
        type: 'PUSH',
        branch: 'main',
        remote: 'origin',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });

    it('should handle PULL messages', async () => {
      const message: GitMessage = {
        type: 'PULL',
        branch: 'develop',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });

    it('should handle CHECKOUT messages', async () => {
      const message: GitMessage = {
        type: 'CHECKOUT',
        branch: 'feature/new-feature',
        create: true,
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });

    it('should handle MERGE messages', async () => {
      const message: GitMessage = {
        type: 'MERGE',
        branch: 'feature/branch',
        strategy: 'rebase',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });

    it('should handle STAGE messages', async () => {
      const message: GitMessage = {
        type: 'STAGE',
        files: ['src/index.ts', 'README.md'],
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });

    it('should handle UNSTAGE messages', async () => {
      const message: GitMessage = {
        type: 'UNSTAGE',
        files: ['src/index.ts'],
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ success: true });
    });
  });

  describe('WorkflowHandler', () => {
    const handler = new WorkflowHandler();

    it('should handle start messages', async () => {
      const message: WorkflowMessage = {
        type: 'start',
        workflow: 'deployment',
        input: { version: '1.0.0' },
      };
      const result = await handler.handle(message);
      expect(result).toHaveProperty('workflowId');

      // Type guard for workflow result
      if (result && typeof result === 'object' && 'workflowId' in result) {
        const workflowResult = result as { workflowId: string };
        expect(workflowResult.workflowId).toMatch(/^workflow-\d+$/);
      } else {
        throw new Error('Expected result to have workflowId property');
      }
    });

    it('should handle pause messages', async () => {
      const message: WorkflowMessage = {
        type: 'pause',
        reason: 'User requested pause',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ paused: true });
    });

    it('should handle resume messages', async () => {
      const message: WorkflowMessage = {
        type: 'resume',
        fromStep: 'deploy',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ resumed: true });
    });

    it('should handle stop messages', async () => {
      const message: WorkflowMessage = {
        type: 'stop',
        reason: 'Error occurred',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ stopped: true });
    });

    it('should handle step messages', async () => {
      const message: WorkflowMessage = {
        type: 'step',
        stepId: 'build',
        input: { buildConfig: 'production' },
      };
      const result = await handler.handle(message);
      expect(result).toEqual({
        stepResult: {
          stepId: 'build',
          input: { buildConfig: 'production' },
          executed: true,
        },
      });
    });

    it('should handle retry messages', async () => {
      const message: WorkflowMessage = {
        type: 'retry',
        stepId: 'deploy',
        maxAttempts: 3,
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ retried: true });
    });

    it('should handle skip messages', async () => {
      const message: WorkflowMessage = {
        type: 'skip',
        stepId: 'tests',
        reason: 'CI/CD pipeline will run tests',
      };
      const result = await handler.handle(message);
      expect(result).toEqual({ skipped: true });
    });
  });

  describe('MessageRouter', () => {
    it('should route messages to appropriate handlers', async () => {
      const router = new MessageRouter();
      const aiHandler = new AIAgentHandler();
      const gitHandler = new GitHandler();

      // Register handlers
      router.register('think', async (msg) => {
        return aiHandler.handle(msg as AIAgentMessage);
      });

      router.register('COMMIT', async (msg) => {
        return gitHandler.handle(msg as GitMessage);
      });

      // Test routing
      const thinkResult = await router.route({
        type: 'think',
        prompt: 'Test prompt',
      });
      expect(thinkResult).toBe('Thinking about: Test prompt with context: undefined');

      const commitResult = await router.route({
        type: 'COMMIT',
        message: 'Test commit',
      });
      expect(commitResult).toEqual({ hash: 'abc123' });
    });

    it('should throw error for unregistered message types', async () => {
      const router = new MessageRouter();

      await expect(router.route({ type: 'unknown' })).rejects.toThrow(
        'No handler registered for message type: unknown'
      );
    });
  });

  describe('Type Guards', () => {
    it('should identify AI agent messages', () => {
      expect(isAIAgentMessage({ type: 'think', prompt: 'test' })).toBe(true);
      expect(isAIAgentMessage({ type: 'act', action: 'test', params: {} })).toBe(true);
      expect(isAIAgentMessage({ type: 'observe', data: {} })).toBe(true);
      expect(isAIAgentMessage({ type: 'learn', experience: {} })).toBe(true);
      expect(isAIAgentMessage({ type: 'reset' })).toBe(true);
      expect(isAIAgentMessage({ type: 'COMMIT', message: 'test' })).toBe(false);
    });

    it('should identify Git messages', () => {
      expect(isGitMessage({ type: 'REQUEST_STATUS' })).toBe(true);
      expect(isGitMessage({ type: 'COMMIT', message: 'test' })).toBe(true);
      expect(isGitMessage({ type: 'PUSH' })).toBe(true);
      expect(isGitMessage({ type: 'PULL' })).toBe(true);
      expect(isGitMessage({ type: 'CHECKOUT', branch: 'main' })).toBe(true);
      expect(isGitMessage({ type: 'MERGE', branch: 'main' })).toBe(true);
      expect(isGitMessage({ type: 'STAGE' })).toBe(true);
      expect(isGitMessage({ type: 'UNSTAGE' })).toBe(true);
      expect(isGitMessage({ type: 'think', prompt: 'test' })).toBe(false);
    });

    it('should identify Workflow messages', () => {
      expect(isWorkflowMessage({ type: 'start', workflow: 'test' })).toBe(true);
      expect(isWorkflowMessage({ type: 'pause' })).toBe(true);
      expect(isWorkflowMessage({ type: 'resume' })).toBe(true);
      expect(isWorkflowMessage({ type: 'stop' })).toBe(true);
      expect(isWorkflowMessage({ type: 'step', stepId: 'test' })).toBe(true);
      expect(isWorkflowMessage({ type: 'retry', stepId: 'test' })).toBe(true);
      expect(isWorkflowMessage({ type: 'skip', stepId: 'test' })).toBe(true);
      expect(isWorkflowMessage({ type: 'think', prompt: 'test' })).toBe(false);
    });
  });

  describe('Exhaustive Pattern Matching', () => {
    it('should enforce exhaustive handling in AIAgentHandler', async () => {
      const handler = new AIAgentHandler();

      // This test ensures that if we add a new message type to AIAgentMessage,
      // TypeScript will force us to handle it in the switch statement
      const validMessages: AIAgentMessage[] = [
        { type: 'think', prompt: 'test' },
        { type: 'act', action: 'test', params: {} },
        { type: 'observe', data: {} },
        { type: 'learn', experience: {} },
        { type: 'reset' },
      ];

      for (const message of validMessages) {
        await expect(handler.handle(message)).resolves.not.toThrow();
      }
    });

    it('should enforce exhaustive handling in GitHandler', async () => {
      const handler = new GitHandler();

      const validMessages: GitMessage[] = [
        { type: 'REQUEST_STATUS' },
        { type: 'COMMIT', message: 'test' },
        { type: 'PUSH' },
        { type: 'PULL' },
        { type: 'CHECKOUT', branch: 'main' },
        { type: 'MERGE', branch: 'main' },
        { type: 'STAGE' },
        { type: 'UNSTAGE' },
      ];

      for (const message of validMessages) {
        await expect(handler.handle(message)).resolves.not.toThrow();
      }
    });

    it('should enforce exhaustive handling in WorkflowHandler', async () => {
      const handler = new WorkflowHandler();

      const validMessages: WorkflowMessage[] = [
        { type: 'start', workflow: 'test' },
        { type: 'pause' },
        { type: 'resume' },
        { type: 'stop' },
        { type: 'step', stepId: 'test' },
        { type: 'retry', stepId: 'test' },
        { type: 'skip', stepId: 'test' },
      ];

      for (const message of validMessages) {
        await expect(handler.handle(message)).resolves.not.toThrow();
      }
    });
  });
});
