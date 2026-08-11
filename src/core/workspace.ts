import * as path from 'node:path';
import {
  parseWorkspaceProfileAssociations,
  type ParsedWorkspaceProfileAssociations,
} from './parsers';
import type {
  Inventory,
  Profile,
  WorkspaceDescriptor,
  WorkspaceExtensionCounts,
  WorkspaceExtensionStatus,
  WorkspaceInventory,
  WorkspaceLocalExtension,
} from './types';

const DEFAULT_PROFILE_SENTINEL = '__default__profile__';
const EXTENSION_PART_RE = /^[a-z0-9][a-z0-9-]*$/i;
export const MAX_WORKSPACE_EXTENSION_ENTRIES_PER_ROOT = 200;
export const MAX_WORKSPACE_EXTENSION_MANIFEST_BYTES = 256 * 1024;

export interface WorkspaceFolderInput {
  name: string;
  uri: string;
  scheme: string;
  fsPath?: string;
}

export interface WorkspaceDescriptorInput {
  name?: string;
  workspaceFileUri?: string;
  workspaceFileFsPath?: string;
  folders: WorkspaceFolderInput[];
}

export interface WorkspaceRuntimeExtension {
  id: string;
  uri: string;
  fsPath?: string;
  version?: string;
}

export interface WorkspaceCandidateIo {
  /** Reads one untrusted workspace manifest only when it is a bounded regular file whose real
   *  path remains inside `extensionsRoot`. */
  readCandidateManifest(
    p: string,
    extensionsRoot: string,
    maxBytes: number,
  ): Promise<string | undefined | Error>;
  listEntries(p: string): Promise<{ name: string; isDirectory: boolean }[] | Error>;
}

export interface WorkspaceInventoryIo extends WorkspaceCandidateIo {
  readFile(p: string): Promise<string | undefined | Error>;
  getDescriptor(): WorkspaceDescriptor | undefined;
  getRuntimeExtensions(): WorkspaceRuntimeExtension[] | Error;
}

export interface WorkspaceDiscoveryResult {
  candidates: WorkspaceLocalExtension[];
  warnings: string[];
}

export interface WorkspaceWatchTarget {
  baseFsPath: string;
  pattern: string;
  /** When set, the broad pattern is only a transport for file events; callers must refresh only
   *  when the changed path equals this literal path. This avoids treating manifest filenames as
   *  glob syntax. */
  exactFsPath?: string;
}

export interface ComposeWorkspaceInventoryInput {
  descriptor: WorkspaceDescriptor;
  inventory: Inventory;
  associations: ParsedWorkspaceProfileAssociations | Error;
  discovery: WorkspaceDiscoveryResult;
  runtimeExtensions: WorkspaceRuntimeExtension[] | Error;
}

export function createWorkspaceDescriptor(input: WorkspaceDescriptorInput): WorkspaceDescriptor | undefined {
  if (!input.workspaceFileUri && input.folders.length === 0) return undefined;
  const kind: WorkspaceDescriptor['kind'] = input.workspaceFileUri || input.folders.length !== 1 ? 'workspace' : 'folder';
  const onlyFolder = input.folders.length === 1 ? input.folders[0] : undefined;
  const associationUri = input.workspaceFileUri ?? onlyFolder?.uri;
  const rootFsPaths = input.folders
    .filter((folder) => folder.scheme.toLowerCase() === 'file' && folder.fsPath)
    .map((folder) => folder.fsPath as string);
  const fallbackName =
    onlyFolder?.name ||
    basenameFromUri(input.workspaceFileUri) ||
    (kind === 'workspace' ? 'Untitled workspace' : 'Current workspace');
  const suppliedName = input.name?.trim();
  const displayName =
    kind === 'workspace' ? suppliedName?.replace(/\s*\(Workspace\)$/i, '').trim() : suppliedName;
  return {
    name: displayName || fallbackName,
    kind,
    ...(associationUri ? { associationUri } : {}),
    ...(isLocalWorkspaceManifest(input.workspaceFileUri, input.workspaceFileFsPath)
      ? { manifestFsPath: input.workspaceFileFsPath }
      : {}),
    rootFsPaths,
  };
}

