/** Stand-ins for VS Code, shared by the tests of Home's views. */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
const declaredSettings = new Set(Object.keys(manifest.contributes.configuration.properties));

type Inspected = { globalValue?: boolean; workspaceValue?: boolean; workspaceFolderValue?: boolean };

/** What the tests control and observe in the `vscode` double. Reset it between tests. */
export const vscodeState = {
  /** Commands run through `commands.executeCommand`, in order. */
  commands: [] as string[],
  /** The arguments each of those commands was run with, in the same order. */
  commandArgs: [] as unknown[][],
  /** Information messages shown, with their options and button labels. */
  informationMessages: [] as { message: string; options: unknown; items: string[] }[],
  /** The button label the next information message returns; `undefined` means the user dismissed it. */
  informationChoice: undefined as string | undefined,
  /** Values the user set, by fully qualified setting name. */
  settings: {} as Record<string, Inspected>,
  /** URLs opened in the browser. */
  opened: [] as string[],
  errors: [] as string[],
  reset(): void {
    this.commands.length = 0;
    this.commandArgs.length = 0;
    this.informationMessages.length = 0;
    this.informationChoice = undefined;
    this.opened.length = 0;
    this.errors.length = 0;
    this.settings = {};
  },
};

const contexts: { dispose(): void }[] = [];
/** Run after each test: releases what the views registered and clears what the `vscode` double recorded. */
export function resetSidebarDoubles(): void {
  contexts.splice(0).forEach((context) => context.dispose());
  vscodeState.reset();
}

/** The parts of the `vscode` module that Home's views touch. Use as the factory of `vi.mock('vscode', …)`. */
export function vscodeDouble() {
  const event = () => ({ dispose: () => undefined });
  return {
    env: {
      openExternal: async (uri: { path: string }) => {
        vscodeState.opened.push(uri.path);
        return true;
      },
    },
    Uri: {
      file: (fsPath: string) => ({ scheme: 'file', fsPath }),
      parse: (path: string) => ({ scheme: 'https', path }),
      joinPath: (base: { fsPath: string }, ...parts: string[]) => ({
        scheme: 'file',
        fsPath: [base.fsPath, ...parts].join('/'),
        toString: () => [base.fsPath, ...parts].join('/'),
      }),
    },
    RelativePattern: class {
      constructor(public baseUri: unknown, public pattern: string) {}
    },
    commands: {
      executeCommand: async (command: string, ...args: unknown[]) => {
        vscodeState.commands.push(command);
        vscodeState.commandArgs.push(args);
      },
    },
    window: {
      showErrorMessage: (message: string) => vscodeState.errors.push(message),
      showInformationMessage: async (message: string, options: unknown, ...items: string[]) => {
        vscodeState.informationMessages.push({ message, options, items });
        return vscodeState.informationChoice;
      },
    },
    workspace: {
      textDocuments: [],
      getConfiguration: (section: string) => {
        const inspect = (key: string) => {
          const id = section + '.' + key;
          if (!declaredSettings.has(id)) throw new Error('Undeclared Personas setting: ' + id);
          return vscodeState.settings[id];
        };
        return {
          inspect,
          get: <T>(key: string, fallback: T) => {
            const value = inspect(key);
            return value?.workspaceValue ?? value?.globalValue ?? fallback;
          },
        };
      },
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
}

/** The extension context a view provider is built with. `resetSidebarDoubles` releases what the provider registers. */
export function fakeContext() {
  const subscriptions: { dispose(): void }[] = [];
  contexts.push({ dispose: () => subscriptions.splice(0).forEach((item) => item.dispose()) });
  return { subscriptions, extensionUri: { scheme: 'file', fsPath: '/ext/samerde.personas-1.0.0' } } as never;
}

/**
 * A stand-in for one of VS Code's sidebar views. The page's script is not run: a test sends `ready`
 * as the script would, and reads what the host posted to the page.
 */
export function fakeView<ToPage, ToHost extends { type: string }>(visible = true) {
  const posted: ToPage[] = [];
  let onMessage: (message: ToHost) => void = () => undefined;
  let onVisibility: () => void = () => undefined;
  const view = {
    visible,
    webview: {
      options: {},
      html: '',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: async (message: ToPage) => {
        posted.push(message);
        return true;
      },
      onDidReceiveMessage: (callback: (message: ToHost) => void) => {
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
  const setVisible = (visible: boolean) => {
    view.visible = visible;
    onVisibility();
  };
  const ready = () => onMessage({ type: 'ready' } as ToHost);
  const reshow = () => {
    setVisible(false);
    posted.length = 0;
    setVisible(true);
    ready();
  };
  return {
    view: view as never,
    posted,
    ready,
    send: (message: ToHost) => onMessage(message),
    setVisible,
    /** Hiding the sidebar discards the page; showing it again reloads the script, which sends `ready`. */
    reshow,
    /**
     * Reshows the view once `settled` resolves, and returns what the page held before with what the
     * host posted synchronously on `ready`: before any refresh has had a chance to finish.
     */
    repaint: async (settled: () => Promise<unknown>) => {
      await settled();
      const lastKnown = [...posted];
      reshow();
      return { lastKnown, repainted: [...posted] };
    },
  };
}
