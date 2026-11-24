import * as vscode from 'vscode';
import { PowerShellService } from '../powershell/service';
import type { HostToPowerShellProfiles, PowerShellProfilesToHost } from '../protocol';
import { PowerShellController } from './powerShellController';
import { powerShellProfilesBody, powerShellProfilesStyles } from './powerShellProfilesMarkup';
import { renderSidebarPage } from './sidebarPage';

/**
 * PowerShell Profiles, one of Home's views. It only wires the view to PowerShellController, which
 * owns discovery, file watching and the row actions.
 */
export class PowerShellProfilesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'personas.powerShellProfiles';
  private view: vscode.WebviewView | undefined;
  private readonly controller: PowerShellController;

  constructor(private readonly context: vscode.ExtensionContext, service = new PowerShellService()) {
    this.controller = new PowerShellController((message) => this.post(message), service);
    context.subscriptions.push(this.controller);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.controller.setActive(webviewView.visible);
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewView.webview.html = this.html(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((m: PowerShellProfilesToHost) => void this.onMessage(m));

    // The visibility change only starts and stops file watching. VS Code discards the page when the
    // view is hidden and loads it again when shown; its script sends `ready` each time, and that
    // message drives the load, so profiles are discovered once per show (#150).
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      this.controller.setActive(webviewView.visible);
    });
    webviewView.onDidDispose(() => {
      visibilityListener.dispose();
      if (this.view === webviewView) {
        this.view = undefined;
        this.controller.setActive(false);
      }
    });
    this.context.subscriptions.push(visibilityListener);
  }

  /** The Refresh button in the view's title bar. */
  refresh(): Promise<void> {
    return this.controller.handle({ type: 'powerShellAction', action: 'refresh' });
  }

  /** The Help button in the view's title bar. */
  help(): Promise<void> {
    return this.controller.handle({ type: 'powerShellAction', action: 'help' });
  }

  private post(message: HostToPowerShellProfiles): void {
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(m: PowerShellProfilesToHost): Promise<void> {
    if (m.type === 'powerShellAction') {
      await this.controller.handle(m);
      return;
    }
    // The page was just rebuilt and is empty: show the last known list, then refresh.
    this.controller.paintLastKnown();
    if (this.view?.visible) await this.controller.refresh(true);
  }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'powerShellProfiles.js'));
    return renderSidebarPage({
      title: 'PowerShell Profiles',
      styles: powerShellProfilesStyles,
      body: powerShellProfilesBody,
      scriptUri: script.toString(),
    });
  }
}