function isLocalWorkspaceManifest(uri: string | undefined, fsPath: string | undefined): fsPath is string {
  if (!uri || !fsPath || !/\.code-workspace$/i.test(fsPath)) return false;
  try {
    return new URL(uri).protocol.toLowerCase() === 'file:';
  } catch {
    return false;
  }
}

function basenameFromUri(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    const decoded = decodeURIComponent(parsed.pathname);
    const base = decoded.replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
    return base?.replace(/\.code-workspace$/i, '');
  } catch {
    return undefined;
  }
}

/** Canonical comparison identity for VS Code URI strings, including Windows case/escaping. */
export function normalizeUriIdentity(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    const scheme = parsed.protocol.slice(0, -1).toLowerCase();
    const authority = parsed.host.toLowerCase();
    let pathname = decodeURIComponent(parsed.pathname).replaceAll('\\', '/');
    // File URIs with a drive letter or UNC authority are Windows identities and therefore
    // case-insensitive. Local POSIX file paths deliberately preserve case.
    if (scheme === 'file' && (authority !== '' || /^\/[a-z]:/i.test(pathname))) {
      pathname = pathname.toLowerCase();
    }
    if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
    return `${scheme}://${authority}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export function resolveActiveProfile(
  descriptor: WorkspaceDescriptor,
  associations: ParsedWorkspaceProfileAssociations,
  profiles: Profile[],
): { profile?: Profile; warnings: string[] } {
  const warnings = [...associations.warnings];
  if (!descriptor.associationUri) {
    warnings.push('The current workspace has no stable association URI; its active profile is unknown.');
    return { warnings };
  }
  const target = normalizeUriIdentity(descriptor.associationUri);
  if (!target) {
    warnings.push('The current workspace association URI is malformed; its active profile is unknown.');
    return { warnings };
  }

  const matchingValues = new Set<string>();
  for (const [rawUri, profileId] of associations.workspaces) {
    const normalized = normalizeUriIdentity(rawUri);
    if (!normalized) {
      warnings.push(`Ignored malformed workspace association URI: ${rawUri}`);
      continue;
    }
    if (normalized === target) matchingValues.add(profileId);
  }
  if (matchingValues.size === 0) {
    warnings.push('VS Code did not persist an exact profile association for this workspace.');
    return { warnings };
  }
  if (matchingValues.size > 1) {
    warnings.push('Conflicting profile associations normalize to the current workspace URI.');
    return { warnings };
  }

  const storedId = [...matchingValues][0] as string;
  if (storedId === DEFAULT_PROFILE_SENTINEL) {
    const defaultProfile = profiles.find((profile) => profile.isDefault);
    if (defaultProfile) return { profile: defaultProfile, warnings };
  }
  const exact = profiles.find((profile) => profile.id === storedId);
  if (exact) return { profile: exact, warnings };
  // Modern VS Code stores the profile id (the basename of its location); tolerate registries
  // whose persisted location includes a parent such as `builtin/agents` when the match is unique.
  const byBasename = profiles.filter((profile) => profile.id.replaceAll('\\', '/').split('/').at(-1) === storedId);
  if (byBasename.length === 1) return { profile: byBasename[0], warnings };

  warnings.push(`VS Code associated this workspace with unknown profile id "${storedId}".`);
  return { warnings };
}

export async function discoverWorkspaceLocalExtensions(
  descriptor: WorkspaceDescriptor,
  io: WorkspaceCandidateIo,
): Promise<WorkspaceDiscoveryResult> {
  const candidates: WorkspaceLocalExtension[] = [];
  const warnings: string[] = [];
  const roots = [...descriptor.rootFsPaths].sort(comparePaths);

  for (const root of roots) {
    const extensionsRoot = joinFs(root, '.vscode', 'extensions');
    const listed = await io.listEntries(extensionsRoot);
    if (listed instanceof Error) {
      warnings.push(`Could not inspect ${extensionsRoot}: ${listed.message}`);
      continue;
    }
    const sortedEntries = [...listed].sort((a, b) => a.name.localeCompare(b.name));
    if (sortedEntries.length > MAX_WORKSPACE_EXTENSION_ENTRIES_PER_ROOT) {
      warnings.push(
        `Stopped scanning ${extensionsRoot} after ${MAX_WORKSPACE_EXTENSION_ENTRIES_PER_ROOT} entries; discovery was truncated.`,
      );
    }
    for (const entry of sortedEntries.slice(0, MAX_WORKSPACE_EXTENSION_ENTRIES_PER_ROOT)) {
      const folderName = entry.name;
      if (!isSafeImmediateChild(folderName)) {
        warnings.push(`Ignored unsafe local extension folder name "${folderName}" in ${extensionsRoot}.`);
        continue;
      }
      if (!entry.isDirectory) {
        warnings.push(`Ignored non-directory entry "${folderName}" in ${extensionsRoot}.`);
        continue;
      }
      const folderPath = joinFs(extensionsRoot, folderName);
      if (!isFsPathContained(extensionsRoot, folderPath)) {
        warnings.push(`Ignored local extension path outside ${extensionsRoot}.`);
        continue;
      }
      const manifestPath = joinFs(folderPath, 'package.json');
      const text = await io.readCandidateManifest(
        manifestPath,
        extensionsRoot,
        MAX_WORKSPACE_EXTENSION_MANIFEST_BYTES,
      );
      if (text === undefined) {
        warnings.push(`Ignored ${folderPath}: package.json is missing.`);
        continue;
      }
      if (text instanceof Error) {
        warnings.push(`Could not read ${manifestPath}: ${text.message}`);
        continue;
      }
      if (Buffer.byteLength(text, 'utf8') > MAX_WORKSPACE_EXTENSION_MANIFEST_BYTES) {
        warnings.push(
          `Could not read ${manifestPath}: manifest exceeds ${MAX_WORKSPACE_EXTENSION_MANIFEST_BYTES} bytes.`,
        );
        continue;
      }
      let manifest: Record<string, unknown>;
      try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('expected an object');
        manifest = parsed as Record<string, unknown>;
      } catch (error) {
        warnings.push(`Ignored ${manifestPath}: invalid JSON (${error instanceof Error ? error.message : String(error)}).`);
        continue;
      }
      const publisher = manifest['publisher'];
      const name = manifest['name'];
      if (
        typeof publisher !== 'string' ||
        typeof name !== 'string' ||
        !EXTENSION_PART_RE.test(publisher) ||
        !EXTENSION_PART_RE.test(name)
      ) {
        warnings.push(`Ignored ${manifestPath}: publisher and name must form a valid extension id.`);
        continue;
      }
      const id = `${publisher}.${name}`.toLowerCase();
      const rawDisplayName = manifest['displayName'];
      const displayName =
        typeof rawDisplayName === 'string' && rawDisplayName.trim() && !rawDisplayName.startsWith('%')
          ? rawDisplayName
          : id;
      const version = typeof manifest['version'] === 'string' ? manifest['version'] : undefined;
      const description =
        typeof manifest['description'] === 'string' && !manifest['description'].startsWith('%')
          ? manifest['description']
          : undefined;
      candidates.push({
        id,
        displayName,
        fsPath: folderPath,
        runtimeVisible: false,
        ...(version ? { version } : {}),
        ...(description ? { description } : {}),
        ...(publisher ? { publisher } : {}),
      });
    }
  }

  const byId = groupById(candidates);
  for (const [id, sameId] of byId) {
    if (sameId.length > 1) {
      warnings.push(`Multiple workspace roots contain local extension ${id}; the effective runtime location wins.`);
    }
  }
  return { candidates, warnings };
}

export function composeWorkspaceInventory(input: ComposeWorkspaceInventoryInput): WorkspaceInventory {
  const warnings = [...input.discovery.warnings];
  let activeProfile: Profile | undefined;
  if (input.associations instanceof Error) {
    warnings.push(`Could not resolve the workspace profile association: ${input.associations.message}`);
  } else {
    const resolved = resolveActiveProfile(input.descriptor, input.associations, input.inventory.profiles);
    activeProfile = resolved.profile;
    warnings.push(...resolved.warnings);
  }

  const runtimeSnapshot = input.runtimeExtensions instanceof Error ? [] : input.runtimeExtensions;
  if (input.runtimeExtensions instanceof Error) {
    warnings.push(`Could not read VS Code's effective extension snapshot: ${input.runtimeExtensions.message}`);
  }
  const runtimeById = groupById(
    runtimeSnapshot.map((extension) => ({ ...extension, id: extension.id.toLowerCase() })),
  );
  for (const [id, matches] of runtimeById) {
    if (matches.length > 1) warnings.push(`VS Code reported multiple effective locations for ${id}.`);
  }

  const candidates = input.discovery.candidates.map((candidate) => ({ ...candidate }));
  const candidatesById = groupById(candidates);
  const profileById = new Map(input.inventory.extensions.map((extension) => [extension.id, extension]));
  const allIds = new Set([...profileById.keys(), ...candidatesById.keys()]);
  const affectedProfiles = new Set(input.inventory.warnings.flatMap((warning) => warning.affectedProfileIds));
  // Any unreadable profile manifest can hide an application-scoped entry. Because such an entry
  // applies to every profile, membership in even a different readable active profile is uncertain
  // until all profile manifests that can carry the flag are readable.
  const profileMembershipReliable = affectedProfiles.size === 0;
  const statuses: WorkspaceExtensionStatus[] = [];

  for (const id of allIds) {
    const profileExtension = profileById.get(id);
    const localCandidates = candidatesById.get(id) ?? [];
    const runtimes = runtimeById.get(id) ?? [];
    const localMatch = localCandidates.find((candidate) =>
      runtimes.some((runtime) => runtime.fsPath && isFsPathContained(candidate.fsPath, runtime.fsPath)),
    );
    if (localMatch) localMatch.runtimeVisible = true;
    const runtime =
      (localMatch
        ? runtimes.find((item) => item.fsPath && isFsPathContained(localMatch.fsPath, item.fsPath))
        : undefined) ?? runtimes[0];

    const manifestReliable = activeProfile ? profileMembershipReliable : false;
    const installedInActiveProfile: boolean | 'unknown' =
      activeProfile && manifestReliable
        ? (profileExtension?.installedIn.includes(activeProfile.id) ?? false)
        : 'unknown';
    const workspaceLocal = localMatch ? 'installed' : localCandidates.length > 0 ? 'candidate' : 'none';
    const runtimeSource = localMatch
      ? 'workspace'
      : runtime && installedInActiveProfile === true
        ? 'profile'
        : 'unknown';
    const stateAndReason = composeState({
      activeProfile,
      installedInActiveProfile,
      workspaceLocal,
      localMatch,
      candidate: localCandidates[0],
      runtime,
      runtimeSnapshotFailed: input.runtimeExtensions instanceof Error,
    });
    const metadataCandidate = localMatch ?? localCandidates[0];
    const runtimeFsPath = runtime?.fsPath;
    const runtimeDiskVersion =
      runtimeFsPath && profileExtension
        ? profileExtension.versions.find(
            (version) =>
              isFsPathContained(version.fsPath, runtimeFsPath) ||
              isFsPathContained(runtimeFsPath, version.fsPath),
          )?.version
        : undefined;
    const activeProfileVersion = activeProfile
      ? profileExtension?.profileVersions?.find((item) => item.profileId === activeProfile.id)?.version
      : undefined;
    const effectiveVersion =
      runtime?.version ??
      localMatch?.version ??
      runtimeDiskVersion ??
      (installedInActiveProfile === true ? activeProfileVersion : undefined) ??
      metadataCandidate?.version;
    statuses.push({
      id,
      displayName: profileExtension?.displayName ?? metadataCandidate?.displayName ?? id,
      state: stateAndReason.state,
      installedInActiveProfile,
      workspaceLocal,
      runtimeSource,
      profileBacked: profileExtension !== undefined,
      reason: stateAndReason.reason,
      ...(profileExtension?.description ?? metadataCandidate?.description
        ? { description: profileExtension?.description ?? metadataCandidate?.description }
        : {}),
      ...(profileExtension?.publisher ?? metadataCandidate?.publisher
        ? { publisher: profileExtension?.publisher ?? metadataCandidate?.publisher }
        : {}),
      ...(effectiveVersion ? { version: effectiveVersion } : {}),
      ...(runtime?.uri ? { runtimeUri: runtime.uri } : {}),
    });
  }
  statuses.sort((a, b) => a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()) || a.id.localeCompare(b.id));

  return {
    descriptor: input.descriptor,
    ...(activeProfile ? { activeProfileId: activeProfile.id, activeProfileName: activeProfile.name } : {}),
    extensions: statuses,
    localExtensions: candidates,
    warnings: unique(warnings),
  };
}

