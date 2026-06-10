/**
 * @actor-web/cli — actor-web runtime host CLI (work in progress)
 *
 * The previous git-workflow surface (`aw` save/ship/sync/worktrees/agent
 * coordination) has been removed: it duplicated FAS (the control plane) and
 * plain git, and was built on an immature, stubbed "git actor".
 *
 * This package is being reconceived as a terminal host for the actor-web
 * runtime (serve/spawn/send/watch). See
 * `docs/actor-web-cli-runtime-host-design.md`. Until that v0 lands, the package
 * is an intentional stub and exposes only package metadata.
 *
 * @author Actor-Web Team
 */

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
    status: 'work-in-progress',
    features: [] as const,
    commands: [] as const,
  } as const;
}
