import { afterEach, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import type { GitConfigResult, GitConfigSnapshot, GitRepository } from '../../src/git/configService';
import { GitConfigurationView, type GitNode } from '../../src/panel/gitConfigurationView';

/** The parts of VS Code the view touches. The tests drive its events and read what the view set. */
const mock = vi.hoisted(() => ({
  remoteName: undefined as string | undefined,
  activeFile: undefined as string | undefined,
  activeScheme: 'file',
  workspaceFolders: [] as string[],
  tree: { visible: true, message: undefined as string | undefined, description: undefined as string | undefined },
  visibility: (() => undefined) as () => void,
  editorChanged: (() => undefined) as () => void,
  watchers: [] as { base: string; pattern: string; disposed: boolean; fire(): void }[],
}));
vi.mock('vscode', () => {
  const uri = (fsPath: string, scheme = 'file') => ({ scheme, fsPath });
  class EventEmitter {
    event = () => ({ dispose: () => undefined });
    fire(): void {}
    dispose(): void {}
  }
  class TreeItem {
    description?: string;
    contextValue?: string;
    constructor(public label: string, public collapsibleState = 0) {}
  }
  return {
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(public id: string) {} },
    Uri: { file: uri },
    RelativePattern: class { constructor(public baseUri: { fsPath: string }, public pattern: string) {} },
    env: { get remoteName() { return mock.remoteName; } },
    window: {
      get activeTextEditor() {
        return mock.activeFile === undefined ? undefined : { document: { uri: uri(mock.activeFile, mock.activeScheme) } };
      },
      onDidChangeActiveTextEditor: (callback: () => void) => {
        mock.editorChanged = callback;
        return { dispose: () => undefined };
      },
      createTreeView: () => ({
        get visible() { return mock.tree.visible; },
        set message(value: string | undefined) { mock.tree.message = value; },
        set description(value: string | undefined) { mock.tree.description = value; },
        onDidChangeVisibility: (callback: () => void) => {
          mock.visibility = callback;
          return { dispose: () => undefined };
        },
        dispose: () => undefined,
      }),
    },
    workspace: {
      get workspaceFolders() { return mock.workspaceFolders.map((folder) => ({ uri: uri(folder) })); },
      onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
      createFileSystemWatcher: (pattern: { baseUri: { fsPath: string }; pattern: string }) => {
        let changed: () => void = () => undefined;
        const on = (callback: () => void) => {
          changed = callback;
          return { dispose: () => undefined };
        };
        const watcher = {
          base: pattern.baseUri.fsPath,
          pattern: pattern.pattern,
          disposed: false,
          fire: () => changed(),
          onDidCreate: on,
          onDidChange: on,
          onDidDelete: on,
          dispose() { this.disposed = true; },
        };
        mock.watchers.push(watcher);
        return watcher;
      },
    },
  };
});

const views: GitConfigurationView[] = [];
afterEach(() => {
  views.splice(0).forEach((view) => view.dispose());
  mock.remoteName = undefined;
  mock.activeFile = undefined;
  mock.activeScheme = 'file';
  mock.workspaceFolders = [];
  mock.tree = { visible: true, message: undefined, description: undefined };
  mock.watchers.length = 0;
  vi.useRealTimers();
});

const at = (...parts: string[]) => path.resolve('/', ...parts);
const work: GitRepository = { name: 'work', root: at('code', 'work'), gitDir: at('code', 'work', '.git') };
const globalFile = at('home', '.gitconfig');

function snapshot(repository: GitRepository | null = work): GitConfigSnapshot {
  return {
    kind: 'ok',
    ...(repository ? { repository } : {}),
    identity: [
      { key: 'user.name', value: 'Base', scope: 'global', file: globalFile },
      { key: 'user.email' },
    ],
    files: [
      {
        scope: 'global',
        path: globalFile,
        includes: [
          { condition: 'gitdir:~/work/', writtenPath: 'work.inc', path: at('home', 'work.inc'), status: 'applied', includes: [] },
          { condition: 'gitdir:~/oss/', writtenPath: 'oss.inc', path: at('home', 'oss.inc'), status: 'notApplied', includes: [] },
          { writtenPath: 'empty.inc', path: at('home', 'empty.inc'), status: 'empty', includes: [] },
          { condition: 'onbranch:main', writtenPath: '~/gone.inc', path: at('home', 'gone.inc'), status: 'missing', includes: [] },
        ],
      },
      ...(repository ? [{ scope: 'local', path: path.join(repository.gitDir, 'config'), includes: [] }] : []),
    ],
    entries: [{ key: 'user.name', value: 'Base', scope: 'global', origin: `file:${globalFile}`, file: globalFile }],
  };
}

function setup(result: GitConfigResult = snapshot()) {
  const service = {
    result,
    current: (result.kind === 'ok' ? result.repository : undefined) as GitRepository | undefined,
    inspect: vi.fn(async (_folders: readonly string[]) => service.result),
    resolveRepository: vi.fn(async (_folders: readonly string[]) => service.current),
  };
  const view = new GitConfigurationView(service, { home: at('home') });
  views.push(view);
  return { service, view };
}

/** The rows as the user reads them: label, description, and whether the row has an open button. */
function rows(view: GitConfigurationView, parent?: GitNode): unknown[] {
  return view.getChildren(parent).map((node) => {
    const item = view.getTreeItem(node);
    const children = rows(view, node);
    return [item.label, item.description, item.contextValue === 'personas.gitConfigFile', ...(children.length ? [children] : [])];
  });
}

