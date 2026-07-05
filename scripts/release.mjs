#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, exit, stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

const args = process.argv.slice(2);
const hasFlag = (flag) => args.includes(flag);
const getOption = (name) => {
  const equalsValue = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsValue) {
    return equalsValue.slice(name.length + 1).trim() || undefined;
  }

  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    return undefined;
  }

  return value.trim() || undefined;
};

const dryRun = hasFlag('--dry-run');
const skipOtp = hasFlag('--skip-otp');
const otp = getOption('--otp');
const channel = getOption('--channel') ?? 'stable';

if (!['stable', 'beta'].includes(channel)) {
  console.error(`[release] Unsupported channel "${channel}". Use stable or beta.`);
  exit(1);
}

const npmCacheDir = mkdtempSync(join(tmpdir(), 'actor-web-release-npm-'));
const releaseEnv = { ...env, NPM_CONFIG_CACHE: env.NPM_CONFIG_CACHE ?? npmCacheDir };

const run = (command, options = {}) => {
  const { onError, ...execOptions } = options;
  console.log(`\n> ${command}`);
  try {
    execSync(command, { stdio: 'inherit', ...execOptions });
  } catch (error) {
    if (typeof onError === 'function') {
      onError(error);
    }
    throw error;
  }
};

const output = (command) =>
  execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

const ensureCleanWorkingTree = () => {
  const status = output('git status --porcelain');
  if (status) {
    console.error('[release] Working tree is not clean. Commit or stash changes before releasing.');
    exit(1);
  }
};

const ensureNpmAuth = () => {
  try {
    const username = output('npm whoami');
    console.log(`[release] Authenticated with npm as ${username}`);
  } catch {
    console.error('[release] Unable to determine npm user. Run `npm login` before releasing.');
    exit(1);
  }
};

const resolveOtp = async () => {
  if (skipOtp) {
    console.log('[release] Skipping OTP prompt (--skip-otp)');
    return undefined;
  }

  if (otp) {
    return otp;
  }

  if (env.NPM_CONFIG_OTP) {
    return env.NPM_CONFIG_OTP;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (
    await rl.question('[release] Enter npm one-time password (leave blank to skip): ')
  ).trim();
  await rl.close();
  return answer || undefined;
};

const shellQuote = (value) => JSON.stringify(value);

const readPreMode = (cwd = process.cwd()) => {
  const preFile = join(cwd, '.changeset/pre.json');
  if (!existsSync(preFile)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(preFile, 'utf8'));
  } catch {
    console.error('[release] Could not parse .changeset/pre.json.');
    exit(1);
  }
};

const ensureChannelState = () => {
  const preMode = readPreMode();

  if (channel === 'stable' && preMode) {
    console.error(
      '[release] Stable releases require no .changeset/pre.json. Exit pre-mode before publishing stable.'
    );
    exit(1);
  }

  if (channel === 'beta' && preMode?.tag !== 'beta') {
    console.error('[release] Beta releases require .changeset/pre.json with tag "beta".');
    exit(1);
  }
};

const getPendingChangesets = (cwd = process.cwd()) => {
  const dir = join(cwd, '.changeset');
  if (!existsSync(dir)) {
    return [];
  }

  const changesetFiles = readdirSync(dir).filter(
    (file) => file.endsWith('.md') && file !== 'README.md'
  );
  const preMode = readPreMode(cwd);
  const applied = preMode?.changesets ?? [];

  return changesetFiles.filter((file) => !applied.includes(file.replace(/\.md$/, '')));
};

const getReleasePlan = (cwd = process.cwd()) => {
  const out = join(cwd, '.release-plan.json');
  try {
    execSync(`pnpm changeset status --output=${out}`, { cwd, stdio: 'ignore' });
    const plan = JSON.parse(readFileSync(out, 'utf8'));
    return (plan.releases ?? []).filter((release) => release.type !== 'none');
  } catch (error) {
    console.warn(
      `[release] Could not compute planned versions: ${error instanceof Error ? error.message : error}`
    );
    return [];
  } finally {
    rmSync(out, { force: true });
  }
};

const printPlannedVersions = (releases = getReleasePlan()) => {
  if (releases.length === 0) {
    console.log('[release] No pending changesets; current package versions would publish as-is.');
    return;
  }

  console.log('\n[release] Planned version bumps:');
  for (const release of releases) {
    console.log(
      `  ${release.name}: ${release.oldVersion} -> ${release.newVersion} (${release.type})`
    );
  }
};

