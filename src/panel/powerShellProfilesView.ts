import * as vscode from 'vscode';
import { PowerShellService } from '../powershell/service';
import type { HostToPowerShellProfiles, PowerShellProfilesToHost } from '../protocol';
import { PowerShellController } from './powerShellController';
import { powerShellProfilesBody, powerShellProfilesStyles } from './powerShellProfilesMarkup';
import { openSidebarPage } from './sidebarPage';

/**
 * PowerShell Profiles, one of Home's views. It only wires the view to PowerShellController, which
 * owns discovery, file watching and the row actions.
 */
export class PowerShellProfilesViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'personas.powerShellProfiles';
  private view: vscode.WebviewView | undefined;
  private readonly controller: PowerShellController;
  private ready = false;
  private pendingHelp?: symbol;

  constructor(private readonly context: vscode.ExtensionContext, service = new PowerShellService()) {
    this.controller = new PowerShellController((message) => this.post(message), service);
    context.subscriptions.push(this.controller);
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.ready = false;
    this.controller.setActive(webviewView.visible);
    openSidebarPage<PowerShellProfilesToHost>(this.context, webviewView, {
      title: 'PowerShell Profiles',
      styles: powerShellProfilesStyles,
      body: powerShellProfilesBody,
      script: 'powerShellProfiles.js',
      onMessage: (message) => this.onMessage(message),
      // Visibility only starts and stops file watching. VS Code discards the page when the view is
      // hidden and loads it again when shown; its script sends `ready` each time, and that message
      // drives the load, so profiles are discovered once per show (#150).
      onVisibilityChange: visible => {
        if (!visible) {
          this.ready = false;
          this.pendingHelp = undefined;
        }
        this.controller.setActive(visible);
      },
      onDispose: () => {
        if (this.view !== webviewView) return;
        this.view = undefined;
        this.ready = false;
        this.pendingHelp = undefined;
        this.controller.setActive(false);
      },
    });
  }

  /** The Refresh button in the view's title bar. */
  refresh(): Promise<void> {
    return this.controller.handle({ type: 'powerShellAction', action: 'refresh' });
  }

  /** The Help button in the view's title bar. */
  async help(): Promise<void> {
    // VS Code can finish the focus command before delivering visibility and ready events.
    const request = Symbol();
    this.pendingHelp = request;
    if (!this.view?.visible) {
      try {
        await vscode.commands.executeCommand(PowerShellProfilesViewProvider.viewId + '.focus');
      } catch (error) {
        if (this.pendingHelp === request) this.pendingHelp = undefined;
        throw error;
      }
    }
    this.showRequestedHelp();
  }

  private showRequestedHelp(): void {
    if (this.ready && this.view?.visible && this.pendingHelp) {
      this.pendingHelp = undefined;
      this.post({type:'showPowerShellHelp'});
    }
  }

  settingsChanged(editionChanged: boolean): void {
    if (!this.view?.visible) return;
    this.controller.paintLastKnown();
    if (editionChanged) void this.controller.refresh(true);
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
    this.ready = true;
    this.showRequestedHelp();
    this.controller.paintLastKnown();
    if (this.view?.visible) await this.controller.refresh(true);
  }
}