it('shows the effective identity with its source, then the config files with their includes and statuses', async () => {
  const { view } = setup();
  await view.refresh();

  expect(mock.tree.description).toBe('work');
  expect(mock.tree.message).toBeUndefined();
  expect(rows(view)).toEqual([
    ['user.name', 'Base · global, ~/.gitconfig', false],
    ['user.email', 'not set', false],
    ['Global', '~/.gitconfig', true, [
      ['work.inc', 'gitdir:~/work/ · Applied', true],
      ['oss.inc', 'gitdir:~/oss/ · Not applied here', true],
      ['empty.inc', 'Empty', true],
      // Nothing to open: Personas does not create Git config files.
      ['~/gone.inc', 'onbranch:main · Missing', false],
    ]],
    ['Local', path.join(work.gitDir, 'config'), true],
  ]);
});

it('takes the repository of the active editor\'s file, else of the first workspace folder', async () => {
  mock.activeFile = at('code', 'work', 'src', 'index.ts');
  mock.workspaceFolders = [at('code', 'other'), at('code', 'third')];
  const { service, view } = setup();
  await view.refresh();
  expect(service.inspect).toHaveBeenLastCalledWith([at('code', 'work', 'src'), at('code', 'other')]);

  // An editor that shows no file, such as the effective configuration document, changes nothing.
  mock.activeFile = '/Effective Git Configuration (read-only)';
  mock.activeScheme = 'personas-readonly';
  await view.refresh();
  expect(service.inspect).toHaveBeenLastCalledWith([at('code', 'work', 'src'), at('code', 'other')]);
});

it('with no repository, says only system and global configuration is shown and states no include status', async () => {
  const none = snapshot(null);
  none.files[0]!.includes = [{ condition: 'gitdir:~/work/', writtenPath: 'work.inc', path: at('home', 'work.inc'), includes: [] }];
  const { view } = setup(none);
  await view.refresh();

  expect(mock.tree.description).toBeUndefined();
  expect(mock.tree.message).toBe('No repository is open. Showing system and global configuration only.');
  expect(rows(view).at(-1)).toEqual(['Global', '~/.gitconfig', true, [['work.inc', 'gitdir:~/work/', true]]]);
});

it('says so when Git is missing, and when the window is remote', async () => {
  const missing = setup({ kind: 'gitMissing' });
  await missing.view.refresh();
  expect(mock.tree.message).toBe('Git was not found. Install Git or set the git.path setting, then refresh.');
  expect(rows(missing.view)).toEqual([]);

  mock.remoteName = 'wsl';
  const remote = setup();
  await remote.view.refresh();
  expect(mock.tree.message).toBe('Git Configuration supports local desktop windows only.');
  expect(rows(remote.view)).toEqual([]);
  expect(remote.service.inspect).not.toHaveBeenCalled();
});

it('refreshes when a listed config file or the repository\'s HEAD changes, but only while the view is visible', async () => {
  const { service, view } = setup();
  await view.refresh();
  vi.useFakeTimers();
  const watched = mock.watchers.map((watcher) => path.join(watcher.base, watcher.pattern));
  expect(watched).toEqual(expect.arrayContaining([
    globalFile, at('home', 'work.inc'), at('home', 'gone.inc'), path.join(work.gitDir, 'config'), path.join(work.gitDir, 'HEAD'),
  ]));

  for (const file of [at('home', 'work.inc'), path.join(work.gitDir, 'HEAD')]) {
    service.inspect.mockClear();
    mock.watchers.find((watcher) => path.join(watcher.base, watcher.pattern) === file)!.fire();
    await vi.advanceTimersByTimeAsync(350);
    expect(service.inspect).toHaveBeenCalledTimes(1);
  }

  // An editor move right after a file change does not swallow the read the change asked for.
  service.inspect.mockClear();
  mock.watchers.find((watcher) => !watcher.disposed)!.fire();
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).toHaveBeenCalledTimes(1);

  // Hidden: nothing is watched, and a late event does not reach Git.
  service.inspect.mockClear();
  const armed = mock.watchers.filter((watcher) => !watcher.disposed);
  mock.tree.visible = false;
  mock.visibility();
  expect(armed.every((watcher) => watcher.disposed)).toBe(true);
  armed[0]!.fire();
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).not.toHaveBeenCalled();

  // Shown again: the view catches up.
  mock.tree.visible = true;
  mock.visibility();
  await vi.advanceTimersByTimeAsync(0);
  expect(service.inspect).toHaveBeenCalledTimes(1);
});

it('refreshes when the active editor moves to another repository, not when it moves within one', async () => {
  mock.activeFile = at('code', 'work', 'a.ts');
  const { service, view } = setup();
  await view.refresh();
  vi.useFakeTimers();
  service.inspect.mockClear();

  mock.activeFile = at('code', 'work', 'src', 'b.ts');
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).not.toHaveBeenCalled();

  mock.activeFile = at('code', 'oss', 'c.ts');
  service.current = { name: 'oss', root: at('code', 'oss'), gitDir: at('code', 'oss', '.git') };
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).toHaveBeenCalledTimes(1);
});

it('renders the effective configuration of what it last read', async () => {
  const { view } = setup();
  await view.refresh();
  expect(view.effectiveText()).toContain(`# Repository: ${work.root}`);
  expect(view.effectiveText()).toContain('user.name\n    Base');
});
