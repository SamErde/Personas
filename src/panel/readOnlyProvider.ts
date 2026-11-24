import * as vscode from 'vscode';
import { asError } from '../core/errors';

const SCHEME = 'personas-readonly';

/**
 * Serves a real on-disk file as a live-updating read-only virtual document. Registered once for
 * the whole extension; the fsPath to read is carried in each request's `query`, set via
 * `vscode.Uri.from` (not string-parsed), so it never needs manual percent-encoding. Contents are
 * read fresh from disk on every provide call, and `refreshOpenDocuments` (driven by the host's
 * file watchers) fires `onDidChange` so open documents re-render after VS Code rewrites a
 * manifest — these are windows onto the live file, not snapshots.
 */
export class PersonasReadOnlyContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly generated = new Map<string, () => string>();

  /**
   * Serves the document titled `label` from `render` instead of from a file on disk, for content
   * Personas composes itself. Like a file, it is rendered again on every provide call.
   */
  registerGenerated(label: string, render: () => string): void {
    this.generated.set(`/${label}`, render);
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const render = uri.query === '' ? this.generated.get(uri.path) : undefined;
    if (render) return render();
    // Fresh read on every invocation — no caching — so each onDidChange fire re-reads disk.
    // A live refresh can race a file that is mid-rewrite or just deleted (VS Code rewrites
    // manifests non-atomically at times), so a read failure renders a short placeholder in the
    // document body instead of throwing and leaving stale content or an opaque editor error.
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(uri.query));
      return Buffer.from(bytes).toString('utf8');
    } catch (e) {
      return `// file could not be read: ${asError(e).message}`;
    }
  }

  /** Signals every open personas-readonly document to re-provide its content from disk. */
  refreshOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === SCHEME) this.changeEmitter.fire(doc.uri);
    }
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

export function registerPersonasReadOnlyProvider(context: vscode.ExtensionContext): PersonasReadOnlyContentProvider {
  const provider = new PersonasReadOnlyContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider), provider);
  return provider;
}

/**
 * Opens `fsPath` as a live read-only virtual document titled with `label` (expected to already
 * make the read-only nature obvious, e.g. "Blog — extensions.json (read-only)"). VS Code owns the
 * real file — this view lets the user browse it without risking an accidental edit, updating in
 * place as the file changes on disk. Never throws: an open failure surfaces as an error toast,
 * and a content read failure renders as placeholder text in the document body (see the provider).
 */
export function openReadOnly(label: string, fsPath: string, languageId = 'json'): Promise<void> {
  return open(label, fsPath, languageId);
}

/** Opens the document registered under `label` with `registerGenerated`. Never throws, like `openReadOnly`. */
export function openGeneratedReadOnly(label: string, languageId: string): Promise<void> {
  return open(label, '', languageId);
}

async function open(label: string, query: string, languageId: string): Promise<void> {
  try {
    const uri = vscode.Uri.from({ scheme: SCHEME, path: `/${label}`, query });
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(doc, languageId).then(undefined, () => undefined);
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (e) {
    void vscode.window.showErrorMessage(
      `Personas: couldn't open "${label}" — ${asError(e).message}`,
    );
  }
}
