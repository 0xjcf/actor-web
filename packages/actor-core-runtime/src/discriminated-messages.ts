// ========================================================================================
// DISCRIMINATED UNION MESSAGE PATTERNS
// ========================================================================================

/**
 * Base discriminated message type
 * All messages must extend this to ensure type safety
 */
export interface BaseMessage {
  type: string;
  timestamp?: number;
  correlationId?: string;
  [key: string]: unknown;
}

/**
 * AI Agent Message Union
 * Demonstrates exhaustive pattern matching for AI agent operations
 */
export type AIAgentMessage =
  | { type: 'think'; prompt: string; context?: unknown }
  | { type: 'act'; action: string; params: unknown }
  | { type: 'observe'; data: unknown; source?: string }
  | { type: 'learn'; experience: unknown; weight?: number }
  | { type: 'reset'; preserveMemory?: boolean };

/**
 * Git Actor Message Union
 * Covers all git operations with proper typing
 */
export type GitMessage =
  | { type: 'REQUEST_STATUS'; requestId?: string }
  | { type: 'COMMIT'; message: string; files?: string[] }
  | { type: 'PUSH'; branch?: string; remote?: string }
  | { type: 'PULL'; branch?: string; remote?: string }
  | { type: 'CHECKOUT'; branch: string; create?: boolean }
  | { type: 'MERGE'; branch: string; strategy?: 'merge' | 'rebase' }
  | { type: 'STAGE'; files?: string[] }
  | { type: 'UNSTAGE'; files?: string[] };

/**
 * Workflow Actor Message Union
 * Supports complex workflow orchestration
 */
export type WorkflowMessage =
  | { type: 'start'; workflow: string; input?: unknown }
  | { type: 'pause'; reason?: string }
  | { type: 'resume'; fromStep?: string }
  | { type: 'stop'; reason?: string }
  | { type: 'step'; stepId: string; input?: unknown }
  | { type: 'retry'; stepId: string; maxAttempts?: number }
  | { type: 'skip'; stepId: string; reason?: string };

/**
 * Supervision Message Union
 * Handles fault tolerance and actor lifecycle
 */
export type SupervisionMessage =
  | { type: 'supervise'; childId: string; strategy?: 'restart' | 'stop' | 'escalate' }
  | { type: 'unsupervise'; childId: string }
  | { type: 'restart'; childId: string; delay?: number }
  | { type: 'escalate'; error: Error; childId?: string }
  | { type: 'health_check'; childId?: string };

// ========================================================================================
// MESSAGE HANDLERS WITH EXHAUSTIVE PATTERN MATCHING
// ========================================================================================

/**
 * AI Agent Handler
 * Demonstrates exhaustive pattern matching with TypeScript
 */
