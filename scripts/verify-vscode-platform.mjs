import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
} from '@vscode/test-electron';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const fixtureId = 'personas-tests.personas-hello-fixture';
const fixtureVersion = '0.0.1';
const profileNames = {
  control: 'Personas Runtime Control',
  target: 'Personas Runtime Target',
  nested: 'Personas Runtime Nested',
};
const nestedLocation = 'nested/profile-target';
const phaseTimeoutMs = 90_000;
const activeProcessGroups = new Set();

const platform = process.platform;
if (platform !== 'linux' && platform !== 'darwin') {
  console.error('Issue #168 runtime verification is supported only on Linux and macOS.');
  process.exit(2);
}

const target = platform === 'linux' ? 'linux-x64' : 'darwin-arm64';
const expectedNodeArch = platform === 'linux' ? 'x64' : 'arm64';
const expectedFolder = `${fixtureId}-${fixtureVersion}-${target}`;
const probeTempBase = platform === 'darwin' ? '/tmp' : tmpdir();
const outputPath = path.resolve(
  process.env.PERSONAS_RUNTIME_EVIDENCE || path.join(repoRoot, '.runtime-evidence', `${target}.json`),
);

const evidence = {
  schemaVersion: 1,
  issue: 168,
  status: 'running',
  startedAt: new Date().toISOString(),
  implementationHead: gitHead(),
  platform: {
    nodePlatform: platform,
    nodeArch: process.arch,
    target,
  },
  fixture: { id: fixtureId, version: fixtureVersion, expectedFolder },
  ci: githubMetadata(),
  phases: [],
  commands: [],
  workbenchFailures: [],
  defaultPaths: {},
  liveProfiles: {},
  nestedProfile: {},
  obsolete: {},
  portable: {},
  cleanup: { attempted: false, rootRemoved: false },
};

let probeRoot;
let activePhase = 'initialization';
let failure;

try {
  assert.equal(process.arch, expectedNodeArch, `runner Node architecture must be ${expectedNodeArch}`);
  probeRoot = createOwnedRoot();
  await runProbe();
  evidence.status = 'passed';
} catch (error) {
  failure = error instanceof Error ? error : new Error(String(error));
  evidence.status = 'failed';
  evidence.failure = { phase: activePhase, message: sanitize(failure.message), stack: sanitize(failure.stack || '') };
  process.exitCode = 1;
} finally {
  if (probeRoot) {
    evidence.cleanup.attempted = true;
    try {
      removeOwnedRoot(probeRoot);
      evidence.cleanup.rootRemoved = !existsSync(probeRoot);
    } catch (cleanupError) {
      evidence.cleanup.error = sanitize(String(cleanupError));
      evidence.status = 'failed';
      process.exitCode = 1;
    }
  }
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`Issue #168 evidence: ${outputPath}`);
  if (failure) console.error(failure);
}

