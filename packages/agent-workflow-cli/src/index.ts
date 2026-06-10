/**
 * @actor-web/cli — terminal host for the actor-web runtime
 * (design doc: docs/actor-web-cli-runtime-host-design.md).
 *
 * v0 surface: an in-process runtime host (`actor-web serve <topology>`) with an
 * operator console (ls/spawn/send/ask/watch). The programmatic host API is
 * exported here so tests and embedders can drive it without a subprocess.
 *
 * @author Actor-Web Team
 */

// Runtime host (v0)
export {
  type CommandContext,
  type CommandOutcome,
  createRuntimeHost,
  createRuntimeHostFromFile,
  executeCommand,
  type HostActorEntry,
  type HostResult,
  type RuntimeHost,
} from './host/runtime-host.js';
export { type LoadModuleOptions, type LoadResult, loadModuleExport } from './host/load-module.js';

// Package metadata (ES module-compatible)
export {
  getDescriptionSync,
  getNameSync,
  getPackageInfo,
  getVersionSync,
  initializePackageInfo,
  type PackageInfo,
} from './package-info.js';

import { getPackageInfo } from './package-info.js';

/**
 * Get CLI package information asynchronously.
 */
export async function getCLIInfo() {
  const packageInfo = await getPackageInfo();
  return {
    name: packageInfo.name,
    description: packageInfo.description,
    version: packageInfo.version,
    status: 'v0-in-process-host',
    features: [
      'In-process runtime hosting from a topology module',
      'Operator console (REPL and --exec scripting)',
      'Dynamic actor spawn from behavior modules',
      'send/ask messaging and emitted-event watching',
    ] as const,
    commands: ['serve', 'info'] as const,
  } as const;
}
