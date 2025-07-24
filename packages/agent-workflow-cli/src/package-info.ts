import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Get current file directory in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Interface for package.json structure
 */
export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  bin?: Record<string, string>;
  keywords?: string[];
}

/**
 * Cached package info to avoid re-reading file
 */
let cachedPackageInfo: PackageInfo | null = null;

/**
 * Load package.json asynchronously using ES module file system access
 */
export async function loadPackageInfo(): Promise<PackageInfo> {
  try {
    const packagePath = resolve(__dirname, '../package.json');
    const packageText = await readFile(packagePath, 'utf-8');
    const packageData = JSON.parse(packageText) as PackageInfo;

    // Validate required fields
    if (!packageData.name || !packageData.version || !packageData.description) {
      throw new Error('Invalid package.json: missing required fields (name, version, description)');
    }

    return packageData;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load package.json: ${error.message}`);
    }
    throw new Error('Failed to load package.json: Unknown error');
  }
}

/**
 * Get package info with caching for performance
 */
export async function getPackageInfo(): Promise<PackageInfo> {
  if (!cachedPackageInfo) {
    cachedPackageInfo = await loadPackageInfo();
  }
  return cachedPackageInfo;
}

/**
 * Get version synchronously (requires package info to be loaded first)
 * This provides compatibility for synchronous version access
 */
export function getVersionSync(): string {
  if (!cachedPackageInfo) {
    throw new Error(
      'Package info not loaded. Call getPackageInfo() first during application startup.'
    );
  }
  return cachedPackageInfo.version;
}

/**
 * Get package name synchronously (requires package info to be loaded first)
 */
export function getNameSync(): string {
  if (!cachedPackageInfo) {
    throw new Error(
      'Package info not loaded. Call getPackageInfo() first during application startup.'
    );
  }
  return cachedPackageInfo.name;
}

/**
 * Get package description synchronously (requires package info to be loaded first)
 */
export function getDescriptionSync(): string {
  if (!cachedPackageInfo) {
    throw new Error(
      'Package info not loaded. Call getPackageInfo() first during application startup.'
    );
  }
  return cachedPackageInfo.description;
}

/**
 * Clear cached package info (useful for testing)
 */
export function clearPackageInfoCache(): void {
  cachedPackageInfo = null;
}

/**
 * Initialize package info cache (call during application startup)
 */
export async function initializePackageInfo(): Promise<PackageInfo> {
  const packageInfo = await getPackageInfo();
  return packageInfo;
}
