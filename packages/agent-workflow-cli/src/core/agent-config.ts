import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@actor-core/runtime';

const log = Logger.namespace('AGENT_CONFIG');

export interface AgentWorktreeConfig {
  agentId: string;
  branch: string;
  path: string;
  role: string;
}

export interface AgentWorkflowConfig {
  /** Agent workspace configurations */
  agents: AgentWorktreeConfig[];
  /** Base directory for relative paths */
  baseDir?: string;
  /** Integration branch name */
  integrationBranch?: string;
}

/**
 * Default agent workspace configuration
 */
export const DEFAULT_AGENT_CONFIG: AgentWorkflowConfig = {
  agents: [
    {
      agentId: 'agent-a',
      branch: 'feature/agent-a',
      path: '../actor-web-architecture',
      role: 'Architecture',
    },
    {
      agentId: 'agent-b',
      branch: 'feature/agent-b',
      path: '../actor-web-implementation',
      role: 'Implementation',
    },
    {
      agentId: 'agent-c',
      branch: 'feature/agent-c',
      path: '../actor-web-tests',
      role: 'Testing',
    },
  ],
  integrationBranch: 'feature/actor-ref-integration',
};

/**
 * Configuration file names to search for
 */
const CONFIG_FILENAMES = [
  'agent-workflow.config.js',
  'agent-workflow.config.json',
  '.awconfig.js',
  '.awconfig.json',
];

/**
 * Load configuration from multiple sources with precedence:
 * 1. CLI options (highest precedence)
 * 2. Environment variables
 * 3. Configuration file
 * 4. Default values (lowest precedence)
 */
export class AgentConfigLoader {
  private config: AgentWorkflowConfig;
  private configPath?: string;

  constructor(private startDir: string = process.cwd()) {
    this.config = { ...DEFAULT_AGENT_CONFIG };
  }

  /**
   * Load configuration from all sources
   */
  async load(
    options: {
      configPath?: string;
      agentPaths?: Record<string, string>;
      baseDir?: string;
      integrationBranch?: string;
    } = {}
  ): Promise<AgentWorkflowConfig> {
    log.debug('Loading agent configuration', { startDir: this.startDir, options });

    // 1. Load from configuration file
    await this.loadFromFile(options.configPath);

    // 2. Apply environment variables
    this.loadFromEnvironment();

    // 3. Apply CLI options (highest precedence)
    this.applyCliOptions(options);

    // 4. Resolve relative paths
    this.resolveRelativePaths();

    log.debug('Final agent configuration loaded', {
      config: this.config,
      configPath: this.configPath,
    });

    return this.config;
  }

  /**
   * Load configuration from file
   */
  private async loadFromFile(explicitPath?: string): Promise<void> {
    let configPath: string | undefined;

    if (explicitPath) {
      // Use explicit path if provided
      configPath = path.resolve(explicitPath);
    } else {
      // Search for configuration file
      configPath = this.findConfigFile();
    }

    if (!configPath || !fs.existsSync(configPath)) {
      log.debug('No configuration file found, using defaults');
      return;
    }

    try {
      this.configPath = configPath;
      let fileConfig: Partial<AgentWorkflowConfig>;

      if (configPath.endsWith('.json')) {
        // Load JSON configuration
        const content = await fs.promises.readFile(configPath, 'utf-8');
        fileConfig = JSON.parse(content);
      } else {
        // Load JavaScript configuration
        const configModule = await import(configPath);
        fileConfig = configModule.default || configModule;
      }

      // Merge with defaults
      this.config = {
        ...this.config,
        ...fileConfig,
        agents: fileConfig.agents || this.config.agents,
      };

      log.debug('Configuration loaded from file', {
        configPath,
        agentCount: this.config.agents.length,
      });
    } catch (error) {
      log.warn('Failed to load configuration file', { configPath, error });
    }
  }

  /**
   * Find configuration file by searching upward from start directory
   */
  private findConfigFile(): string | undefined {
    let currentDir = this.startDir;
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
      for (const filename of CONFIG_FILENAMES) {
        const configPath = path.join(currentDir, filename);
        if (fs.existsSync(configPath)) {
          log.debug('Found configuration file', { configPath });
          return configPath;
        }
      }
      currentDir = path.dirname(currentDir);
    }

    return undefined;
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnvironment(): void {
    const envConfig: Partial<AgentWorkflowConfig> = {};

    // Check for base directory override
    if (process.env.AW_BASE_DIR) {
      envConfig.baseDir = process.env.AW_BASE_DIR;
    }

    // Check for integration branch override
    if (process.env.AW_INTEGRATION_BRANCH) {
      envConfig.integrationBranch = process.env.AW_INTEGRATION_BRANCH;
    }

    // Check for agent path overrides
    const agentPaths: Record<string, string> = {};
    if (process.env.AW_AGENT_A_PATH) agentPaths['agent-a'] = process.env.AW_AGENT_A_PATH;
    if (process.env.AW_AGENT_B_PATH) agentPaths['agent-b'] = process.env.AW_AGENT_B_PATH;
    if (process.env.AW_AGENT_C_PATH) agentPaths['agent-c'] = process.env.AW_AGENT_C_PATH;

    // Apply agent path overrides
    if (Object.keys(agentPaths).length > 0) {
      envConfig.agents = this.config.agents.map((agent) => ({
        ...agent,
        path: agentPaths[agent.agentId] || agent.path,
      }));
    }

    // Merge environment config
    this.config = { ...this.config, ...envConfig };

    if (Object.keys(envConfig).length > 0) {
      log.debug('Environment configuration applied', { envConfig });
    }
  }

  /**
   * Apply CLI options with highest precedence
   */
  private applyCliOptions(options: {
    agentPaths?: Record<string, string>;
    baseDir?: string;
    integrationBranch?: string;
  }): void {
    const { agentPaths, baseDir, integrationBranch } = options;

    if (baseDir) {
      this.config.baseDir = baseDir;
    }

    if (integrationBranch) {
      this.config.integrationBranch = integrationBranch;
    }

    if (agentPaths && Object.keys(agentPaths).length > 0) {
      this.config.agents = this.config.agents.map((agent) => ({
        ...agent,
        path: agentPaths[agent.agentId] || agent.path,
      }));

      log.debug('CLI agent paths applied', { agentPaths });
    }
  }

  /**
   * Resolve relative paths to absolute paths
   */
  private resolveRelativePaths(): void {
    const baseDir = this.config.baseDir || this.startDir;

    this.config.agents = this.config.agents.map((agent) => ({
      ...agent,
      path: path.resolve(baseDir, agent.path),
    }));

    log.debug('Relative paths resolved', {
      baseDir,
      paths: this.config.agents.map((a) => ({ id: a.agentId, path: a.path })),
    });
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentWorkflowConfig {
    return this.config;
  }

  /**
   * Get configuration file path (if loaded from file)
   */
  getConfigPath(): string | undefined {
    return this.configPath;
  }
}

/**
 * Convenience function to load agent configuration
 */
export async function loadAgentConfig(
  options: {
    configPath?: string;
    agentPaths?: Record<string, string>;
    baseDir?: string;
    integrationBranch?: string;
    startDir?: string;
  } = {}
): Promise<AgentWorkflowConfig> {
  const loader = new AgentConfigLoader(options.startDir);
  return loader.load(options);
}
