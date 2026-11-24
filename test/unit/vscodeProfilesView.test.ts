import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService, type InventoryIo } from '../../src/core/inventory';
import { resolvePaths } from '../../src/core/paths';
import { VsCodeProfilesViewProvider } from '../../src/panel/vscodeProfilesView';
import type { HostToVsCodeProfiles, VsCodeProfilesToHost } from '../../src/protocol';
import type * as Doubles from './sidebarDoubles';
import { fakeContext, fakeView, vscodeState } from './sidebarDoubles';

const mock = vi.hoisted(() => ({ services: undefined as unknown }));
vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());
vi.mock('../../src/servicesFactory', () => ({ getOrBuildServices: async () => mock.services }));
// Every extension folder weighs the same, so a size identifies how many folders were measured.
vi.mock('../../src/panel/fsStat', () => ({ statFolder: async () => ({ sizeBytes: 10, lastModifiedMs: 0 }) }));

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vscodeState.reset();
});

/** The view shown for the first time, as VS Code does it: the view resolves, then its page's script sends `ready`. */
function show(extensionFolders: string[] = []) {
  const paths = resolvePaths({
    globalStorageFsPath: '/data/User/globalStorage/samerde.personas',
    extensionFsPath: '/ext/samerde.personas-1.0.0',
    platform: 'linux',
  });
  const io: InventoryIo = {
    readFile: async (file) =>
      file === paths.storageJson ? JSON.stringify({ userDataProfiles: [{ location: 'aaa', name: 'Work' }] }) : undefined,
    listDirs: async () => [...extensionFolders],
    readPackageMeta: async () => undefined,
  };
  const inventory = new InventoryService(paths, io);
  const getInventory = vi.spyOn(inventory, 'getInventory');
  mock.services = { inventory, paths, workspace: { getWorkspaceInventory: async () => undefined } };
  const { context, dispose } = fakeContext();
  cleanup.push(dispose);
  const page = fakeView<HostToVsCodeProfiles, VsCodeProfilesToHost>();
  new VsCodeProfilesViewProvider(context).resolveWebviewView(page.view);
  page.ready();
  return { getInventory, page };
}

const states = (posted: HostToVsCodeProfiles[]) => posted.filter((message) => message.type === 'state');
const settled = (posted: HostToVsCodeProfiles[], count: number) =>
  vi.waitFor(() => expect(states(posted)).toHaveLength(count));
const matrixOpened = () => vscodeState.commands.filter((command) => command === 'personas.showMatrix').length;

it('reads the profiles once per show of the view', async () => {
  const { getInventory, page } = show();
  await settled(page.posted, 1);
  expect(getInventory).toHaveBeenCalledTimes(1);

  page.reshow();
  // The last known state, then the fresh state.
  await settled(page.posted, 2);
  expect(getInventory).toHaveBeenCalledTimes(2);
});

it('paints the last known state as soon as a reshown view is ready', async () => {
  const { page } = show();
  await settled(page.posted, 1);
  const lastKnown = [...page.posted];

  page.reshow();
  // Synchronously: before the refresh has had a chance to finish.
  expect(page.posted).toEqual(lastKnown);
});

it('paints nothing from memory the first time the view is shown', () => {
  expect(show().page.posted).toEqual([]);
});

it('never pairs a new orphan count with the size measured for a different set of orphans', async () => {
  // No profile lists these folders, so both are orphaned.
  const folders = ['pub.one-1.0.0', 'pub.two-1.0.0'];
  const { page } = show(folders);
  const sizes = () => page.posted.flatMap((message) => (message.type === 'orphanSize' ? [message.totalSizeBytes] : []));
  await vi.waitFor(() => expect(sizes()).toEqual([20]));

  folders.pop();
  page.reshow();
  await vi.waitFor(() => expect(sizes().at(-1)).toBe(10));
  // The repaint shows the old count with its own size; the fresh count is followed only by the fresh size.
  const fresh = page.posted.slice(page.posted.map((message) => message.type).lastIndexOf('state'));
  expect(fresh).toMatchObject([{ type: 'state', orphanCount: 1 }, { type: 'orphanSize', totalSizeBytes: 10 }]);
});

it('opens the Extension Matrix each time the view becomes visible', () => {
  const { page } = show();
  expect(matrixOpened()).toBe(1);

  page.setVisible(false);
  expect(matrixOpened()).toBe(1);
  page.setVisible(true);
  expect(matrixOpened()).toBe(2);
});

it('leaves the Extension Matrix closed when the user turned opening with the sidebar off', () => {
  vscodeState.settings = { 'extensionMatrix.openWithSidebar': { globalValue: false } };
  expect(show().page.posted).toEqual([]);
  expect(matrixOpened()).toBe(0);
});

it('still honors the setting under the name it had before the rename', () => {
  vscodeState.settings = { openMatrixOnActivityBarClick: { globalValue: false } };
  show();
  expect(matrixOpened()).toBe(0);
});
