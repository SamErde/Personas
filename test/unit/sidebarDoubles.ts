/** Stand-ins for VS Code, shared by the tests of Home's views. */

type Inspected = { globalValue?: boolean; workspaceValue?: boolean; workspaceFolderValue?: boolean };

/** What the tests control and observe in the `vscode` double. Reset it between tests. */
export const vscodeState = {
  /** Commands run through `commands.executeCommand`, in order. */
  commands: [] as string[],
  /** Values the user set, by setting name within `personas`. */
  settings: {} as Record<string, Inspected>,
  /** URLs opened in the browser. */
  opened: [] as string[],
  reset(): void {
    this.commands.length = 0;
    this.opened.length = 0;
    this.settings = {};
  },
};

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
      executeCommand: async (command: string) => {
        vscodeState.commands.push(command);
      },
    },
    window: { showErrorMessage: () => undefined },
    workspace: {
      textDocuments: [],
      getConfiguration: () => ({
        get: <T>(_key: string, fallback: T) => fallback,
        inspect: (key: string) => vscodeState.settings[key],
      }),
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

/** The extension context a view provider is built with. `dispose` releases what the provider registered. */
export function fakeContext() {
  const subscriptions: { dispose(): void }[] = [];
  return {
    context: { subscriptions, extensionUri: { scheme: 'file', fsPath: '/ext/samerde.personas-1.0.0' } } as never,
    dispose: () => subscriptions.splice(0).forEach((item) => item.dispose()),
  };
}

/**
 * A stand-in for one of VS Code's sidebar views. The page's script is not run: a test sends `ready`
 * as the script would, and reads what the host posted to the page.
 */
export function fakeView<ToPage, ToHost extends { type: string }>() {
  const posted: ToPage[] = [];
  let onMessage: (message: ToHost) => void = () => undefined;
  let onVisibility: () => void = () => undefined;
  const view = {
    visible: true,
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
  return {
    view: view as never,
    posted,
    ready,
    send: (message: ToHost) => onMessage(message),
    setVisible,
    /** Hiding the sidebar discards the page; showing it again reloads the script, which sends `ready`. */
    reshow: () => {
      setVisible(false);
      posted.length = 0;
      setVisible(true);
      ready();
    },
  };
}
