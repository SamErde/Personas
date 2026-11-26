import { afterEach, expect, it, vi } from 'vitest';
import { InventoryService, type InventoryIo } from '../../src/core/inventory';
import { resolvePaths } from '../../src/core/paths';
import { VsCodeProfilesViewProvider } from '../../src/panel/vscodeProfilesView';
import type { HostToVsCodeProfiles, VsCodeProfilesToHost } from '../../src/protocol';
import type * as Doubles from './sidebarDoubles';
import { fakeContext, fakeView, resetSidebarDoubles, vscodeState } from './sidebarDoubles';

const mock = vi.hoisted(() => ({ services: undefined as unknown, building: undefined as Promise<void> | undefined }));
vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());
vi.mock('../../src/servicesFactory', () => ({
  getOrBuildServices: async () => {
    await mock.building;
    return mock.services;
  },
}));
// Every extension folder weighs the same, so a size identifies how many folders were measured.
vi.mock('../../src/panel/fsStat', () => ({ statFolder: async () => ({ sizeBytes: 10, lastModifiedMs: 0 }) }));

afterEach(() => {
  mock.building = undefined;
  resetSidebarDoubles();
});

/** The view as VS Code resolves it, before its page has loaded. */
function resolve(extensionFolders: string[] = [], visible = true) {
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
  const page = fakeView<HostToVsCodeProfiles, VsCodeProfilesToHost>(visible);
  new VsCodeProfilesViewProvider(fakeContext()).resolveWebviewView(page.view);
  return { getInventory, page };
}

/** The view shown for the first time: it resolves, then its page's script sends `ready`. */
function show(extensionFolders: string[] = [], visible = true) {
  const shown = resolve(extensionFolders, visible);
  shown.page.ready();
  return shown;
}

const states = (posted: HostToVsCodeProfiles[]) => posted.filter((message) => message.type === 'state');
const settled = (posted: HostToVsCodeProfiles[], count: number) =>
  vi.waitFor(() => expect(states(posted)).toHaveLength(count));
/** Once the view has loaded its content, the Extension Matrix has still not been opened. */
async function staysClosed(posted: HostToVsCodeProfiles[]): Promise<void> {
  await settled(posted, 1);
  expect(matrixOpened()).toBe(0);
}
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
  const { lastKnown, repainted } = await page.repaint(() => settled(page.posted, 1));
  expect(states(lastKnown)).toHaveLength(1);
  expect(repainted).toEqual(lastKnown);
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

it('opens the Extension Matrix each time the view is shown', async () => {
  const { page } = show();
  await settled(page.posted, 1);
  expect(matrixOpened()).toBe(1);

  page.reshow();
  await settled(page.posted, 2);
  expect(matrixOpened()).toBe(2);
});

it('waits for the page to load before opening the Extension Matrix', async () => {
  // VS Code reports a newly resolved view as visible even when the sidebar was closed while the
  // extension was starting. The page loading is what shows the view really is on screen.
  const { page } = resolve();
  await Promise.resolve();
  expect(matrixOpened()).toBe(0);

  page.ready();
  await settled(page.posted, 1);
  expect(matrixOpened()).toBe(1);
});

it('leaves the Extension Matrix closed when the view is hidden while Personas is still setting up', async () => {
  let finishBuilding = () => undefined as void;
  mock.building = new Promise<void>((done) => (finishBuilding = done));
  const { page } = show();
  page.setVisible(false);
  finishBuilding();
  await staysClosed(page.posted);
});

it('leaves the Extension Matrix closed while the view is not visible', () => staysClosed(show([], false).page.posted));

it.each([
  ['when the user turned opening with the sidebar off', 'extensionMatrix.openWithSidebar'],
  ['when the user turned it off under the name the setting had before the rename', 'openMatrixOnActivityBarClick'],
])('leaves the Extension Matrix closed %s', async (_when, setting) => {
  vscodeState.settings = { ['personas.' + setting]: { globalValue: false } };
  await staysClosed(show().page.posted);
});