async function runProbe() {
  setPhase('resolve-owned-distribution');
  const ownedExecutable = await downloadAndUnzipVSCode({
    version: 'stable',
    platform: target,
    cachePath: path.join(probeRoot, 'vscode-cache'),
  });
  const ownedDistribution = distributionRoot(ownedExecutable);
  assert.ok(existsSync(ownedExecutable), 'owned VS Code executable is missing');
  assert.ok((statSync(ownedExecutable).mode & 0o111) !== 0, 'owned VS Code executable is not executable');
  const cliPath = resolveCliPathFromVSCodeExecutablePath(ownedExecutable, target);
  assert.ok(existsSync(cliPath), 'owned VS Code CLI launcher is missing');

  const defaultHome = makeHome('default-home');
  const defaultEnv = isolatedEnv(defaultHome);
  const version = runCli('owned-code-version', cliPath, ['--version'], defaultEnv);
  const versionInfo = parseCodeVersion(version.stdout);
  assert.equal(versionInfo.arch, expectedNodeArch, 'VS Code binary architecture does not match runner');
  evidence.platform.vscode = versionInfo;
  evidence.platform.ownedDistributionValidated = true;

  setPhase('package-target-vsix');
  const vsixPath = path.join(probeRoot, `personas-hello-fixture-${target}.vsix`);
  const vscePath = path.join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
  runCommand('package-target-vsix', process.execPath, [
    vscePath,
    'package',
    '--allow-missing-repository',
    '--target', target,
    '--out', vsixPath,
  ], { cwd: path.join(repoRoot, 'test', 'fixtures', 'hello-ext'), env: isolatedEnv(defaultHome) });
  assert.ok(existsSync(vsixPath), 'target-specific fixture VSIX was not created');

  const defaultLayout = layoutForHome(defaultHome);
  const defaultWorkspace = path.join(probeRoot, 'workspace-default');
  mkdirSync(defaultWorkspace);

  setPhase('default-user-data-and-profile-resolution');
  await launchWorkbenchUntil(
    'materialize-default-user-data',
    ownedExecutable,
    workbenchArgs(defaultWorkspace),
    defaultEnv,
    () => existsAndParses(defaultLayout.storageJson),
  );
  const storageBeforeSeed = readJson(defaultLayout.storageJson);
  const profilesBeforeSeed = profileRegistry(storageBeforeSeed);
  assert.ok(!profilesBeforeSeed.some((profile) => Object.values(profileNames).includes(profile.name)), 'probe profile already exists');
  const seededProfiles = [
    ...profilesBeforeSeed,
    { location: 'profile-control', name: profileNames.control },
    { location: 'profile-target', name: profileNames.target },
  ];
  storageBeforeSeed.userDataProfiles = seededProfiles;
  writeFileSync(defaultLayout.storageJson, `${JSON.stringify(storageBeforeSeed, null, 2)}\n`);
  const controlWorkspace = path.join(probeRoot, 'workspace-control');
  const targetWorkspace = path.join(probeRoot, 'workspace-target');
  mkdirSync(controlWorkspace);
  mkdirSync(targetWorkspace);
  const controlAssociation = await validateProfileInWorkbench(
    ownedExecutable,
    defaultEnv,
    controlWorkspace,
    defaultLayout.storageJson,
    profileNames.control,
    'profile-control',
    seededProfiles,
  );
  const targetAssociation = await validateProfileInWorkbench(
    ownedExecutable,
    defaultEnv,
    targetWorkspace,
    defaultLayout.storageJson,
    profileNames.target,
    'profile-target',
    seededProfiles,
  );
  const profiles = profileRegistry(readJson(defaultLayout.storageJson));
  const control = exactlyOneProfile(profiles, profileNames.control);
  const liveTarget = exactlyOneProfile(profiles, profileNames.target);
  assert.notEqual(control.location, liveTarget.location, 'VS Code generated duplicate profile locations');
  assert.ok(existsSync(defaultLayout.storageJson), 'default storage.json was not materialized');
  assert.equal(path.normalize(defaultLayout.storageJson), path.join(defaultLayout.userData, 'User', 'globalStorage', 'storage.json'));
  evidence.defaultPaths = {
    userDataRoot: relativeToHome(defaultHome, defaultLayout.userData),
    storageJson: relativeToHome(defaultHome, defaultLayout.storageJson),
    extensionsRoot: relativeToHome(defaultHome, defaultLayout.extensions),
    noUserDataOverride: true,
    noExtensionsOverride: true,
  };
  evidence.liveProfiles = {
    profileProvisioning: 'fixture-seeded in disposable storage.json',
    automaticProfileCreationClaimed: false,
    workbenchResolutionVerified: true,
    registryBeforeSeed: profilesBeforeSeed,
    registryAfterWorkbenchResolution: profiles,
    associations: [controlAssociation, targetAssociation],
    profiles: [
    { name: control.name, location: control.location },
    { name: liveTarget.name, location: liveTarget.location },
    ],
  };

  setPhase('live-named-profile-isolation');
  const liveManifestPaths = {
    control: profileManifestPath(defaultLayout.userData, control.location),
    target: profileManifestPath(defaultLayout.userData, liveTarget.location),
  };
  const liveBefore = snapshotNamedProfiles(cliPath, defaultEnv, defaultLayout, control, liveTarget, liveManifestPaths);
  runCli('install-live-target', cliPath, [
    '--profile', profileNames.target,
    '--install-extension', vsixPath,
    '--force',
  ], defaultEnv);
  const liveInstalled = snapshotNamedProfiles(cliPath, defaultEnv, defaultLayout, control, liveTarget, liveManifestPaths);
  assertUnchanged(liveBefore.default, liveInstalled.default, 'Default changed during named-profile install');
  assertUnchanged(liveBefore.control, liveInstalled.control, 'control profile changed during target install');
  assertFixtureAbsent(liveInstalled.default);
  assertFixtureAbsent(liveInstalled.control);
  assertFixturePresent(liveInstalled.target);
  assertOnlyFixtureDelta(liveBefore.target, liveInstalled.target, 'target install');
  const livePhysicalFolders = assertTargetFolder(defaultLayout.extensions, liveInstalled.target.manifest);

  runCli('uninstall-live-target', cliPath, [
    '--profile', profileNames.target,
    '--uninstall-extension', fixtureId,
  ], defaultEnv);
  const liveUninstalled = snapshotNamedProfiles(cliPath, defaultEnv, defaultLayout, control, liveTarget, liveManifestPaths);
  assertUnchanged(liveBefore.default, liveUninstalled.default, 'Default changed during named-profile uninstall');
  assertUnchanged(liveBefore.control, liveUninstalled.control, 'control profile changed during target uninstall');
  assertFixtureAbsent(liveUninstalled.target);
  assertOnlyFixtureDelta(liveBefore.target, liveUninstalled.target, 'target uninstall');
  evidence.liveProfiles.snapshots = {
    before: liveBefore,
    afterInstall: liveInstalled,
    afterUninstall: liveUninstalled,
  };
  evidence.liveProfiles.physicalFoldersAfterInstall = livePhysicalFolders;
  evidence.obsolete.afterLiveUninstall = captureObsolete(defaultLayout.obsolete, defaultLayout.extensions);

  setPhase('nested-profile-fixture');
  const nestedStorage = readJson(defaultLayout.storageJson);
  const currentProfiles = profileRegistry(nestedStorage);
  assert.ok(!currentProfiles.some((profile) => profile.name === profileNames.nested), 'nested fixture profile already exists');
  nestedStorage.userDataProfiles = [
    ...currentProfiles,
    { location: nestedLocation, name: profileNames.nested },
  ];
  writeFileSync(defaultLayout.storageJson, `${JSON.stringify(nestedStorage, null, 2)}\n`);
  const nestedManifest = profileManifestPath(defaultLayout.userData, nestedLocation);
  const controlsBeforeNested = snapshotControls(cliPath, defaultEnv, defaultLayout, control, liveTarget, liveManifestPaths);
  const nestedBefore = snapshotProfile(cliPath, defaultEnv, profileNames.nested, nestedManifest);
  runCli('install-nested-profile', cliPath, [
    '--profile', profileNames.nested,
    '--install-extension', vsixPath,
    '--force',
  ], defaultEnv);
  const nestedInstalled = snapshotProfile(cliPath, defaultEnv, profileNames.nested, nestedManifest);
  assertFixturePresent(nestedInstalled);
  const nestedPhysicalFolders = assertTargetFolder(defaultLayout.extensions, nestedInstalled.manifest);
  assert.ok(existsSync(nestedManifest), 'slash-containing profile manifest was not created');
  const controlsAfterNested = snapshotControls(cliPath, defaultEnv, defaultLayout, control, liveTarget, liveManifestPaths);
  assertUnchanged(controlsBeforeNested, controlsAfterNested, 'nested fixture install leaked into a control profile');
  runCli('uninstall-nested-profile', cliPath, [
    '--profile', profileNames.nested,
    '--uninstall-extension', fixtureId,
  ], defaultEnv);
  const nestedUninstalled = snapshotProfile(cliPath, defaultEnv, profileNames.nested, nestedManifest);
  assertFixtureAbsent(nestedUninstalled);
  assertOnlyFixtureDelta(nestedBefore, nestedUninstalled, 'nested profile uninstall');
  evidence.nestedProfile = {
    evidenceType: 'fixture-backed registry plus live CLI/filesystem',
    location: nestedLocation,
    manifestSuffix: path.posix.join('User', 'profiles', nestedLocation, 'extensions.json'),
    before: nestedBefore,
    afterInstall: nestedInstalled,
    afterUninstall: nestedUninstalled,
    physicalFoldersAfterInstall: nestedPhysicalFolders,
    controlsUnchanged: true,
  };
  evidence.obsolete.afterNestedUninstall = captureObsolete(defaultLayout.obsolete, defaultLayout.extensions);

  setPhase('exact-build-obsolete-source');
  evidence.obsolete.source = await inspectObsoleteSource(versionInfo.commit);

  setPhase('true-portable-mode');
  const portableHome = makeHome('portable-home');
  const portableEnv = isolatedEnv(portableHome);
  const portableLayout = createPortableLayout(ownedDistribution, ownedExecutable);
  const portableWorkspace = path.join(probeRoot, 'portable-workspace');
  mkdirSync(portableWorkspace);
  await launchWorkbenchUntil(
    'portable-workbench',
    ownedExecutable,
    workbenchArgs(portableWorkspace),
    portableEnv,
    () => existsAndParses(portableLayout.storageJson),
  );
  assert.ok(existsSync(portableLayout.storageJson), 'portable workbench did not create storage.json');
  const portableBefore = snapshotProfile(cliPath, portableEnv, undefined, portableLayout.globalManifest);
  runCli('install-portable-default', cliPath, ['--install-extension', vsixPath, '--force'], portableEnv);
  const portableInstalled = snapshotProfile(cliPath, portableEnv, undefined, portableLayout.globalManifest);
  assertFixturePresent(portableInstalled);
  const portablePhysicalFolders = assertTargetFolder(portableLayout.extensions, portableInstalled.manifest);
  assertDefaultHomeDidNotReceiveFixture(portableHome);
  runCli('uninstall-portable-default', cliPath, ['--uninstall-extension', fixtureId], portableEnv);
  const portableUninstalled = snapshotProfile(cliPath, portableEnv, undefined, portableLayout.globalManifest);
  assertFixtureAbsent(portableUninstalled);
  evidence.portable = {
    marker: portableLayout.markerDescription,
    userDataRoot: portableLayout.userDataRelative,
    storageJson: portableLayout.storageRelative,
    extensionsRoot: portableLayout.extensionsRelative,
    noPathOverrides: true,
    defaultHomeFixtureStateUntouched: true,
    before: portableBefore,
    afterInstall: portableInstalled,
    afterUninstall: portableUninstalled,
    physicalFoldersAfterInstall: portablePhysicalFolders,
  };
  if (platform === 'darwin') evidence.portable.macosSiblingRealpathVerified = true;
}