function composeState(input: {
  activeProfile: Profile | undefined;
  installedInActiveProfile: boolean | 'unknown';
  workspaceLocal: WorkspaceExtensionStatus['workspaceLocal'];
  localMatch?: WorkspaceLocalExtension;
  candidate?: WorkspaceLocalExtension;
  runtime?: WorkspaceRuntimeExtension;
  runtimeSnapshotFailed: boolean;
}): { state: WorkspaceExtensionStatus['state']; reason: string } {
  if (input.runtimeSnapshotFailed) {
    return { state: 'unknown', reason: "VS Code's effective extension snapshot was unavailable." };
  }
  if (input.runtime) {
    if (input.localMatch) {
      const profilePart = input.installedInActiveProfile === true ? ' It is also installed in the active profile.' : '';
      return {
        state: 'enabled',
        reason: `VS Code reports this extension as available from workspace-local runtime location ${input.runtime.uri} (candidate root ${input.localMatch.fsPath}).${profilePart}`,
      };
    }
    if (input.installedInActiveProfile === true) {
      return {
        state: 'enabled',
        reason: `VS Code reports this extension as available at ${input.runtime.uri} in the current window and it is installed in ${input.activeProfile?.name ?? 'the active profile'}.`,
      };
    }
    return {
      state: 'enabled',
      reason: `VS Code reports this extension as available at ${input.runtime.uri} in the current window; its installation source could not be resolved.`,
    };
  }
  if (input.workspaceLocal === 'candidate') {
    return {
      state: 'unknown',
      reason: `A local extension candidate exists at ${input.candidate?.fsPath ?? 'an unknown path'}, but VS Code does not report it as available or installed.`,
    };
  }
  if (input.installedInActiveProfile === true) {
    return {
      state: 'notEnabled',
      reason:
        'Installed in the active profile but not reported as available by VS Code. This can reflect global or workspace disablement, Workspace Trust, dependencies, or compatibility.',
    };
  }
  if (input.installedInActiveProfile === false) {
    return {
      state: 'notInstalledInProfile',
      reason: 'Not installed in the active profile, and no installed workspace-local copy is visible.',
    };
  }
  return {
    state: 'unknown',
    reason: 'The active profile or its extension manifest could not be resolved safely.',
  };
}

