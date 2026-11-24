import * as vscode from 'vscode';
import * as path from 'node:path';
import { asError } from '../core/errors';
import { fsPathKey, type Platform } from '../core/paths';
import type {
  GitConfigSnapshot,
  GitConfigFile,
  GitConfigInclude,
  GitConfigResult,
  GitConfigService,
  GitIdentityValue,
  GitIncludeStatus,
} from '../git/configService';
import { gitHome, standardConfigFiles } from '../git/configService';
import { renderEffectiveConfiguration } from '../git/effectiveConfiguration';

export type GitNode =
  | { kind: 'identity'; value: GitIdentityValue }
  | { kind: 'file'; file: GitConfigFile }
  | { kind: 'include'; include: GitConfigInclude };

const messages = {
  remote: 'Git Configuration supports local desktop windows only.',
  gitMissing: 'Git was not found. Install Git or set the git.path setting, then refresh.',
  noRepository: 'No repository is open. Showing system and global configuration only.',
};

const statuses: Record<GitIncludeStatus, { label: string; icon: string; detail: string }> = {
  applied: { label: 'Applied', icon: 'pass', detail: 'Git takes values from this file for the current repository.' },
  notApplied: { label: 'Not applied here', icon: 'circle-slash', detail: 'This file has values, but none are in effect for the current repository.' },
  empty: { label: 'Empty', icon: 'circle-outline', detail: 'This file exists and holds no values.' },
  missing: { label: 'Missing', icon: 'warning', detail: 'This file does not exist.' },
};

/** The context value of a row with an open button; see `view/item/context` in package.json. */
const openableFile = 'personas.gitConfigFile';

type Service = Pick<GitConfigService, 'inspect' | 'resolveRepository'>;

/**
 * Git Configuration, one of Home's views: the Git identity in effect for the current repository
 * and the config files it comes from. Read-only. Personas opens these files in the editor and
 * never writes them.
 */
export class GitConfigurationView implements vscode.TreeDataProvider<GitNode>, vscode.Disposable {
  static readonly viewId = 'personas.gitConfiguration';

  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly tree: vscode.TreeView<GitNode>;
  private readonly subscriptions: vscode.Disposable[];
  private readonly home: string;
  private readonly onRefreshed: () => void;
  private result: GitConfigResult | undefined;
  private watchers: vscode.Disposable[] = [];
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  /** Whether the pending timer owes a full read, which a later editor move must not downgrade. */
  private readPending = false;
  /** The folder of the last file shown in the editor, kept while the editor shows something that is not a file. */
  private editorFolder: string | undefined;
  private disposed = false;

