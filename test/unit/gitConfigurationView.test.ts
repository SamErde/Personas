import { afterEach, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import type { GitConfigResult, GitConfigSnapshot, GitRepository } from '../../src/git/configService';
import { GitConfigurationView, type GitNode } from '../../src/panel/gitConfigurationView';

/** The parts of VS Code the view touches. The tests drive its events and read what the view set. */
const mock = vi.hoisted(() => ({
  remoteName: undefined as string | undefined,
  activeFile: undefined as string | undefined,
  activeScheme: 'file',
  /** Whether the editor area has a tab open, with or without a text editor in it. */
  tabOpen: false,
  workspaceFolders: [] as string[],
  tree: { visible: true, message: undefined as string | undefined, description: undefined as string | undefined },
  visibility: (() => undefined) as () => void,
  editorChanged: (() => undefined) as () => void,
  watchers: [] as { base: string; pattern: string; disposed: boolean; fire(file: string): void }[],
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
      tabGroups: { get activeTabGroup() { return { activeTab: mock.tabOpen ? {} : undefined }; } },
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
        let changed: (changedUri: unknown) => void = () => undefined;
        const on = (callback: (changedUri: unknown) => void) => {
          changed = callback;
          return { dispose: () => undefined };
        };
        const watcher = {
          base: pattern.baseUri.fsPath,
          pattern: pattern.pattern,
          disposed: false,
          fire: (file: string) => changed(uri(file)),
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
  mock.tabOpen = false;
  vi.unstubAllEnvs();
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

/** A change to `file` as VS Code reports it: to every live watcher of the folder it is in. */
function change(file: string): void {
  for (const watcher of mock.watchers) {
    if (!watcher.disposed && watcher.base === path.dirname(file)) watcher.fire(file);
  }
}

function setup(result: GitConfigResult = snapshot()) {
  // The developer's own Git locations must not decide which folders are watched.
  vi.stubEnv('GIT_CONFIG_GLOBAL', '');
  vi.stubEnv('XDG_CONFIG_HOME', '');
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

  // Nor does the moment between two documents, when a tab is open and no text editor is active.
  mock.activeFile = undefined;
  mock.tabOpen = true;
  await view.refresh();
  expect(service.inspect).toHaveBeenLastCalledWith([at('code', 'work', 'src'), at('code', 'other')]);

  // An empty editor area does: the first workspace folder is all that is left.
  mock.tabOpen = false;
  await view.refresh();
  expect(service.inspect).toHaveBeenLastCalledWith([at('code', 'other')]);
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
  // Folders are watched whole and changes matched by path, so a file name is never read as a glob.
  const live = mock.watchers.filter((watcher) => !watcher.disposed);
  // The standard global locations are watched too, so a config file created later is seen.
  expect(live.map((watcher) => [watcher.base, watcher.pattern])).toEqual([
    [at('home'), '*'],
    [work.gitDir, '*'],
    [at('home', '.config', 'git'), '*'],
  ]);

  for (const file of [at('home', 'work.inc'), at('home', 'gone.inc'), path.join(work.gitDir, 'HEAD')]) {
    service.inspect.mockClear();
    change(file);
    await vi.advanceTimersByTimeAsync(350);
    expect(service.inspect).toHaveBeenCalledTimes(1);
  }

  // A global config file that did not exist when the view last read.
  service.inspect.mockClear();
  change(at('home', '.config', 'git', 'config'));
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).toHaveBeenCalledTimes(1);

  // A file in a watched folder that the view does not list changes nothing.
  service.inspect.mockClear();
  change(at('home', 'notes.txt'));
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).not.toHaveBeenCalled();

  // An editor move right after a file change does not swallow the read the change asked for.
  service.inspect.mockClear();
  change(globalFile);
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).toHaveBeenCalledTimes(1);

  // Hidden: nothing is watched, and a late event does not reach Git.
  service.inspect.mockClear();
  const armed = mock.watchers.filter((watcher) => !watcher.disposed);
  mock.tree.visible = false;
  mock.visibility();
  expect(armed.every((watcher) => watcher.disposed)).toBe(true);
  armed[0]!.fire(globalFile);
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).not.toHaveBeenCalled();

  // Shown again: the view catches up.
  mock.tree.visible = true;
  mock.visibility();
  await vi.advanceTimersByTimeAsync(0);
  expect(service.inspect).toHaveBeenCalledTimes(1);
});

it('matches a config file whose name has glob characters', async () => {
  const bracketed = snapshot();
  bracketed.files[0]!.includes = [{ writtenPath: 'active[1].inc', path: at('home', 'active[1].inc'), status: 'applied', includes: [] }];
  const { service, view } = setup(bracketed);
  await view.refresh();
  vi.useFakeTimers();
  service.inspect.mockClear();

  change(at('home', 'active[1].inc'));
  await vi.advanceTimersByTimeAsync(350);
  expect(service.inspect).toHaveBeenCalledTimes(1);
});

it('keeps watching after a failed read, so correcting the file is seen', async () => {
  const { service, view } = setup();
  await view.refresh();
  service.result = { kind: 'error', message: 'bad config line 3' };
  await view.refresh();
  expect(mock.tree.message).toBe('Git configuration could not be read: bad config line 3');
  vi.useFakeTimers();
  service.inspect.mockClear();

  service.result = snapshot();
  change(globalFile);
  await vi.advanceTimersByTimeAsync(350);

  expect(service.inspect).toHaveBeenCalledTimes(1);
  expect(mock.tree.message).toBeUndefined();
});

it('keeps a change that arrives while a read is under way', async () => {
  const { service, view } = setup();
  await view.refresh();
  vi.useFakeTimers();
  service.inspect.mockClear();
  let finish: (result: GitConfigResult) => void = () => undefined;
  service.inspect.mockImplementationOnce(() => new Promise<GitConfigResult>((resolve) => { finish = resolve; }));

  const reading = view.refresh();
  await vi.advanceTimersByTimeAsync(0);
  change(globalFile);
  finish(snapshot());
  await reading;
  await vi.advanceTimersByTimeAsync(350);

  // The read under way, then one more for the change it could not have seen.
  expect(service.inspect).toHaveBeenCalledTimes(2);
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

it('reads again when the active editor moves into a repository Git cannot read, so the error shows', async () => {
  const { service, view } = setup(snapshot(null));
  await view.refresh();
  vi.useFakeTimers();
  service.inspect.mockClear();

  mock.activeFile = at('code', 'broken', 'a.ts');
  service.resolveRepository.mockRejectedValueOnce(new Error('bad config line 3'));
  service.result = { kind: 'error', message: 'bad config line 3' };
  mock.editorChanged();
  await vi.advanceTimersByTimeAsync(350);

  expect(service.inspect).toHaveBeenCalledTimes(1);
  expect(mock.tree.message).toBe('Git configuration could not be read: bad config line 3');
});

it('renders the effective configuration of what it last read', async () => {
  const { view } = setup();
  await view.refresh();
  expect(view.effectiveText()).toContain(`# Repository: ${work.root}`);
  expect(view.effectiveText()).toContain('user.name\n    Base');
});