export function workspaceExtensionCounts(workspace: WorkspaceInventory): WorkspaceExtensionCounts {
  const counts: WorkspaceExtensionCounts = { enabled: 0, notEnabled: 0, unknown: 0, workspaceLocal: 0 };
  for (const extension of workspace.extensions) {
    const relevant = extension.installedInActiveProfile !== false || extension.workspaceLocal !== 'none';
    if (!relevant) continue;
    if (extension.state === 'enabled') counts.enabled += 1;
    else if (extension.state === 'notEnabled') counts.notEnabled += 1;
    else if (extension.state === 'unknown') counts.unknown += 1;
    if (extension.workspaceLocal === 'installed') counts.workspaceLocal += 1;
  }
  return counts;
}

export function workspaceExtensionsRootPaths(descriptor: WorkspaceDescriptor): string[] {
  return descriptor.rootFsPaths.map((root) => joinFs(root, '.vscode', 'extensions'));
}

/** Narrow watcher targets that also work before .vscode/extensions exists. */
export function workspaceWatchTargets(descriptor: WorkspaceDescriptor): WorkspaceWatchTarget[] {
  const targets: WorkspaceWatchTarget[] = descriptor.rootFsPaths.map((root) => ({
    baseFsPath: root,
    pattern: '.vscode/extensions/**',
  }));
  if (descriptor.manifestFsPath) {
    const windows = isWindowsFsPath(descriptor.manifestFsPath);
    const pathApi = windows ? path.win32 : path.posix;
    targets.push({
      baseFsPath: pathApi.dirname(descriptor.manifestFsPath),
      pattern: '*',
      exactFsPath: descriptor.manifestFsPath,
    });
  }
  return targets;
}

