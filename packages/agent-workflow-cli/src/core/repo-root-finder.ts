import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@actor-core/runtime';

const log = Logger.namespace('REPO_ROOT_FINDER');

/**
 * Options for finding repository root
 */
export interface RepoRootFinderOptions {
  /** Starting directory for search (defaults to process.cwd()) */
  startDir?: string;
  /** Explicit root path override */
  explicitRoot?: string;
  /** Environment variable to check for root override */
  envVar?: string;
  /** Maximum levels to search upward */
  maxLevels?: number;
}

/**
 * Indicators that suggest we've found the repository root
 */
const ROOT_INDICATORS = [
  '.git', // Git repository
  'pnpm-workspace.yaml', // PNPM monorepo
  'yarn.lock', // Yarn workspace
  'lerna.json', // Lerna monorepo
  'nx.json', // Nx monorepo
  'rush.json', // Rush monorepo
] as const;

/**
 * Secondary indicators (package.json with specific characteristics)
 */
const PACKAGE_JSON_INDICATORS = [
  'workspaces', // npm/yarn workspaces
  'pnpm', // pnpm configuration
] as const;

/**
 * Dynamically finds the repository root using multiple strategies
 */
export class RepoRootFinder {
  private options: Required<RepoRootFinderOptions>;

  constructor(options: RepoRootFinderOptions = {}) {
    this.options = {
      startDir: options.startDir || process.cwd(),
      explicitRoot: options.explicitRoot || '',
      envVar: options.envVar || 'ACTOR_WEB_REPO_ROOT',
      maxLevels: options.maxLevels || 20,
    };
  }

  /**
   * Find the repository root using multiple strategies
   */
  async findRoot(): Promise<string> {
    log.debug('Starting repository root discovery', {
      startDir: this.options.startDir,
      envVar: this.options.envVar,
      maxLevels: this.options.maxLevels,
    });

    // Strategy 1: Explicit root override
    if (this.options.explicitRoot) {
      const explicitPath = path.resolve(this.options.explicitRoot);
      if (await this.isValidRoot(explicitPath)) {
        log.debug('Using explicit root override', { path: explicitPath });
        return explicitPath;
      }
      log.warn('Explicit root override invalid, falling back to search', {
        explicitRoot: explicitPath,
      });
    }

    // Strategy 2: Environment variable override
    const envRoot = process.env[this.options.envVar];
    if (envRoot) {
      const envPath = path.resolve(envRoot);
      if (await this.isValidRoot(envPath)) {
        log.debug('Using environment variable root', {
          envVar: this.options.envVar,
          path: envPath,
        });
        return envPath;
      }
      log.warn('Environment variable root invalid, falling back to search', {
        envVar: this.options.envVar,
        envRoot: envPath,
      });
    }

    // Strategy 3: Search upwards for root indicators
    const searchResult = await this.searchUpwards();
    if (searchResult) {
      log.debug('Found repository root via upward search', { path: searchResult });
      return searchResult;
    }

    // Strategy 4: Fallback to current directory
    log.warn('Could not find repository root, falling back to current directory', {
      fallback: this.options.startDir,
    });
    return this.options.startDir;
  }

  /**
   * Search upwards from starting directory for repository root indicators
   */
  private async searchUpwards(): Promise<string | null> {
    let currentDir = path.resolve(this.options.startDir);
    let levelsSearched = 0;

    while (levelsSearched < this.options.maxLevels) {
      log.debug('Searching directory for root indicators', {
        currentDir,
        level: levelsSearched,
      });

      // Check for primary root indicators
      for (const indicator of ROOT_INDICATORS) {
        const indicatorPath = path.join(currentDir, indicator);
        if (await this.pathExists(indicatorPath)) {
          log.debug('Found root indicator', { indicator, path: currentDir });
          return currentDir;
        }
      }

      // Check for package.json with workspace indicators
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (await this.pathExists(packageJsonPath)) {
        const hasWorkspaceIndicator = await this.hasWorkspaceIndicators(packageJsonPath);
        if (hasWorkspaceIndicator) {
          log.debug('Found package.json with workspace indicators', { path: currentDir });
          return currentDir;
        }
      }

      // Move up one level
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        // Reached filesystem root
        log.debug('Reached filesystem root, stopping search');
        break;
      }

      currentDir = parentDir;
      levelsSearched++;
    }

    log.debug('Upward search completed without finding root', { levelsSearched });
    return null;
  }

  /**
   * Check if a path exists
   */
  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if package.json has workspace indicators
   */
  private async hasWorkspaceIndicators(packageJsonPath: string): Promise<boolean> {
    try {
      const content = await fs.promises.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(content);

      for (const indicator of PACKAGE_JSON_INDICATORS) {
        if (packageJson[indicator]) {
          log.debug('Found workspace indicator in package.json', {
            indicator,
            path: packageJsonPath,
          });
          return true;
        }
      }

      return false;
    } catch (error) {
      log.debug('Error reading package.json', { path: packageJsonPath, error });
      return false;
    }
  }

  /**
   * Validate that a path is a valid repository root
   */
  private async isValidRoot(rootPath: string): Promise<boolean> {
    try {
      // Check if path exists and is a directory
      const stats = await fs.promises.stat(rootPath);
      if (!stats.isDirectory()) {
        return false;
      }

      // Check for at least one root indicator
      for (const indicator of ROOT_INDICATORS) {
        const indicatorPath = path.join(rootPath, indicator);
        if (await this.pathExists(indicatorPath)) {
          return true;
        }
      }

      // Check for package.json with workspace indicators
      const packageJsonPath = path.join(rootPath, 'package.json');
      if (await this.pathExists(packageJsonPath)) {
        return await this.hasWorkspaceIndicators(packageJsonPath);
      }

      return false;
    } catch {
      return false;
    }
  }
}

/**
 * Convenience function to find repository root with default options
 */
export async function findRepoRoot(options: RepoRootFinderOptions = {}): Promise<string> {
  const finder = new RepoRootFinder(options);
  return await finder.findRoot();
}

/**
 * Convenience function to find repository root with CLI option support
 */
export async function findRepoRootWithOptions(cliOptions: {
  root?: string;
  cwd?: string;
}): Promise<string> {
  return await findRepoRoot({
    startDir: cliOptions.cwd || process.cwd(),
    explicitRoot: cliOptions.root,
  });
}
