import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService, type InventoryIo } from '../../src/core/inventory';
import { resolvePaths } from '../../src/core/paths';
import { HomeViewProvider } from '../../src/panel/homeView';
import { PowerShellService } from '../../src/powershell/service';
import type { HomeToHost, HostToHome } from '../../src/protocol';

const mock = vi.hoisted(() => ({ services: undefined as unknown, commands: [] as string[] }));
vi.mock('vscode', () => {
  const event = () => ({ dispose: () => undefined });
  return {
    env: {},
    Uri: {
      file: (fsPath: string) => ({ scheme: 'file', fsPath }),
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        scheme: 'file',
        fsPath: [base.fsPath, ...parts].join('/'),
      }),
    },
    RelativePattern: class {
      constructor(public baseUri: unknown, public pattern: string) {}
    },
    commands: {
      executeCommand: async (command: string) => {
        mock.commands.push(command);
      },
    },
    window: { showErrorMessage: () => undefined },
    workspace: {
      textDocuments: [],
      getConfiguration: () => ({ get: <T>(_key: string, fallback: T) => fallback }),
      onDidSaveTextDocument: event,
      onDidCreateFiles: event,
      onDidDeleteFiles: event,
      onDidRenameFiles: event,
      createFileSystemWatcher: () => ({
        onDidCreate: event,
        onDidChange: event,
        onDidDelete: event,
        dispose: () => undefined,
      }),
    },
  };
});
vi.mock('../../src/servicesFactory', () => ({ getOrBuildServices: async () => mock.services }));

const providers: { dispose(): void }[] = [];
afterEach(() => {
  providers.splice(0).forEach((item) => item.dispose());
  mock.commands.length = 0;
});

/** A stand-in for VS Code's sidebar view. Its script is not run: the test sends `ready` as the script would. */
function fakeView() {
  const posted: HostToHome[] = [];
  let onMessage: (message: HomeToHost) => void = () => undefined;
  let onVisibility: () => void = () => undefined;
  const view = {
    visible: true,
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: async (message: HostToHome) => {
        posted.push(message);
        return true;
      },
      onDidReceiveMessage: (callback: (message: HomeToHost) => void) => {
        onMessage = callback;
        return { dispose: () => undefined };
      },
    },
    onDidChangeVisibility: (callback: () => void) => {
      onVisibility = callback;
      return { dispose: () => undefined };
    },
    onDidDispose: () => ({ dispose: () => undefined }),
  };
  return {
    view,
    posted,
    ready: () => onMessage({ type: 'ready' }),
    setVisible: (visible: boolean) => {
      view.visible = visible;
      onVisibility();
    },
  };
}

function setup() {
  const paths = resolvePaths({
    globalStorageFsPath: '/data/User/globalStorage/samerde.personas',
    extensionFsPath: '/ext/samerde.personas-1.0.0',
    platform: 'linux',
  });
  const io: InventoryIo = {
    readFile: async (file) =>
      file === paths.storageJson ? JSON.stringify({ userDataProfiles: [{ location: 'aaa', name: 'Work' }] }) : undefined,
    listDirs: async () => [],
    readPackageMeta: async () => undefined,
  };
  const inventory = new InventoryService(paths, io);
  const getInventory = vi.spyOn(inventory, 'getInventory');
  mock.services = { inventory, paths, workspace: { getWorkspaceInventory: async () => undefined } };
  const discover = vi.fn(async () => [{ edition: 'PowerShell 7' as const, installations: [] }]);
  const subscriptions: { dispose(): void }[] = [];
  const context = { subscriptions, extensionUri: { scheme: 'file', fsPath: '/ext/samerde.personas-1.0.0' } };
  const provider = new HomeViewProvider(context as never, new PowerShellService(discover, undefined, 'linux'));
  providers.push({ dispose: () => subscriptions.forEach((item) => item.dispose()) });
  return { provider, discover, getInventory };
}

const types = (posted: HostToHome[]) => posted.map((message) => message.type);
/** Both sections have posted fresh state `count` times. */
const settled = (posted: HostToHome[], count: number) =>
  vi.waitFor(() => {
    expect(posted.filter((message) => message.type === 'state')).toHaveLength(count);
    expect(posted.filter((message) => message.type === 'powerShellState')).toHaveLength(count);
  });

it('reads each section once when Home is first shown', async () => {
  const { provider, discover, getInventory } = setup();
  const home = fakeView();
  provider.resolveWebviewView(home.view as never);
  home.ready();
  await settled(home.posted, 1);
  expect(discover).toHaveBeenCalledTimes(1);
  expect(getInventory).toHaveBeenCalledTimes(1);
});

it('reads each section once more when Home is shown again', async () => {
  const { provider, discover, getInventory } = setup();
  const home = fakeView();
  provider.resolveWebviewView(home.view as never);
  home.ready();
  await settled(home.posted, 1);

  // Hiding the sidebar discards the webview; showing it again reloads the script, which sends `ready`.
  home.setVisible(false);
  home.posted.length = 0;
  home.setVisible(true);
  home.ready();
  // The last known state of both sections, then their fresh state.
  await settled(home.posted, 2);
  expect(discover).toHaveBeenCalledTimes(2);
  expect(getInventory).toHaveBeenCalledTimes(2);
});

it('paints both sections from their last known state as soon as a reshown Home is ready', async () => {
  const { provider } = setup();
  const home = fakeView();
  provider.resolveWebviewView(home.view as never);
  home.ready();
  await settled(home.posted, 1);
  const [state, powerShellState] = ['state', 'powerShellState'].map((type) =>
    home.posted.find((message) => message.type === type),
  );

  home.setVisible(false);
  home.posted.length = 0;
  home.setVisible(true);
  home.ready();
  // Synchronously: before either section's refresh has had a chance to finish.
  expect(types(home.posted)).toEqual(['state', 'powerShellState']);
  expect(home.posted).toEqual([state, powerShellState]);
});

it('paints nothing from memory the first time Home is shown', () => {
  const { provider } = setup();
  const home = fakeView();
  provider.resolveWebviewView(home.view as never);
  home.ready();
  expect(home.posted).toEqual([]);
});
