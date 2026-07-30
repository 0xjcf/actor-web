/**
 * @actor-web/cli — terminal host for the actor-web runtime
 * (design doc: docs/actor-web-cli-runtime-host-design.md).
 *
 * Current surface: an operator host that can run in-process or as a
 * distributed runtime node (`actor-web serve <topology> --gateway --transport
 * --connect ...`). The programmatic host API is exported here so tests and
 * embedders can drive it without a subprocess.
 *
 * @author Actor-Web Team
 */

export { type LoadModuleOptions, type LoadResult, loadModuleExport } from './host/load-module.js';
// Runtime host
export {
  type CommandContext,
  type CommandOutcome,
  createRuntimeHost,
  createRuntimeHostFromFile,
  executeCommand,
  type HostActorEntry,
  type HostResult,
  type RuntimeHost,
  type RuntimeHostCheckpointOptions,
  type RuntimeHostDistributedOptions,
  type RuntimeHostRemoteOptions,
  type RuntimeHostReadinessStatus,
  type RuntimeHostStatus,
  splitExecScript,
} from './host/runtime-host.js';

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
    status: 'v2-distributed-runtime-host',
    features: [
      'In-process or distributed runtime hosting from a topology module',
      'Standalone remote gateway operator shells',
      'Localhost-safe gateway and transport listeners',
      'Explicit checkpoint dependency and readiness reporting',
      'Operator console (REPL and --exec scripting)',
      'Explicit host status with transport and directory readiness facts',
      'Dynamic actor spawn from behavior modules (in-process mode)',
      'send/ask messaging and emitted-event watching',
    ] as const,
    commands: ['serve', 'connect', 'info'] as const,
  } as const;
}
