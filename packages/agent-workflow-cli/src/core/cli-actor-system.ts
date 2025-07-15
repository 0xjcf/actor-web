/**
 * CLI Actor System
 *
 * Provides a CLI-specific actor system implementation that uses the proper
 * ActorSystem from @actor-core/runtime instead of ad-hoc actor creation.
 */

import {
  type ActorSystem,
  type ActorSystemConfig,
  createActorSystem,
  Logger,
} from '@actor-core/runtime';
import { createGitActor, type GitActor } from '../actors/git-actor.js';

// Create scoped logger for CLI actor system
const log = Logger.namespace('CLI_ACTOR_SYSTEM');

/**
 * CLI Actor System singleton
 */
class CLIActorSystem {
  private static instance: CLIActorSystem;
  private actorSystem: ActorSystem | null = null;
  private isInitialized = false;

  static getInstance(): CLIActorSystem {
    if (!CLIActorSystem.instance) {
      CLIActorSystem.instance = new CLIActorSystem();
    }
    return CLIActorSystem.instance;
  }

  /**
   * Initialize the CLI actor system
   */
  async initialize(config?: ActorSystemConfig): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    log.debug('🚀 Initializing CLI Actor System');

    // Create actor system with CLI-specific configuration
    this.actorSystem = createActorSystem({
      nodeAddress: 'cli-node',
      messageTimeout: 30000,
      maxActors: 50,
      directory: {
        cacheTtl: 300000, // 5 minutes
        maxCacheSize: 1000,
        cleanupInterval: 60000, // 1 minute
      },
      ...config,
    });

    // Start the actor system
    await this.actorSystem.start();

    this.isInitialized = true;
    log.debug('✅ CLI Actor System initialized');
  }

  /**
   * Get the actor system instance
   */
  getActorSystem(): ActorSystem {
    if (!this.actorSystem) {
      throw new Error('CLI Actor System not initialized. Call initialize() first.');
    }
    return this.actorSystem;
  }

  /**
   * Create a GitActor using the current implementation
   * TODO: Integrate properly with ActorSystem once XState machine support is added
   */
  async createGitActor(baseDir?: string): Promise<GitActor> {
    // Ensure system is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    log.debug('📦 Creating GitActor with CLI system management', { baseDir });

    // Use the existing createGitActor function for now
    // TODO: Replace with proper ActorSystem.spawn() once XState support is added
    const gitActor = createGitActor(baseDir);

    log.debug('✅ GitActor created successfully');

    return gitActor;
  }

  /**
   * Cleanup and stop the actor system
   */
  async cleanup(): Promise<void> {
    if (this.actorSystem) {
      log.debug('🧹 Cleaning up CLI Actor System');
      await this.actorSystem.stop();
      this.actorSystem = null;
      this.isInitialized = false;
      log.debug('✅ CLI Actor System cleaned up');
    }
  }

  /**
   * Get system stats
   */
  async getStats() {
    if (!this.actorSystem) {
      return null;
    }
    return await this.actorSystem.getSystemStats();
  }

  /**
   * List all actors
   */
  async listActors() {
    if (!this.actorSystem) {
      return [];
    }
    return await this.actorSystem.listActors();
  }
}

/**
 * Get the CLI actor system instance
 */
export function getCLIActorSystem(): CLIActorSystem {
  return CLIActorSystem.getInstance();
}

/**
 * Initialize the CLI actor system
 */
export async function initializeCLIActorSystem(config?: ActorSystemConfig): Promise<void> {
  const cliSystem = getCLIActorSystem();
  await cliSystem.initialize(config);
}

/**
 * Create a GitActor using the proper actor system
 */
export async function createGitActorWithSystem(baseDir?: string) {
  const cliSystem = getCLIActorSystem();
  return await cliSystem.createGitActor(baseDir);
}

/**
 * Cleanup CLI actor system
 */
export async function cleanupCLIActorSystem(): Promise<void> {
  const cliSystem = getCLIActorSystem();
  await cliSystem.cleanup();
}
