import type { HostToPowerShellProfiles, PowerShellProfilesToHost } from '../protocol';
import { isTrustedHostMessageOrigin } from './messageSecurity';
import { renderPowerShell } from './powershell';

/** The script of the PowerShell Profiles view's page: draws each list the host sends. */
declare function acquireVsCodeApi(): { postMessage(m: PowerShellProfilesToHost): void };
const vscode = acquireVsCodeApi();

window.addEventListener('message', (event: MessageEvent<HostToPowerShellProfiles>) => {
  // Host messages arrive same-origin; see the note in vscodeProfiles.ts.
  if (!isTrustedHostMessageOrigin(event.origin, window.location.origin)) return;
  if (event.data.type === 'powerShellState') {
    renderPowerShell(event.data.inventory, (message) => vscode.postMessage(message), event.data.allowRuntimeDiscovery);
  }
});

vscode.postMessage({ type: 'ready' });
