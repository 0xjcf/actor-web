/**
 * @agent-workflow/cli - Agent-Centric Development Workflow CLI
 * Programmatic API exports for integration with other tools and frameworks
 *
 * @version 0.1.0-alpha
 * @author Actor-Web Team
 */

// ============================================================================
// GIT ACTOR SYSTEM
// ============================================================================

// Core Git Actor with enhanced commit and date validation
export {
  type AgentWorktreeConfig,
  createGitActor,
  type GitContext,
  type GitEvent,
  type GitResponse,
  gitActorMachine,
} from './actors/git-actor.js';

// ============================================================================
// ENHANCED COMMIT SYSTEM
// ============================================================================

// Actor-powered commit operations
export {
  commitEnhancedCommand,
  generateCommitMessageCommand,
  validateDatesCommand,
} from './commands/commit-enhanced.js';

// ============================================================================
// ADVANCED GIT ACTOR COMMANDS
// ============================================================================

// Advanced git actor operations
export {
  actorCreateCommand,
  actorStatusCommand,
  actorWorktreesCommand,
} from './commands/advanced-git.js';

// ============================================================================
// AGENT COORDINATION COMMANDS
// ============================================================================

// Multi-agent coordination and management
export {
  agentsConflictsCommand,
  agentsStatusCommand,
  agentsSyncCommand,
} from './commands/agent-coordination.js';

// ============================================================================
// CORE WORKFLOW COMMANDS
// ============================================================================

// Traditional workflow commands
export { initCommand } from './commands/init.js';
export { saveCommand } from './commands/save.js';
export { shipCommand } from './commands/ship.js';
export { statusCommand } from './commands/status.js';
export { syncCommand } from './commands/sync.js';
export { validateCommand } from './commands/validate.js';

// ============================================================================
// GIT OPERATIONS & VALIDATION
// ============================================================================

// Core git operations and utilities
export { GitOperations } from './core/git-operations.js';
export { ValidationService } from './core/validation.js';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

// Common types for API consumers
export interface AgentWorkflowConfig {
  agentCount?: number;
  template?: string;
  baseDir?: string;
  integrationBranch?: string;
}

export interface CommitAnalysis {
  type: string;
  scope: string;
  description: string;
  workCategory: string;
  agentType: string;
  files: string[];
  projectTag: string;
}

export interface DateValidationResult {
  file: string;
  line: number;
  date: string;
  issue: 'future' | 'past' | 'invalid';
  context: string;
}

export interface AgentStatus {
  currentBranch: string;
  agentType: string;
  uncommittedChanges: boolean;
  ahead: number;
  behind: number;
  changedFiles: string[];
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Detect agent type from branch name or git context
 * @returns Agent type string
 */
export async function detectAgentType(): Promise<string> {
  const { GitOperations } = await import('./core/git-operations.js');
  const git = new GitOperations();
  return await git.detectAgentType();
}

/**
 * Get comprehensive agent status
 * @param baseDir - Repository base directory
 * @returns Complete agent status information
 */
export async function getAgentStatus(baseDir?: string): Promise<AgentStatus> {
  const { GitOperations } = await import('./core/git-operations.js');
  const git = new GitOperations(baseDir);

  const currentBranch = await git.getCurrentBranch();
  const agentType = await git.detectAgentType();
  const uncommittedChanges = await git.hasUncommittedChanges();
  const { ahead, behind } = await git.getIntegrationStatus();
  const changedFiles = await git.getChangedFiles();

  return {
    currentBranch,
    agentType,
    uncommittedChanges,
    ahead,
    behind,
    changedFiles,
  };
}

/**
 * Generate intelligent commit message
 * @param baseDir - Repository base directory
 * @returns Analyzed commit message with metadata
 */
export async function generateIntelligentCommitMessage(baseDir?: string): Promise<CommitAnalysis> {
  const gitActor = (await import('./actors/git-actor.js')).createGitActor(baseDir);

  return new Promise((resolve, reject) => {
    gitActor.start();

    gitActor.send({ type: 'GENERATE_COMMIT_MESSAGE' });

    // Poll for result (in production, this would use proper event handling)
    const checkResult = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.context.lastCommitMessage && snapshot.context.commitConfig) {
        gitActor.stop();
        resolve({
          type: snapshot.context.commitConfig.type || 'feat',
          scope: snapshot.context.commitConfig.scope || 'core',
          description: snapshot.context.commitConfig.description || 'update implementation',
          workCategory: snapshot.context.commitConfig.workCategory || 'implementation',
          agentType: snapshot.context.agentType || 'Unknown Agent',
          files: [], // Would be populated from git diff
          projectTag: snapshot.context.commitConfig.projectTag || 'actor-web',
        });
      } else if (snapshot.context.lastError) {
        gitActor.stop();
        reject(new Error(snapshot.context.lastError));
      } else {
        setTimeout(checkResult, 100);
      }
    };

    setTimeout(checkResult, 100);
  });
}