function setPhase(name) {
  activePhase = name;
  evidence.phases.push({ name, startedAt: new Date().toISOString() });
  console.log(`\n[issue-168] ${name}`);
}

function createOwnedRoot() {
  const root = mkdtempSync(path.join(probeTempBase, 'p168-'));
  writeFileSync(path.join(root, '.personas-runtime-probe'), 'issue=168\n', { mode: 0o600 });
  return root;
}

function removeOwnedRoot(root) {
  assert.equal(activeProcessGroups.size, 0, `refusing to remove probe root with active process groups: ${[...activeProcessGroups].join(', ')}`);
  const resolvedRoot = realpathSync(root);
  const resolvedTemp = realpathSync(probeTempBase);
  assert.equal(path.dirname(resolvedRoot), resolvedTemp, 'probe root is not a direct child of the temp directory');
  assert.ok(path.basename(resolvedRoot).startsWith('p168-'), 'probe root prefix mismatch');
  assert.ok(existsSync(path.join(resolvedRoot, '.personas-runtime-probe')), 'probe ownership sentinel is missing');
  rmSync(resolvedRoot, { recursive: true, force: false, maxRetries: 3, retryDelay: 250 });
}

function distributionRoot(executable) {
  if (platform === 'linux') return path.dirname(executable);
  let current = path.dirname(executable);
  while (current !== path.dirname(current) && !current.endsWith('.app')) current = path.dirname(current);
  assert.ok(current.endsWith('.app'), `cannot locate macOS app bundle from ${executable}`);
  return path.dirname(current);
}