const runVerification = () => {
  run('pnpm test:all');
  run('pnpm build');
};

const versionAndCommit = (pendingChangesets) => {
  if (pendingChangesets.length === 0) {
    console.log('[release] No pending changesets; skipping `changeset version`.');
    return;
  }

  printPlannedVersions();
  run('pnpm changeset version');
  run('pnpm install --no-frozen-lockfile');
  run('git add package.json pnpm-lock.yaml .changeset packages');
  run('git commit -m "chore: version packages" --no-verify', { env: { ...env, HUSKY: '0' } });
};

const printVersionedPublishPlan = (cwd, releases) => {
  if (releases.length === 0) {
    return;
  }

  console.log('\n[release] Versioned dry-run packages:');
  const packagesDir = join(cwd, 'packages');
  const packageManifests = new Map(
    readdirSync(packagesDir).flatMap((entry) => {
      const packageJsonPath = join(packagesDir, entry, 'package.json');
      if (!existsSync(packageJsonPath)) {
        return [];
      }

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      return [[packageJson.name, packageJson]];
    })
  );

  for (const release of releases) {
    const packageJson = packageManifests.get(release.name);
    if (!packageJson) {
      console.log(`  ${release.name}@<manifest not found>`);
      continue;
    }

    console.log(`  ${packageJson.name}@${packageJson.version}`);
  }
};

const publishDryRun = (cwd = process.cwd()) => {
  const tag = channel === 'beta' && !readPreMode(cwd) ? ' --tag beta' : '';
  run(`pnpm -r publish --dry-run --no-git-checks${tag}`, { cwd, env: releaseEnv });
};

const publishVersionedDryRun = (releases, pendingChangesets) => {
  if (pendingChangesets.length === 0) {
    publishDryRun();
    return;
  }

  const worktreeParent = mkdtempSync(join(tmpdir(), 'actor-web-release-worktree-'));
  const worktreePath = join(worktreeParent, 'repo');

  try {
    console.log('\n[release] Creating temporary versioned worktree for dry-run tarball preview.');
    run(`git worktree add --detach ${shellQuote(worktreePath)} HEAD`);
    run('pnpm install --no-frozen-lockfile', { cwd: worktreePath, env: releaseEnv });
    run('pnpm changeset version', { cwd: worktreePath, env: { ...releaseEnv, HUSKY: '0' } });
    run('pnpm install --no-frozen-lockfile', { cwd: worktreePath, env: releaseEnv });
    printVersionedPublishPlan(worktreePath, releases);
    run('pnpm build', { cwd: worktreePath, env: releaseEnv });
    publishDryRun(worktreePath);
  } finally {
    try {
      run(`git worktree remove --force ${shellQuote(worktreePath)}`);
      rmSync(worktreeParent, { force: true, recursive: true });
    } catch {
      rmSync(worktreeParent, { force: true, recursive: true });
    }
  }
};

const publish = async () => {
  const resolvedOtp = await resolveOtp();
  const publishEnv = { ...releaseEnv };

  if (resolvedOtp) {
    publishEnv.NPM_CONFIG_OTP = resolvedOtp;
    console.log('[release] Using provided OTP for npm publish.');
  }

  run('pnpm changeset publish', { env: publishEnv });
};

const main = async () => {
  env.HUSKY = '0';

  ensureChannelState();
  ensureCleanWorkingTree();

  if (!dryRun) {
    ensureNpmAuth();
  }

  try {
    run('pnpm changeset status');
  } catch {
    console.warn(
      '[release] `changeset status` did not find pending changesets; continuing for already-versioned packages.'
    );
  }

  runVerification();

  const pendingChangesets = getPendingChangesets();
  const releases = getReleasePlan();

  if (dryRun) {
    console.log('\n[release] Dry run: not versioning, committing, or publishing.');
    printPlannedVersions(releases);
    publishVersionedDryRun(releases, pendingChangesets);
    console.log('\n[release] Dry run complete. No files were changed and nothing was published.');
    return;
  }

  versionAndCommit(pendingChangesets);
  run('pnpm build');
  publishDryRun();
  await publish();

  console.log(
    '\n[release] Publish complete. Push the release commit and tags with `git push --follow-tags`.'
  );
};

main()
  .catch((error) => {
    console.error('\n[release] Release script failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(npmCacheDir, { force: true, recursive: true });
  });
