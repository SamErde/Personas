import { afterEach, expect, it, vi } from 'vitest';
import { PowerShellProfilesViewProvider } from '../../src/panel/powerShellProfilesView';
import { PowerShellService } from '../../src/powershell/service';
import type { HostToPowerShellProfiles, PowerShellProfilesToHost } from '../../src/protocol';
import type * as Doubles from './sidebarDoubles';
import { fakeContext, fakeView, resetSidebarDoubles, vscodeState } from './sidebarDoubles';

vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());

afterEach(resetSidebarDoubles);

/** The view shown for the first time, as VS Code does it: the view resolves, then its page's script sends `ready`. */
function show() {
  const discover = vi.fn(async () => [{ edition: 'PowerShell 7' as const, installations: [] }]);
  const provider = new PowerShellProfilesViewProvider(fakeContext(), new PowerShellService(discover, undefined, 'linux'));
  const page = fakeView<HostToPowerShellProfiles, PowerShellProfilesToHost>();
  provider.resolveWebviewView(page.view);
  page.ready();
  return { provider, discover, page };
}
const settled = (posted: HostToPowerShellProfiles[], count: number) =>
  vi.waitFor(() => expect(posted).toHaveLength(count));

it('discovers PowerShell profiles once per show of the view', async () => {
  const { discover, page } = show();
  await settled(page.posted, 1);
  expect(discover).toHaveBeenCalledTimes(1);

  page.reshow();
  // The last known list, then the fresh one.
  await settled(page.posted, 2);
  expect(discover).toHaveBeenCalledTimes(2);
});

it('paints the last known list as soon as a reshown view is ready', async () => {
  const { page } = show();
  const { lastKnown, repainted } = await page.repaint(() => settled(page.posted, 1));
  expect(lastKnown).toHaveLength(1);
  expect(repainted).toEqual(lastKnown);
});

it('applies edition exclusion to the first cached paint and to stale row actions', async () => {
  const discover = vi.fn(async (includeWindows: boolean) => {
    const seven = {edition:'PowerShell 7' as const, installations:[]};
    return includeWindows ? [seven, {edition:'Windows PowerShell' as const, installations:[]}] : [seven];
  });
  const service = new PowerShellService(discover, undefined, 'win32');
  const provider = new PowerShellProfilesViewProvider(fakeContext(), service);
  const page = fakeView<HostToPowerShellProfiles, PowerShellProfilesToHost>();
  provider.resolveWebviewView(page.view);
  page.ready();
  await settled(page.posted, 1);
  const oldRow = service.snapshot.rows.find(row => row.edition === 'Windows PowerShell')!;
  page.setVisible(false);
  vscodeState.settings.includeWindowsPowerShell = {workspaceValue:false};
  provider.settingsChanged(true);
  page.reshow();
  expect(page.posted[0]).toMatchObject({
    type:'powerShellState', inventory:{editions:[{edition:'PowerShell 7'}]},
  });
  expect(discover).toHaveBeenLastCalledWith(true); // The passive refresh is still queued.
  page.send({type:'powerShellAction', action:'reveal', id:oldRow.id});
  await vi.waitFor(() => expect(vscodeState.errors).toContain('Personas: Error: Windows PowerShell is excluded in Personas Settings'));
  await vi.waitFor(() => expect(discover).toHaveBeenLastCalledWith(false));
  expect(vscodeState.commands).not.toContain('revealFileInOS');
});

it('refreshes from the view title button', async () => {
  const { provider, discover, page } = show();
  await settled(page.posted, 1);

  await provider.refresh();
  expect(discover).toHaveBeenCalledTimes(2);
  expect(page.posted).toHaveLength(2);
});

it('opens section help in the visible page and waits for a hidden page to become ready', async () => {
  const { provider, page } = show();
  await settled(page.posted, 1);
  await provider.help();
  expect(page.posted.at(-1)).toEqual({type:'showPowerShellHelp'});
  page.setVisible(false);
  await provider.help();
  expect(vscodeState.commands).toContain('personas.powerShellProfiles.focus');
  page.reshow();
  expect(page.posted).toContainEqual({type:'showPowerShellHelp'});
});