function makeHome(name) {
  const home = path.join(probeRoot, name);
  mkdirSync(home);
  mkdirSync(path.join(home, 'tmp'));
  const runtime = path.join(home, 'runtime');
  mkdirSync(runtime, { mode: 0o700 });
  return home;
}

function isolatedEnv(home) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'XDG_CONFIG_HOME' || key.startsWith('VSCODE_')) delete env[key];
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env.XDG_RUNTIME_DIR = path.join(home, 'runtime');
  env.TMPDIR = path.join(home, 'tmp');
  env.TMP = path.join(home, 'tmp');
  env.TEMP = path.join(home, 'tmp');
  env.DO_NOT_TRACK = '1';
  return env;
}

function layoutForHome(home) {
  const userData = platform === 'linux'
    ? path.join(home, '.config', 'Code')
    : path.join(home, 'Library', 'Application Support', 'Code');
  const extensions = path.join(home, '.vscode', 'extensions');
  return {
    userData,
    storageJson: path.join(userData, 'User', 'globalStorage', 'storage.json'),
    extensions,
    globalManifest: path.join(extensions, 'extensions.json'),
    obsolete: path.join(extensions, '.obsolete'),
  };
}

function workbenchArgs(workspace, profileName) {
  return [
    ...(profileName ? ['--profile', profileName] : []),
    ...(platform === 'linux' ? ['--no-sandbox'] : []),
    '--new-window',
    workspace,
    '--disable-extensions',
    '--disable-gpu',
    '--disable-updates',
    '--disable-workspace-trust',
    '--skip-release-notes',
    '--skip-welcome',
  ];
}

