import * as vscode from 'vscode';

/**
 * Thin launcher for the activity-bar sidebar view. All matrix logic lives in MatrixPanel; this
 * provider only ever invokes the `showMatrix` command — it never duplicates service logic.
 */
export class WelcomeViewProvider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.html();
    webviewView.webview.onDidReceiveMessage((m: { type: string }) => {
      if (m.type === 'open') void vscode.commands.executeCommand('profileExtensionManager.showMatrix');
    });

    // resolveWebviewView doesn't re-fire on later re-clicks (the view stays resolved once
    // created), so also auto-open on visibility change to visible — this covers re-clicking the
    // activity-bar icon after the matrix editor tab was closed.
    this.maybeAutoOpen();
    // Tie the listener to this webviewView's own lifetime, not just the extension's: if the
    // view is disposed and later re-resolved, a context.subscriptions-only registration would
    // stack a stale listener per resolve. context.subscriptions stays as the outer bound for
    // extension deactivation (Disposable.dispose is idempotent, so double-dispose is safe).
    const visibilityListener = webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.maybeAutoOpen();
    });
    webviewView.onDidDispose(() => visibilityListener.dispose());
    this.context.subscriptions.push(visibilityListener);
  }

  private maybeAutoOpen(): void {
    const enabled = vscode.workspace
      .getConfiguration('profileExtensionManager')
      .get<boolean>('openMatrixOnActivityBarClick', true);
    if (enabled) void vscode.commands.executeCommand('profileExtensionManager.showMatrix');
  }

  private html(): string {
    const nonce = [...Array(24)].map(() => Math.random().toString(36)[2]).join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}';">
<title>Profile Extension Manager</title>
</head>
<body>
<p>The Extension Matrix opens as an editor tab.</p>
<button id="open">Open Extension Matrix</button>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
</script>
</body>
</html>`;
  }
}