export class AIAgentHandler {
  async handle(message: AIAgentMessage): Promise<unknown> {
    switch (message.type) {
      case 'think':
        return this.think(message.prompt, message.context);

      case 'act':
        return this.execute(message.action, message.params);

      case 'observe':
        return this.observe(message.data, message.source);

      case 'learn':
        return this.learn(message.experience, message.weight);

      case 'reset':
        return this.reset(message.preserveMemory);

      // TypeScript ensures all cases are handled
      default: {
        // This will cause a compile error if we miss a case
        const exhaustiveCheck: never = message;
        throw new Error(`Unhandled message type: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async think(prompt: string, context?: unknown): Promise<string> {
    // LLM thinking implementation
    return `Thinking about: ${prompt} with context: ${JSON.stringify(context)}`;
  }

  private async execute(action: string, params: unknown): Promise<unknown> {
    // Action execution implementation
    return { action, params, executed: true };
  }

  private async observe(data: unknown, source?: string): Promise<void> {
    // Observation processing implementation
    console.log(`Observing data from ${source}:`, data);
  }

  private async learn(experience: unknown, weight?: number): Promise<void> {
    // Learning implementation
    console.log(`Learning from experience (weight: ${weight}):`, experience);
  }

  private async reset(preserveMemory?: boolean): Promise<void> {
    // Reset implementation
    console.log(`Resetting agent (preserve memory: ${preserveMemory})`);
  }
}

/**
 * Git Handler
 * Handles all git operations with proper error handling
 */
export class GitHandler {
  async handle(message: GitMessage): Promise<unknown> {
    switch (message.type) {
      case 'REQUEST_STATUS':
        return this.getStatus(message.requestId);

      case 'COMMIT':
        return this.commit(message.message, message.files);

      case 'PUSH':
        return this.push(message.branch, message.remote);

      case 'PULL':
        return this.pull(message.branch, message.remote);

      case 'CHECKOUT':
        return this.checkout(message.branch, message.create);

      case 'MERGE':
        return this.merge(message.branch, message.strategy);

      case 'STAGE':
        return this.stage(message.files);

      case 'UNSTAGE':
        return this.unstage(message.files);

      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unhandled git message: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async getStatus(requestId?: string): Promise<{ status: string; requestId?: string }> {
    return { status: 'clean', requestId };
  }

  private async commit(_message: string, _files?: string[]): Promise<{ hash: string }> {
    return { hash: 'abc123' };
  }

  private async push(_branch?: string, _remote?: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  private async pull(_branch?: string, _remote?: string): Promise<{ success: boolean }> {
    return { success: true };
  }

  private async checkout(_branch: string, _create?: boolean): Promise<{ success: boolean }> {
    return { success: true };
  }

  private async merge(
    _branch: string,
    _strategy?: 'merge' | 'rebase'
  ): Promise<{ success: boolean }> {
    return { success: true };
  }

  private async stage(_files?: string[]): Promise<{ success: boolean }> {
    return { success: true };
  }

  private async unstage(_files?: string[]): Promise<{ success: boolean }> {
    return { success: true };
  }
}

/**
 * Example workflow handler using discriminated messages
 */
export class WorkflowHandler {
  private _currentStep?: string;
  private _workflowState: 'idle' | 'running' | 'paused' | 'stopped' = 'idle';

  // Getter to ensure linter recognizes usage of private members
  get currentState() {
    return { step: this._currentStep, state: this._workflowState };
  }

  async handle(message: WorkflowMessage): Promise<unknown> {
    switch (message.type) {
      case 'start':
        return this.start(message.workflow, message.input);

      case 'pause':
        return this.pause(message.reason);

      case 'resume':
        return this.resume(message.fromStep);

      case 'stop':
        return this.stop(message.reason);

      case 'step':
        return this.executeStep(message.stepId, message.input);

      case 'retry':
        return this.retry(message.stepId, message.maxAttempts);

      case 'skip':
        return this.skip(message.stepId, message.reason);

      default: {
        const exhaustiveCheck: never = message;
        throw new Error(`Unhandled workflow message: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  private async start(_workflow: string, _input?: unknown): Promise<{ workflowId: string }> {
    this._workflowState = 'running';
    return { workflowId: `workflow-${Date.now()}` };
  }

  private async pause(_reason?: string): Promise<{ paused: boolean }> {
    this._workflowState = 'paused';
    return { paused: true };
  }

  private async resume(fromStep?: string): Promise<{ resumed: boolean }> {
    this._workflowState = 'running';
    if (fromStep) {
      this._currentStep = fromStep;
    }
    return { resumed: true };
  }

  private async stop(_reason?: string): Promise<{ stopped: boolean }> {
    this._workflowState = 'stopped';
    return { stopped: true };
  }

  private async executeStep(stepId: string, input?: unknown): Promise<{ stepResult: unknown }> {
    this._currentStep = stepId;
    return { stepResult: { stepId, input, executed: true } };
  }

  private async retry(_stepId: string, _maxAttempts?: number): Promise<{ retried: boolean }> {
    return { retried: true };
  }

  private async skip(_stepId: string, _reason?: string): Promise<{ skipped: boolean }> {
    return { skipped: true };
  }
}

// ========================================================================================
// GENERIC MESSAGE ROUTER
// ========================================================================================

/**
 * Generic message router that uses discriminated unions for type-safe routing
 */
export class MessageRouter {
  private handlers = new Map<string, (message: BaseMessage) => Promise<unknown>>();

  register<T extends BaseMessage>(
    messageType: T['type'],
    handler: (message: T) => Promise<unknown>
  ): void {
    this.handlers.set(messageType, handler as (message: BaseMessage) => Promise<unknown>);
  }

  async route(message: BaseMessage): Promise<unknown> {
    const handler = this.handlers.get(message.type);
    if (!handler) {
      throw new Error(`No handler registered for message type: ${message.type}`);
    }
    return handler(message);
  }
}

// ========================================================================================
// UTILITY FUNCTIONS
// ========================================================================================

/**
 * Type guard for AI agent messages
 */
export function isAIAgentMessage(message: BaseMessage): message is AIAgentMessage {
  return ['think', 'act', 'observe', 'learn', 'reset'].includes(message.type);
}

/**
 * Type guard for Git messages
 */
export function isGitMessage(message: BaseMessage): message is GitMessage {
  return [
    'REQUEST_STATUS',
    'COMMIT',
    'PUSH',
    'PULL',
    'CHECKOUT',
    'MERGE',
    'STAGE',
    'UNSTAGE',
  ].includes(message.type);
}

/**
 * Type guard for Workflow messages
 */
export function isWorkflowMessage(message: BaseMessage): message is WorkflowMessage {
  return ['start', 'pause', 'resume', 'stop', 'step', 'retry', 'skip'].includes(message.type);
}

/**
 * Type guard for Supervision messages
 */
export function isSupervisionMessage(message: BaseMessage): message is SupervisionMessage {
  return ['supervise', 'unsupervise', 'restart', 'escalate', 'health_check'].includes(message.type);
}

// ========================================================================================
// EXAMPLE USAGE
// ========================================================================================

/**
 * Example demonstrating how to use discriminated unions for type-safe message handling
 */
export namespace DiscriminatedMessageExample {
  export async function demonstrateAIAgent() {
    const handler = new AIAgentHandler();

    // ✅ All valid messages compile correctly
    await handler.handle({ type: 'think', prompt: 'Hello world' });
    await handler.handle({ type: 'act', action: 'move', params: { x: 10, y: 20 } });
    await handler.handle({ type: 'observe', data: { temperature: 25 } });
    await handler.handle({ type: 'learn', experience: { success: true }, weight: 0.8 });
    await handler.handle({ type: 'reset', preserveMemory: true });

    // ❌ Invalid messages cause compile errors
    // await handler.handle({ type: 'invalid' }); // TypeScript error
    // await handler.handle({ type: 'think' }); // TypeScript error: missing prompt
  }

  export async function demonstrateGitActor() {
    const handler = new GitHandler();

    // ✅ All valid git operations
    await handler.handle({ type: 'REQUEST_STATUS', requestId: 'req-123' });
    await handler.handle({ type: 'COMMIT', message: 'Fix bug', files: ['src/index.ts'] });
    await handler.handle({ type: 'PUSH', branch: 'main' });
    await handler.handle({ type: 'PULL', branch: 'develop' });
  }

  export async function demonstrateMessageRouter() {
    const router = new MessageRouter();

    // Register handlers for different message types
    router.register('think', async (msg) => {
      const aiHandler = new AIAgentHandler();
      return aiHandler.handle(msg as AIAgentMessage);
    });

    router.register('COMMIT', async (msg) => {
      const gitHandler = new GitHandler();
      return gitHandler.handle(msg as GitMessage);
    });

    // Route messages to appropriate handlers
    await router.route({ type: 'think', prompt: 'Analyze this code' });
    await router.route({ type: 'COMMIT', message: 'Add new feature' });
  }
}
