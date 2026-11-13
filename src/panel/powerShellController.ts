import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PowerShellService } from '../powershell/service';
import { createProfile, deleteProfile, inspectProfile } from '../powershell/files';
import type { HostToHome, HomeToHost } from '../protocol';

const helpUrl = 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles';
export class PowerShellController implements vscode.Disposable {
  private readonly service = new PowerShellService();
  private watchers: vscode.FileSystemWatcher[] = [];
  private watchKey = '';
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly events: vscode.Disposable[];
  constructor(private readonly post: (message: HostToHome) => void) {
    this.events = [
      vscode.workspace.onDidSaveTextDocument(() => this.schedule()),
      vscode.workspace.onDidCreateFiles(() => this.schedule()),
      vscode.workspace.onDidDeleteFiles(() => this.schedule()),
      vscode.workspace.onDidRenameFiles(() => this.schedule()),
    ];
  }
  refresh(): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disposed) return;
      if (vscode.env.remoteName) {
        this.post({type:'powerShellState', inventory:{editions:[], rows:[], error:'PowerShell profiles support local desktop windows. WSL support is planned next.'}});
        return;
      }
      try {
        const inventory = await this.service.refresh();
        if (this.disposed) return;
        this.post({type:'powerShellState', inventory});
        await this.watch();
      } catch (error) {
        this.post({type:'powerShellState', inventory:{editions:[],rows:[],error:String(error)}});
      }
    });
    return this.queue;
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), 300);
  }
  private async watch(): Promise<void> {
    const bases = new Set<string>();
    for (const row of this.service.snapshot.rows) {
      for (const file of [row.path, row.target]) {
        if (!file) continue;
        let directory = path.dirname(file);
        while (directory !== path.dirname(directory)) {
          try { if ((await fs.stat(directory)).isDirectory()) break; } catch { /* nearest existing parent */ }
          directory = path.dirname(directory);
        }
        if (directory !== path.parse(directory).root) bases.add(directory);
      }
    }
    const key = [...bases].sort().join('\n');
    if (key === this.watchKey) return;
    this.watchKey = key;
    for (const watcher of this.watchers) watcher.dispose();
    this.watchers = [];
    for (const base of bases) {
      // Nonrecursive parent watch notices missing profile directory creation without scanning a home tree.
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), '*'));
      watcher.onDidCreate(() => this.schedule());
      watcher.onDidChange(() => this.schedule());
      watcher.onDidDelete(() => this.schedule());
      this.watchers.push(watcher);
    }
  }
  async handle(message: Extract<HomeToHost, {type:'powerShellAction'}>): Promise<void> {
    if (vscode.env.remoteName) return;
    try {
      if (message.action === 'help') { await vscode.env.openExternal(vscode.Uri.parse(helpUrl)); return; }
      if (message.action === 'refresh') { await this.refresh(); return; }
      if (message.action === 'resolve') {
        await this.service.resolve(message.id ?? '');
        await this.refresh(); return;
      }
      // Resolve the opaque identifier against host-owned inventory, then re-inspect the file.
      const location = this.service.row(message.id ?? '');
      if (!location) throw new Error('Profile is no longer available; refresh first');
      let row = await inspectProfile(location);
      if (!row.path) throw new Error('Profile path is unresolved');
      if (message.action === 'copy') { await vscode.env.clipboard.writeText(row.path); return; }
      if (message.action === 'reveal') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(row.state === 'missing' ? path.dirname(row.path) : row.path)); return;
      }
      if (message.action === 'delete') {
        await deleteProfile(location, {
          // VS Code does not document link-only Trash semantics across all platforms.
          canTrashLinks: false,
          isDirty: async file => {
            const target = await fs.realpath(file).catch(() => file);
            for (const document of vscode.workspace.textDocuments) {
              if (!document.isDirty || document.uri.scheme !== 'file') continue;
              const documentPath = await fs.realpath(document.uri.fsPath).catch(() => document.uri.fsPath);
              if (process.platform === 'win32' ? documentPath.toLowerCase() === target.toLowerCase() : documentPath === target) return true;
            }
            return false;
          },
          confirm: async current => await vscode.window.showWarningMessage(
            'Delete PowerShell Profile?', {modal:true, detail:current.path + (current.target ? '\nLink target: ' + current.target : '') + '\nMove to Trash/Recycle Bin.'},
            'Move to Trash',
          ) === 'Move to Trash',
          trash: async file => vscode.workspace.fs.delete(vscode.Uri.file(file), {useTrash:true, recursive:false}),
        });
      } else if (message.action === 'open') {
        if (row.state === 'missing' && !row.readOnly) {
          if (await vscode.window.showInformationMessage('Create PowerShell profile?', {modal:true, detail:row.path}, 'Create and Open') !== 'Create and Open') return;
          row = await createProfile(location);
        }
        if (row.state !== 'existing') throw new Error(row.detail ?? 'Profile cannot be opened');
        const document = await vscode.workspace.openTextDocument(vscode.Uri.file(row.target ?? row.path!));
        await vscode.window.showTextDocument(document, {preview:false});
      }
      await this.refresh();
    } catch (error) {
      void vscode.window.showErrorMessage('Personas: ' + String(error));
      await this.refresh();
    }
  }
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    for (const item of [...this.watchers, ...this.events]) item.dispose();
  }
}