  constructor(private readonly service: Service, options: { home?: string; onRefreshed?: () => void } = {}) {
    this.home = options.home ?? gitHome();
    this.onRefreshed = options.onRefreshed ?? (() => undefined);
    this.tree = vscode.window.createTreeView(GitConfigurationView.viewId, { treeDataProvider: this });
    this.subscriptions = [
      this.tree,
      this.changeEmitter,
      this.tree.onDidChangeVisibility(() => {
        if (this.tree.visible) void this.refresh(true);
        else this.stopWatching();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule(false)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule(true)),
    ];
    if (this.tree.visible) void this.refresh(true);
  }

  /** Reads the configuration again. A background refresh is skipped while the view is hidden. */
  refresh(background = false): Promise<void> {
    this.queue = this.queue.then(async () => {
      if (this.disposed || (background && !this.tree.visible)) return;
      this.result = vscode.env.remoteName ? undefined : await this.service.inspect(this.candidateFolders());
      if (this.disposed) return;
      this.describe();
      this.watch();
      this.changeEmitter.fire();
      this.onRefreshed();
    });
    return this.queue;
  }

  /** The text of the Effective Git Configuration document, from what the view last read. */
  effectiveText(): string {
    if (this.result?.kind === 'ok') return renderEffectiveConfiguration(this.result);
    return `# ${this.failure() ?? 'Git configuration has not been read yet.'}\n`;
  }

  /** The open button of a file row: the file opens in the normal editor, where the user edits and saves it. */
  async openFile(node: GitNode | undefined): Promise<void> {
    const file = node?.kind === 'file' ? node.file.path : node?.kind === 'include' ? node.include.path : undefined;
    if (file === undefined) return;
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: false });
    } catch (e) {
      void vscode.window.showErrorMessage(`Personas: couldn't open ${file}: ${asError(e).message}`);
    }
  }

  getChildren(node?: GitNode): GitNode[] {
    if (this.result?.kind !== 'ok') return [];
    if (!node) {
      return [
        ...this.result.identity.map((value): GitNode => ({ kind: 'identity', value })),
        ...this.result.files.map((file): GitNode => ({ kind: 'file', file })),
      ];
    }
    const includes = node.kind === 'file' ? node.file.includes : node.kind === 'include' ? node.include.includes : [];
    return includes.map((include): GitNode => ({ kind: 'include', include }));
  }

  getTreeItem(node: GitNode): vscode.TreeItem {
    if (node.kind === 'identity') return this.identityItem(node.value);
    if (node.kind === 'file') {
      const { scope, path: file, includes } = node.file;
      const item = new vscode.TreeItem(scope.charAt(0).toUpperCase() + scope.slice(1), expandedIf(includes));
      item.description = this.short(file);
      item.tooltip = file;
      item.iconPath = new vscode.ThemeIcon('file');
      item.contextValue = openableFile;
      return item;
    }
    const { condition, writtenPath, path: file, status, includes } = node.include;
    const shown = status === undefined ? undefined : statuses[status];
    const item = new vscode.TreeItem(writtenPath, expandedIf(includes));
    item.description = [condition, shown?.label].filter((part) => part !== undefined).join(' · ');
    item.tooltip = [file, shown?.detail].filter((part) => part !== undefined).join('\n');
    item.iconPath = new vscode.ThemeIcon(shown?.icon ?? 'file');
    if (status !== 'missing') item.contextValue = openableFile;
    return item;
  }

  private identityItem(value: GitIdentityValue): vscode.TreeItem {
    const item = new vscode.TreeItem(value.key);
    item.iconPath = new vscode.ThemeIcon(value.key === 'user.name' ? 'account' : 'mail');
    if (value.value === undefined) {
      item.description = 'not set';
      return item;
    }
    const source = [value.scope, value.file === undefined ? undefined : this.short(value.file)].filter((part) => part !== undefined);
    item.description = `${value.value} · ${source.join(', ')}`;
    item.tooltip = value.file ?? value.scope;
    return item;
  }

  /** A path under the home folder, written the way Git config files write it. */
  private short(file: string): string {
    const relative = path.relative(this.home, file);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return file;
    return `~/${relative.split(path.sep).join('/')}`;
  }

  private failure(): string | undefined {
    if (vscode.env.remoteName) return messages.remote;
    if (this.result?.kind === 'gitMissing') return messages.gitMissing;
    if (this.result?.kind === 'error') return `Git configuration could not be read: ${this.result.message}`;
    return undefined;
  }

  /** The view's own text: the current repository's name, or why there is less to show. */
  private describe(): void {
    const repository = this.result?.kind === 'ok' ? this.result.repository : undefined;
    this.tree.description = repository?.name;
    this.tree.message = this.failure() ?? (this.result?.kind === 'ok' && !repository ? messages.noRepository : undefined);
  }

  /** Debounces a read: a full one, or one made only if the current repository turns out to have changed. */
  private schedule(read: boolean): void {
    if (!this.tree.visible || this.disposed) return;
    this.readPending ||= read;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const full = this.readPending;
      this.readPending = false;
      void (full ? this.refresh(true) : this.followEditor());
    }, 300);
  }

  /** The active editor moved: read again only if that changes which repository is the current one. */
  private async followEditor(): Promise<void> {
    // A read still under way decides what is shown, so the comparison waits for it, before and after asking Git.
    await this.queue;
    if (this.result?.kind !== 'ok' || vscode.env.remoteName) return this.refresh(true);
    // A repository Git cannot read is not "no repository": a full read is what reports the error.
    const unreadable = Symbol('unreadable');
    const current = await this.service.resolveRepository(this.candidateFolders()).then((repository) => repository?.root, () => unreadable);
    await this.queue;
    const shown = this.result?.kind === 'ok' ? this.result.repository?.root : undefined;
    if (current !== shown) await this.refresh(true);
  }

  /**
   * Where to look for the current repository: the active editor's file first, then the first
   * workspace folder. An editor that shows no file, such as the Effective Git Configuration
   * document itself, leaves the current repository where it was.
   */
  private candidateFolders(): string[] {
    const editor = vscode.window.activeTextEditor?.document.uri;
    // With a tab open and no text editor, the editor is between two documents or shows something
    // that is not text; only an empty editor area gives the current repository up.
    if (!editor && !vscode.window.tabGroups.activeTabGroup.activeTab) this.editorFolder = undefined;
    else if (editor?.scheme === 'file') this.editorFolder = path.dirname(editor.fsPath);
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    return [
      ...(this.editorFolder === undefined ? [] : [this.editorFolder]),
      ...(folder?.scheme === 'file' ? [folder.fsPath] : []),
    ];
  }

  /**
   * Watches every listed file, and the repository's HEAD because `onbranch:` conditions depend on
   * it. Each folder is watched as a whole and changes are matched by path: a file name is not a
   * safe glob pattern (`active[1].inc`). A read already scheduled survives the watchers' renewal.
   */
  private watch(): void {
    // A failed read keeps the last known watches: correcting the file that broke it must be seen.
    if (this.tree.visible && this.result !== undefined && this.result.kind !== 'ok') return;
    this.releaseWatchers();
    if (!this.tree.visible || this.result?.kind !== 'ok') return;
    const byFolder = new Map<string, Set<string>>();
    for (const file of [...watchedFiles(this.result), ...standardConfigFiles(this.home, this.result.repository)]) {
      const folder = path.dirname(file);
      byFolder.set(folder, (byFolder.get(folder) ?? new Set()).add(fileKey(file)));
    }
    for (const [folder, files] of byFolder) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), '*'));
      const changed = (uri: vscode.Uri) => {
        if (files.has(fileKey(uri.fsPath))) this.schedule(true);
      };
      watcher.onDidCreate(changed);
      watcher.onDidChange(changed);
      watcher.onDidDelete(changed);
      this.watchers.push(watcher);
    }
  }

  private releaseWatchers(): void {
    for (const watcher of this.watchers.splice(0)) watcher.dispose();
  }

  /** The view is hidden or gone: nothing is watched and nothing is owed. */
  private stopWatching(): void {
    clearTimeout(this.timer);
    this.readPending = false;
    this.releaseWatchers();
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching();
    for (const item of this.subscriptions) item.dispose();
  }
}

const fileKey = (file: string) => fsPathKey(file, process.platform as Platform);

/** Every listed file, and the repository's HEAD. */
function watchedFiles(snapshot: GitConfigSnapshot): string[] {
  const files: string[] = [];
  const add = (includes: readonly GitConfigInclude[]): void => {
    for (const include of includes) {
      files.push(include.path);
      add(include.includes);
    }
  };
  for (const file of snapshot.files) {
    files.push(file.path);
    add(file.includes);
  }
  if (snapshot.repository) files.push(path.join(snapshot.repository.gitDir, 'HEAD'));
  return files;
}

function expandedIf(includes: readonly unknown[]): vscode.TreeItemCollapsibleState {
  return includes.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
}

