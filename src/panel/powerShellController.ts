import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import { affectsProfile, changedIdentities, pathIdentities, profileWatchPlan } from '../powershell/watch';
import * as path from 'node:path';
import { PowerShellService } from '../powershell/service';
import { createProfile, deleteProfile, inspectProfile, nearestExistingDirectory } from '../powershell/files';
import type { HostToHome, HomeToHost } from '../protocol';

const helpUrl = 'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles';
/** Watcher events are best effort; a dropped one must not leave the view stale (#136). */
const defaultReconcileMs = 5000;
export class PowerShellController implements vscode.Disposable {

  private watchers = new Map<string, vscode.FileSystemWatcher>();
  private staleWatchRoots = new Set<string>();
  private active = false;
  private dependencies: string[] = [];
  private timer?: NodeJS.Timeout;
  private disposed = false;
  private queue: Promise<void> = Promise.resolve();
  private readonly events: vscode.Disposable[];
  private reconcileTimer?: NodeJS.Timeout;
  private reconcileGeneration = 0;
  private identities?: Map<string, string>;
  private readonly armedIdentities = new Map<string, string>();
  private readonly reconcileMs: number;
  constructor(
    private readonly post: (message: HostToHome) => void,
    private readonly service = new PowerShellService(),
    private readonly confirmCreate: (file: string) => Promise<boolean> = async file =>
      await vscode.window.showInformationMessage('Create PowerShell profile?', {modal:true, detail:file}, 'Create and Open') === 'Create and Open',
    options: {reconcileMs?: number} = {},
  ) {
    this.reconcileMs = options.reconcileMs ?? defaultReconcileMs;
    this.events = [
      vscode.workspace.onDidSaveTextDocument(document => this.changed([document.uri])),
      vscode.workspace.onDidCreateFiles(event => this.changed(event.files, true)),
      vscode.workspace.onDidDeleteFiles(event => this.changed(event.files, true)),
      vscode.workspace.onDidRenameFiles(event => this.changed(event.files.flatMap(file => [file.oldUri, file.newUri]), true)),
    ];
  }
  refresh(background = false): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disposed || background && !this.active) return;
      if (vscode.env.remoteName) {
        this.post({type:'powerShellState', inventory:{editions:[], rows:[], error:'PowerShell profiles support local desktop windows. WSL support is planned next.'}});
        return;
      }
      try {
        const inventory = await this.service.refresh();
        if (this.disposed) return;
        await this.watch();
        if (!this.disposed) this.post({type:'powerShellState', inventory});
      } catch (error) {
        this.post({type:'powerShellState', inventory:{editions:[],rows:[],error:String(error)}});
      }
    });
    return this.queue;
  }
  setActive(active: boolean): void {
    const activated = active && !this.active;
    this.active = active;
    if (activated) this.startReconcile();
    if (!active) {
      this.stopReconcile();
      clearTimeout(this.timer);
      for (const watcher of this.watchers.values()) watcher.dispose();
      this.watchers.clear();
      this.armedIdentities.clear();
      this.staleWatchRoots.clear();
    }
  }
  private changed(uris: readonly vscode.Uri[], structural = false): void {
    if (this.active && uris.some(uri => uri.scheme === 'file' && affectsProfile(uri.fsPath, this.dependencies))) {
      // Reattach replaced directories, keeping their unaffected parent watches alive.
      if (structural) for (const base of this.watchers.keys()) {
        if (uris.some(uri => uri.scheme === 'file' && affectsProfile(uri.fsPath, [base]))) this.staleWatchRoots.add(base);
      }
      this.schedule();
    }
  }
  private schedule(): void {
    if (!this.active || this.disposed) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.active && !this.disposed) void this.refresh(true);
    }, 300);
  }
  private startReconcile(): void {
    this.stopReconcile();
    if (this.reconcileMs > 0 && !this.disposed) this.reconcileTimer = setInterval(() => void this.reconcile(), this.reconcileMs);
  }
  private stopReconcile(): void {
    clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    this.reconcileGeneration++;
    this.identities = undefined;
  }
  /** Backstop for dropped watcher events: refresh when a dependency or watched directory is replaced, removed, or created. */
  private async reconcile(): Promise<void> {
    const generation = this.reconcileGeneration;
    const bases = [...this.watchers.keys()];
    const identities = await pathIdentities([...this.dependencies, ...bases]);
    // Paths without a baseline (the first sample, or dependencies a refresh just added such as a new link
    // target) are checked by re-inspecting the shown rows: a change made between that refresh and this
    // sample must not become the baseline unnoticed.
    const inventoryStale = this.lacksBaseline(identities) ? await this.inventoryIsStale() : false;
    // A tick that outlived a deactivate/reactivate cycle must not seed or act on the new cycle.
    if (!this.isReconcileCurrent(generation)) return;
    const previous = this.identities;
    this.identities = identities;
    const changed = inventoryStale || (previous !== undefined && changedIdentities(previous, identities).length > 0);
    const replaced = this.markReplacedBases(identities);
    if (changed || replaced) this.schedule();
  }
  private lacksBaseline(identities: ReadonlyMap<string, string>): boolean {
    const baseline = this.identities;
    return !baseline || [...identities.keys()].some(file => !baseline.has(file));
  }
  private isReconcileCurrent(generation: number): boolean {
    return generation === this.reconcileGeneration && this.active && !this.disposed;
  }
  /** A watched directory replaced or removed since its watch was attached needs a fresh watch, as a structural event would cause. */
  private markReplacedBases(identities: ReadonlyMap<string, string>): boolean {
    let replaced = false;
    for (const [base, armed] of this.armedIdentities) {
      const identity = identities.get(base);
      // Already marked: its refresh is pending, and re-scheduling would keep pushing that refresh back.
      if (identity === undefined || identity === armed || this.staleWatchRoots.has(base)) continue;
      this.staleWatchRoots.add(base);
      replaced = true;
    }
    return replaced;
  }
  /** Whether any shown row's state or link target differs from a fresh inspection, the same check the inventory itself uses. */
  private async inventoryIsStale(): Promise<boolean> {
    const rows = this.service.snapshot.rows;
    const current = await Promise.all(rows.map(row => inspectProfile(row)));
    return current.some((row, index) => row.state !== rows[index]?.state || row.target !== rows[index]?.target);
  }
  private async watch(): Promise<void> {
    if (!this.active || this.disposed) return;
    const files = this.service.snapshot.rows.flatMap(row => row.path ? [row.path] : []);
    const plan = await profileWatchPlan(files);
    // Taken before attaching, so a replacement racing the attach reads as changed rather than adopted.
    const armed = await pathIdentities(plan.directories);
    if (!this.active || this.disposed) return;
    this.dependencies = plan.paths;
    const bases = new Set(plan.directories);
    for (const [base, watcher] of this.watchers) {
      if (!bases.has(base) || this.staleWatchRoots.has(base)) {
        watcher.dispose();
        this.watchers.delete(base);
        this.armedIdentities.delete(base);
      }
    }
    this.staleWatchRoots.clear();
    for (const base of plan.directories) {
      if (this.watchers.has(base)) continue;
      this.armedIdentities.set(base, armed.get(base) ?? 'missing');
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(base), '*'));
      watcher.onDidCreate(uri => this.changed([uri], true));
      watcher.onDidChange(uri => this.changed([uri]));
      watcher.onDidDelete(uri => this.changed([uri], true));
      this.watchers.set(base, watcher);
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
        // A missing profile's own folder may not exist yet, for example before the first one is created.
        const target = row.state === 'missing' ? await nearestExistingDirectory(path.dirname(row.path)) : row.path;
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(target)); return;
      }
      if (message.action === 'delete') {
        await deleteProfile(location, {
          // VS Code does not document link-only Trash semantics across all platforms.
          canTrashLinks: false,
          isDirty: async file => {
            const target = await fs.realpath(file).catch(() => file);
            // Hard links keep distinct canonical paths, so an alias is recognized by filesystem identity.
            const identity = await fs.stat(file, {bigint:true}).catch(() => undefined);
            for (const document of vscode.workspace.textDocuments) {
              if (!document.isDirty || document.uri.scheme !== 'file') continue;
              const documentPath = await fs.realpath(document.uri.fsPath).catch(() => document.uri.fsPath);
              if (process.platform === 'win32' ? documentPath.toLowerCase() === target.toLowerCase() : documentPath === target) return true;
              if (!identity || identity.nlink < 2n) continue;
              const other = await fs.stat(document.uri.fsPath, {bigint:true}).catch(() => undefined);
              if (other && other.dev === identity.dev && other.ino === identity.ino) return true;
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
          if (!await this.confirmCreate(row.path)) return;
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
    this.stopReconcile();
    clearTimeout(this.timer);
    for (const item of [...this.watchers.values(), ...this.events]) item.dispose();
  }
}