async function validateProfileInWorkbench(
  executable,
  env,
  workspace,
  storageJson,
  profileName,
  expectedLocation,
  expectedProfiles,
) {
  assert.equal(associationForWorkspace(readJson(storageJson), workspace), undefined, `${profileName} association existed before launch`);
  await launchWorkbenchUntil(
    `resolve-profile-${profileName}`,
    executable,
    workbenchArgs(workspace, profileName),
    env,
    () => {
      if (!existsAndParses(storageJson)) return false;
      return associationForWorkspace(readJson(storageJson), workspace)?.location === expectedLocation;
    },
  );
  const storage = readJson(storageJson);
  assert.deepEqual(profileRegistry(storage), expectedProfiles, `${profileName} launch changed the seeded profile registry`);
  const association = associationForWorkspace(storage, workspace);
  assert.equal(association?.location, expectedLocation, `${profileName} did not resolve to its seeded location`);
  return {
    name: profileName,
    location: expectedLocation,
    observedWorkspaceUri: sanitize(association.observedUri),
    normalizedWorkspaceUri: sanitize(association.normalizedUri),
  };
}

async function launchWorkbenchUntil(label, executable, args, env, predicate) {
  const stdoutPath = path.join(probeRoot, `${safeName(label)}.stdout.log`);
  const stderrPath = path.join(probeRoot, `${safeName(label)}.stderr.log`);
  const stdoutFd = openSync(stdoutPath, 'w', 0o600);
  const stderrFd = openSync(stderrPath, 'w', 0o600);
  let child;
  let pendingError;
  try {
    child = spawn(executable, args, {
      cwd: probeRoot,
      env,
      detached: true,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
    assert.ok(child.pid, `${label} did not return a pid`);
    const unverifiedGroup = `unverified:${child.pid}`;
    activeProcessGroups.add(unverifiedGroup);
    const pgid = processGroupId(child.pid);
    assert.equal(pgid, child.pid, `${label} child is not its process-group leader`);
    activeProcessGroups.delete(unverifiedGroup);
    activeProcessGroups.add(pgid);
    evidence.commands.push({ label, executable: 'owned-workbench', args: args.map(sanitize), processGroup: 'owned' });
    await waitFor(predicate, phaseTimeoutMs, `${label} did not produce expected state`, child);
    await terminateOwnedProcessGroup(child, pgid, label);
  } catch (error) {
    pendingError = error;
  } finally {
    if (child?.pid) {
      try {
        if (processGroupMembers(child.pid).length > 0) {
          await terminateOwnedProcessGroup(child, child.pid, `${label}-finally`);
        } else {
          activeProcessGroups.delete(child.pid);
        }
      } catch (cleanupError) {
        evidence.cleanup.processGroupError = sanitize(String(cleanupError));
        pendingError = pendingError
          ? new AggregateError([pendingError, cleanupError], `${label} failed and its process group could not be cleaned up`)
          : cleanupError;
      }
    }
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  if (pendingError) {
    evidence.workbenchFailures.push({
      label,
      stdoutTail: readLogTail(stdoutPath),
      stderrTail: readLogTail(stderrPath),
    });
  }
  if (pendingError) throw pendingError;
}

function processGroupId(pid) {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  assert.equal(result.status, 0, `cannot inspect process group for pid ${pid}`);
  const pgid = Number(result.stdout.trim());
  assert.ok(Number.isInteger(pgid) && pgid > 0, `invalid process group for pid ${pid}`);
  return pgid;
}

function processGroupMembers(pgid) {
  const result = spawnSync('ps', ['-eo', 'pid=,pgid='], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `cannot inspect members of process group ${pgid}: ${result.stderr.trim()}`);
  return result.stdout.split(/\r?\n/).flatMap((line) => {
    const [pidText, groupText] = line.trim().split(/\s+/);
    return Number(groupText) === pgid ? [Number(pidText)] : [];
  }).filter(Number.isInteger);
}

async function terminateOwnedProcessGroup(child, pgid, label) {
  assert.equal(pgid, child.pid, `${label} process-group ownership changed`);
  if (processGroupMembers(pgid).length > 0) {
    try { process.kill(-pgid, 'SIGTERM'); } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
    const stopped = await waitForValue(() => processGroupMembers(pgid).length === 0, 10_000);
    if (!stopped) {
      process.kill(-pgid, 'SIGKILL');
      assert.ok(await waitForValue(() => processGroupMembers(pgid).length === 0, 10_000), `${label} process group survived SIGKILL`);
    }
  }
  assert.ok(
    await waitForValue(() => child.exitCode !== null || child.signalCode !== null, 5_000),
    `${label} group stopped but its leader did not report exit`,
  );
  activeProcessGroups.delete(pgid);
}

async function waitFor(predicate, timeoutMs, message, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    if (child.exitCode !== null) throw new Error(`${message}; workbench exited with ${child.exitCode}`);
    await delay(250);
  }
  throw new Error(message);
}

async function waitForValue(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await delay(100);
  }
  return predicate();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCli(label, cliPath, args, env) {
  return runCommand(label, cliPath, args, { env, cwd: probeRoot });
}

function runCommand(label, executable, args, options) {
  const result = spawnSync(executable, args, {
    ...options,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  evidence.commands.push({
    label,
    executable: sanitize(executable),
    args: args.map(sanitize),
    exitCode: result.status,
    stdout: sanitize(result.stdout || ''),
    stderr: sanitize(result.stderr || ''),
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} failed: ${(result.stderr || result.stdout || '').trim()}`);
  return result;
}

function parseCodeVersion(stdout) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const version = lines.find((line) => /^\d+\.\d+\.\d+/.test(line));
  const commit = lines.find((line) => /^[0-9a-f]{40}$/i.test(line));
  const arch = lines.find((line) => ['x64', 'arm64', 'armhf'].includes(line));
  assert.ok(version && commit && arch, `unexpected code --version output: ${stdout}`);
  return { version, commit, arch };
}

function snapshotNamedProfiles(cliPath, env, layout, control, targetProfile, manifests) {
  return {
    default: snapshotProfile(cliPath, env, undefined, layout.globalManifest),
    control: snapshotProfile(cliPath, env, control.name, manifests.control),
    target: snapshotProfile(cliPath, env, targetProfile.name, manifests.target),
  };
}

function snapshotControls(cliPath, env, layout, control, targetProfile, manifests) {
  return snapshotNamedProfiles(cliPath, env, layout, control, targetProfile, manifests);
}

function snapshotProfile(cliPath, env, profileName, manifestPath) {
  const args = [...(profileName ? ['--profile', profileName] : []), '--list-extensions', '--show-versions'];
  const listed = runCli(`list-${profileName || 'Default'}`, cliPath, args, env).stdout
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter((line) => /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*@/.test(line))
    .sort();
  return { cli: listed, manifest: readManifest(manifestPath) };
}

function readManifest(file) {
  if (!existsSync(file)) return [];
  const root = readJson(file);
  assert.ok(Array.isArray(root), `${file} is not a manifest array`);
  return root.flatMap((entry) => {
    const id = entry?.identifier?.id;
    if (typeof id !== 'string' || typeof entry?.version !== 'string') return [];
    return [{
      id: id.toLowerCase(),
      version: entry.version,
      ...(typeof entry.relativeLocation === 'string' ? { relativeLocation: entry.relativeLocation } : {}),
    }];
  }).sort((a, b) => `${a.id}@${a.version}`.localeCompare(`${b.id}@${b.version}`));
}

function assertFixturePresent(snapshot) {
  assert.ok(snapshot.cli.includes(`${fixtureId}@${fixtureVersion}`), 'fixture is missing from CLI listing');
  const entry = snapshot.manifest.find((item) => item.id === fixtureId);
  assert.ok(entry, 'fixture is missing from manifest');
  assert.equal(entry.version, fixtureVersion);
  assert.equal(entry.relativeLocation, expectedFolder);
}

function assertFixtureAbsent(snapshot) {
  assert.ok(!snapshot.cli.some((line) => line.startsWith(`${fixtureId}@`)), 'fixture leaked into CLI listing');
  assert.ok(!snapshot.manifest.some((item) => item.id === fixtureId), 'fixture leaked into manifest');
}

function assertOnlyFixtureDelta(before, after, label) {
  const withoutFixture = (snapshot) => ({
    cli: snapshot.cli.filter((line) => !line.startsWith(`${fixtureId}@`)),
    manifest: snapshot.manifest.filter((entry) => entry.id !== fixtureId),
  });
  assert.deepEqual(withoutFixture(after), withoutFixture(before), `${label} changed unrelated extension state`);
}

function assertUnchanged(before, after, message) {
  assert.deepEqual(after, before, message);
}

function assertTargetFolder(extensionsDir, manifest) {
  const folders = existsSync(extensionsDir)
    ? readdirSync(extensionsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : [];
  folders.sort();
  assert.ok(folders.includes(expectedFolder), `target-specific folder ${expectedFolder} was not created`);
  const fixtureEntry = manifest.find((entry) => entry.id === fixtureId);
  assert.equal(fixtureEntry?.relativeLocation, expectedFolder);
  return folders;
}

function profileManifestPath(userData, location) {
  return path.join(userData, 'User', 'profiles', ...location.split('/'), 'extensions.json');
}

function profileRegistry(storage) {
  return Array.isArray(storage.userDataProfiles) ? storage.userDataProfiles : [];
}

function associationForWorkspace(storage, workspace) {
  const associations = storage?.profileAssociations?.workspaces;
  if (!associations || typeof associations !== 'object' || Array.isArray(associations)) return undefined;
  const expectedPath = path.resolve(workspace);
  for (const [uri, location] of Object.entries(associations)) {
    if (typeof location !== 'string') continue;
    try {
      if (path.resolve(fileURLToPath(uri)) === expectedPath) {
        return { observedUri: uri, normalizedUri: pathToFileURL(expectedPath).toString(), location };
      }
    } catch {
      // Ignore non-file or malformed association keys; this probe opens only file workspaces.
    }
  }
  return undefined;
}

function exactlyOneProfile(profiles, name) {
  const found = profiles.filter((profile) => profile?.name === name && typeof profile?.location === 'string');
  assert.equal(found.length, 1, `expected exactly one generated profile named ${name}`);
  return { name, location: found[0].location };
}

function captureObsolete(file, extensionsDir) {
  if (!existsSync(file)) return { exists: false, runtimeShapeVerified: false };
  const raw = readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed && typeof parsed === 'object' && !Array.isArray(parsed), '.obsolete is not a flat object');
  const fixtureValue = parsed[expectedFolder];
  if (fixtureValue === true) {
    return { exists: true, runtimeShapeVerified: true, raw, fixtureValue };
  }
  const folderStillExists = existsSync(path.join(extensionsDir, expectedFolder));
  assert.equal(folderStillExists, false, '.obsolete omitted the fixture while its unreferenced folder remained');
  return {
    exists: true,
    runtimeShapeVerified: true,
    raw,
    fixtureValue: 'absent-after-eager-folder-removal',
  };
}

async function inspectObsoleteSource(commit) {
  const sourceUrl = `https://raw.githubusercontent.com/microsoft/vscode/${commit}/src/vs/platform/extensionManagement/node/extensionManagementService.ts`;
  const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
  assert.ok(response.ok, `cannot read exact-build VS Code source: HTTP ${response.status}`);
  const source = await response.text();
  const lines = source.split('\n');
  const typedDictionaryLine = lineNumber(lines, 'Queue<IStringDictionary<boolean>>');
  const obsoleteResourceLine = lineNumber(lines, "userExtensionsLocation, '.obsolete'");
  const folderKeyTrueLine = lineNumber(lines, 'removedExtensions[extensionKey.toString()] = true');
  const jsonSerializationLine = lineNumber(lines, 'JSON.stringify(removed)');
  assert.ok(
    typedDictionaryLine && obsoleteResourceLine && folderKeyTrueLine && jsonSerializationLine,
    'exact-build source lacks expected .obsolete shape or serialization signals',
  );
  return {
    evidenceType: 'exact-runtime-commit source inspection',
    url: sourceUrl.replace('raw.githubusercontent.com', 'github.com').replace(`/${commit}/`, `/blob/${commit}/`),
    signals: {
      booleanDictionary: { symbol: 'Queue<IStringDictionary<boolean>>', line: typedDictionaryLine },
      obsoleteResource: { symbol: "userExtensionsLocation + '.obsolete'", line: obsoleteResourceLine },
      folderKeyMapsToTrue: { symbol: 'removedExtensions[extensionKey.toString()] = true', line: folderKeyTrueLine },
      jsonSerialization: { symbol: 'JSON.stringify(removed)', line: jsonSerializationLine },
    },
  };
}

function lineNumber(lines, needle) {
  const index = lines.findIndex((line) => line.includes(needle));
  return index < 0 ? undefined : index + 1;
}

function createPortableLayout(ownedDistribution, ownedExecutable) {
  let root;
  let markerDescription;
  if (platform === 'linux') {
    root = path.join(ownedDistribution, 'data');
    markerDescription = 'distribution-root/data';
  } else {
    const appBundle = macAppBundle(ownedExecutable);
    root = path.join(path.dirname(appBundle), 'code-portable-data');
    markerDescription = 'code-portable-data sibling of Visual Studio Code.app';
    assert.equal(realpathSync(path.dirname(appBundle)), realpathSync(path.dirname(root)));
    assert.equal(path.basename(root), 'code-portable-data');
  }
  assert.ok(!existsSync(root), 'portable marker already exists in owned distribution');
  mkdirSync(root);
  const userData = path.join(root, 'user-data');
  const extensions = path.join(root, 'extensions');
  return {
    root,
    userData,
    storageJson: path.join(userData, 'User', 'globalStorage', 'storage.json'),
    extensions,
    globalManifest: path.join(extensions, 'extensions.json'),
    markerDescription,
    userDataRelative: platform === 'linux' ? 'data/user-data' : 'code-portable-data/user-data',
    storageRelative: platform === 'linux'
      ? 'data/user-data/User/globalStorage/storage.json'
      : 'code-portable-data/user-data/User/globalStorage/storage.json',
    extensionsRelative: platform === 'linux' ? 'data/extensions' : 'code-portable-data/extensions',
  };
}

function macAppBundle(executable) {
  let current = path.dirname(executable);
  while (current !== path.dirname(current) && !current.endsWith('.app')) current = path.dirname(current);
  assert.ok(current.endsWith('.app'), 'owned executable is not inside an app bundle');
  return current;
}

function assertDefaultHomeDidNotReceiveFixture(home) {
  const layout = layoutForHome(home);
  const manifest = readManifest(layout.globalManifest);
  assert.ok(!manifest.some((entry) => entry.id === fixtureId), 'portable fixture leaked to default extension manifest');
  if (existsSync(layout.extensions)) {
    assert.ok(!readdirSync(layout.extensions).includes(expectedFolder), 'portable fixture leaked to default extension root');
  }
  assert.ok(!existsSync(layout.storageJson), 'portable workbench wrote default user-data storage.json');
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function existsAndParses(file) {
  if (!existsSync(file)) return false;
  try { readJson(file); return true; } catch { return false; }
}

function relativeToHome(home, value) {
  return `$HOME/${path.relative(home, value).split(path.sep).join('/')}`;
}

function sanitize(value) {
  if (typeof value !== 'string') return String(value);
  let result = value;
  if (probeRoot) result = result.split(probeRoot).join('$PROBE_ROOT');
  result = result.split(repoRoot).join('$REPO');
  return result;
}

function safeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function readLogTail(file) {
  if (!existsSync(file)) return '';
  return sanitize(readFileSync(file, 'utf8').slice(-8_000));
}

function gitHead() {
  // pull_request workflows check out a shallow synthetic merge commit, so the workflow passes the
  // event's head SHA explicitly. Keep it distinct from ci.workflowSha (the tested merge revision).
  if (process.env.PERSONAS_IMPLEMENTATION_HEAD) return process.env.PERSONAS_IMPLEMENTATION_HEAD;
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function githubMetadata() {
  return {
    ...(process.env.GITHUB_RUN_ID ? { runId: process.env.GITHUB_RUN_ID } : {}),
    ...(process.env.GITHUB_RUN_ATTEMPT ? { runAttempt: process.env.GITHUB_RUN_ATTEMPT } : {}),
    ...(process.env.GITHUB_JOB ? { job: process.env.GITHUB_JOB } : {}),
    ...(process.env.GITHUB_SHA ? { workflowSha: process.env.GITHUB_SHA } : {}),
    ...(process.env.GITHUB_REPOSITORY ? { repository: process.env.GITHUB_REPOSITORY } : {}),
  };
}