/**
 * Validate dates in documentation files
 * @param files - Array of file paths to validate
 * @param baseDir - Repository base directory
 * @returns Array of date validation issues
 */
export async function validateDocumentationDates(
  files: string[],
  baseDir?: string
): Promise<DateValidationResult[]> {
  const gitActor = (await import('./actors/git-actor.js')).createGitActor(baseDir);

  return new Promise((resolve, reject) => {
    gitActor.start();

    gitActor.send({ type: 'VALIDATE_DATES', filePaths: files });

    const checkResult = () => {
      const snapshot = gitActor.getSnapshot();
      if (snapshot.context.dateIssues) {
        gitActor.stop();
        resolve(snapshot.context.dateIssues);
      } else if (snapshot.context.lastError) {
        gitActor.stop();
        reject(new Error(snapshot.context.lastError));
      } else {
        setTimeout(checkResult, 100);
      }
    };

    setTimeout(checkResult, 100);
  });
}

// ============================================================================
// CLI INTEGRATION HELPERS
// ============================================================================

/**
 * Run workflow command programmatically
 * @param command - Command to run ('init', 'save', 'ship', 'sync', 'validate', 'status')
 * @param options - Command-specific options
 * @returns Promise that resolves when command completes
 */
export async function runWorkflowCommand(
  command: 'init' | 'save' | 'ship' | 'sync' | 'validate' | 'status',
  options: Record<string, unknown> = {}
): Promise<void> {
  switch (command) {
    case 'init':
      return (await import('./commands/init.js')).initCommand(
        options as { agents: string; template: string }
      );
    case 'save':
      return (await import('./commands/save.js')).saveCommand();
    case 'ship':
      return (await import('./commands/ship.js')).shipCommand();
    case 'sync':
      return (await import('./commands/sync.js')).syncCommand();
    case 'validate':
      return (await import('./commands/validate.js')).validateCommand();
    case 'status':
      return (await import('./commands/status.js')).statusCommand();
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

// ============================================================================
// PACKAGE METADATA
// ============================================================================

// Import package.json for version info
import packageJson from '../package.json' with { type: 'json' };

/**
 * CLI Package version
 */
export const version = packageJson.version;

/**
 * Get CLI package information
 */
export const CLI_INFO = {
  name: '@agent-workflow/cli',
  description: 'Agent-centric development workflow automation',
  features: [
    'Git worktree management',
    'Smart validation (changed files only)',
    'Agent-aware operations',
    'Enhanced conventional commits',
    'Date validation',
    'Actor-based git operations',
    'Multi-agent coordination',
    'Conflict detection',
    'Advanced git actor system',
  ],
  commands: [
    // Core workflow
    'init',
    'sync',
    'validate',
    'save',
    'ship',
    'status',
    // Enhanced commits
    'commit',
    'generate-message',
    'validate-dates',
    // Actor system
    'actor:status',
    'actor:worktrees',
    'actor:create',
    // Agent coordination
    'agents:status',
    'agents:sync',
    'agents:conflicts',
    // Utilities
    'help',
  ],
  categories: {
    core: ['init', 'sync', 'validate', 'save', 'ship', 'status'],
    commits: ['commit', 'generate-message', 'validate-dates'],
    actors: ['actor:status', 'actor:worktrees', 'actor:create'],
    coordination: ['agents:status', 'agents:sync', 'agents:conflicts'],
  },
} as const;
