import type { WelcomeToHost } from '../core/types';

export interface WorkspaceManifestAction {
  mode: 'readOnly' | 'edit';
  filePath: string;
}

/** Resolve manifest actions exclusively from host-owned state. Extra properties on an untrusted
 * webview message can never select a different path. */
export function resolveWorkspaceManifestAction(
  message: WelcomeToHost,
  workspaceManifestPath: string | undefined,
): WorkspaceManifestAction | undefined {
  if (!workspaceManifestPath) return undefined;
  if (message.type === 'openWorkspaceReadOnly') {
    return { mode: 'readOnly', filePath: workspaceManifestPath };
  }
  if (message.type === 'editWorkspaceFile') {
    return { mode: 'edit', filePath: workspaceManifestPath };
  }
  return undefined;
}
