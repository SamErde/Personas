// The Extension Matrix panel keeps the matrix's view state for the session, so closing and
// reopening the panel brings the view back. VS Code is replaced by a fake panel that records what
// the host posts and lets the test speak for the webview.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToMatrix, MatrixToHost } from '../../src/protocol';
import type { Services } from '../../src/servicesFactory';
import { MatrixPanel } from '../../src/panel/matrixPanel';
import { NO_FILTERS } from '../../src/webview/render';
import { inv } from './matrixDom';

interface FakePanel {
  posted: HostToMatrix[];
  receive(message: MatrixToHost): void;
  close(): void;
}

const mock = vi.hoisted(() => ({ panels: [] as FakePanel[] }));

vi.mock('vscode', () => ({
  ViewColumn: { One: 1 },
  Uri: {
    file: (fsPath: string) => ({ fsPath, toString: () => fsPath }),
    joinPath: (base: { fsPath: string }, ...parts: string[]) => ({ fsPath: [base.fsPath, ...parts].join('/') }),
  },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
  window: {
    createWebviewPanel: () => {
      let onMessage: (message: MatrixToHost) => void = () => undefined;
      let onDispose: () => void = () => undefined;
      const fake: FakePanel = {
        posted: [],
        receive: (message) => onMessage(message),
        close: () => onDispose(),
      };
      mock.panels.push(fake);
      return {
        reveal: () => undefined,
        onDidDispose: (listener: () => void) => (onDispose = listener),
        webview: {
          html: '',
          cspSource: 'vscode-resource:',
          asWebviewUri: (uri: { fsPath: string }) => uri.fsPath,
          postMessage: async (message: HostToMatrix) => fake.posted.push(message),
          onDidReceiveMessage: (listener: (message: MatrixToHost) => void) => (onMessage = listener),
        },
      };
    },
  },
}));

const context = { extensionUri: { fsPath: '/personas' } } as never;
const services = {
  paths: { extensionsDir: '/extensions' },
  inventory: { getInventory: async () => inv },
  workspace: { getWorkspaceInventory: async () => undefined },
  mutations: {},
  cleanup: {},
} as unknown as Services;

/** Lets the panel's message queue run what the fake webview sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  mock.panels.at(-1)?.close();
  mock.panels.length = 0;
});

/**
 * Opens a panel, lets the test act on it as its webview, closes it, then opens a new panel and
 * has its webview signal ready. Returns what the host posted to the new panel.
 */
async function reopenAfter(firstServices: Services, actOnFirst: (first: FakePanel) => Promise<void> | void): Promise<HostToMatrix[]> {
  MatrixPanel.show(context, firstServices);
  const first = mock.panels[0]!;
  await actOnFirst(first);
  first.close();

  MatrixPanel.show(context, services);
  const second = mock.panels[1]!;
  second.receive({ type: 'ready' });
  await settle();
  return second.posted;
}

describe('view state across closing and reopening the panel', () => {
  it('is sent to the reopened panel before its first inventory', async () => {
    const state = {
      filters: { ...NO_FILTERS, view: 'orphaned' as const, text: 'Be', categories: ['Linters'], publishers: ['contoso'], sources: ['vsix'] },
    };

    const posted = await reopenAfter(services, async (first) => {
      first.receive({ type: 'viewState', state });
      await settle();
    });

    expect(posted.map((m) => m.type)).toEqual(['viewState', 'inventory']);
    expect(posted[0]).toEqual({ type: 'viewState', state });
  });

  it('is kept at once, even while the closing panel is still reading the inventory', async () => {
    let finishRead: () => void = () => undefined;
    const slowRead = new Promise<void>((resolve) => (finishRead = resolve));
    const slow = { ...services, inventory: { getInventory: async () => (await slowRead, inv) } } as unknown as Services;
    const state = { filters: { ...NO_FILTERS, view: 'appliedToAllProfiles' as const } };

    const posted = await reopenAfter(slow, (first) => {
      first.receive({ type: 'refresh' }); // still running when the person changes the view and closes
      first.receive({ type: 'viewState', state });
    });
    finishRead();

    expect(posted[0]).toEqual({ type: 'viewState', state });
  });
});
