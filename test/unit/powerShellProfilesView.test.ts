import { afterEach, expect, it, vi } from 'vitest';
import { PowerShellProfilesViewProvider } from '../../src/panel/powerShellProfilesView';
import { PowerShellService } from '../../src/powershell/service';
import type { HostToPowerShellProfiles, PowerShellProfilesToHost } from '../../src/protocol';
import type * as Doubles from './sidebarDoubles';
import { fakeContext, fakeView, vscodeState } from './sidebarDoubles';

vi.mock('vscode', async () => (await vi.importActual<typeof Doubles>('./sidebarDoubles')).vscodeDouble());

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vscodeState.reset();
});

/** The view shown for the first time, as VS Code does it: the view resolves, then its page's script sends `ready`. */
function show() {
  const discover = vi.fn(async () => [{ edition: 'PowerShell 7' as const, installations: [] }]);
  const { context, dispose } = fakeContext();
  cleanup.push(dispose);
  const provider = new PowerShellProfilesViewProvider(context, new PowerShellService(discover, undefined, 'linux'));
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
  await settled(page.posted, 1);
  const lastKnown = [...page.posted];

  page.reshow();
  // Synchronously: before the refresh has had a chance to finish.
  expect(page.posted).toEqual(lastKnown);
});

it('refreshes from the view title button', async () => {
  const { provider, discover, page } = show();
  await settled(page.posted, 1);

  await provider.refresh();
  expect(discover).toHaveBeenCalledTimes(2);
  expect(page.posted).toHaveLength(2);
});

it('opens the PowerShell profiles article from the view title button', async () => {
  const { provider } = show();
  await provider.help();
  expect(vscodeState.opened).toEqual([
    'https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles',
  ]);
});