export class WorkspaceInventoryService {
  constructor(
    private readonly storageJson: string,
    private readonly io: WorkspaceInventoryIo,
  ) {}

  watchedTargets(): WorkspaceWatchTarget[] {
    const descriptor = this.io.getDescriptor();
    return descriptor ? workspaceWatchTargets(descriptor) : [];
  }

  async getWorkspaceInventory(inventory: Inventory): Promise<WorkspaceInventory | undefined> {
    const descriptor = this.io.getDescriptor();
    if (!descriptor) return undefined;

    const storage = await this.io.readFile(this.storageJson);
    let associations: ParsedWorkspaceProfileAssociations | Error;
    if (storage === undefined) {
      associations = new Error('globalStorage/storage.json is missing.');
    } else if (storage instanceof Error) {
      associations = storage;
    } else {
      try {
        associations = parseWorkspaceProfileAssociations(storage);
      } catch (error) {
        associations = error instanceof Error ? error : new Error(String(error));
      }
    }

    let discovery: WorkspaceDiscoveryResult;
    try {
      discovery = await discoverWorkspaceLocalExtensions(descriptor, this.io);
    } catch (error) {
      discovery = {
        candidates: [],
        warnings: [`Could not discover workspace-local extensions: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
    let runtimeExtensions: WorkspaceRuntimeExtension[] | Error;
    try {
      runtimeExtensions = this.io.getRuntimeExtensions();
    } catch (error) {
      runtimeExtensions = error instanceof Error ? error : new Error(String(error));
    }
    return composeWorkspaceInventory({ descriptor, inventory, associations, discovery, runtimeExtensions });
  }
}

export function areFsPathsEqual(a: string, b: string): boolean {
  return normalizeFsPath(a) === normalizeFsPath(b);
}

export function isFsPathContained(parent: string, child: string): boolean {
  const normalizedParent = normalizeFsPath(parent);
  const normalizedChild = normalizeFsPath(child);
  return normalizedChild === normalizedParent || normalizedChild.startsWith(`${normalizedParent}/`);
}

function normalizeFsPath(value: string): string {
  const windows = isWindowsFsPath(value);
  const resolved = windows ? path.win32.resolve(value) : path.posix.resolve(value);
  const slashed = (windows ? resolved.replaceAll('\\', '/') : resolved).replace(/\/+$/, '');
  return windows ? slashed.toLowerCase() : slashed;
}

function joinFs(root: string, ...parts: string[]): string {
  const windows = isWindowsFsPath(root);
  return (windows ? path.win32.join(root, ...parts) : path.posix.join(root, ...parts));
}

function isWindowsFsPath(value: string): boolean {
  return /^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value);
}

function isSafeImmediateChild(value: string): boolean {
  return value !== '' && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\');
}

function comparePaths(a: string, b: string): number {
  return normalizeFsPath(a).localeCompare(normalizeFsPath(b));
}

function groupById<T extends { id: string }>(items: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const id = item.id.toLowerCase();
    const list = result.get(id) ?? [];
    list.push(item);
    result.set(id, list);
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
